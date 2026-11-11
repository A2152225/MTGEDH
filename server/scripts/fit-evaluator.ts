/**
 * Fit evaluator weights from self-play position logs (P1-3).
 *
 * Usage:
 *   npm run ai:fit -- --positions 'out/fit-pos-merged.jsonl' --results 'out/fit-seed2000.jsonl'
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_NAMES,
  type EvalWeights,
  type FeatureName,
  type SeatFeatures,
} from '../../rules-engine/src/ai/evaluatorFeatures.js';
import {
  type Example,
  fit,
  logLoss,
  reliability,
  uniformLogLoss,
} from './lib/conditionalLogit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const WEIGHTS_PATH = path.join(repoRoot, 'rules-engine', 'src', 'ai', 'evaluatorWeights.v1.ts');
const REPORT_PATH = path.join(repoRoot, 'docs', 'ai-evaluator-fit.md');

interface PositionRow {
  v: number;
  gameId: string;
  turn: number;
  activeSeat: string;
  features: Record<string, SeatFeatures>;
  eliminated: string[];
}

interface ResultRow {
  gameId: string;
  winner: string | null;
  endReason: string;
}

function parseArgs(argv: string[]) {
  const out: {
    positions: string[];
    results: string[];
    l2: number;
    seed: number;
    force: boolean;
  } = {
    positions: [],
    results: [],
    l2: 0.01,
    seed: 1,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--positions') out.positions.push(...expandGlobs(argv[++i]));
    else if (a === '--results') out.results.push(...expandGlobs(argv[++i]));
    else if (a === '--l2') out.l2 = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--force') out.force = true;
  }
  return out;
}

function expandGlobs(spec: string): string[] {
  if (!spec) return [];
  if (!spec.includes('*')) {
    const p = path.resolve(serverRoot, spec);
    return fs.existsSync(p) ? [p] : [];
  }
  const dir = path.resolve(serverRoot, path.dirname(spec));
  const re = new RegExp(
    `^${path.basename(spec).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`,
  );
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => re.test(n))
    .map((n) => path.join(dir, n))
    .sort();
}

function readJsonl<T>(files: string[]): T[] {
  const rows: T[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      rows.push(JSON.parse(t) as T);
    }
  }
  return rows;
}

/** selfplay-<seed>-<pod>-<rotation> → selfplay-<seed>-<pod> */
function podOf(gameId: string): string {
  const m = /^(selfplay-\d+-\d+)-\d+$/.exec(gameId);
  return m ? m[1] : gameId;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function splitByPod(examples: Example[], trainFrac: number, seed: number): {
  train: Example[];
  test: Example[];
} {
  const pods = [...new Set(examples.map((e) => e.pod))];
  const rng = mulberry32(seed);
  for (let i = pods.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pods[i], pods[j]] = [pods[j], pods[i]];
  }
  const nTrain = Math.max(1, Math.floor(pods.length * trainFrac));
  const trainPods = new Set(pods.slice(0, nTrain));
  const train = examples.filter((e) => trainPods.has(e.pod));
  const test = examples.filter((e) => !trainPods.has(e.pod));
  return { train, test };
}

function weightsFromVector(w: number[]): EvalWeights {
  const out = {} as EvalWeights;
  for (let i = 0; i < FEATURE_NAMES.length; i++) {
    out[FEATURE_NAMES[i]] = w[i] ?? 0;
  }
  return out;
}

function lifeOnlyExamples(data: Example[]): Example[] {
  const lifeIdx = FEATURE_NAMES.indexOf('life');
  return data.map((e) => ({
    ...e,
    X: e.X.map((row) => {
      const next = new Array(row.length).fill(0);
      next[lifeIdx] = row[lifeIdx];
      return next;
    }),
  }));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.positions.length || !args.results.length) {
    console.error(
      'Usage: npm run ai:fit -- --positions <glob|file> --results <glob|file> [--l2 0.01] [--seed 1] [--force]',
    );
    process.exitCode = 1;
    return;
  }

  const positions = readJsonl<PositionRow>(args.positions);
  const results = readJsonl<ResultRow>(args.results);
  const byEnd: Record<string, number> = {};
  for (const r of results) byEnd[r.endReason] = (byEnd[r.endReason] || 0) + 1;

  const winners = new Map(
    results
      .filter((r) => r.endReason === 'win' && r.winner)
      .map((r) => [r.gameId, String(r.winner)]),
  );

  const examples: Example[] = [];
  for (const row of positions) {
    const winner = winners.get(row.gameId);
    if (!winner) continue;
    const elim = new Set((row.eliminated || []).map(String));
    const seats = Object.keys(row.features).filter((id) => !elim.has(id));
    if (seats.length < 2 || !seats.includes(winner)) continue;
    examples.push({
      gameId: row.gameId,
      pod: podOf(row.gameId),
      X: seats.map((id) => FEATURE_NAMES.map((f) => Number(row.features[id]?.[f] ?? 0))),
      winnerIdx: seats.indexOf(winner),
    });
  }

  const { train, test } = splitByPod(examples, 0.8, args.seed);
  const w = fit(train, args.l2);
  const wLife = fit(lifeOnlyExamples(train), args.l2);
  const fittedLoss = logLoss(test, w);
  const lifeOnlyLoss = logLoss(lifeOnlyExamples(test), wLife);
  const uniformLoss = uniformLogLoss(test);
  const rel = reliability(test, w, 10);
  const weights = weightsFromVector(w);

  const signsOk =
    weights.life > 0
    && weights.boardValue > 0
    && weights.manaSources > 0
    && weights.commanderDamageTaken < 0;
  const beatsBoth =
    Number.isFinite(fittedLoss)
    && fittedLoss < Math.min(uniformLoss, lifeOnlyLoss);
  const calibrated = rel.every((b) => b.n < 100 || b.gap <= 0.1);
  const pass = beatsBoth && calibrated && signsOk;

  const report = `# AI evaluator fit (P1-3)

Generated ${new Date().toISOString()}.

## Data

| Metric | Value |
| --- | --- |
| Result rows | ${results.length} |
| Position rows | ${positions.length} |
| Wins used | ${winners.size} |
| Labeled positions | ${examples.length} |
| Train positions | ${train.length} |
| Hold-out positions | ${test.length} |
| Pods (train/hold-out) | ${new Set(train.map((e) => e.pod)).size} / ${new Set(test.map((e) => e.pod)).size} |
| L2 | ${args.l2} |
| Seed | ${args.seed} |

### End reasons

${Object.entries(byEnd).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Hold-out log-loss

| Model | Log-loss |
| --- | --- |
| Fitted | ${fittedLoss.toFixed(4)} |
| Life-only | ${lifeOnlyLoss.toFixed(4)} |
| Uniform | ${uniformLoss.toFixed(4)} |

Beats both baselines: **${beatsBoth ? 'yes' : 'no'}**

## Reliability (10-point buckets)

| Bucket | n | mean predicted | observed | gap | flag |
| --- | --- | --- | --- | --- | --- |
${rel
  .map((b) => {
    const flag = b.n >= 100 && b.gap > 0.1 ? 'FAIL' : '';
    return `| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${b.predicted.toFixed(3)} | ${b.observed.toFixed(3)} | ${b.gap.toFixed(3)} | ${flag} |`;
  })
  .join('\n')}

Calibrated: **${calibrated ? 'yes' : 'no'}**

## Weights

| Feature | Weight | Expected sign | OK |
| --- | --- | --- | --- |
${FEATURE_NAMES.map((f: FeatureName) => {
  const expected =
    f === 'commanderDamageTaken' ? 'negative' : f === 'life' || f === 'boardValue' || f === 'manaSources' ? 'positive' : 'any';
  const ok =
    expected === 'any'
      ? '—'
      : expected === 'positive'
        ? weights[f] > 0
          ? 'yes'
          : 'no'
        : weights[f] < 0
          ? 'yes'
          : 'no';
  return `| ${f} | ${weights[f].toFixed(4)} | ${expected} | ${ok} |`;
}).join('\n')}

Sign check (life/board/mana +, cmd dmg −): **${signsOk ? 'yes' : 'no'}**

## Verdict

**${pass ? 'PASS' : 'FAIL'}** — ${
    pass
      ? 'wrote FITTED_WEIGHTS'
      : args.force
        ? 'forced write of FITTED_WEIGHTS despite failed checks'
        : 'kept FITTED_WEIGHTS = null (DEFAULT_WEIGHTS still used)'
  }.

Known limit: labels come from v0 self-play at maxTurns=45, so most games are turn-limit and the win sample is small.
`;

  fs.writeFileSync(REPORT_PATH, report);

  if (pass || args.force) {
    const body = `/**
 * Fitted evaluator weights (P1-3). Generated by server/scripts/fit-evaluator.ts — do not edit by hand.
 *
 * Fitted on ${winners.size} wins / ${examples.length} positions.
 * Hold-out log-loss ${fittedLoss.toFixed(4)} vs uniform ${uniformLoss.toFixed(4)} and life-only ${lifeOnlyLoss.toFixed(4)}.
 */
import type { EvalWeights } from './evaluatorFeatures.js';

export const FITTED_WEIGHTS: EvalWeights | null = ${JSON.stringify(weights, null, 2)};
`;
    fs.writeFileSync(WEIGHTS_PATH, body);
  }

  console.log(report.split('\n').slice(0, 40).join('\n'));
  console.log(`\nWrote report → ${REPORT_PATH}`);
  if (pass || args.force) console.log(`Wrote weights → ${WEIGHTS_PATH}`);
  else console.log('Left evaluatorWeights.v1.ts stub (null).');
  if (!pass) process.exitCode = 1;
}

main();
