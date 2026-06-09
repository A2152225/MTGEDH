import fs from 'node:fs';
import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
for (const name of ["Siren's Ruse", 'Ram Through', 'Bone Mask', 'Mirage Phalanx', "Clive's Hideaway"]) {
  const card = cards.find((c: any) => c.name === name);
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  for (const a of parsed.abilities || []) {
    const text = String(a.effectText || a.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    if (rec.status === 'fully_applied') continue;
    console.log('\n', name, rec.status);
    console.log('TEXT', text);
    for (const s of steps) {
      if (s.kind === 'conditional') console.log('COND', (s as any).condition?.raw);
    }
  }
}
