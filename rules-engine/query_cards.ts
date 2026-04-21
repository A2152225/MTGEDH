import * as fs from "fs";
import * as path from "path";
import { parseOracleTextToIR } from "./src/oracleIRParser";

const cardNames = [
  "Songbirds' Blessing",
  "Garruk's Harbinger",
  "Nahiri's Warcrafting",
  "Industrial Advancement",
  "The Key to the Vault"
];

const cardsJsonPath = path.join("..", "oracle-cards.json");
const cards = JSON.parse(fs.readFileSync(cardsJsonPath, "utf-8"));

for (const name of cardNames) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) {
    console.log(`Card not found: ${name}`);
    continue;
  }

  console.log(`--- ${card.name} ---`);
  console.log(`Oracle Text:\n${card.oracle_text}\n`);

  const irResult = parseOracleTextToIR(card.oracle_text, card.name);
  
  for (const ability of irResult.abilities) {
    const hasTargetClause = card.oracle_text.includes("Put the rest on the bottom of your library in a random order.");
    if (hasTargetClause) {
      // Find the step before the one containing the message about putting cards on the bottom
      // In many cases, it's one of the steps in the IR.
      console.log(`Ability Type: ${ability.type}`);
      ability.steps.forEach((step: any, index: number) => {
         const entry = JSON.stringify(step);
         if (entry.includes("Put the rest on the bottom") || (index + 1 < ability.steps.length && JSON.stringify(ability.steps[index+1]).includes("Put the rest on the bottom"))) {
            console.log(`Step ${index}:`, JSON.stringify(step, null, 2));
         }
      });
    }
  }
  console.log("\n");
}
