import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

type Row = {
  card: string;
  text: string;
  reasons: Record<string, number>;
  kinds: Record<string, number>;
  stepKinds: string[];
};

const rows: Row[] = [];
const clusters = new Map<string, { count: number; examples: string[]; reasons: Record<string, number> }>();

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
    if (rec.status !== 'unsupported') continue;
    rows.push({
      card: card.name,
      text,
      reasons: rec.reasonCodes,
      kinds: rec.stepKinds,
      stepKinds: steps.map((s) => s.kind),
    });
    const key = text
      .toLowerCase()
      .replace(/\b\d+\b/g, '<N>')
      .replace(/\{[^}]+\}/g, '{M}')
      .slice(0, 110);
    const c = clusters.get(key) || { count: 0, examples: [], reasons: {} };
    c.count += 1;
    if (c.examples.length < 4) c.examples.push(card.name);
    for (const [code, n] of Object.entries(rec.reasonCodes)) {
      c.reasons[code] = (c.reasons[code] || 0) + Number(n);
    }
    clusters.set(key, c);
  }
}

console.log('unsupported abilities', rows.length);
const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [key, v] of sorted) {
  console.log(`\n[${v.count}] ${key}`);
  console.log('  e.g.', v.examples.join(', '));
  console.log('  reasons', JSON.stringify(v.reasons));
}

const reasonTotals: Record<string, number> = {};
for (const r of rows) {
  for (const [code, n] of Object.entries(r.reasons)) {
    reasonTotals[code] = (reasonTotals[code] || 0) + Number(n);
  }
}
console.log('\nreason totals', reasonTotals);
