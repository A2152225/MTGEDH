
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
      for (const ability of card.abilities) {
        if (ability.oracle && ability.oracle.includes("You may cast the copy without paying its mana cost")) {
           const lines = ability.oracle.split("\n");
           for (const line of lines) {
             if (line.includes("You may cast the copy without paying its mana cost")) {
               console.log(`Oracle: ${line}`);
             }
           }
           console.log("Steps:", JSON.stringify(ability.steps, null, 2));
        }
      }
    }
  }
}

run();
