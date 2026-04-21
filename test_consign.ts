import fs from 'fs';
import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const cards = JSON.parse(fs.readFileSync('./oracle-cards.json', 'utf-8'));
const card = cards.find((c: any) => c.name === 'Consign to Memory');

if (card) {
    console.log('Oracle Text:', card.oracle_text);
    const parsed = parseOracleTextToIR(card.oracle_text, card.name);
    const replicateBit = parsed.abilities.find((a: any) => a.text.toLowerCase().includes('replicate'));
    console.log('Parsed Replicate Bit:', JSON.stringify(replicateBit, null, 2));
} else {
    console.log('Card not found');
}
