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
const oraclePath = path.join(repoRoot, 'oracle-cards.json');

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as any[];

type Cluster = { count: number; kind: string; raw: string; cards: string[] };
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
    state = targetEnriched.state;
    ctx = targetEnriched.ctx;

    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
    });
    const record = classifyExecutionResult(result, stepCount, irGaps);
    if (record.status !== 'partial') continue;
    if ((result.automationGaps || []).length > 0) continue;

    for (const skip of result.skippedSteps || []) {
      const kind = String((skip as any).kind || (skip as any).stepKind || 'unknown');
      const raw = String((skip as any).raw || (skip as any).text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const key = `${kind}|${raw}`.toLowerCase();
      const existing = clusters.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.cards.length < 4 && !existing.cards.includes(card.name)) existing.cards.push(card.name);
      } else {
        clusters.set(key, { count: 1, kind, raw, cards: [card.name] });
      }
    }
  }
}

const sorted = [...clusters.values()].sort((a, b) => b.count - a.count);
console.log(`Gap-less partial skip clusters: ${sorted.length}`);
for (const row of sorted.slice(0, 50)) {
  console.log(`[${row.count}] ${row.kind}`);
  console.log(`    ${row.raw}`);
  console.log(`    e.g. ${row.cards.join(', ')}`);
}
