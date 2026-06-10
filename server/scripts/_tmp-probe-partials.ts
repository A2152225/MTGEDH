import fs from 'node:fs';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();

const audit = JSON.parse(
  fs.readFileSync(new URL('./out/executor-coverage-audit.json', import.meta.url), 'utf8')
) as any;

const partialCards = (audit.items || [])
  .filter((item: any) => item.status === 'partial')
  .slice(0, 25);

const cards = JSON.parse(
  fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')
) as any[];

console.log('partial count', partialCards.length);

for (const item of partialCards) {
  const name = String(item.cardName || item.name || '');
  const card = cards.find((c: any) => c.name === name);
  if (!card) continue;
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const irGaps = hasUnknownIRSteps(text, card.name);
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status !== 'partial') continue;
    console.log('\n===', name, '===');
    console.log('reasons', rec.reasonCodes, rec.stepKinds);
    console.log('ABILITY', text.slice(0, 180));
    const bad = steps.filter((s: any) => {
      const dryOne = dryRunOracleSteps([s], card, irGaps, { typeLine: card.type_line });
      return dryOne.status === 'partial' || dryOne.unsupported > 0;
    });
    console.log(
      'bad steps',
      bad.map((s: any) => ({ kind: s.kind, raw: String(s.raw || '').slice(0, 90), target: (s as any).target }))
    );
    break;
  }
}
