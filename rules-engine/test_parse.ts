import { parseOracleTextToIR } from './src/oracleIRParser';

const heatedDebate = "This spell can't be countered. (This includes by the ward ability.)\nHeated Debate deals 4 damage to target creature or planeswalker.";
const tollsOfWar = "When this enchantment enters, create a Clue token. (It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")\nWhenever you sacrifice a permanent during your turn, create a 1/1 white Ally creature token. This ability triggers only once each turn.";

const res1 = parseOracleTextToIR(heatedDebate);
const res2 = parseOracleTextToIR(tollsOfWar);

console.log(JSON.stringify({
  heatedDebate: res1.abilities,
  tollsOfWar: res2.abilities
}, null, 2));
