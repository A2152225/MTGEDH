/**
 * Dual-run self-play determinism check (P0-3).
 * Runs the harness twice with the same seed and compares JSONL lines (ignoring ms).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const outA = path.join(serverRoot, 'out', 'selfplay-det-a.jsonl');
const outB = path.join(serverRoot, 'out', 'selfplay-det-b.jsonl');

for (const p of [outA, outB]) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function run(out) {
  const env = {
    ...process.env,
    AI_SELFPLAY_GAMES: process.env.AI_SELFPLAY_GAMES || '1',
    AI_SELFPLAY_SEED: process.env.AI_SELFPLAY_SEED || '1',
    AI_SELFPLAY_MAX_TURNS: process.env.AI_SELFPLAY_MAX_TURNS || '8',
    AI_SELFPLAY_OUT: out,
  };
  const result = spawnSync('npx', ['vitest', 'run', 'tests/ai-selfplay.harness.test.ts'], {
    cwd: serverRoot,
    env,
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status || 1);
  }
}

function normalizeLine(line) {
  const row = JSON.parse(line);
  delete row.ms;
  // Player ids are assigned by join and are not seeded; remap by seat order.
  const seatOrder = Array.isArray(row.seatOrder) ? row.seatOrder : [];
  const idMap = new Map(seatOrder.map((id, i) => [String(id), `seat${i}`]));
  const remapKeyObj = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[idMap.get(String(k)) || String(k)] = v;
    }
    return out;
  };
  row.decks = remapKeyObj(row.decks);
  row.seatBrains = remapKeyObj(row.seatBrains);
  row.seatOrder = seatOrder.map((_, i) => `seat${i}`);
  if (row.winner != null) row.winner = idMap.get(String(row.winner)) || row.winner;
  return JSON.stringify(row);
}

run(outA);
run(outB);

const a = fs.readFileSync(outA, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(normalizeLine);
const b = fs.readFileSync(outB, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(normalizeLine);

if (a.length === 0 || a.length !== b.length) {
  console.error(`Line count mismatch: ${a.length} vs ${b.length}`);
  process.exit(1);
}

for (let i = 0; i < a.length; i++) {
  if (a[i] !== b[i]) {
    console.error(`Mismatch at line ${i + 1}`);
    console.error('A:', a[i]);
    console.error('B:', b[i]);
    process.exit(1);
  }
}

console.log(`Determinism OK: ${a.length} game(s) identical (ms ignored).`);
