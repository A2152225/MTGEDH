
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
    
    // Debug step: print all ability oracle fields
    for (const ability of irResult.abilities) {
      console.log(`  Checking ability: ${ability.oracle?.substring(0, 50)}...`);
      // Relaxed check
      if (ability.oracle && (ability.oracle.includes("without paying its mana cost") || card.oracle_text.includes("without paying its mana cost"))) {
         console.log(`  MATCH Oracle: ${ability.oracle}`);
         console.log("  Steps:", JSON.stringify(ability.steps, null, 2));
      }
    }
  }
}

run();
