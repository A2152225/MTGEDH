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

type Cluster = { count: number; status: string; kind: string; raw: string; reason: string; cards: string[] };
const clusters = new Map<string, Cluster>();

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    if (isIgnorableCardForIrGap(card) && hasUnknownIRSteps(effect, card.name).length > 0) continue;

    const irGaps = hasUnknownIRSteps(effect, card.name);
    const steps = collectStepsFromIrText(effect, card.name);
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

    const gapCodes = (result.automationGaps || []).map((g) => g.reasonCode).join(',') || 'none';
    for (const skip of result.skippedSteps || []) {
      const kind = String((skip as any).kind || 'unknown');
      const raw = String((skip as any).raw || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      const key = `${gapCodes}|${kind}|${raw}`.toLowerCase();
      const existing = clusters.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.cards.length < 3 && !existing.cards.includes(card.name)) existing.cards.push(card.name);
      } else {
        clusters.set(key, { count: 1, status: 'partial', kind, raw, reason: gapCodes, cards: [card.name] });
      }
    }
    if ((result.skippedSteps || []).length === 0) {
      const key = `${gapCodes}|applied_partial|${effect.slice(0, 60)}`.toLowerCase();
      const existing = clusters.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.cards.length < 3 && !existing.cards.includes(card.name)) existing.cards.push(card.name);
      } else {
        clusters.set(key, { count: 1, status: 'partial', kind: 'mixed', raw: effect.slice(0, 90), reason: gapCodes, cards: [card.name] });
      }
    }
  }
}

const sorted = [...clusters.values()].sort((a, b) => b.count - a.count);
console.log(`Partial skip clusters: ${sorted.length}, total partial triggers ~${sorted.reduce((s, r) => s + r.count, 0)}`);
for (const row of sorted.slice(0, 45)) {
  console.log(`[${row.count}] gaps=${row.reason} :: ${row.kind}`);
  console.log(`    ${row.raw}`);
  console.log(`    e.g. ${row.cards.join(', ')}`);
}
