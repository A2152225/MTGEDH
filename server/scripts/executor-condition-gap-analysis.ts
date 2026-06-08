/*
  Cluster unsupported_condition_clause executor skips from trigger-effect dry-runs.

  Run:
    npx tsx scripts/executor-condition-gap-analysis.ts
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
const outPath = path.join(__dirname, 'out', 'executor-condition-gap-analysis.json');

type GapRow = {
  key: string;
  conditionRaw: string;
  wrapperRaw: string;
  count: number;
  exampleCards: string[];
};

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, GapRow>();
const seen = new Set<string>();
let scanned = 0;
let unsupportedConditionItems = 0;

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
    const state = buildAuditFixtureState(card.name, card.type_line);
    const ctx = buildAuditExecutionContext(card.name);
    const selectedModeIds = collectAutoSelectedModeIds(steps);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
    });

    const conditionGaps = (result.automationGaps || []).filter(
      gap => gap.reasonCode === 'unsupported_condition_clause'
    );
    if (conditionGaps.length === 0) continue;

    unsupportedConditionItems += 1;
    for (const gap of conditionGaps) {
      const conditionRaw = String((gap.metadata as any)?.conditionRaw || '').trim();
      const wrapperRaw = String(gap.raw || effect).slice(0, 200);
      const key = conditionRaw.toLowerCase() || wrapperRaw.toLowerCase();

      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          conditionRaw: conditionRaw || wrapperRaw,
          wrapperRaw,
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

const top = [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 80);
const report = {
  generatedAt: new Date().toISOString(),
  cardsScanned: scanned,
  unsupportedConditionItems,
  uniqueClusters: clusters.size,
  topClusters: top,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Cards scanned: ${scanned}`);
console.log(`Items with unsupported_condition_clause: ${unsupportedConditionItems}`);
console.log(`Unique clusters: ${clusters.size}`);
console.log('');
for (const row of top.slice(0, 20)) {
  console.log(`[${row.count}] ${row.conditionRaw}`);
  console.log(`     e.g. ${row.exampleCards.slice(0, 3).join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
