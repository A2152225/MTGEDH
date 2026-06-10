/**
 * Debug Magus Sisters collectStepsFromIrText — run: npx tsx server/scripts/_tmp-debug-magus-collect.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { repairRandomChooseModeSagaAbilities, repairGapClosureAbilitySteps } from '../../rules-engine/src/oracleIRParserPostprocess.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

await loadEffectIrParser();

const card = cards.find((c) => c.name === 'Summon: Magus Sisters')!;
const oracle = getCombinedOracleText(card);
const parsed = parseOracleTextToIR(oracle, card.name);
const ability = parsed.abilities.find((a) => /choose one at random/i.test(String(a.effectText || a.text || '')))!;
const text = String(ability.effectText || ability.text || '');

console.log('fragment len', text.length, 'has bullet', text.includes('•'));
console.log('fragment:', text);

const fragParsed = parseOracleTextToIR(text, card.name);
console.log('\nfragment parse abilities:', fragParsed.abilities.length);
for (const a of fragParsed.abilities) {
  console.log('  eff:', String(a.effectText || a.text || '').slice(0, 100));
  console.log('  steps:', a.steps?.map((s) => s.kind));
}

const audited = text.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const auditedParsed = parseOracleTextToIR(audited, card.name);
console.log('\naudited single-line parse abilities:', auditedParsed.abilities.length);
for (const a of auditedParsed.abilities) {
  console.log('  eff len:', String(a.effectText || a.text || '').length);
  console.log('  eff:', String(a.effectText || a.text || '').slice(0, 120));
  console.log('  steps:', a.steps?.map((s) => s.kind));
}
const repaired = repairRandomChooseModeSagaAbilities(repairGapClosureAbilitySteps(auditedParsed.abilities));
console.log('\nafter repair:');
for (const a of repaired) {
  console.log('  steps:', a.steps?.map((s) => s.kind));
}

const steps = collectStepsFromIrText(text, card.name);
console.log('\ncollectSteps kinds:', steps.map((s) => s.kind));
console.log(JSON.stringify(steps, null, 2));

const irGaps = hasUnknownIRSteps(text, card.name);
const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
console.log('\ndryRun:', rec.status, rec.reasonCodes);
