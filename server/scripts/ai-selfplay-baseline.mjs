/**
 * Run the P0-6 v0 baseline in small batches (memory grows across games in one vitest).
 *
 * Default: 100 games, seed 1000, maxTurns 20, 20 sequential batches of 5
 * (AI_SELFPLAY_SHARD=i/20 with AI_SELFPLAY_GAMES=100).
 *
 * Usage: node scripts/ai-selfplay-baseline.mjs
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const outDir = path.join(serverRoot, 'out');

const GAMES = Number(process.env.AI_SELFPLAY_GAMES || 100);
const SEED = Number(process.env.AI_SELFPLAY_SEED || 1000);
const MAX_TURNS = Number(process.env.AI_SELFPLAY_MAX_TURNS || 20);
// One game per vitest process: RSS grows badly across games in a single worker.
const SHARDS = Number(process.env.AI_SELFPLAY_SHARDS || 100);
const HEAP_MB = String(process.env.AI_SELFPLAY_HEAP_MB || 8192);
const START_SHARD = Number(process.env.AI_SELFPLAY_START_SHARD || 0);
// Exclusive end index (default: all shards). Use with START_SHARD to replay one
// batch while keeping AI_SELFPLAY_SHARD=i/SHARDS game mapping (e.g. 103/320).
const END_SHARD = Math.min(
  SHARDS,
  Number(process.env.AI_SELFPLAY_END_SHARD || SHARDS),
);
// Hard kill only after the harness soft wall budget (max(180s, maxTurns*60s)) plus
// overhead. Gate max45 used BATCH_KILL=300s while maxWallClockMs=675s, so slow-but-live
// games were synthetic hard-kills (~5%/run) before softStop could end them.
// +10m overhead for prepareLiveGame / vitest transform so softStop can fire first.
const DEFAULT_BATCH_KILL_MS = Math.max(240_000, MAX_TURNS * 60_000 + 600_000);
const BATCH_KILL_MS = Number(process.env.AI_SELFPLAY_BATCH_KILL_MS || DEFAULT_BATCH_KILL_MS);
// 4 is the cap: each shard is its own vitest process. Four 8GB heaps oversubscribe
// a machine with ~30GB free; use a smaller AI_SELFPLAY_HEAP_MB when PARALLEL=4.
const PARALLEL = Math.max(1, Math.min(4, Number(process.env.AI_SELFPLAY_PARALLEL || 1) || 1));
const QUIET = process.env.AI_SELFPLAY_QUIET === '1';
const ERROR_RE = /(?:\bError\b|\bFAIL\b|selfplay-stall|tick-timeout|turn-stalled|wall-clock-exceeded|oracleIR-telemetry|AssertionError|hard-kill|timed out|Unhandled|FATAL|out of memory)/i;

fs.mkdirSync(outDir, { recursive: true });

const OUT_PREFIX = String(process.env.AI_SELFPLAY_OUT_PREFIX || 'baseline');

function readResultRow(out) {
  try {
    if (!fs.existsSync(out)) return null;
    const lines = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function emitInteresting(index, text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (ERROR_RE.test(trimmed) || trimmed.includes('[selfplay]')) {
      console.log(`[game ${index}] ${new Date().toISOString()} ${trimmed}`);
    }
  }
}

function runShard(index) {
  const out = path.join(outDir, `${OUT_PREFIX}-${index}.jsonl`);
  const logPath = path.join(outDir, `${OUT_PREFIX}-${index}.log`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const startedAt = new Date();
  return new Promise((resolve) => {
    console.log(`[game ${index}] START ${startedAt.toISOString()} shard=${index}/${SHARDS} → ${path.basename(out)}`);
    const child = spawn(
      'npx',
      ['vitest', 'run', 'tests/ai-selfplay.harness.test.ts', '--pool=forks', '--maxWorkers=1'],
      {
        cwd: serverRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
          AI_BRAIN: '',
          LIVE_PRECON_PROGRESS_LOG: '',
          AI_SELFPLAY_GAMES: String(GAMES),
          AI_SELFPLAY_SEED: String(SEED),
          AI_SELFPLAY_MAX_TURNS: String(MAX_TURNS),
          AI_SELFPLAY_SHARD: `${index}/${SHARDS}`,
          AI_SELFPLAY_OUT: out,
          // Optional P1-2/P1-3 position log (one file per shard when AI_POSITIONS_DIR is set).
          // Clear VERIFY unless both positions logging and an explicit verify flag are set —
          // leftover AI_POSITIONS_VERIFY in the parent shell turned 2 gate games into
          // seatFeatures assertion errors.
          AI_POSITIONS_VERIFY:
            process.env.AI_POSITIONS_DIR && process.env.AI_POSITIONS_VERIFY
              ? process.env.AI_POSITIONS_VERIFY
              : '',
          ...(process.env.AI_POSITIONS_DIR
            ? { AI_POSITIONS_FILE: path.join(process.env.AI_POSITIONS_DIR, `pos-${index}.jsonl`) }
            : { AI_POSITIONS_FILE: '' }),
        },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      console.warn(`[batch ${index}] hard-kill after ${BATCH_KILL_MS}ms`);
      try {
        if (process.platform === 'win32' && child.pid) {
          execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    }, BATCH_KILL_MS);
    child.stdout.on('data', (buf) => {
      const text = buf.toString();
      stdout += text;
      logStream.write(text);
      if (QUIET) emitInteresting(index, text);
      else process.stdout.write(`[batch ${index}] ${text}`);
    });
    child.stderr.on('data', (buf) => {
      const text = buf.toString();
      stderr += text;
      logStream.write(text);
      if (QUIET) emitInteresting(index, text);
      else process.stderr.write(`[batch ${index}] ${text}`);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      logStream.end();
      const endedAt = new Date();
      const elapsedMs = endedAt.getTime() - startedAt.getTime();
      let lines = fs.existsSync(out)
        ? fs.readFileSync(out, 'utf8').trim().split(/\r?\n/).filter(Boolean).length
        : 0;
      if (code !== 0 && lines === 0) {
        // Keep the overall baseline moving; record a synthetic error row.
        const progress = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
          .map((l) => l.trim())
          .filter((l) => l.includes('[live-harness:') || l.includes('hard-kill') || ERROR_RE.test(l))
          .slice(-8);
        const errorRow = {
          gameId: `selfplay-${SEED}-batch${index}`,
          seed: (SEED + index * 9973) >>> 0,
          decks: {},
          seatBrains: {},
          seatOrder: [],
          winner: null,
          endReason: 'error',
          turns: 0,
          ms: elapsedMs,
          error: killed
            ? `batch hard-killed after ${BATCH_KILL_MS}ms`
            : `batch exited ${code}`,
          lastProgress: progress,
        };
        fs.appendFileSync(out, `${JSON.stringify(errorRow)}\n`);
        lines = 1;
        console.warn(`[game ${index}] ERROR ${errorRow.error}`);
        if (progress.length) console.warn(`[game ${index}] lastProgress:\n${progress.join('\n')}`);
      }
      const row = readResultRow(out);
      const endReason = row?.endReason || (killed ? 'hard-kill' : `exit-${code}`);
      console.log(
        `[game ${index}] END ${endedAt.toISOString()} elapsedMs=${elapsedMs} exit=${code}` +
          ` end=${endReason} turns=${row?.turns ?? '?'} stallReason=${row?.stallReason || ''}` +
          ` gameId=${row?.gameId || ''} ms=${row?.ms ?? ''}` +
          (row?.error ? ` error=${row.error}` : ''),
      );
      resolve({ index, out, lines, code });
    });
  });
}

console.log(
  `Baseline: ${GAMES} games, seed ${SEED}, maxTurns ${MAX_TURNS}, batches ${SHARDS} [${START_SHARD},${END_SHARD}), parallel=${PARALLEL}, heap=${HEAP_MB}MB, batchKillMs=${BATCH_KILL_MS}, quiet=${QUIET ? 1 : 0}`,
);
const started = Date.now();
const indexes = [];
for (let i = START_SHARD; i < END_SHARD; i++) indexes.push(i);
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < indexes.length) {
    const index = indexes[cursor];
    cursor += 1;
    results.push(await runShard(index));
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL, indexes.length) }, () => worker()));
results.sort((a, b) => a.index - b.index);
const failed = results.filter((r) => r.code && r.code !== 0).length;
if (failed) console.warn(`Batches with non-zero exit: ${failed}/${results.length}`);
console.log(`All batches done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
let total = 0;
for (const r of results) {
  total += r.lines;
  console.log(`  ${path.basename(r.out)}: ${r.lines} games`);
}
console.log(`Total games: ${total}`);
console.log(`Merge with: npm run ai:report -- out/baseline-*.jsonl`);
