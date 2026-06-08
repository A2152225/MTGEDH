import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const cases = [
  'draw a card',
  'draw a card.',
  'you may draw a card.',
  'you may draw a card',
  'Whenever you draw a card, you may draw a card.',
];

for (const text of cases) {
  const ir = parseOracleTextToIR(text);
  const unknown = ir.steps?.filter((s) => s.kind === 'unknown').map((s) => s.raw) ?? [];
  console.log(JSON.stringify({ text, unknown, kinds: ir.steps?.map((s) => s.kind) }));
}
