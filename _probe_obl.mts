
import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.js';
const texts = [
  'If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn',
  'gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn',
  'gain control of target creature until end of turn',
];
for (const text of texts) {
  const ir = parseOracleTextToIR(text, 'Eldrazi Obligator');
  console.log('TEXT:', text.slice(0,80));
  console.log(JSON.stringify(ir.abilities.flatMap(a=>a.steps), null, 2).slice(0,1500));
  console.log('---');
}
