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

type OracleCard = {
  oracle_id?: string;
  id?: string;
  name: string;
  type_line?: string;
};

type Row = {
  card: string;
  triggerEvent: string;
  effect: string;
  applied: number;
  skipped: number;
  reasonSummary: string;
  skipDetails: string;
};

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];

const rows: Row[] = [];
const seen = new Set<string>();

for (const card of cards) {
  if (!isEligible(card)) continue;
  if (!isCommanderLegalCard(card)) continue;
  const oracleId = String(card.oracle_id || card.id || card.name);
  if (seen.has(oracleId)) continue;
  seen.add(oracleId);

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
    if (record.status !== 'impossible') continue;

    const gaps = (result.automationGaps || []).map(g => {
      const kind = String(g.stepKind || '?');
      const reason = String(g.reasonCode || '?');
      const msg = String(g.message || g.stepRaw || g.raw || '').trim();
      return `${kind} (${reason}): ${msg}`;
    });

    rows.push({
      card: card.name,
      triggerEvent: String(trigger.event || trigger.condition || trigger.triggerFilter || 'unknown'),
      effect,
      applied: record.applied,
      skipped: record.skipped,
      reasonSummary: Object.entries(record.reasonCodes)
        .map(([code, count]) => `${code}×${count}`)
        .join(', '),
      skipDetails: gaps.join(' || '),
    });
  }
}

rows.sort((a, b) => a.card.localeCompare(b.card) || a.effect.localeCompare(b.effect));

const outPath = path.join(import.meta.dirname, 'out', 'impossible-effects.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ count: rows.length, rows }, null, 2));

console.log(`Wrote ${rows.length} impossible effect(s) to ${outPath}`);
for (const [index, row] of rows.entries()) {
  console.log(`${index + 1}. ${row.card} | ${row.triggerEvent}`);
  console.log(`   effect: ${row.effect.replace(/\s+/g, ' ').slice(0, 140)}${row.effect.length > 140 ? '…' : ''}`);
  console.log(`   why: ${row.skipDetails || row.reasonSummary}`);
}
