import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { getCombinedOracleText, collectUnknownIrGapsFromSteps } from './trigger-coverage-audit.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  dryRunOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];

const TARGETS = new Set([
  'Telling Time',
  'Accumulate Wisdom',
  'See the Truth',
  'Moment of Truth',
  'Cache Grab',
  'Wrenn and Six',
  'Alaundo the Seer',
  'Sword of the Meek',
  'Osteomancer Adept',
  'Empty the Laboratory',
  "Grim Captain's Call",
  "Selvala's Stampede",
  "Tarrian's Journal // The Tomb of Aclazotz",
  'Kindred Summons',
]);

for (const card of cards) {
  if (!TARGETS.has(card.name)) continue;
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    const steps = Array.isArray(ability.steps) ? ability.steps : [];
    if (!text || steps.length === 0) continue;
    const irGaps = collectUnknownIrGapsFromSteps(steps);
    const record = dryRunOracleSteps(steps, card, irGaps);
    if (record.status === 'fully_applied' || record.status === 'choice_required') continue;

    console.log(`\n=== ${card.name} ===`);
    console.log(`  ability: ${text.slice(0, 120)}`);
    console.log(`  status=${record.status} applied=${record.applied} skipped=${record.skipped}`);

    let state = buildAuditFixtureState(card.name, card.type_line);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForCopySteps(card, steps, state, ctx);
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
    const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: declineOptional ? false : true,
      ...(declineOptional ? { declineOptionalSteps: true } : {}),
      ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
    });
    for (const gap of result.automationGaps || []) {
      console.log(`  gap: ${gap.stepKind} | ${gap.reasonCode} | ${String(gap.raw || '').slice(0, 80)}`);
    }
    for (const step of result.skippedSteps || []) {
      console.log(`  skip: ${step.kind} | ${String((step as any).raw || '').slice(0, 80)}`);
    }
    for (const step of steps) {
      console.log(`  step: ${step.kind} | ${String((step as any).raw || '').slice(0, 70)}`);
    }
  }
}
