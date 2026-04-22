
import * as fs from 'fs';
import { parseOracleTextToIR } from './src/oracleIRParser';

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));

const cardNames = ['Tooth and Nail', 'Spinal Parasite'];
for (const name of cardNames) {
    const card = cards.find((c: any) => c.name === name);
    if (!card) {
        console.log('Card not found: ' + name);
        continue;
    }
    const ir = parseOracleTextToIR(card.oracle_text, card.name);
    
    console.log('--- Card: ' + name + ' ---');
    console.log('Keywords: ' + JSON.stringify(ir.keywords));
    
    // Check for remaining reminder lines or unknown static abilities
    const unknownStatics = ir.abilities.filter((a: any) => a.type === 'static' && a.text);
    console.log('Static abilities: ' + JSON.stringify(unknownStatics.map((a: any) => a.text)));
    console.log('');
}

