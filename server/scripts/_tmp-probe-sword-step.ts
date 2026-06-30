import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === 'Sword of the Meek');
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
const ability = ir.abilities?.find((a: any) => /attach it to that creature/i.test(String(a.effectText || '')));
console.log(JSON.stringify(ability?.steps, null, 2));
