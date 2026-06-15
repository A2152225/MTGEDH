/*
  Cluster full_card general executor skips (non-target, non-ir_gap).

  Run:
    npx tsx scripts/_tmp-fullcard-general-gap-analysis.ts
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  isBenignFullCardReplacementMetadata,
} from './executor-coverage-audit.ts';
import {
  collectUnknownIrGapsFromSteps,
  getCombinedOracleText,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outPath = path.join(__dirname, 'out', 'executor-fullcard-general-gap-analysis.json');

const UI_REASON_CODES = new Set([
  'player_choice_required',
  'no_deterministic_target',
  'unsupported_target',
  'unsupported_step',
  'ir_gap',
]);

type GapRow = {
  key: string;
  reasonCode: string;
  stepKind: string;
  raw: string;
  message: string;
  count: number;
  exampleCards: string[];
};

function clusterKey(reasonCode: string, stepKind: string, raw: string): string {
  return `${reasonCode}|${stepKind}|${raw.toLowerCase().slice(0, 160)}`;
}

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, GapRow>();
const seen = new Set<string>();
let scanned = 0;
let gapItems = 0;
const itemsByReason: Record<string, number> = {};
const itemsByStepKind: Record<string, number> = {};

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracleId = String(card.oracle_id || card.id || card.name);
  if (seen.has(oracleId)) continue;
  seen.add(oracleId);
  scanned += 1;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;
  if (isIgnorableCardForIrGap(card)) continue;

  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const abilitySteps = Array.isArray(ability.steps) ? ability.steps : [];
    if (
      ability.type === 'replacement' &&
      abilitySteps.length === 0 &&
      isBenignFullCardReplacementMetadata(text)
    ) {
      continue;
    }
    const steps = abilitySteps.length > 0 ? abilitySteps : [];
    if (steps.length === 0) continue;
    if (collectUnknownIrGapsFromSteps(steps).length > 0) continue;

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
    state = targetEnriched.state;
    ctx = targetEnriched.ctx;
    const selectedModeIds = collectAutoSelectedModeIds(steps);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
    });

    const generalGaps = (result.automationGaps || []).filter(
      (gap) => !UI_REASON_CODES.has(String(gap.reasonCode || ''))
    );
    if (generalGaps.length === 0) continue;

    gapItems += generalGaps.length;
    for (const gap of generalGaps) {
      const reasonCode = String(gap.reasonCode || 'unknown');
      itemsByReason[reasonCode] = (itemsByReason[reasonCode] || 0) + 1;
      const stepKind = String(gap.stepKind || 'unknown');
      itemsByStepKind[stepKind] = (itemsByStepKind[stepKind] || 0) + 1;
      const raw = String(gap.raw || text).slice(0, 200);
      const message = String(gap.message || '').slice(0, 160);
      const key = clusterKey(reasonCode, stepKind, raw);

      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          reasonCode,
          stepKind,
          raw,
          message,
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

const top = [...clusters.values()].sort((a, b) => b.count - a.count);
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'full_card',
  cardsScanned: scanned,
  gapItems,
  itemsByReason,
  itemsByStepKind,
  uniqueClusters: clusters.size,
  topClusters: top,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Cards scanned: ${scanned}`);
console.log(`General gap items: ${gapItems}`);
console.log(`Unique clusters: ${clusters.size}`);
console.log(JSON.stringify(itemsByReason, null, 2));
console.log(`\nWrote ${outPath}`);
process.exit(0);
