import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === "Grim Captain's Call");
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
const step = ir.abilities?.[0]?.steps?.find((s: any) => s.kind === 'move_zone');
console.log(JSON.stringify(step, null, 2));
