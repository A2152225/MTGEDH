import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText } from './executor-coverage-audit.ts';

await loadEffectIrParser();

const samples = [
  ['Endrek Sahr', 'create X 1/1 black Thrull creature tokens, where X is that spell\'s mana value'],
  ['Mycotyrant', 'create X 1/1 black Fungus creature tokens with "This token can\'t block," where X is the number of times you descended this turn'],
  ['Raffine', 'target attacking creature connives X, where X is the number of attacking creatures'],
  ['Dragonhawk', 'exile the top X cards of your library, where X is the number of creatures you control with power 4 or greater. You may play those cards until your next end step.'],
  ['Queen\'s Bay Paladin', 'Whenever a creature enters the battlefield under your control, you lose life equal to its mana value.'],
];

for (const [name, text] of samples) {
  const steps = collectStepsFromIrText(text, name);
  console.log('\n===', name, '===');
  console.log(JSON.stringify(steps, null, 2));
}
