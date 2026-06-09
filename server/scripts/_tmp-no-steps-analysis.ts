import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText, isCommanderLegalCard, isEligible } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { isExternallyHandledOracleFragmentText } from '../../rules-engine/src/oracleIRParserPostprocess.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

type Cluster = { count: number; examples: string[]; sample: string };

const clusters = new Map<string, Cluster>();
const items: { card: string; text: string; external: boolean }[] = [];

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const irGaps = hasUnknownIRSteps(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status !== 'no_steps') continue;

    const key = text
      .toLowerCase()
      .replace(/\b\d+\b/g, '<N>')
      .replace(/\{[^}]+\}/g, '{C}')
      .slice(0, 100);
    const cluster = clusters.get(key) || { count: 0, examples: [], sample: text.slice(0, 140) };
    cluster.count += 1;
    if (cluster.examples.length < 5 && !cluster.examples.includes(card.name)) cluster.examples.push(card.name);
    clusters.set(key, cluster);
    items.push({
      card: card.name,
      text,
      external: isExternallyHandledOracleFragmentText(text),
    });
  }
}

console.log('no_steps total', items.length);
console.log('externally handled but still no_steps', items.filter((i) => i.external).length);
console.log('\nTop clusters:');
for (const [key, c] of [...clusters.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 40)) {
  console.log(`[${c.count}] ${c.sample}`);
  console.log('  e.g.', c.examples.join(', '));
}
