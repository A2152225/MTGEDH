import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const texts = [
  'You may sacrifice another permanent. If you do, you gain 3 life and draw a card.',
  'You may discard a card. If you do, draw a card.',
];

for (const text of texts) {
  const ir = parseOracleTextToIR(text, 'Probe');
  console.log(JSON.stringify({ text, ir }, null, 2));
}
