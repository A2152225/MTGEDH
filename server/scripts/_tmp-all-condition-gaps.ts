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

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, number>();
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
    if (!effect || hasUnknownIRSteps(effect, card.name).length > 0) continue;
    if (isIgnorableCardForIrGap(card) && hasUnknownIRSteps(effect, card.name).length > 0) continue;

    const steps = collectStepsFromIrText(effect, card.name);
    const state = buildAuditFixtureState(card.name, card.type_line);
    const ctx = buildAuditExecutionContext(card.name);
    const selectedModeIds = collectAutoSelectedModeIds(steps);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
    });

    for (const gap of (result.automationGaps || []).filter((g: any) => g.reasonCode === 'unsupported_condition_clause')) {
      const key = String((gap.metadata as any)?.conditionRaw || gap.raw || '').trim().toLowerCase();
      clusters.set(key, (clusters.get(key) || 0) + 1);
    }
  }
}

const sorted = [...clusters.entries()].sort((a, b) => b[1] - a[1]);
console.log('Total unique:', sorted.length, 'Total hits:', sorted.reduce((s, [, c]) => s + c, 0));
for (const [k, c] of sorted) console.log(`[${c}] ${k}`);
