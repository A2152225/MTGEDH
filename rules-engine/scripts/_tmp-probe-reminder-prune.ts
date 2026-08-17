import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const cases = [
  ['Wither (This deals damage to creatures in the form of -1/-1 counters.)', 'Wither Source'],
  ['Bushido 2 (Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.)', 'Battle-Mad Ronin'],
  ['Crew 2', 'Sky Skiff'],
  ["Evoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)", 'Mulldrifter'],
  [
    'Cleave {5}{W} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nDestroy target [attacking] creature.',
    'Fierce Retribution',
  ],
  [
    'When this creature dies, put target creature card from your graveyard on top of your library. Dredge 4 (If you would draw a card, you may mill four cards instead. If you do, return this card from your graveyard to your hand.)',
    'Golgari Thug',
  ],
  [
    'Cascade, cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order. Then do it again.)',
    'Call Forth the Tempest',
  ],
] as const;

for (const [text, name] of cases) {
  const ir = parseOracleTextToIR(text, name);
  console.log('\n===', name, '===');
  console.log('keywords:', ir.keywords);
  console.log(
    'abilities:',
    JSON.stringify(
      ir.abilities.map((a) => ({
        type: a.type,
        text: a.text,
        steps: a.steps.map((s: any) => ({ kind: s.kind, raw: s.raw, abilities: s.abilities })),
      })),
      null,
      2,
    ),
  );
}

process.exit(0);
