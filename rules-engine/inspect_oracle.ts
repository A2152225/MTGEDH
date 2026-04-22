import { parseOracleTextToIR } from './src/oracleIRParser';
import * as fs from 'fs';

const cardsToFind = [
  'Mysterious Confluence',
  'Chandra\'s Dragonmech',
  'Spellweaver Volute',
  'Mysterious Stranger',
  'Myra the Magnificent'
];

async function main() {
  const data = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
  const foundCards = data.filter((card: any) => cardsToFind.includes(card.name));

  for (const card of foundCards) {
    console.log('--- Card: ' + card.name + ' ---');
    console.log('Oracle Text: ' + card.oracle_text);
    const ir = parseOracleTextToIR(card.oracle_text, card.name);
    
    ir.abilities.forEach((ability, index) => {
      ability.steps.forEach((step, stepIndex) => {
        const stepStr = JSON.stringify(step);
        if (stepStr.includes('unknown') || stepStr.includes('copy') || stepStr.includes('cast')) {
          console.log('Ability ' + index + ', Step ' + stepIndex + ': ' + stepStr);
        }
      });
    });
    console.log('');
  }
}

main().catch(console.error);
