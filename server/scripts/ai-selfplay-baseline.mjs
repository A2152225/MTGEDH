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
// Hard kill when a batch wedges the event loop (wall-clock Promise.race cannot fire).
const BATCH_KILL_MS = Number(process.env.AI_SELFPLAY_BATCH_KILL_MS || 240_000);

fs.mkdirSync(outDir, { recursive: true });

function runShard(index) {
  const out = path.join(outDir, `baseline-${index}.jsonl`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  return new Promise((resolve, reject) => {
    console.log(`[batch ${index}/${SHARDS}] starting → ${path.basename(out)}`);
    const child = spawn(
      'npx',
      ['vitest', 'run', 'tests/ai-selfplay.harness.test.ts', '--pool=forks', '--maxWorkers=1'],
      {
        cwd: serverRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
          AI_SELFPLAY_GAMES: String(GAMES),
          AI_SELFPLAY_SEED: String(SEED),
          AI_SELFPLAY_MAX_TURNS: String(MAX_TURNS),
          AI_SELFPLAY_SHARD: `${index}/${SHARDS}`,
          AI_SELFPLAY_OUT: out,
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
      process.stdout.write(`[batch ${index}] ${text}`);
    });
    child.stderr.on('data', (buf) => {
      const text = buf.toString();
      stderr += text;
      process.stderr.write(`[batch ${index}] ${text}`);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      const lines = fs.existsSync(out)
        ? fs.readFileSync(out, 'utf8').trim().split(/\r?\n/).filter(Boolean).length
        : 0;
      console.log(`[batch ${index}/${SHARDS}] done code=${code} games=${lines}`);
      if (code !== 0 && lines === 0) {
        // Keep the overall baseline moving; record a synthetic error row.
        const row = {
          gameId: `selfplay-${SEED}-batch${index}`,
          seed: (SEED + index * 9973) >>> 0,
          decks: {},
          seatBrains: {},
          seatOrder: [],
          winner: null,
          endReason: 'error',
          turns: 0,
          ms: 0,
          error: killed ? `batch hard-killed after ${BATCH_KILL_MS}ms` : `batch exited ${code}`,
        };
        fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
        console.warn(`[batch ${index}] wrote synthetic error row`);
      }
      resolve({ index, out, lines: Math.max(lines, code !== 0 && lines === 0 ? 1 : lines), code });
    });
  });
}

console.log(
  `Baseline: ${GAMES} games, seed ${SEED}, maxTurns ${MAX_TURNS}, batches ${SHARDS} (from ${START_SHARD}), heap=${HEAP_MB}MB`,
);
const started = Date.now();
const results = [];
for (let i = START_SHARD; i < SHARDS; i++) {
  results.push(await runShard(i));
}
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
