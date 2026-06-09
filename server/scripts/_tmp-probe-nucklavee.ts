import { collectStepsFromIrText } from './executor-coverage-audit.ts';
import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import { parseMoveZoneSingleTargetFromYourGraveyard, cardMatchesMoveZoneSingleTargetCriteria } from '../../rules-engine/src/oracleIRExecutorZoneOps.js';

await loadEffectIrParser();
const text = 'you may return target red sorcery card from your graveyard to your hand';
const steps = collectStepsFromIrText(text, 'Nucklavee');
console.log('steps', JSON.stringify(steps, null, 2));
const step = steps[0] as any;
console.log('parsed', parseMoveZoneSingleTargetFromYourGraveyard(step.what));
const criteria = parseMoveZoneSingleTargetFromYourGraveyard(step.what);
const cards = [
  { id: 'gy-instant-1', type_line: 'Instant', colors: ['R'] },
  { id: 'gy-red-sorcery', type_line: 'Sorcery', colors: ['R'] },
  { id: 'gy-black-spell-1', type_line: 'Instant', colors: ['B'] },
];
for (const c of cards) {
  console.log(c.id, criteria ? cardMatchesMoveZoneSingleTargetCriteria(c, criteria) : 'no criteria');
}
