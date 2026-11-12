/**
 * Self-play JSONL report (P0-6) and Phase 1 gate mode (P1-6).
 *
 * Usage:
 *   npx tsx scripts/selfplay-report.ts out/baseline-*.jsonl
 *   npx tsx scripts/selfplay-report.ts --mode gate --challenger 'out/gate-v1-*.jsonl' \
 *     --control 'out/gate-v0-*.jsonl' [--puzzles-v0 out/puzzles-v0.json] \
 *     [--puzzles-v1 out/puzzles-v1.json] [--out docs/ai-phase1-gate.md]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expandGlobs,
  mulberry32,
  podOf,
  readJsonlRows,
  type ResultRow,
} from './lib/selfplayRows.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

type PuzzleOut = {
  brain?: string;
  total: number;
  passed: number;
  results?: Array<{ id: string; status: string }>;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

function wilson(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number; rate: number } {
  if (n <= 0) return { low: 0, high: 0, rate: 0 };
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return {
    rate: phat,
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

function fmtPct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

function share(rows: ResultRow[], f: (r: ResultRow) => boolean): number {
  if (!rows.length) return 0;
  return rows.filter(f).length / rows.length;
}

function challengerSeat(r: ResultRow, brain = 'v1'): string | undefined {
  const brains = r.seatBrains || {};
  return Object.keys(brains).find((id) => brains[id] === brain);
}

function challengerWon(r: ResultRow, brain = 'v1'): boolean {
  const seat = challengerSeat(r, brain);
  return Boolean(seat && r.winner && r.winner === seat);
}

function podBootstrap(
  pods: Array<{ wins: number; games: number }>,
  B: number,
  rng: () => number,
): { low: number; high: number } {
  if (!pods.length) return { low: 0, high: 0 };
  const rates: number[] = [];
  for (let b = 0; b < B; b++) {
    let w = 0;
    let g = 0;
    for (let i = 0; i < pods.length; i++) {
      const p = pods[Math.floor(rng() * pods.length)];
      w += p.wins;
      g += p.games;
    }
    rates.push(g ? w / g : 0);
  }
  rates.sort((a, b) => a - b);
  return {
    low: rates[Math.floor(0.025 * B)] ?? 0,
    high: rates[Math.min(rates.length - 1, Math.floor(0.975 * B))] ?? 0,
  };
}

function endReasonMix(rows: ResultRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r.endReason || 'unknown');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function parseGateArgs(argv: string[]) {
  const out: {
    challenger: string[];
    control: string[];
    puzzlesV0?: string;
    puzzlesV1?: string;
    outPath?: string;
    seed: number;
  } = { challenger: [], control: [], seed: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--challenger') out.challenger.push(argv[++i]);
    else if (a === '--control') out.control.push(argv[++i]);
    else if (a === '--puzzles-v0') out.puzzlesV0 = argv[++i];
    else if (a === '--puzzles-v1') out.puzzlesV1 = argv[++i];
    else if (a === '--out') out.outPath = argv[++i];
    else if (a === '--seed') out.seed = Number(argv[++i]) || 1;
  }
  return out;
}

function loadPuzzles(file?: string): PuzzleOut | null {
  if (!file) return null;
  const p = path.isAbsolute(file) ? file : path.resolve(serverRoot, file);
  if (!fs.existsSync(p)) {
    console.warn(`missing puzzles file: ${p}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as PuzzleOut;
}

function reportBasic(files: string[]): void {
  const rows = readJsonlRows<ResultRow>(files);
  console.log(`Files: ${files.length}`);
  console.log(`Games: ${rows.length}`);
  if (rows.length === 0) process.exit(1);

  const byReason = endReasonMix(rows);
  console.log('\nEnd reasons:');
  for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count} (${fmtPct(count / rows.length)})`);
  }

  const turns = rows.map((r) => Number(r.turns) || 0).sort((a, b) => a - b);
  const ms = rows.map((r) => Number(r.ms) || 0).sort((a, b) => a - b);
  console.log('\nTurns: median', percentile(turns, 50), 'p90', percentile(turns, 90));
  console.log(
    'Seconds: median',
    (percentile(ms, 50) / 1000).toFixed(1),
    'p90',
    (percentile(ms, 90) / 1000).toFixed(1),
  );

  const seatWins = new Map<number, number>();
  const seatGames = new Map<number, number>();
  const deckWins = new Map<string, number>();
  const deckGames = new Map<string, number>();

  for (const row of rows) {
    const order = Array.isArray(row.seatOrder) ? row.seatOrder : Object.keys(row.decks || {});
    order.forEach((pid, seatIdx) => {
      seatGames.set(seatIdx, (seatGames.get(seatIdx) || 0) + 1);
      const deckId = row.decks?.[pid];
      if (deckId) deckGames.set(deckId, (deckGames.get(deckId) || 0) + 1);
    });
    if (row.winner && order.includes(row.winner)) {
      const seatIdx = order.indexOf(row.winner);
      seatWins.set(seatIdx, (seatWins.get(seatIdx) || 0) + 1);
      const deckId = row.decks?.[row.winner];
      if (deckId) deckWins.set(deckId, (deckWins.get(deckId) || 0) + 1);
    }
  }

  console.log('\nWin share by seat:');
  for (let seat = 0; seat < 4; seat++) {
    const n = seatGames.get(seat) || 0;
    const w = seatWins.get(seat) || 0;
    const interval = wilson(w, n);
    console.log(
      `  seat${seat}: ${w}/${n} = ${fmtPct(interval.rate)} [${fmtPct(interval.low)}, ${fmtPct(interval.high)}]`,
    );
  }

  const finished = rows.filter((r) => r.endReason === 'win').length;
  const winOrLimit = rows.filter(
    (r) => r.endReason === 'win' || r.endReason === 'turn-limit',
  ).length;
  const errors = rows.filter((r) => r.endReason === 'error').length;
  const turnLimits = rows.filter((r) => r.endReason === 'turn-limit').length;
  console.log('\nGate signals:');
  console.log(`  win or turn-limit: ${winOrLimit}/${rows.length}`);
  console.log(`  errors: ${errors}`);
  console.log(`  turn-limit share: ${fmtPct(turnLimits / rows.length)}`);
  console.log(`  finished wins: ${finished}`);

  const topDecks = [...deckWins.entries()]
    .map(([deck, wins]) => ({ deck, wins, games: deckGames.get(deck) || 0 }))
    .filter((d) => d.games > 0)
    .sort((a, b) => b.wins / b.games - a.wins / a.games)
    .slice(0, 10);
  if (topDecks.length) {
    console.log('\nTop win-rate decks (raw):');
    for (const d of topDecks) {
      console.log(`  ${d.deck}: ${d.wins}/${d.games} (${fmtPct(d.wins / d.games)})`);
    }
  }
}

function reportGate(argv: string[]): void {
  const args = parseGateArgs(argv);
  const challengerFiles = expandGlobs(args.challenger, serverRoot);
  const controlFiles = expandGlobs(args.control, serverRoot);
  const v1 = readJsonlRows<ResultRow>(challengerFiles);
  const v0 = readJsonlRows<ResultRow>(controlFiles);
  if (!v1.length) {
    console.error('No challenger rows');
    process.exit(1);
  }
  if (!v0.length) {
    console.error('No control rows');
    process.exit(1);
  }

  // Equal-strength share is 25% of decisive games. Turn-limits/stalls/errors are
  // not challenger losses — score win rate among endReason=win only.
  const finished = v1.filter((r) => r.endReason === 'win');
  const wins = finished.filter((r) => challengerWon(r)).length;
  const n = finished.length;
  const wInt = wilson(wins, n);
  const byPod = new Map<string, ResultRow[]>();
  for (const r of finished) {
    const pod = podOf(String(r.gameId || ''));
    if (!byPod.has(pod)) byPod.set(pod, []);
    byPod.get(pod)!.push(r);
  }
  const pods = [...byPod.values()].map((g) => ({
    wins: g.filter((r) => challengerWon(r)).length,
    games: g.length,
  }));
  const bInt = podBootstrap(pods, 10_000, mulberry32(args.seed));
  const lowerBound = n > 0 ? Math.min(wInt.low, bInt.low) : 0;
  const absWins = v1.filter((r) => challengerWon(r)).length;
  const absInt = wilson(absWins, v1.length);

  const bad = (r: ResultRow) => r.endReason === 'stall' || r.endReason === 'error';
  const v1Bad = share(v1, bad);
  const v0Bad = share(v0, bad);
  const v1Med = median(v1.map((r) => Number(r.ms) || 0));
  const v0Med = median(v0.map((r) => Number(r.ms) || 0));
  const puzzlesV0 = loadPuzzles(args.puzzlesV0);
  const puzzlesV1 = loadPuzzles(args.puzzlesV1);
  const puzzlePass =
    !puzzlesV0 || !puzzlesV1 ? true : puzzlesV1.passed >= puzzlesV0.passed;

  const checks = {
    winRate: lowerBound > 0.25,
    stalls: v1Bad <= v0Bad + 2 / Math.max(v1.length, 1), // allow 2-game noise margin
    seconds: v1Med <= 1.25 * v0Med,
    puzzles: puzzlePass,
  };
  const pass = checks.winRate && checks.stalls && checks.seconds && checks.puzzles;

  const v1Mix = endReasonMix(v1);
  const v0Mix = endReasonMix(v0);
  const v1P90 = percentile(
    v1.map((r) => Number(r.ms) || 0).sort((a, b) => a - b),
    90,
  );
  const v0P90 = percentile(
    v0.map((r) => Number(r.ms) || 0).sort((a, b) => a - b),
    90,
  );

  const report = `# AI Phase 1 gate (v1 vs v0)

Decision: _pending review_

## Verdict

| Check | Result | Detail |
| --- | --- | --- |
| Challenger win-rate LB > 25% (among finished) | **${checks.winRate ? 'PASS' : 'FAIL'}** | lower=${fmtPct(lowerBound)} (Wilson ${fmtPct(wInt.low)}, bootstrap ${fmtPct(bInt.low)}); finished=${n}/${v1.length} |
| Stall+error share ≤ control (+2/n margin) | **${checks.stalls ? 'PASS' : 'FAIL'}** | v1 ${fmtPct(v1Bad)} vs v0 ${fmtPct(v0Bad)} |
| Median ms ≤ 1.25× control | **${checks.seconds ? 'PASS' : 'FAIL'}** | v1 ${(v1Med / 1000).toFixed(1)}s vs v0 ${(v0Med / 1000).toFixed(1)}s (ratio ${(v0Med ? v1Med / v0Med : 0).toFixed(2)}) |
| Puzzles ≥ v0 | **${checks.puzzles ? 'PASS' : 'FAIL'}** | v1 ${puzzlesV1?.passed ?? 'n/a'}/${puzzlesV1?.total ?? 'n/a'} vs v0 ${puzzlesV0?.passed ?? 'n/a'}/${puzzlesV0?.total ?? 'n/a'} |

**Overall: ${pass ? 'PASS' : 'FAIL'}**

## Challenger win rate

- Among finished (endReason=win): **${wins}/${n}** (${fmtPct(wInt.rate)})
- Absolute (all games, incl. turn-limit): **${absWins}/${v1.length}** (${fmtPct(absInt.rate)})
- Wilson 95% (finished): [${fmtPct(wInt.low)}, ${fmtPct(wInt.high)}]
- Pod bootstrap 95% (finished): [${fmtPct(bInt.low)}, ${fmtPct(bInt.high)}]
- Gate lower bound: **${fmtPct(lowerBound)}**

## End reasons

| Reason | v1 | v0 |
| --- | --- | --- |
${[...new Set([...Object.keys(v1Mix), ...Object.keys(v0Mix)])]
  .map(
    (k) =>
      `| ${k} | ${v1Mix[k] || 0} (${fmtPct((v1Mix[k] || 0) / v1.length)}) | ${v0Mix[k] || 0} (${fmtPct((v0Mix[k] || 0) / v0.length)}) |`,
  )
  .join('\n')}

## Timing

| Metric | v1 | v0 |
| --- | --- | --- |
| Median seconds | ${(v1Med / 1000).toFixed(1)} | ${(v0Med / 1000).toFixed(1)} |
| p90 seconds | ${(v1P90 / 1000).toFixed(1)} | ${(v0P90 / 1000).toFixed(1)} |

## Files

- Challenger: ${challengerFiles.length} files, ${v1.length} games
- Control: ${controlFiles.length} files, ${v0.length} games
- Seed: 3000+ (gate); report seed ${args.seed}
`;

  console.log(report);
  if (args.outPath) {
    const outPath = path.isAbsolute(args.outPath)
      ? args.outPath
      : path.resolve(repoRoot, args.outPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report);
    console.log(`Wrote ${outPath}`);
  }
  if (!pass) process.exitCode = 1;
}

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a && a !== '--');
  if (argv.includes('--mode') && argv[argv.indexOf('--mode') + 1] === 'gate') {
    reportGate(argv.filter((a, i) => a !== '--mode' && argv[i - 1] !== '--mode'));
    return;
  }
  if (argv.length === 0) {
    console.error('Usage: npx tsx scripts/selfplay-report.ts <jsonl...>');
    console.error(
      '   or: npx tsx scripts/selfplay-report.ts --mode gate --challenger <glob> --control <glob>',
    );
    process.exit(1);
  }
  const files = expandGlobs(argv, serverRoot);
  reportBasic(files);
}

main();
