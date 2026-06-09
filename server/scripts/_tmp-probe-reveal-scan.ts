import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText, isCommanderLegalCard, isEligible } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

const template =
  /target opponent reveals their hand\. you choose a nonland card from it\. that player discards that card/i;

const partials: string[] = [];
let fully = 0;

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
    if (rec.status === 'partial') partials.push(`${card.name} :: ${rec.reasonCodes}`);
    else if (rec.status === 'fully_applied') fully += 1;
  }
}

console.log('partial', partials.length, 'fully', fully);
for (const line of partials.slice(0, 20)) console.log('PARTIAL', line);
