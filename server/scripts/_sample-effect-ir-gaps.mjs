import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/trigger-coverage-audit.json'), 'utf8'));

const unknownCounts = new Map();
const samples = [];

for (const pattern of audit.topPatterns || []) {
  if (!pattern.statuses?.includes('effect_ir_gap')) continue;
  const effect = pattern.sampleEffect;
  if (!effect) continue;
  const card = pattern.exampleCards?.[0] || 'Unknown';
  const ir = parseOracleTextToIR(effect, card);
  const unknown = [];
  for (const ability of ir.abilities || []) {
    for (const step of ability.steps || []) {
      if (step.kind === 'unknown') unknown.push(step.raw);
    }
  }
  if (unknown.length) {
    samples.push({ card, event: pattern.event, effect, unknown });
    for (const u of unknown) unknownCounts.set(u, (unknownCounts.get(u) || 0) + 1);
  }
  for (const gap of pattern.effectGapSamples || []) {
    unknownCounts.set(gap, (unknownCounts.get(gap) || 0) + 1);
  }
}

const topUnknown = [...unknownCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log('samples with unknown from sampleEffect:', samples.length);
console.log('top unknown/gap fragments:', topUnknown);

for (const s of samples.slice(0, 20)) {
  console.log('\n---');
  console.log(JSON.stringify(s, null, 0));
}

// Probe specific gap fragments directly
const probes = [
  'exile target card from an opponent\'s graveyard.',
  'a card',
  'you may reveal a human card from among them and put it into your hand. put the rest on the bottom of your library in any order',
  'life equal to its mana value',
  'birds are cowards in addition to their other types',
];
console.log('\n=== direct probes ===');
for (const text of probes) {
  const ir = parseOracleTextToIR(text);
  const unknown = (ir.abilities?.[0]?.steps || []).filter((s) => s.kind === 'unknown').map((s) => s.raw);
  console.log(JSON.stringify({ text: text.slice(0, 80), unknown, kinds: (ir.abilities?.[0]?.steps || []).map((s) => s.kind) }));
}
