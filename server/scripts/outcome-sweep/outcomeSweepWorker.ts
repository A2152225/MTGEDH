/**
 * Outcome sweep worker: runs a slice of the selection file in-process and appends one JSON line per
 * card to results.<worker>.jsonl. Spawned by outcomeSweepCli.ts; writes inflight.<worker>.json
 * before each card so the parent can attribute a hard hang or crash to the card that caused it.
 *
 * Args: --cards-file F --from A --to B --out DIR --worker-id W [--timeout MS] [--verbose]
 */
import './sweepEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { calibrateSweepNoise, sweepOneCard } from './sweepDriver.js';
import { initOutcomeSweepHarness, installSweepConsoleCapture } from './sweepHarness.js';
import type { SweepCard } from './sweepBoard.js';

function arg(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

async function main(): Promise<void> {
  const cardsFile = arg('--cards-file');
  const from = Number(arg('--from') || 0);
  const to = Number(arg('--to') || 0);
  const outDir = arg('--out');
  const workerId = arg('--worker-id') || '0';
  const timeoutMs = Number(arg('--timeout') || 20000);
  const skipNames = new Set<string>(arg('--skip-file') && fs.existsSync(arg('--skip-file')) ? JSON.parse(fs.readFileSync(arg('--skip-file'), 'utf8')) : []);
  installSweepConsoleCapture(process.argv.includes('--verbose'));
  const cards = (JSON.parse(fs.readFileSync(cardsFile, 'utf8')) as SweepCard[]).slice(from, to);
  const resultsFile = path.join(outDir, `results.${workerId}.jsonl`);
  const inflightFile = path.join(outDir, `inflight.${workerId}.json`);
  await initOutcomeSweepHarness();
  const noise = await calibrateSweepNoise();
  fs.writeFileSync(path.join(outDir, `noise.${workerId}.json`), JSON.stringify(noise), 'utf8');
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (skipNames.has(String(card.name))) continue;
    fs.writeFileSync(inflightFile, JSON.stringify({ name: card.name, set: card.set, typeLine: card.type_line, at: Date.now() }), 'utf8');
    const outcome = await sweepOneCard(card, { index: from + i, timeoutMs });
    fs.appendFileSync(resultsFile, `${JSON.stringify(outcome)}\n`, 'utf8');
  }
  try { fs.rmSync(inflightFile, { force: true }); } catch { /* best effort */ }
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`[outcome-sweep worker] fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
