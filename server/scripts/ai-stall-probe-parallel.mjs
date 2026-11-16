/**
 * Run stall-probe shards in parallel (isolated vitest processes).
 *
 * Fake timers are process-global, so shards MUST NOT share a worker. This
 * runner caps concurrency (default 3) and launches one vitest process per shard.
 *
 * Usage:
 *   node scripts/ai-stall-probe-parallel.mjs
 *   PROBE_STALL_SHARDS=1,2,19,43,48,54 PROBE_STALL_PARALLEL=3 node scripts/ai-stall-probe-parallel.mjs
 *
 * Per-shard logs: out/probe-stall-<index>.log
 * Per-shard JSON: out/probe-stall-<index>.json (written by the test)
 * Summary:        out/probe-stall-summary.json
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const outDir = path.join(serverRoot, 'out');

const SHARDS = String(process.env.PROBE_STALL_SHARDS || '1,2,19,43,48,54')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const PARALLEL = Math.max(1, Math.min(8, Number(process.env.PROBE_STALL_PARALLEL || 3) || 3));
const HEAP_MB = String(process.env.PROBE_STALL_HEAP_MB || process.env.AI_SELFPLAY_HEAP_MB || 8192);
const KILL_MS = Number(process.env.PROBE_STALL_KILL_MS || 1_200_000); // 20 min hard ceiling per shard

fs.mkdirSync(outDir, { recursive: true });

function runShard(gameIndex) {
  const logPath = path.join(outDir, `probe-stall-${gameIndex}.log`);
  const jsonPath = path.join(outDir, `probe-stall-${gameIndex}.json`);
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

  const startedAt = new Date().toISOString();
  const startedHr = process.hrtime.bigint();
  console.log(`[probe-parallel] START shard=${gameIndex} at=${startedAt} → ${path.basename(logPath)}`);

  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      [
        'vitest',
        'run',
        '--config',
        'vitest.config.ts',
        'tests/_tmp-probe-stall-fix.test.ts',
        '--pool=forks',
        '--maxWorkers=1',
        '--reporter=verbose',
      ],
      {
        cwd: serverRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
          PROBE_STALL_SHARDS: String(gameIndex),
          PROBE_STALL_OUT: jsonPath,
          LIVE_PRECON_PROGRESS_LOG: process.env.LIVE_PRECON_PROGRESS_LOG || '1',
          AI_SELFPLAY_CHALLENGER: process.env.AI_SELFPLAY_CHALLENGER || 'v2',
          AI_SELFPLAY_BASELINE: process.env.AI_SELFPLAY_BASELINE || 'v1',
        },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const killer = setTimeout(() => {
      killed = true;
      console.warn(`[probe-parallel] HARD-KILL shard=${gameIndex} after ${KILL_MS}ms`);
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 5_000).unref?.();
    }, KILL_MS);

    const onData = (chunk, isErr) => {
      const text = chunk.toString();
      if (isErr) stderr += text;
      else stdout += text;
      logStream.write(text);
    };
    child.stdout?.on('data', (c) => onData(c, false));
    child.stderr?.on('data', (c) => onData(c, true));

    child.on('close', (code) => {
      clearTimeout(killer);
      logStream.end();
      const endedAt = new Date().toISOString();
      const ms = Math.round(Number(process.hrtime.bigint() - startedHr) / 1e6);

      let result = null;
      try {
        if (fs.existsSync(jsonPath)) {
          result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        }
      } catch (err) {
        result = { parseError: String(err) };
      }
      if (!result) {
        // Vitest can die mid-game (OOM / hard kill) before PROBE_STALL_OUT is written.
        const failLine =
          [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
            .reverse()
            .find((line) => /FAIL|FATAL|out of memory|heap|tick-timeout|timers APIs/i.test(line)) || null;
        const turnMatch = [...stdout.split(/\r?\n/)]
          .reverse()
          .find((line) => /advanced-turn-(\d+)/.test(line));
        const turns = turnMatch ? Number((turnMatch.match(/advanced-turn-(\d+)/) || [])[1] || 0) : null;
        result = {
          gameIndex,
          endReason: killed ? 'hard-kill' : 'process-exit',
          turns,
          exitCode: code,
          error: failLine || `vitest exited ${code} without PROBE_STALL_OUT`,
          errors: failLine ? [failLine.slice(0, 500)] : [],
          errorCount: failLine ? 1 : 0,
        };
        try {
          fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
        } catch {
          // ignore
        }
      }

      const row = {
        gameIndex,
        startedAt,
        endedAt,
        ms,
        exitCode: code,
        killed,
        result,
        // Keep a short error digest from the process logs for the summary.
        logErrors: [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
          .filter((line) =>
            /(?:Error:|FAIL|tick-timeout|turn-stalled|Force-mark|oracleIR-telemetry|all_or_nothing|timers APIs)/i.test(
              line,
            ),
          )
          .slice(0, 40),
      };

      console.log(
        `[probe-parallel] END shard=${gameIndex} at=${endedAt} ms=${ms} exit=${code}` +
          ` endReason=${result?.endReason ?? (killed ? 'hard-kill' : 'unknown')}` +
          ` turns=${result?.turns ?? '?'} errors=${(result?.errors || []).length}`,
      );
      if ((result?.errors || []).length > 0) {
        for (const err of result.errors.slice(0, 12)) {
          console.log(`  [shard ${gameIndex} error] ${String(err).slice(0, 240)}`);
        }
      }
      resolve(row);
    });
  });
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

const batchStartedAt = new Date().toISOString();
console.log(
  `[probe-parallel] batch START at=${batchStartedAt} shards=${SHARDS.join(',')} parallel=${PARALLEL}`,
);

const rows = await runPool(SHARDS, PARALLEL, runShard);
const summary = {
  startedAt: batchStartedAt,
  endedAt: new Date().toISOString(),
  parallel: PARALLEL,
  shards: SHARDS,
  rows,
  tallies: rows.reduce((acc, row) => {
    const reason = row?.result?.endReason || (row?.killed ? 'hard-kill' : `exit-${row?.exitCode}`);
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {}),
};

const summaryPath = path.join(outDir, 'probe-stall-summary.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[probe-parallel] batch END summary → ${path.basename(summaryPath)}`);
console.log(`[probe-parallel] tallies ${JSON.stringify(summary.tallies)}`);

const bad = rows.filter((r) => r.killed || r.exitCode !== 0 || r.result?.endReason === 'stall');
process.exit(bad.length > 0 ? 1 : 0);
