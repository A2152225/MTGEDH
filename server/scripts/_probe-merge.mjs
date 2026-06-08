import { mergeLookChooseFromTopAbilities } from '../../rules-engine/src/oracleIRParserPostprocess.ts';

const abilities = [{
  steps: [
    {
      kind: 'look_top',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 4 },
      raw: 'look at the top four cards of your library',
    },
    {
      kind: 'unknown',
      raw: 'You may reveal a Hero card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order',
      optional: true,
    },
  ],
}];

const merged = mergeLookChooseFromTopAbilities(abilities);
console.log(JSON.stringify(merged[0].steps.map(s => ({ kind: s.kind, selectorText: s.selectorText })), null, 2));
