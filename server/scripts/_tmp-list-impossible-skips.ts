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

type OracleCard = { oracle_id?: string; id?: string; name: string; type_line?: string };

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];

type Row = {
  card: string;
  status: string;
  triggerEvent: string;
  effect: string;
  skipDetails: string;
};

const rows: Row[] = [];
const seen = new Set<string>();

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracleId = String(card.oracle_id || card.id || card.name);
  if (seen.has(oracleId)) continue;
  seen.add(oracleId);

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
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText: oracle,
    });
    state = targetEnriched.state;
    ctx = targetEnriched.ctx;

    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(collectAutoSelectedModeIds(steps).length > 0
        ? { selectedModeIds: collectAutoSelectedModeIds(steps) }
        : {}),
    });
    const record = classifyExecutionResult(result, stepCount, irGaps);

    const impossibleGaps = (result.automationGaps || []).filter(
      g => String(g.reasonCode || '') === 'impossible_action' || String(g.reasonCode || '') === 'invalid_input'
    );
    if (impossibleGaps.length === 0) continue;

    rows.push({
      card: card.name,
      status: record.status,
      triggerEvent: String(trigger.event || trigger.condition || trigger.triggerFilter || 'unknown'),
      effect,
      skipDetails: impossibleGaps
        .map(g => `${String(g.stepKind || '?')} (${String(g.reasonCode || '?')}): ${String(g.message || g.stepRaw || '').trim()}`)
        .join(' || '),
    });
  }
}

rows.sort((a, b) => a.card.localeCompare(b.card) || a.effect.localeCompare(b.effect));
console.log(`TOTAL_WITH_IMPOSSIBLE_SKIP=${rows.length}`);
for (const [i, row] of rows.entries()) {
  console.log(`${i + 1}. [${row.status}] ${row.card} (${row.triggerEvent})`);
  console.log(`   ${row.effect.replace(/\s+/g, ' ').slice(0, 130)}${row.effect.length > 130 ? '…' : ''}`);
  console.log(`   ${row.skipDetails.slice(0, 220)}${row.skipDetails.length > 220 ? '…' : ''}`);
}
