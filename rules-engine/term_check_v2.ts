import { parseOracleTextToIR } from './src/oracleIRParser.ts';
import fs from 'fs';

const cardsToFind = ['Shagrat, Loot Bearer', 'Saruman, the White Hand', 'Fall of Cair Andros', 'Warg Rider'];
const cardsData = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf-8'));

cardsToFind.forEach(name => {
    const card = cardsData.find(c => c.name === name);
    if (!card) return;
    const ir = parseOracleTextToIR(card.oracle_text, name);
    console.log('--- ' + name + ' ---');
    ir.abilities.forEach((ability, i) => {
        if (JSON.stringify(ability).includes('amass') || JSON.stringify(ability).includes('Orc')) {
            console.log('Ability ' + i + ' steps:');
            const steps = (ability.trigger?.steps || []).concat(ability.steps || []);
            console.log(JSON.stringify(steps, null, 2));
        }
    });
});
