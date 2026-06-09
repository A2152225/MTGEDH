import fs from 'node:fs';
import path from 'node:path';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  classifyExecutionResult,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
  countOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];

const names = ['Foot Chopper', 'Smothering Tithe', 'Living Artifact', 'Magnetic Snuffler'];
for (const name of names) {
  const card = cards.find((c) => c.name === name);
  if (!card) continue;
  const oracle = getCombinedOracleText(card);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    const irGaps = hasUnknownIRSteps(effect, name);
    const steps = collectStepsFromIrText(effect, name);
    const stepCount = countOracleSteps(steps);
    if (irGaps.length > 0 || stepCount.recognized === 0) continue;
    const cardRecord = { name: card.name, type_line: card.type_line, oracle_text: oracle };
    let state = buildAuditFixtureState(card.name, card.type_line);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForCopySteps(cardRecord, steps, state, ctx);
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
    const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: declineOptional ? false : true,
      ...(declineOptional ? { declineOptionalSteps: true } : {}),
      ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
    });
    const record = classifyExecutionResult(result, stepCount, irGaps);
    if (record.status !== 'partial') continue;
    console.log('\n===', name, '===');
    console.log('effect:', effect.slice(0, 100));
    console.log('status', record.status, 'reasonCodes', record.reasonCodes);
    console.log('applied', result.appliedSteps?.map((s) => `${s.kind}${(s as any).optional ? '?' : ''}`));
    console.log('skipped', (result.skippedSteps || []).map((s) => ({
      kind: (s as any).kind,
      optional: (s as any).optional,
      raw: String((s as any).raw || '').slice(0, 70),
    })));
    console.log('gaps', result.automationGaps?.map((g) => g.reasonCode));
  }
}
