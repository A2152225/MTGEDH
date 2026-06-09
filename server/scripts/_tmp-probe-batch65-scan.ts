import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

const patterns = [
  /exile target creature you control, then return that card/i,
  /the next time a source of your choice would deal damage to you this turn, prevent that damage/i,
  /as long as this permanent is paired with another creature/i,
  /target creature you control deals damage equal to its power to target creature you don't control/i,
];

for (const card of cards) {
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!patterns.some((p) => p.test(text))) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    if (rec.status !== 'fully_applied' && rec.status !== 'choice_required') {
      console.log(card.name, rec.status, rec.reasonCodes, '|', text.slice(0, 90));
    }
  }
}
