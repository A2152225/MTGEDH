import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { splitIntoClauses } from '../../rules-engine/src/oracleIRParserUtils.js';

const text =
  'Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

const ir = parseOracleTextToIR(text, 'Whip of Erebos');
console.log('abilities', ir.abilities.length);
for (const [i, a] of ir.abilities.entries()) {
  console.log('ability', i, 'type', a.type, 'steps', a.steps?.length);
  console.log(JSON.stringify(a.steps, null, 2));
}

// per-clause parse simulation - import parseClause if needed
process.exit(0);
