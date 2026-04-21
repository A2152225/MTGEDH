import { parseOracleTextToIR } from './src/oracleIRParser.ts';
import fs from 'fs';

const cardsToFind = ["Shagrat, Loot Bearer", "Saruman, the White Hand", "Fall of Cair Andros", "Warg Rider"];

// We need to find the oracle text for these cards. 
// Assuming oracle-cards.json is in the root D:\Git\MTGEDH
const cardsData = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));

cardsToFind.forEach(name => {
    const card = cardsData.find(c => c.name === name);
    if (card) {
        console.log('--- ' + name + ' ---');
        console.log('Oracle Text: ' + card.oracle_text);
        const ir = parseOracleTextToIR(card.oracle_text, name);
        console.log('IR Abilities:');
        console.log(JSON.stringify(ir.abilities, null, 2));
    } else {
        console.log('--- ' + name + ' NOT FOUND ---');
    }
});
