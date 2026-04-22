import fs from 'fs';
import { parseOracleTextToIR } from './src/oracleIRParser';

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
const chancellor = cards.find(c => c.name === 'Chancellor of the Forge');

if (!chancellor) {
    console.error('Chancellor of the Forge not found');
    process.exit(1);
}

console.log('Oracle Text:', chancellor.oracle_text);
const ir = parseOracleTextToIR(chancellor.oracle_text, chancellor.name);
console.log('IR:', JSON.stringify(ir, null, 2));
