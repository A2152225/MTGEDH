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

type Cluster = { count: number; reasonCode: string; stepKind: string; raw: string; cards: string[] };

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as any[];

const clusters = new Map<string, Cluster>();
let partialCount = 0;

for (const card of cards) {
  if (!isEligible(card)) continue;
  if (!isCommanderLegalCard(card)) continue;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  const triggers = parseTriggeredAbilitiesFromText(oracle, card.name);
  for (const trigger of triggers) {
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
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText: oracle,
    });
    state = targetEnriched.state;
    ctx = targetEnriched.ctx;

    const selectedModeIds = collectAutoSelectedModeIds(steps);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
    });
    const record = classifyExecutionResult(result, stepCount, irGaps);
    if (record.status !== 'partial') continue;
    partialCount += 1;

    for (const gap of result.automationGaps || []) {
      const reasonCode = String(gap.reasonCode || 'unknown');
      if (reasonCode === 'player_choice_required') continue;
      const stepKind = String(gap.stepKind || 'unknown');
      const raw = String(gap.raw || gap.message || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const key = `${reasonCode}|${stepKind}|${raw}`.toLowerCase();
      const existing = clusters.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.cards.length < 5 && !existing.cards.includes(card.name)) existing.cards.push(card.name);
      } else {
        clusters.set(key, { count: 1, reasonCode, stepKind, raw, cards: [card.name] });
      }
    }
  }
}

const sorted = [...clusters.values()].sort((a, b) => b.count - a.count);
console.log(`Partial effects: ${partialCount}`);
console.log(`Non-choice skip clusters: ${sorted.length}`);
for (const row of sorted.slice(0, 40)) {
  console.log(`[${row.count}] ${row.reasonCode} :: ${row.stepKind}`);
  console.log(`    ${row.raw}`);
  console.log(`    e.g. ${row.cards.join(', ')}`);
}
