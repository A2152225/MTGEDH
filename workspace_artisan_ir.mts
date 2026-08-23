import { parseOracleTextToIR } from './rules-engine/src/oracleTextParser.ts';
const text = 'When you cast this spell, you may return target creature card from your graveyard to the battlefield.';
const ir = parseOracleTextToIR(text, 'Artisan of Kozilek');
console.log(JSON.stringify(ir, null, 2).slice(0, 5000));
