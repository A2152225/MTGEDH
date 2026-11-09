/**
 * Self-play JSONL report (P0-6).
 *
 * Usage: npx tsx scripts/selfplay-report.ts out/baseline-*.jsonl
 * Prints end-reason mix, turn/ms percentiles, win share by seat and deck,
 * and Wilson 95% intervals for win rates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'node:fs';

type Row = {
  gameId?: string;
  seed?: number;
  decks?: Record<string, string>;
  seatBrains?: Record<string, string>;
  seatOrder?: string[];
  winner?: string | null;
  endReason?: string;
  turns?: number;
  ms?: number;
  error?: string;
};

function expandArgs(args: string[]): string[] {
  const files: string[] = [];
  for (const arg of args) {
    if (arg.includes('*') || arg.includes('?')) {
      const matches = globSync(arg, { windowsPathsNoEscape: true });
      files.push(...matches);
    } else if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
      files.push(...globSync(path.join(arg, '*.jsonl'), { windowsPathsNoEscape: true }));
    } else {
      files.push(arg);
    }
  }
  return files;
}

function readRows(files: string[]): Row[] {
  const rows: Row[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.warn(`missing: ${file}`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as Row);
      } catch {
        console.warn(`bad line in ${file}: ${line.slice(0, 80)}`);
      }
    }
  }
  return rows;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function wilson(successes: number, n: number, z = 1.96): { low: number; high: number; rate: number } {
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

function main(): void {
  const args = process.argv.slice(2).filter((a) => a && a !== '--');
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/selfplay-report.ts <jsonl...>');
    process.exit(1);
  }
  const files = expandArgs(args);
  const rows = readRows(files);
  console.log(`Files: ${files.length}`);
  console.log(`Games: ${rows.length}`);
  if (rows.length === 0) process.exit(1);

  const byReason = new Map<string, number>();
  for (const row of rows) {
    const reason = String(row.endReason || 'unknown');
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
  }
  console.log('\nEnd reasons:');
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count} (${fmtPct(count / rows.length)})`);
  }

  const turns = rows.map((r) => Number(r.turns) || 0).sort((a, b) => a - b);
  const ms = rows.map((r) => Number(r.ms) || 0).sort((a, b) => a - b);
  console.log('\nTurns: median', percentile(turns, 50), 'p90', percentile(turns, 90));
  console.log('Seconds: median', (percentile(ms, 50) / 1000).toFixed(1), 'p90', (percentile(ms, 90) / 1000).toFixed(1));

  const seatWins = new Map<number, number>();
  const seatGames = new Map<number, number>();
  const deckWins = new Map<string, number>();
  const deckGames = new Map<string, number>();
  const deckBad = new Map<string, number>();

  for (const row of rows) {
    const order = Array.isArray(row.seatOrder) ? row.seatOrder : Object.keys(row.decks || {});
    order.forEach((pid, seatIdx) => {
      seatGames.set(seatIdx, (seatGames.get(seatIdx) || 0) + 1);
      const deckId = row.decks?.[pid];
      if (deckId) deckGames.set(deckId, (deckGames.get(deckId) || 0) + 1);
      if (row.endReason === 'stall' || row.endReason === 'error') {
        if (deckId) deckBad.set(deckId, (deckBad.get(deckId) || 0) + 1);
      }
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
  const winOrLimit = rows.filter((r) => r.endReason === 'win' || r.endReason === 'turn-limit').length;
  const errors = rows.filter((r) => r.endReason === 'error').length;
  const turnLimits = rows.filter((r) => r.endReason === 'turn-limit').length;
  console.log('\nGate signals:');
  console.log(`  win or turn-limit: ${winOrLimit}/${rows.length}`);
  console.log(`  errors: ${errors}`);
  console.log(`  turn-limit share: ${fmtPct(turnLimits / rows.length)}`);
  console.log(`  finished wins: ${finished}`);

  const topBad = [...deckBad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topBad.length) {
    console.log('\nDecks with most stall/error appearances:');
    for (const [deck, count] of topBad) {
      console.log(`  ${deck}: ${count}`);
    }
  }

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

main();
