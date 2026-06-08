/*
  Cluster unknown_amount and unsupported_scaler executor skips from trigger-effect dry-runs.

  Run:
    npx tsx scripts/executor-amount-gap-analysis.ts
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outPath = path.join(__dirname, 'out', 'executor-amount-gap-analysis.json');

const TARGET_REASONS = new Set(['unknown_amount', 'unsupported_scaler']);

type GapRow = {
  key: string;
  reasonCode: string;
  stepKind: string;
  amountRaw: string;
  scalerRaw: string;
  raw: string;
  count: number;
  exampleCards: string[];
};

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, GapRow>();
const seen = new Set<string>();
let scanned = 0;
const reasonTotals: Record<string, number> = {};

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracleId = String(card.oracle_id || card.id || card.name);
  if (seen.has(oracleId)) continue;
  seen.add(oracleId);
  scanned += 1;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    if (isIgnorableCardForIrGap(card) && hasUnknownIRSteps(effect, card.name).length > 0) continue;
    if (hasUnknownIRSteps(effect, card.name).length > 0) continue;

    const steps = collectStepsFromIrText(effect, card.name);
    let state = buildAuditFixtureState(card.name, card.type_line);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name: card.name, type_line: card.type_line, oracle_text: oracle },
      steps,
      state,
      ctx
    );
    state = enriched.state;
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, state, enriched.ctx, { oracleText: oracle });
    state = targetEnriched.state;
    ctx = targetEnriched.ctx;
    const selectedModeIds = collectAutoSelectedModeIds(steps);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
    });

    const amountGaps = (result.automationGaps || []).filter((gap) =>
      TARGET_REASONS.has(String(gap.reasonCode || ''))
    );
    if (amountGaps.length === 0) continue;

    for (const gap of amountGaps) {
      const reasonCode = String(gap.reasonCode || 'unknown_amount');
      reasonTotals[reasonCode] = (reasonTotals[reasonCode] || 0) + 1;

      const stepKind = String((gap.metadata as any)?.stepKind || gap.stepKind || 'unknown').trim();
      const amountRaw = String((gap.metadata as any)?.amountRaw || '').trim();
      const scalerRaw = String((gap.metadata as any)?.scalerRaw || '').trim();
      const raw = String(gap.raw || effect).slice(0, 240);
      const key = `${reasonCode}|${stepKind}|${amountRaw || scalerRaw || raw}`.toLowerCase();

      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          reasonCode,
          stepKind,
          amountRaw,
          scalerRaw,
          raw,
          count: 1,
          exampleCards: [card.name],
        });
        continue;
      }
      existing.count += 1;
      if (!existing.exampleCards.includes(card.name) && existing.exampleCards.length < 8) {
        existing.exampleCards.push(card.name);
      }
    }
  }
}

const top = [...clusters.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const report = {
  generatedAt: new Date().toISOString(),
  cardsScanned: scanned,
  reasonTotals,
  uniqueClusters: clusters.size,
  topClusters: top.slice(0, 120),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Cards scanned: ${scanned}`);
for (const [reason, count] of Object.entries(reasonTotals).sort((a, b) => b[1] - a[1])) {
  console.log(`${reason} items: ${count}`);
}
console.log(`Unique clusters: ${clusters.size}`);
console.log('');
for (const row of top.slice(0, 25)) {
  const detail = row.amountRaw || row.scalerRaw || row.raw.slice(0, 80);
  console.log(`[${row.count}] ${row.reasonCode} ${row.stepKind} — ${detail}`);
  console.log(`     e.g. ${row.exampleCards.slice(0, 2).join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
