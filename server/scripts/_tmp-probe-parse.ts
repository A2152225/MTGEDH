import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText } from './executor-coverage-audit.ts';

await loadEffectIrParser();

const texts = [
  'return this card and up to one other target creature card from your graveyard to the battlefield',
  'you may exile all cards from your hand face down',
  'then exile a card from your hand face down',
  'you may put an artifact card with mana value 2 or 3 from among them into your hand',
  'put any number of land cards from among them onto the battlefield tapped',
  "then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order",
  'return up to x target permanents to their owners\' hands, where x is the number of verse counters on this enchantment',
  'you may attach target equipment you control with mana value 2 or 3 to this permanent',
];

for (const t of texts) {
  const steps = collectStepsFromIrText(t, 'Test');
  console.log(t);
  console.log(JSON.stringify(steps, null, 2));
  console.log();
}
