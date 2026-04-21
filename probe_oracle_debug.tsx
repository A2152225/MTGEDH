
import fs from "fs";

const cardsToFind = [
  "Mysterious Confluence",
  "Chandra\'s Dragonmech",
  "Spellweaver Volute",
  "Mysterious Stranger",
  "Myra the Magnificent"
];

function run() {
  const data = JSON.parse(fs.readFileSync("oracle-cards.json", "utf-8"));
  
  for (const cardName of cardsToFind) {
    const card = data.find(c => c.name === cardName);
    if (!card) {
      console.log(`Card not found: ${cardName}`);
      continue;
    }

    console.log(`--- ${card.name} ---`);
    if (card.abilities) {
      console.log(`Abilities found: ${card.abilities.length}`);
      for (const ability of card.abilities) {
        console.log(`  Oracle snippet: ${ability.oracle?.substring(0, 50)}...`);
        if (ability.oracle && ability.oracle.includes("without paying its mana cost")) {
           const lines = ability.oracle.split("\n");
           for (const line of lines) {
             if (line.includes("without paying its mana cost")) {
               console.log(`  MATCH: ${line}`);
             }
           }
           console.log("  Steps:", JSON.stringify(ability.steps, null, 2));
        }
      }
    } else {
        console.log("No abilities array.");
    }
  }
}

run();
