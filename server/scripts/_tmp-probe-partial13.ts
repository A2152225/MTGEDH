import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { collectUnknownIrGapsFromSteps } from './trigger-coverage-audit.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  classifyExecutionResult,
  collectStepsFromIrText,
  countOracleSteps,
  dryRunOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.js';

const CARDS = [
  "Green Sun's Twilight",
  'Cache Grab',
  'Wrenn and Six',
  'Alaundo the Seer',
  'Sword of the Meek',
  'Sicarian Infiltrator',
  'Osteomancer Adept',
  'Empty the Laboratory',
  "Grim Captain's Call",
  "Selvala's Stampede",
  'Tarrian\'s Journal',
  'Tarrian\'s Journal // The Tomb of Aclazotz',
  'See the Truth',
  'Kindred Summons',
];

async function main() {
  const { lookupLocalCardByNameSync, ensureLocalCardLookupIndexSync } = await import(
    '../src/services/localCardLookup.js'
  );
  ensureLocalCardLookupIndexSync();

  for (const name of CARDS) {
    const card = lookupLocalCardByNameSync(name);
    const oracleText = String(card?.oracle_text || '').trim();
    console.log(`\n=== ${name} ===`);
    if (!oracleText) {
      console.log('  NO ORACLE TEXT');
      continue;
    }

    const steps = collectStepsFromIrText(oracleText, name);
    const irGaps = collectUnknownIrGapsFromSteps(steps);
    const record = dryRunOracleSteps(steps, name, irGaps, { typeLine: card?.type_line });
    console.log(`  audit status=${record.status} applied=${record.applied} skipped=${record.skipped}`);

    let state = buildAuditFixtureState(name, card?.type_line);
    let ctx = buildAuditExecutionContext(name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name, type_line: card?.type_line, oracle_text: oracleText },
      steps,
      state,
      ctx,
    );
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText,
    });
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: true,
    });

    for (const gap of result.automationGaps || []) {
      console.log(`  gap: ${gap.stepKind} | ${gap.reasonCode} | ${String(gap.raw || '').slice(0, 90)}`);
    }
    for (const step of result.skippedSteps || []) {
      console.log(`  skip: ${step.kind} | ${String((step as any).reason || (step as any).reasonCode || '')} | ${String((step as any).raw || '').slice(0, 90)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
