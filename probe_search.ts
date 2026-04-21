import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';
const texts = [
  'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
  'You may search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
  'Search your library for a Wizard card, reveal it, put it into your hand, then shuffle.'
];
texts.forEach((text, i) => {
  console.log('--- Case ' + (i + 1) + ' ---');
  console.log('Text: ' + text);
  const result = parseOracleTextToIR(text);
  console.log(JSON.stringify(result, null, 2));
});
