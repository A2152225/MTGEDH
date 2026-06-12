import fs from 'node:fs';
import path from 'node:path';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();
const repoRoot = path.resolve(import.meta.dirname, '../..');
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];

const names = [
  'Provisions Merchant',
  'Bloodcrazed Socialite',
  'Puppet Conjurer',
  'Goremand',
  'Akuta, Born of Ash',
  'Infernal Denizen',
  'Alpine Guide',
  'Velukan Dragon',
  'Horned Stoneseeker',
  'Shadowgrange Archfiend',
  "Palani's Hatcher",
  'Leviathan',
  'The Cabbage Merchant',
];

for (const name of names) {
  const card = cards.find((c) => c.name === name);
  if (!card) {
    console.log(`\n=== ${name} MISSING`);
    continue;
  }
  const oracle = getCombinedOracleText(card);
  console.log(`\n=== ${name} ===`);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    const steps = collectStepsFromIrText(effect, name);
    let state = buildAuditFixtureState(name, card.type_line);
    let ctx = buildAuditExecutionContext(name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name, type_line: card.type_line, oracle_text: oracle },
      steps,
      state,
      ctx
    );
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText: oracle,
    });
    const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: declineOptional ? false : true,
      ...(declineOptional ? { declineOptionalSteps: true } : {}),
      ...(collectAutoSelectedModeIds(steps).length > 0
        ? { selectedModeIds: collectAutoSelectedModeIds(steps) }
        : {}),
    });
    const bad = (result.automationGaps || []).filter((g) => g.reasonCode !== 'player_choice_required');
    if (bad.length === 0) {
      console.log(`  OK ${effect.slice(0, 100)}`);
      continue;
    }
    for (const step of steps) {
      if (step.kind === 'sacrifice' || step.kind === 'conditional' || step.kind === 'modify_pt') {
        console.log(`    ${step.kind}: ${String(step.raw || '').slice(0, 100)}`);
        console.log(`      who: ${JSON.stringify((step as any).who)} what: ${JSON.stringify((step as any).what || (step as any).object)}`);
      }
    }
    for (const gap of bad) {
      console.log(`  GAP ${gap.reasonCode} [${gap.stepKind}]: ${gap.message}`);
    }
  }
}
process.exit(0);
