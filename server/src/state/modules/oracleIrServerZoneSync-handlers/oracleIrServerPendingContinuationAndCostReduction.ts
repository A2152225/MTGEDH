// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerPendingContinuationAndCostReduction.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: persistUnqueuedPendingContinuationFromOracleIRResult and
//   syncNextSpellCostReductionFromOracleIRResult.
// Public entry symbols: persistUnqueuedPendingContinuationFromOracleIRResult,
//   syncNextSpellCostReductionFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { unwrapYouDoResumeSteps } from '../oracleIrServerPromptResumeUtils.js';
import { grantNextSpellCostReduction } from '../nextSpellCostReduction.js';
import { hasQueuedOracleIrContinuationOwner } from '../oracleIrContinuationBridge.js';

export function persistUnqueuedPendingContinuationFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    resolutionQueueStepsBefore: number;
    resolutionQueueStepsAfter: number;
  },
): void {
  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) return;
  if (String(state?.oracleIrPendingResumeStepsJson || '').trim()) return;

  const gameId = String((ctx as any).gameId || '').trim();
  // As-enters prompts (shock / check-land / copy / color) grow the queue without
  // owning leftover IR steps. Skip persist only when a queued step actually
  // carries resume/choice JSON. Unknown gameId still persists rather than
  // treating raw queue growth as a bridge.
  if (hasQueuedOracleIrContinuationOwner(gameId)) return;

  state.oracleIrPendingResumeStepsJson = JSON.stringify(unwrapYouDoResumeSteps(pending));
  state.oracleIrPendingResumeControllerId = params.controller;
  if (params.sourceId) state.oracleIrPendingResumeSourceId = params.sourceId;
  if (params.sourceName) state.oracleIrPendingResumeSourceName = params.sourceName;
}


export function syncNextSpellCostReductionFromOracleIRResult(
  state: any,
  controllerId: PlayerID,
  result: OracleIRExecutionResult,
  irCtx?: OracleIRExecutionContext,
): void {
  const pending = (irCtx as any)?.pendingNextSpellCostReduction;
  if (pending && Number(pending.genericAmount) > 0) {
    grantNextSpellCostReduction(state, controllerId, Number(pending.genericAmount), String(pending.sourceName || ''));
    return;
  }
  for (const step of result.appliedSteps || []) {
    if ((step as any)?.kind !== 'grant_next_spell_cost_reduction') continue;
    const per = Boolean((step as any).perCountersRemoved);
    const countersRemoved = Number((irCtx as any)?.countersRemovedThisWay ?? 0);
    const mana = String((step as any).mana || '{1}');
    const perAmount = Number.parseInt(String((mana.match(/\{(\d+)\}/) || [])[1] || '1'), 10);
    const amount = per
      ? Math.max(0, countersRemoved) * (Number.isFinite(perAmount) ? perAmount : 1)
      : Number((step as any).amount || perAmount || 0);
    if (amount > 0) {
      grantNextSpellCostReduction(state, controllerId, amount, String((irCtx as any)?.sourceName || ''));
    }
  }
}

