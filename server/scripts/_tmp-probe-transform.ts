import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

for (const text of ['transform this creature', 'transform this creature.', 'Transform this creature. Trample', 'convert this permanent.']) {
  const ir = parseOracleTextToIR(text, 'Test');
  console.log('text:', text, '->', JSON.stringify(ir.abilities?.[0]?.steps || []));
}
