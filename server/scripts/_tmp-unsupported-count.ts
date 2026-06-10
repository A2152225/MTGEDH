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

let unsupported = 0;
const reasonTotals: Record<string, number> = {};
const clusters = new Map<string, number>();

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
    unsupported += 1;
    for (const [code, n] of Object.entries(rec.reasonCodes)) {
      reasonTotals[code] = (reasonTotals[code] || 0) + Number(n);
    }
    const key = text.toLowerCase().replace(/\b\d+\b/g, '<N>').replace(/\{[^}]+\}/g, '{M}').slice(0, 90);
    clusters.set(key, (clusters.get(key) || 0) + 1);
  }
}

console.log('unsupported abilities', unsupported);
console.log('reason totals', reasonTotals);
const top = [...clusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 35);
for (const [k, n] of top) console.log(`[${n}] ${k}`);
