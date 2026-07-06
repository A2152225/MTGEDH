import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectActivatedAbilitySteps } from '../src/state/modules/oracleIrAbilityExecution.js';

const text =
  'Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

const activated = collectActivatedAbilitySteps(text, 'Whip of Erebos');
const ir = parseOracleTextToIR(text, 'Whip of Erebos');

console.log('activated', JSON.stringify(activated, null, 2));
console.log('ir ability0', JSON.stringify(ir.abilities[0]?.steps, null, 2));
process.exit(0);
