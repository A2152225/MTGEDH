import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';
const c1 = "Put two +1/+1 counters on each creature you control. Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)";
const c2 = "When this creature enters, target player creates a 1/1 white and black Inkling creature token with flying. Then if an opponent controls more creatures than you, this creature becomes prepared. (While it\u0027s prepared, you may cast a copy of its spell. Doing so unprepares it.)";
console.log('--- Germination Practicum ---');
console.log(JSON.stringify(parseOracleTextToIR(c1), null, 2));
console.log('--- Emeritus of Truce ---');
console.log(JSON.stringify(parseOracleTextToIR(c2), null, 2));
