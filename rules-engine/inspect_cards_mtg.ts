import fs from 'fs';
import { parseOracleTextToIR } from './src/oracleIRParser.ts';

const cardsData = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
const targetNames = [
  'Mysterious Confluence',
  'Chandra\'s Dragonmech',
  'Spellweaver Volute',
  'Mysterious Stranger',
  'Myra the Magnificent'
];

targetNames.forEach(name => {
  const card = cardsData.find(c => c.name === name);
  if (!card) {
    console.log('Card not found: ' + name);
    return;
  }
  console.log('--- ' + name + ' ---');
  console.log('Oracle Text: ' + card.oracle_text);
  try {
    const ir = parseOracleTextToIR(card.oracle_text, card.name);
    ir.abilities.forEach((ability, i) => {
      console.log('Ability ' + i + ':');
      ability.steps.forEach(step => {
        console.log('  Step Kind: ' + step.kind + ' | Text: ' + step.rawText);
        if (step.kind === 'unknown' || step.kind === 'copy_spell') {
          console.log('    [Special Highlight] ' + JSON.stringify(step));
        }
      });
    });
  } catch (e) {
    console.error('Error parsing ' + name + ': ' + e.message);
  }
});
