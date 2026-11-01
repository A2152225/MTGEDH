// server/src/state/effects/effectProgramStateDiffPersistence.ts
// Origin parent: effectProgramResolutionService.ts (continueEffectProgramResolution).
// Cluster: before/after replay diffs for Effect Program runs, matching the ones
//   applyOracleIRStepsOnServer saves for plain IR passes.
// Public entry symbols: snapshotEffectProgramReplayBaseline, persistEffectProgramStateDiffs.
//
// An Effect Program run only saved its explicit replayMutations, so damage to
// players, lifelink, battlefield counters, permanent patches, poison and energy
// made after a choice resumed were lost on reload.

import type { OracleIRCommandExecutionEvent } from '../../../../rules-engine/src/effectProgramOracleRunner.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import type { GameContext } from '../context.js';
import type { EffectProgramOracleIrBridgeConfig } from '../modules/oracleIrEffectProgramBridge.js';
import { snapshotBattlefieldCounters } from '../modules/oracleIrServerZoneSync-handlers/oracleIrServerMillCounterPreparedSync.js';
import {
  persistBattlefieldPermanentPatchesFromOracleIR,
  snapshotBattlefieldPermanentReplayPatches,
  type BattlefieldPermanentReplayPatch,
} from './battlefieldPermanentReplayPersistence.js';
import {
  persistCounterDiffsFromOracleIR,
  persistLifeDiffsFromOracleIR,
  persistPlayerCounterDiffsFromOracleIR,
  snapshotPlayerCounterTotals,
  snapshotPlayerLifeTotals,
} from './effectProgramReplayMutationPersistence.js';

export interface EffectProgramReplayBaseline {
  readonly counters: Map<string, Record<string, number>>;
  readonly permanentPatches: Map<string, BattlefieldPermanentReplayPatch>;
  readonly life: Map<string, number>;
  readonly playerCounters: Map<string, Record<string, number>>;
}

export function snapshotEffectProgramReplayBaseline(state: any): EffectProgramReplayBaseline {
  return {
    counters: snapshotBattlefieldCounters(state || {}),
    permanentPatches: snapshotBattlefieldPermanentReplayPatches(state || {}),
    life: snapshotPlayerLifeTotals(state || {}),
    playerCounters: snapshotPlayerCounterTotals(state || {}),
  };
}

export function persistEffectProgramStateDiffs(
  ctx: GameContext,
  baseline: EffectProgramReplayBaseline,
  state: any,
  events: readonly unknown[],
  bridge?: EffectProgramOracleIrBridgeConfig,
): void {
  if ((ctx as any).isReplaying || !state) return;

  const replayMutations = events.flatMap((event) => {
    const typed = event as Partial<OracleIRCommandExecutionEvent> | null;
    if (!typed || typed.type !== 'oracle_ir_execution' || !typed.execution) return [];
    return [...(typed.execution.replayMutations || [])];
  });
  const mutationBridge = {
    sourceId: String(bridge?.sourceId || bridge?.irCtx?.sourceId || '').trim() || undefined,
    sourceName: String(bridge?.sourceName || bridge?.irCtx?.sourceName || '').trim() || undefined,
    effectProgramMutation: true,
  };

  persistCounterDiffsFromOracleIR(ctx, baseline.counters, state, mutationBridge);
  persistBattlefieldPermanentPatchesFromOracleIR(ctx, baseline.permanentPatches, state, mutationBridge);
  persistLifeDiffsFromOracleIR(
    ctx,
    baseline.life,
    state,
    { replayMutations } as unknown as OracleIRExecutionResult,
    mutationBridge,
  );
  persistPlayerCounterDiffsFromOracleIR(ctx, baseline.playerCounters, state, mutationBridge);
}
