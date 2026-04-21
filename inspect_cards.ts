import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';
import fs from 'node:fs';

const JSON_PATH = './oracle-cards.json';
const namesToFind = ['Songbirds' Blessing', 'Garruk's Harbinger', 'Industrial Advancement', 'The Key to the Vault', 'Doomskar Warrior'];

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

for (const name of namesToFind) {
  const card = data.find(c => c.name === name);
  if (card) {
    console.log('--- ' + name + ' ---');
    const oracleText = card.oracle_text || '';
    const sentences = oracleText.split('\n');
    for (const sentence of sentences) {
      if (sentence.includes('Put the rest on the bottom of your library in a random order')) {
        console.log('Oracle Clause: ' + sentence);
      }
    }
    console.log('Parsed Steps:');
    const IR = parseOracleTextToIR(oracleText, name);
    IR.abilities.forEach((ability, i) => {
      console.log('  Ability ' + (i + 1) + ' (' + ability.type + '):');
      ability.steps.forEach((step, j) => {
        console.log('    Step ' + (j + 1) + ': ' + JSON.stringify(step));
      });
    });
  }
}
