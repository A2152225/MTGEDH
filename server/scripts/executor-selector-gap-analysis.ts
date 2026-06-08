/*
  Cluster unsupported_selector executor skips from trigger-effect dry-runs.

  Run:
    npx tsx scripts/executor-selector-gap-analysis.ts
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
const outPath = path.join(__dirname, 'out', 'executor-selector-gap-analysis.json');

type OracleCard = {
  oracle_id?: string;
  id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
  legalities?: Record<string, string>;
};

type GapRow = {
  key: string;
  stepKind: string;
  selectorText: string;
  raw: string;
  count: number;
  exampleCards: string[];
};

function dryRunWithGaps(
  steps: ReturnType<typeof collectStepsFromIrText>,
  cardName: string,
  typeLine?: string
) {
  const state = buildAuditFixtureState(cardName, typeLine);
  const ctx = buildAuditExecutionContext(cardName);
  const selectedModeIds = collectAutoSelectedModeIds(steps);
  return applyOracleIRStepsToGameState(state, steps, ctx, {
    allowOptional: true,
    ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
  });
}

await loadEffectIrParser(); // from trigger-coverage-audit

const oraclePath = path.join(repoRoot, 'oracle-cards.json');
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];
const clusters = new Map<string, GapRow>();
const seen = new Set<string>();
let scanned = 0;
let unsupportedSelectorItems = 0;

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
    const result = dryRunWithGaps(steps, card.name, card.type_line);
    const selectorGaps = (result.automationGaps || []).filter(
      gap => gap.reasonCode === 'unsupported_selector'
    );
    if (selectorGaps.length === 0) continue;

    unsupportedSelectorItems += 1;
    for (const gap of selectorGaps) {
      const stepKind = String(gap.stepKind || 'unknown');
      const raw = String(gap.raw || effect).slice(0, 200);
      const key = `${stepKind}|${raw.toLowerCase()}`;

      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          stepKind,
          selectorText: raw,
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

const top = [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 80);
const report = {
  generatedAt: new Date().toISOString(),
  cardsScanned: scanned,
  unsupportedSelectorItems,
  uniqueClusters: clusters.size,
  topClusters: top,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Cards scanned: ${scanned}`);
console.log(`Items with unsupported_selector: ${unsupportedSelectorItems}`);
console.log(`Unique clusters: ${clusters.size}`);
console.log('');
for (const row of top.slice(0, 25)) {
  console.log(`[${row.count}] ${row.stepKind} — ${row.selectorText || row.raw}`);
  console.log(`     e.g. ${row.exampleCards.slice(0, 3).join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
