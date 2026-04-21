
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
    if (!card) continue;

    console.log(`--- ${card.name} ---`);
    console.log(`Oracle Text: ${card.oracle_text || "NONE"}`);
    
    // Check for "parsed_abilities" or similar
    const abilitiesKey = Object.keys(card).find(k => k.toLowerCase().includes("abilities"));
    if (abilitiesKey) {
        console.log(`Found key: ${abilitiesKey}`);
        const abilities = card[abilitiesKey];
        if (Array.isArray(abilities)) {
            for (const ability of abilities) {
                 if (ability.oracle && ability.oracle.includes("without paying its mana cost")) {
                    console.log(`Parsed Oracle: ${ability.oracle}`);
                    console.log("Steps:", JSON.stringify(ability.steps, null, 2));
                 }
            }
        }
    }
  }
}

run();
