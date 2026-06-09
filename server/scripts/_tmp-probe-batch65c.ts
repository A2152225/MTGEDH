import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

const cases = [
  ['Ram Through', "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead."],
  ["Siren's Ruse", "Exile target creature you control, then return that card to the battlefield under its owner's control. If a Pirate was exiled this way, draw a card."],
  ['Bone Mask', 'The next time a source of your choice would deal damage to you this turn, prevent that damage. Exile cards from the top of your library equal to the damage prevented this way.'],
  ['Mirage Phalanx', 'As long as this permanent is paired with another creature, each of those creatures has "At the beginning of combat on your turn, create a token that\'s a copy of this creature, except it has haste and loses soulbond. Exile it at end of combat."'],
  ['Lair of the Hydra', "X can't be 0."],
  ["Clive's Hideaway", 'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.'],
  ['Martyr of Frost', 'Counter target spell unless its controller pays {X}.'],
];

for (const [name, text] of cases) {
  const steps = collectStepsFromIrText(text, name);
  const rec = dryRunOracleSteps(steps, name, hasUnknownIRSteps(text, name));
  console.log(name, rec.status, rec.reasonCodes, steps.map((s) => s.kind));
}
