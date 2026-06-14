/*
  Cluster full_card no_deterministic_target and unsupported_target executor skips.

  Run:
    npx tsx scripts/_tmp-fullcard-target-gap-analysis.ts
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
const outPath = path.join(__dirname, 'out', 'executor-fullcard-target-gap-analysis.json');

const TARGET_REASON_CODES = new Set(['no_deterministic_target', 'unsupported_target']);

type GapRow = {
  key: string;
  reasonCode: string;
  stepKind: string;
  targetText: string;
  raw: string;
  count: number;
  exampleCards: string[];
};

function extractTargetText(gap: {
  raw?: string;
  metadata?: Record<string, unknown>;
}): string {
  const meta = gap.metadata || {};
  return String(
    meta.targetText ||
      meta.target ||
      meta.selectorText ||
      meta.selector ||
      ''
  ).trim();
}

function clusterKey(reasonCode: string, stepKind: string, targetText: string, raw: string): string {
  const targetPart = (targetText || raw).toLowerCase().slice(0, 160);
  return `${reasonCode}|${stepKind}|${targetPart}`;
}

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, GapRow>();
const seen = new Set<string>();
let scanned = 0;
let gapItems = 0;
const itemsByReason: Record<string, number> = {
  no_deterministic_target: 0,
  unsupported_target: 0,
};

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

    const targetGaps = (result.automationGaps || []).filter((gap) =>
      TARGET_REASON_CODES.has(String(gap.reasonCode || ''))
    );
    if (targetGaps.length === 0) continue;

    gapItems += 1;
    for (const gap of targetGaps) {
      const reasonCode = String(gap.reasonCode || 'unknown');
      itemsByReason[reasonCode] = (itemsByReason[reasonCode] || 0) + 1;
      const stepKind = String(gap.stepKind || 'unknown');
      const raw = String(gap.raw || text).slice(0, 200);
      const targetText = extractTargetText(gap).slice(0, 160);
      const key = clusterKey(reasonCode, stepKind, targetText, raw);

      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          reasonCode,
          stepKind,
          targetText: targetText || raw.slice(0, 160),
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

const top = [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 40);
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'full_card',
  cardsScanned: scanned,
  gapItems,
  itemsByReason,
  uniqueClusters: clusters.size,
  topClusters: top,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Cards scanned: ${scanned}`);
console.log(`Items with target gaps: ${gapItems}`);
console.log(`no_deterministic_target items: ${itemsByReason.no_deterministic_target || 0}`);
console.log(`unsupported_target items: ${itemsByReason.unsupported_target || 0}`);
console.log(`Unique clusters: ${clusters.size}`);
console.log('');
for (const row of top.slice(0, 40)) {
  console.log(`[${row.count}] ${row.reasonCode} ${row.stepKind} — ${row.targetText || row.raw}`);
  console.log(`     e.g. ${row.exampleCards.slice(0, 3).join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
process.exit(0);
