import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: { name: string }) => c.name === "Kozilek's Unsealing");

async function main() {
  await loadEffectIrParser();
  const oracle = getCombinedOracleText(card);
  const triggers = parseTriggeredAbilitiesFromText(oracle, 'PROBE', 'P1', card.name);
  for (const t of triggers) {
    const gaps = hasUnknownIRSteps(t.effect, card.name);
    if (!gaps.length) continue;
    console.log('event:', t.event);
    console.log('effect:', t.effect);
    const audited = t.effect.replace(/\([^()]*\)/g, ' ').replace(/\s+\)/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('audited:', audited);
    console.log('gaps:', gaps);
    console.log(JSON.stringify(parseOracleTextToIR(audited, card.name).abilities, null, 2));
  }
}
main();
