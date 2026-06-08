import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: { name: string }) => c.name === 'The Indomitable');

async function main() {
  await loadEffectIrParser();
  const oracle = getCombinedOracleText(card);
  const triggers = parseTriggeredAbilitiesFromText(oracle, 'PROBE', 'P1', 'The Indomitable');
  const t = triggers.find((x: { event: string }) => x.event === 'deals_combat_damage_to_player');
  console.log('effect:', t?.effect);
  const audited = t?.effect.replace(/\([^()]*\)/g, ' ').replace(/\s+\)/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('audited:', audited);
  const ir = parseOracleTextToIR(audited, 'The Indomitable');
  console.log(JSON.stringify(ir.abilities, null, 2));
  console.log('gaps:', hasUnknownIRSteps(t.effect, 'The Indomitable'));
}
main();
