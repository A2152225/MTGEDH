/**
 * Summarize shadow vs v0 disagreements from an AI_TRACE_FILE JSONL (P1-5).
 *
 * Usage: npm run ai:shadow -- --trace out/trace.jsonl [--out docs/ai-shadow-disagreements.md]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCardAIProfile, clearCardAIProfileCache } from '../src/socket/ai-handlers/aiCardProfile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

function parseArgs(argv: string[]) {
  let trace = '';
  let out = '';
  let seed = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trace') trace = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--seed') seed = Number(argv[++i]) || 1;
  }
  return { trace, out, seed };
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.trace) {
    console.error('Usage: npm run ai:shadow -- --trace <jsonl> [--out <md>] [--seed 1]');
    process.exitCode = 1;
    return;
  }
  const tracePath = path.resolve(serverRoot, args.trace);
  const lines = fs
    .readFileSync(tracePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  clearCardAIProfileCache();
  const withShadow = lines.filter((r) => r.shadow);
  let disagreements = 0;
  const byV0Role: Record<string, number> = {};
  const byV1Role: Record<string, number> = {};
  const dropsByRole: Record<string, number> = {};
  const samples: any[] = [];

  for (const row of withShadow) {
    const cands = row.candidates || [];
    const scores = row.shadow.scores || [];
    const v0Top = cands[0];
    let best: any = null;
    for (const s of scores) {
      if (s.dropped) {
        const name = cands[s.v0Index]?.name || 'unknown';
        const roles = getCardAIProfile(name)?.roles || [];
        for (const r of roles) dropsByRole[r] = (dropsByRole[r] || 0) + 1;
        continue;
      }
      if (!best || s.score > best.score) best = s;
    }
    const v1Top = best ? cands[best.v0Index] : null;
    const v0Dropped = scores.find((s: any) => s.v0Index === 0)?.dropped;
    const disagree =
      !v1Top
      || v0Dropped
      || (v0Top && v1Top && (v0Top.name !== v1Top.name || v0Top.kind !== v1Top.kind));
    if (disagree) {
      disagreements += 1;
      const v0Role = (getCardAIProfile(v0Top?.name || '')?.roles || ['none'])[0] || 'none';
      const v1Role = (getCardAIProfile(v1Top?.name || '')?.roles || ['none'])[0] || 'none';
      byV0Role[v0Role] = (byV0Role[v0Role] || 0) + 1;
      byV1Role[v1Role] = (byV1Role[v1Role] || 0) + 1;
      samples.push({
        turn: row.turn,
        phase: row.phase,
        step: row.step,
        seat: row.seat,
        winProb: row.shadow.winProb,
        v0Top,
        v1Top,
        scores,
        candidates: cands,
      });
    }
  }

  const rng = mulberry32(args.seed);
  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  const picked = samples.slice(0, 30);

  const report = `# Shadow disagreements

Trace: \`${args.trace}\`
Decisions with shadow: ${withShadow.length}
Disagreements: ${disagreements} (${withShadow.length ? ((100 * disagreements) / withShadow.length).toFixed(1) : 0}%)

## By v0 top role

${Object.entries(byV0Role).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '_none_'}

## By v1 top role

${Object.entries(byV1Role).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '_none_'}

## Drops by role

${Object.entries(dropsByRole).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '_none_'}

## Sampled disagreements (mark better choice)

${picked
  .map((s, i) => {
    return `### ${i + 1}. turn ${s.turn} ${s.phase}/${s.step || ''}
- winProb: \`${JSON.stringify(s.winProb)}\`
- v0 top: ${s.v0Top?.kind} ${s.v0Top?.name} (prio ${s.v0Top?.score})
- v1 top: ${s.v1Top?.kind || 'none'} ${s.v1Top?.name || ''}
- Better?: _ _
`;
  })
  .join('\n')}
`;

  console.log(report);
  if (args.out) {
    const outPath = path.resolve(serverRoot, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report);
    console.log(`Wrote ${outPath}`);
  }
}

main();
