import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === 'Cache Grab');
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
console.log(JSON.stringify(ir.abilities?.[0]?.steps, null, 2));
