import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import fs from 'node:fs';

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
for (const name of ["Clive's Hideaway", 'Lair of the Hydra', 'Blur', 'Siren\'s Ruse', 'Cho-Arrim Alchemist']) {
  const card = cards.find((c: any) => c.name === name);
  const oracle = getCombinedOracleText(card);
  console.log('\n=== FULL', name, '===');
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const a of parsed.abilities || []) {
    const text = String(a.text || a.effectText || '').trim();
    if (!text) continue;
    if (!/hideaway|x can't be 0|exile target creature you control|prevent that damage/i.test(text)) continue;
    console.log('ability type', a.type, 'steps', (a.steps || []).map((s: any) => s.kind));
    console.log('TEXT', text.slice(0, 120));
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    console.log('collect', steps.map((s) => s.kind), rec.status, rec.reasonCodes);
  }
}
