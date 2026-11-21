/**
 * Re-run specific self-play shards. The pre-fix gate row is invalid once a
 * rerun finishes: win, turn-limit, stall, or error all replace
 * gate-p2-v2-<shard>.jsonl. A missing row leaves the original in place.
 *
 *   RERUN_SHARDS=28,29 RERUN_PARALLEL=2 node scripts/ai-selfplay-rerun-shards.mjs
 *   PROMOTE_WATCH=1 PROMOTE_PARENT_PID=<rerun pid> RERUN_SHARDS=... node scripts/ai-selfplay-rerun-shards.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(serverRoot, 'out');
const shards = String(process.env.RERUN_SHARDS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const parallel = Math.max(1, Math.min(3, Number(process.env.RERUN_PARALLEL || 2) || 2));
const cachePrefix = 'gate-p2-cache';
const livePrefix = 'gate-p2-v2';

function readRow(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  } catch {
    return null;
  }
}

function promoteShard(index) {
  const cached = path.join(outDir, `${cachePrefix}-${index}.jsonl`);
  const row = readRow(cached);
  if (!row?.endReason) {
    return false;
  }
  const live = path.join(outDir, `${livePrefix}-${index}.jsonl`);
  const liveRow = readRow(live);
  const same = liveRow
    && liveRow.endReason === row.endReason
    && liveRow.turns === row.turns
    && liveRow.ms === row.ms
    && (liveRow.stallReason || '') === (row.stallReason || '');
  if (!same) {
    fs.copyFileSync(cached, live);
    console.log(`[replace] shard ${index} ${row.endReason} turns=${row.turns} stallReason=${row.stallReason || ''} -> ${livePrefix}-${index}.jsonl`);
  }
  return true;
}

function parentAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function watchPromotions() {
  const parentPid = Number(process.env.PROMOTE_PARENT_PID || 0);
  const pending = new Set(shards);
  while (pending.size > 0) {
    for (const index of [...pending]) {
      if (promoteShard(index)) pending.delete(index);
    }
    if (pending.size === 0) break;
    if (parentPid && !parentAlive(parentPid)) break;
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  for (const index of [...pending]) promoteShard(index);
  console.log(`[promote] done pending=${[...pending].join(',') || 'none'} ${new Date().toISOString()}`);
}

function runShard(index) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/ai-selfplay-baseline.mjs'], {
      cwd: serverRoot,
      env: {
        ...process.env,
        AI_BRAIN: '',
        LIVE_PRECON_PROGRESS_LOG: '',
        AI_SELFPLAY_GAMES: '320',
        AI_SELFPLAY_SEED: '7000',
        AI_SELFPLAY_MAX_TURNS: '90',
        AI_SELFPLAY_SHARDS: '320',
        AI_SELFPLAY_CHALLENGER: 'v2',
        AI_SELFPLAY_BASELINE: 'v1',
        AI_SELFPLAY_HEAP_MB: process.env.AI_SELFPLAY_HEAP_MB || '4096',
        AI_SELFPLAY_OUT_PREFIX: cachePrefix,
        AI_SELFPLAY_START_SHARD: String(index),
        AI_SELFPLAY_END_SHARD: String(index + 1),
        AI_SELFPLAY_PARALLEL: '1',
        AI_SELFPLAY_QUIET: '1',
        AI_SELFPLAY_WALL_PER_TURN_MS: '60000',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('close', () => {
      if (!promoteShard(index)) {
        const row = readRow(path.join(outDir, `${cachePrefix}-${index}.jsonl`));
        console.log(`[keep] shard ${index} ${row?.endReason || 'missing'} stallReason=${row?.stallReason || ''} original left in place`);
      }
      resolve();
    });
  });
}

if (shards.length === 0) {
  console.error('Set RERUN_SHARDS=8,28,29');
  process.exit(1);
}

if (process.env.PROMOTE_WATCH === '1') {
  await watchPromotions();
  process.exit(0);
}

console.log(`[rerun] shards=${shards.join(',')} parallel=${parallel} ${new Date().toISOString()}`);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(parallel, shards.length) }, async () => {
  while (cursor < shards.length) {
    const index = shards[cursor];
    cursor += 1;
    await runShard(index);
  }
}));
console.log(`[rerun] done ${new Date().toISOString()}`);
