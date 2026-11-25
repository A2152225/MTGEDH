/*
  Per-card outcome sweep: drives every card's cast / play, ETB, activated abilities and death
  trigger through the real socket paths on a minimal 2-player board and classifies each as
  ok / noop / throw / stuck / skipped. Catches abilities that are "handled" by the census but
  resolve without changing state at runtime.

  Usage (from server/):
    npm run sweep:outcomes -- --sample 500 --out D:/tmp/mtgpatch/outcome-sweep
    npm run sweep:outcomes -- --set mh3 --limit 50
    npm run sweep:outcomes -- --name "lightning bolt,llanowar elves" --exact
    npm run sweep:outcomes -- --chunk 200 --workers 4 --resume        (full run, resumable)
    npm run sweep:outcomes -- --report-only --out <dir>                 (rebuild summary)
    npm run sweep:outcomes -- --report-only --out <dir> --compare <prevDir>   (per-card class diff)

  Flags: --limit N --offset N --set a,b --name x,y [--exact] --sample N (hash-mixed sets)
         --chunk N (cards per worker process, default 200) --workers K (default 1, max 8)
         --timeout MS (per card, default 20000) --resume --report-only --out DIR --verbose
         --include-upcoming (also unreleased paper cards, like the census)
         --compare PREV_DIR (after the run or with --report-only: compare.txt / compare.json in --out)
         --name accepts `|` as the separator when names contain commas ("Kai Winn, Faithless Leader|Opt")

  Output: results.<worker>.jsonl (one line per card), summary.json, summary.txt, failures.json,
  cards.json (the selection), run-meta.json. Default dir: server/scripts/out/outcome-sweep.
*/
import './sweepEnv.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSweepArgs, selectSweepCards } from './sweepSelect.js';
import { readSweepResults, writeSweepReport } from './sweepReport.js';
import { comparisonHeadline, writeSweepComparison } from './sweepCompare.js';
import type { SweepCard } from './sweepBoard.js';

const WORKER = fileURLToPath(new URL('./outcomeSweepWorker.ts', import.meta.url));

function log(line: string): void {
  process.stdout.write(`[outcome-sweep] ${line}\n`);
}

function doneNames(outDir: string): Set<string> {
  return new Set(readSweepResults(outDir).map((card) => card.name));
}

function freshOutputDir(outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(outDir)) {
    if (/^(?:results|inflight|skip|noise)\.\d+\.json(?:l)?$/.test(name) || /^(?:summary\.(?:json|txt)|failures\.json|compare\.(?:json|txt))$/.test(name)) {
      fs.rmSync(path.join(outDir, name), { force: true });
    }
  }
}

type ChunkContext = { cards: SweepCard[]; cardsFile: string; outDir: string; timeoutMs: number; verbose: boolean };

function runWorkerOnce(ctx: ChunkContext, from: number, to: number, slot: number): Promise<{ code: number | null; hung: boolean }> {
  const skipFile = path.join(ctx.outDir, `skip.${slot}.json`);
  const done = doneNames(ctx.outDir);
  fs.writeFileSync(skipFile, JSON.stringify(ctx.cards.slice(from, to).map((card) => card.name).filter((name) => done.has(String(name)))), 'utf8');
  const inflight = path.join(ctx.outDir, `inflight.${slot}.json`);
  const args = [...process.execArgv, '--max-old-space-size=4096', WORKER, '--cards-file', ctx.cardsFile, '--from', String(from), '--to', String(to),
    '--out', ctx.outDir, '--worker-id', String(slot), '--timeout', String(ctx.timeoutMs), '--skip-file', skipFile, ...(ctx.verbose ? ['--verbose'] : [])];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    let hung = false;
    const watchdog = setInterval(() => {
      try {
        const at = Number(JSON.parse(fs.readFileSync(inflight, 'utf8')).at || 0);
        if (at && Date.now() - at > ctx.timeoutMs * 3 + 30000) {
          hung = true;
          child.kill();
        }
      } catch { /* no card in flight */ }
    }, 5000);
    child.on('exit', (code) => {
      clearInterval(watchdog);
      resolve({ code, hung });
    });
  });
}

async function runChunk(ctx: ChunkContext, from: number, to: number, slot: number): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const done = doneNames(ctx.outDir);
    if (ctx.cards.slice(from, to).every((card) => done.has(String(card.name)))) return;
    const { code, hung } = await runWorkerOnce(ctx, from, to, slot);
    if (code === 0 && !hung) continue;
    const inflight = path.join(ctx.outDir, `inflight.${slot}.json`);
    let card: any;
    try { card = JSON.parse(fs.readFileSync(inflight, 'utf8')); } catch { card = undefined; }
    fs.rmSync(inflight, { force: true });
    if (!card?.name) {
      log(`worker ${slot} exited ${code} with no card in flight; giving up on ${from}-${to}`);
      return;
    }
    const detail = hung ? 'worker_hang' : `worker_crash:${code}`;
    log(`worker ${slot} ${detail} on ${card.name}; recording it and continuing`);
    const record = { name: card.name, set: card.set, typeLine: card.typeLine || '', class: hung ? 'stuck' : 'throw', detail: `cast:${detail}`,
      phases: [{ phase: 'cast', label: 'worker', text: '', family: 'none', conditional: false, class: hung ? 'stuck' : 'throw', detail, changes: [], weak: [], castPrompts: [], prompts: [], notes: [], errors: [] }],
      telemetry: [], untestedTriggers: [], ms: Date.now() - Number(card.at || Date.now()) };
    fs.appendFileSync(path.join(ctx.outDir, `results.${slot}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
  }
}

async function main(): Promise<void> {
  const args = parseSweepArgs(process.argv.slice(2));
  const started = Date.now();
  if (args.reportOnly) {
    const summary = writeSweepReport(args.out);
    log(`report rebuilt: ${summary.cards} cards ${JSON.stringify(summary.classes)} -> ${path.join(args.out, 'summary.txt')}`);
    if (args.compare) log(`compare vs ${args.compare}: ${comparisonHeadline(writeSweepComparison(args.compare, args.out))} -> ${path.join(args.out, 'compare.txt')}`);
    return;
  }
  if (!args.resume) freshOutputDir(args.out);
  fs.mkdirSync(args.out, { recursive: true });
  const cards = await selectSweepCards(args);
  const cardsFile = path.join(args.out, 'cards.json');
  fs.writeFileSync(cardsFile, JSON.stringify(cards), 'utf8');
  log(`${cards.length} cards selected; chunk ${args.chunk}, workers ${args.workers}, out ${args.out}`);
  const ctx: ChunkContext = { cards, cardsFile, outDir: args.out, timeoutMs: args.timeoutMs, verbose: args.verbose };
  const chunks: Array<[number, number]> = [];
  for (let from = 0; from < cards.length; from += args.chunk) chunks.push([from, Math.min(cards.length, from + args.chunk)]);
  let next = 0;
  let finished = 0;
  const slots = Array.from({ length: Math.min(args.workers, Math.max(1, chunks.length)) }, (_, slot) => (async () => {
    while (next < chunks.length) {
      const [from, to] = chunks[next++];
      await runChunk(ctx, from, to, slot);
      finished += 1;
      const done = doneNames(args.out).size;
      log(`chunk ${from}-${to} done (${finished}/${chunks.length} chunks, ${done} cards, ${Math.round((Date.now() - started) / 1000)}s)`);
    }
  })());
  await Promise.all(slots);
  const summary = writeSweepReport(args.out);
  const elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(args.out, 'run-meta.json'), `${JSON.stringify({ argv: process.argv.slice(2), selected: cards.length, elapsedMs, finishedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  log(`done in ${Math.round(elapsedMs / 1000)}s: ${JSON.stringify(summary.classes)}`);
  log(`summary: ${path.join(args.out, 'summary.txt')}`);
  if (args.compare) log(`compare vs ${args.compare}: ${comparisonHeadline(writeSweepComparison(args.compare, args.out))} -> ${path.join(args.out, 'compare.txt')}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`[outcome-sweep] fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
