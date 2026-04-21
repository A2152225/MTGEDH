import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const text1 = 'Search your library for a card, put that card into your hand, discard a card at random, then shuffle.';
const text2 = 'Search your library for a card, put it onto the battlefield, then shuffle.';
const text3 = 'Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.';

console.log('--- Gamble ---');
console.log(JSON.stringify(parseOracleTextToIR(text1, 'Gamble'), null, 2));
console.log('--- Simple Search ---');
console.log(JSON.stringify(parseOracleTextToIR(text2, 'Simple Search'), null, 2));
console.log('--- Aetherworks Marvel ---');
console.log(JSON.stringify(parseOracleTextToIR(text3, 'Aetherworks Marvel'), null, 2));
