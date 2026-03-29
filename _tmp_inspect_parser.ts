import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';

const samples: Array<[string, string, string?]> = [
  [
    'Bruse',
    "Whenever Bruse Tarl enters or attacks, exile the top card of your library. If it's a land card, create a 2/2 white Ox creature token. Otherwise, you may cast it until the end of your next turn.",
    'Bruse Tarl, Roving Rancher',
  ],
  [
    'IfYouDo',
    'If you do, exile the top two cards of your library, then choose one of them. You may play that card this turn.',
  ],
  [
    'Chainer',
    'Discard a card: You may cast a creature spell from your graveyard this turn.',
    'Chainer, Nightmare Adept',
  ],
  [
    'Sevinne',
    "Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.",
    "Sevinne's Reclamation",
  ],
  ['Transmute', 'Transmute {1}{U}{U}', 'Muddle the Mixture'],
];

for (const [label, text, cardName] of samples) {
  console.log(`--- ${label} ---`);
  const ir = parseOracleTextToIR(text, cardName);
  console.dir(ir.abilities, { depth: null });
}
