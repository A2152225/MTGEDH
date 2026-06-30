import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
  dryRunOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.js';
import { collectUnknownIrGapsFromSteps } from './trigger-coverage-audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];

const NAMES = [
  'Telling Time',
  'See the Truth',
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
];

for (const name of NAMES) {
  const card = cards.find((c) => c.name === name);
  if (!card) {
    console.log(`\n=== ${name} === NOT IN ORACLE`);
    continue;
  }
  const oracleText = getCombinedOracleText(card);
  const steps = collectStepsFromIrText(oracleText, card.name);
  const irGaps = collectUnknownIrGapsFromSteps(steps);
  const record = dryRunOracleSteps(steps, card, irGaps);
  console.log(`\n=== ${name} === status=${record.status} applied=${record.applied} skipped=${record.skipped}`);

  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForCopySteps(card, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
    oracleText,
  });
  const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
    allowOptional: declineOptional ? false : true,
    ...(declineOptional ? { declineOptionalSteps: true } : {}),
    ...(collectAutoSelectedModeIds(steps).length > 0
      ? { selectedModeIds: collectAutoSelectedModeIds(steps) }
      : {}),
  });
  for (const gap of result.automationGaps || []) {
    console.log(`  gap: ${gap.stepKind} | ${gap.reasonCode} | ${String(gap.raw || '').slice(0, 85)}`);
  }
  for (const step of result.skippedSteps || []) {
    console.log(`  skip: ${step.kind} | ${String((step as any).raw || '').slice(0, 85)}`);
  }
}
