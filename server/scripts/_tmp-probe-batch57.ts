import { dryRunOracleSteps, collectStepsFromIrText } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];

function probe(cardName: string, filter?: RegExp) {
  const card = cards.find((c: any) => c.name === cardName);
  const oracle = getCombinedOracleText(card);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (filter && !filter.test(effect)) continue;
    const steps = collectStepsFromIrText(effect, card.name);
    const irGaps = hasUnknownIRSteps(effect, card.name);
    console.log('\n===', cardName, '===');
    console.log('effect:', effect.slice(0, 120));
    console.log('dryRun:', dryRunOracleSteps(steps, card, irGaps));
    console.log('gaps ir:', irGaps);
  }
}

probe('Nucklavee', /graveyard/i);
probe('Greasefang, Okiba Boss', /vehicle/i);
probe("Geralf's Messenger", /return/i);
probe('Foot Chopper', /attach/i);
