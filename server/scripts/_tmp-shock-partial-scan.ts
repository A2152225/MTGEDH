import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText, isCommanderLegalCard, isEligible } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

const template = /search your library for a basic land card, put (?:it|that card) onto the battlefield tapped, then shuffle/i;

const partials: string[] = [];
const fully: string[] = [];

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!template.test(text)) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    if (rec.status === 'partial') partials.push(`${card.name} (${card.type_line}) :: ${text.slice(0, 120)}`);
    else if (rec.status === 'fully_applied') fully.push(card.name);
  }
}

console.log('partial count', partials.length);
console.log('fully count', fully.length);
for (const line of partials.slice(0, 15)) console.log('PARTIAL', line);
for (const name of [...new Set(partials.map((p) => p.split(' ::')[0]))].slice(0, 10)) {
  const card = cards.find((c: any) => `${c.name} (${c.type_line})` === name || c.name === name.split(' (')[0]);
}
