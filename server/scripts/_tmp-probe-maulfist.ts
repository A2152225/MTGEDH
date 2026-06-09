import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
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
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];
const card = cards.find((c: any) => c.name === 'Maulfist Squad');
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  if (!/servo/i.test(effect)) continue;
  const steps = collectStepsFromIrText(effect, card.name);
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForCopySteps(
    { name: card.name, type_line: card.type_line, oracle_text: oracle },
    steps,
    state,
    ctx
  );
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
    oracleText: oracle,
  });
  for (const allowOptional of [false, true]) {
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional,
      ...(collectAutoSelectedModeIds(steps).length > 0
        ? { selectedModeIds: collectAutoSelectedModeIds(steps) }
        : {}),
    });
    console.log('\nallowOptional=', allowOptional);
    console.log('applied:', result.appliedSteps?.map((s: any) => s.raw?.slice(0, 60)));
    console.log('skipped:', result.skippedSteps?.map((s: any) => s.raw?.slice(0, 60)));
    console.log('gaps:', result.automationGaps?.map((g: any) => g.reasonCode + ' ' + g.message?.slice(0, 70)));
    console.log('log:', result.log?.slice(-6));
  }
}
