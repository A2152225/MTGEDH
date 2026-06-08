import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const cards = JSON.parse(readFileSync('D:/Git/MTGEDH/oracle-cards.json', 'utf8'));
const card = cards.find((c: { name: string }) => c.name === 'Fear of Burning Alive');
const o = String(card.oracle_text || '');
const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
for (const t of parsed) {
  console.log('event:', t.event);
  console.log('effect:', t.effect);
  const ir = parseOracleTextToIR(t.effect, card.name);
  console.log(JSON.stringify(ir.abilities[0]?.steps, null, 2));
}
