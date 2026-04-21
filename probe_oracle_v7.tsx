
import fs from "fs";
import path from "path";
import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser";

const cardsToFind = [
  "Mysterious Confluence",
  "Chandra\'s Dragonmech",
  "Spellweaver Volute",
  "Mysterious Stranger",
  "Myra the Magnificent"
];

function run() {
  const cardsJsonPath = "oracle-cards.json";
  const data = JSON.parse(fs.readFileSync(cardsJsonPath, "utf-8"));
  
  for (const cardName of cardsToFind) {
    const card = data.find((c: any) => c.name === cardName);
    if (!card) continue;

    console.log(`--- ${card.name} ---`);
    const irResult = parseOracleTextToIR(card.oracle_text, card.name);
    
    for (const ability of irResult.abilities) {
      const matchText = "without paying its mana cost";
      if (JSON.stringify(ability).includes(matchText)) {
         const lines = card.oracle_text.split("\n");
         for (const line of lines) {
           if (line.includes(matchText)) {
             console.log(`Oracle sentence: ${line}`);
             break;
           }
         }
         console.log("Steps:", JSON.stringify(ability.steps, null, 2));
      }
    }
  }
}

run();
