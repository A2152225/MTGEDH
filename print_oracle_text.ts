
import * as fs from "fs";
import * as path from "path";

const cardNames = [
  "Nahiri\'s Warcrafting",
  "Songbirds\' Blessing",
  "Garruk\'s Harbinger",
  "Industrial Advancement",
  "The Key to the Vault"
];

const cardsJsonPath = path.join(__dirname, "oracle-cards.json");
const cards = JSON.parse(fs.readFileSync(cardsJsonPath, "utf-8"));

for (const name of cardNames) {
  const card = cards.find((c: any) => c.name === name);
  if (card) {
    console.log(`${card.name}\n${card.oracle_text}\n`);
  } else {
    console.log(`Card not found: ${name}`);
  }
}
