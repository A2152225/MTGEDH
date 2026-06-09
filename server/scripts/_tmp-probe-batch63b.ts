import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

for (const name of ["Gix's Caress", 'Thoughtseize', 'Fated Return', 'Vat Emergence']) {
  const card = cards.find((c: any) => c.name === name);
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!/reveals their hand|graveyard onto the battlefield/i.test(text)) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    console.log(name, rec.status, rec.reasonCodes, 'applied', rec.applied, 'skipped', rec.skipped);
  }
}
