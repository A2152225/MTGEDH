import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const c = cards.find((x: { name: string }) => x.name === 'Stolen Uniform');
console.log('oracle:', c?.oracle_text);
console.log('faces:', c?.card_faces?.map((f: { oracle_text?: string }) => f.oracle_text));
console.log('parsed:', parseTriggeredAbilitiesFromText(c.oracle_text, 'SRC', 'P1', c.name));
