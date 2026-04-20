import { parseOracleTextToIR } from "./src/oracleIRParser.js";
const text1 = "Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nDraw a card.";
const text2 = "Destroy target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)";

const ir1 = parseOracleTextToIR(text1, "Text 1");
const ir2 = parseOracleTextToIR(text2, "Text 2");

console.log("TEXT 1:");
console.log(JSON.stringify(ir1.abilities, null, 2));
console.log("\nTEXT 2:");
console.log(JSON.stringify(ir2.abilities, null, 2));
