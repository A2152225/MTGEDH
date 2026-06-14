import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  collectAutoSelectedModeIds,
  dryRunOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  isBenignFullCardReplacementMetadata,
  buildAuditExecutionContext,
  buildAuditFixtureState,
} from './executor-coverage-audit.ts';
import {
  collectUnknownIrGapsFromSteps,
  getCombinedOracleText,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outPath = path.join(__dirname, 'out', 'executor-fullcard-condition-gap-analysis.json');

type GapRow = {
  key: string;
  conditionRaw: string;
  effectText: string;
  count: number;
  exampleCards: string[];
};

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, GapRow>();
const seen = new Set<string>();
let scanned = 0;
let gapItems = 0;

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

    const irGaps = collectUnknownIrGapsFromSteps(steps);
    if (irGaps.length > 0) continue;

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

    const conditionGaps = (result.automationGaps || []).filter(
      (gap) => gap.reasonCode === 'unsupported_condition_clause'
    );
    if (conditionGaps.length === 0) continue;

    gapItems += 1;
    for (const gap of conditionGaps) {
      const conditionRaw = String((gap.metadata as any)?.conditionRaw || '').trim();
      const key = conditionRaw.toLowerCase() || String(gap.raw || text).toLowerCase().slice(0, 120);
      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          conditionRaw: conditionRaw || text,
          effectText: text.slice(0, 160),
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
  scope: 'full_card',
  cardsScanned: scanned,
  gapItems,
  uniqueClusters: clusters.size,
  topClusters: top,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Cards scanned: ${scanned}`);
console.log(`Items with unsupported_condition_clause: ${gapItems}`);
console.log(`Unique clusters: ${clusters.size}`);
for (const row of top.slice(0, 25)) {
  console.log(`[${row.count}] ${row.conditionRaw}`);
  console.log(`     effect: ${row.effectText.slice(0, 80)}`);
  console.log(`     e.g. ${row.exampleCards.slice(0, 3).join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
process.exit(0);
