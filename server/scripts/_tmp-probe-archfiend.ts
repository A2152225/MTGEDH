import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Archfiend of Spite')!;
const oracle = getCombinedOracleText(card);
console.log(oracle);
for (const t of parseTriggeredAbilitiesFromText(oracle, 'Archfiend of Spite')) {
  console.log('effect:', t.effect);
  console.log(JSON.stringify(collectStepsFromIrText(t.effect, 'Archfiend of Spite'), null, 2));
}
