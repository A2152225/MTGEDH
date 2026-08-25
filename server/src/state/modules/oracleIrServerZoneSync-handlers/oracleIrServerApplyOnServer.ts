// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerApplyOnServer.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: applyOracleIRStepsOnServer.
// Public entry symbols: applyOracleIRStepsOnServer.
// Sacrifice prompts are reached through oracleIrServerApplyDeps (bound by the parent).
// Must not import oracleIrServerZoneSync.ts or the handlers index.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  type OracleIRExecutionContext,
  type OracleIRExecutionOptions,
  type OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRTransitionHaltState } from '../../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { createEmptyStepLedger } from '../../../../../rules-engine/src/oracleIRStepLedger.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { persistOracleIrReplayMutationsFromExecution, persistCounterDiffsFromOracleIR } from '../../effects/effectProgramReplayMutationPersistence.js';
import { persistBattlefieldPermanentPatchesFromOracleIR, snapshotBattlefieldPermanentReplayPatches } from '../../effects/battlefieldPermanentReplayPersistence.js';
import { queueTopLibraryChoicePromptsFromOracleIRResult } from '../oracleIrServerScrySurveilPromptUtils.js';
import { queueBlightChoicePromptsFromOracleIRResult } from '../oracleIrServerBlightPromptUtils.js';
import { isOracleIrTriggerPrimaryEnabled } from '../oracleIrTriggerExecution.js';
import { processSpellCounteredTriggers } from '../spellCounteredTriggerUtils.js';
import { emitTriggersAfterOracleIRApply, snapshotBattlefieldForTriggerEmission } from '../oracleIrPostApplyTriggerEmission.js';
import { processDrawTriggers } from '../zones.js';
import { queueCopySpellStackPushFromOracleIRResult, queueCastableCopiedSpellPromptsFromOracleIRResult } from '../oracleIrServerCopySpellSync.js';
import { resyncPreparedExileCopiesWithControllers } from '../prepared.js';
import { queueEachPlayerCounterPlacementPromptsFromOracleIRResult } from '../triggerCounterPlacementPromptUtils.js';
import { bridgeGameStateOracleEffectsAfterOracleIR } from '../triggerGameStateOracleBridgeUtils.js';
import { bridgeCreatedTokenEtbTriggersAfterOracleIR } from '../triggerOracleIrTokenEtbBridge.js';
import { queueOracleIrReflexiveWhenYouDoFollowups } from '../triggerReflexiveWhenYouDoQueueUtils.js';
import { syncDerivedContinuousEffects } from '../staticEffectSpec.js';
import { mirrorGraveyardCastingPermissionsToDurable } from '../graveyard-permissions.js';
import { syncCastingModifierGrantsFromOracleIRResult } from '../casting-modifiers.js';
import {
  createOracleIRServerExecutionBridge,
  queueOracleIrDeferredReplacementPrompts,
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
} from '../oracleIrTransitionPipeline.js';
import {
  syncIrAtNextEndStepTokenSacrificeFromOracleIRResult,
  syncIrCopyTokenProvenanceFromOracleIRResult,
  syncIrGraveyardExilesToSourcePermanentExiledCards,
  syncIrImpulseExileToPendingImpulseDraws,
  syncIrLinkedExilesFromOracleIRResult,
  syncIrPowerToughnessModifiersToTemporaryPTMods,
  syncIrPreparedStateFromOracleIRResult,
  syncIrReanimationRidersFromOracleIRResult,
  syncIrTemporaryGrantEffectsToServerTemporaryAbilities,
} from './oracleIrServerPostExecutionStateSync.js';
import {
  queueLookChooseChoicePromptsFromOracleIRResult,
  queueSearchLibraryChoicePromptsFromOracleIRResult,
  queueChoosePileChoicePromptsFromOracleIRResult,
} from './oracleIrServerLibrarySearchLookChoosePilePrompts.js';
import {
  queueJoinForcesPromptsFromOracleIRResult,
  queueVotePromptsFromOracleIRResult,
} from './oracleIrServerVoteJoinForcesPrompts.js';
import { queueChoiceFamilyPromptsFromOracleIRResult } from './oracleIrServerChoiceFamilyPrompts.js';
import {
  queueTapMatchingPermanentsChoicePromptsFromOracleIRResult,
  queueTapOrUntapChoicePromptsFromOracleIRResult,
} from './oracleIrServerTapUntapChoicePrompts.js';
import {
  queueExploreChoicePromptsFromOracleIRResult,
  queuePopulateChoicePromptsFromOracleIRResult,
  queueChangeTargetChoicePromptsFromOracleIRResult,
} from './oracleIrServerExplorePopulateChangeTargetPrompts.js';
import {
  queueRepeatedZoneDraftChoicePromptFromOracleIRResult,
  queueSeparateIntoPilesPromptsFromOracleIRResult,
  bridgeLibraryChaosExchangeFromOracleIRResult,
} from './oracleIrServerZoneDraftPilesChaosPrompts.js';
import {
  queueCopyPermanentChoicePromptsFromOracleIRResult,
  queueMoveZoneChoicePromptsFromOracleIRResult,
  queueMoveZoneDestinationChoicePromptsFromOracleIRResult,
} from './oracleIrServerCopyPermanentMoveZonePrompts.js';
import {
  syncGraveyardCastFreeExilePermissionsFromOracleIR,
  syncImpulseExilePlayPermissionsToState,
  queueChooseOneImpulseExilePlayPromptsFromOracleIRResult,
  queueDiscoverCastOrHandPromptsFromOracleIRResult,
} from './oracleIrServerImpulseDiscoverGyPermissionPrompts.js';
import { queueOptionalStepChoicePromptsFromOracleIRResult } from './oracleIrServerOptionalStepChoicePrompts.js';
import {
  persistUnqueuedPendingContinuationFromOracleIRResult,
  syncNextSpellCostReductionFromOracleIRResult,
} from './oracleIrServerPendingContinuationAndCostReduction.js';
import { queueUnlessPayChoicePromptsFromOracleIRResult } from './oracleIrServerUnlessPayChoicePrompts.js';
import {
  queueAddManaChoicePromptsFromOracleIRResult,
  queueAddCounterTargetSelectionPromptsFromOracleIRResult,
  queueCounterDistributionPromptsFromOracleIRResult,
} from './oracleIrServerManaCounterChoicePrompts.js';
import {
  queueConniveChoicePromptsFromOracleIRResult,
  queuePlayerChoicePromptsFromOracleIRResult,
  syncIrPendingDiscardFromOracleIRResult,
} from './oracleIrServerConnivePlayerChoicePrompts.js';
import {
  queueControllerMayPutLandFromHandPromptsFromOracleIRResult,
  queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult,
  queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult,
} from './oracleIrServerLandFromHandPrompts.js';
import {
  queueDiscardChoicePromptsFromOracleIRResult,
  queueProliferateChoicePromptsFromOracleIRResult,
} from './oracleIrServerDiscardProliferatePrompts.js';
import {
  queueRedistributeLifeTotalsPromptsFromOracleIRResult,
  queueFlipCoinLifeStakesPromptsFromOracleIRResult,
} from './oracleIrServerLifeFlipCoinPrompts.js';
import {
  enrichBattlefieldTokenImages,
  hydrateOracleIRPlayerZonesFromContext,
  snapshotGraveyardCardIds,
  snapshotExileCardIds,
  bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult,
  bridgeScheduleDelayedFlickerReturnsFromOracleIRResult,
  syncAllOracleIRPlayerZonesAfterResolution,
} from './oracleIrServerZoneHydrateDelayedBridges.js';
import {
  snapshotBattlefieldControllers,
  snapshotBattlefieldCounters,
  syncCounterReplacementEffectsAfterOracleIR,
  syncPreparedCopiesAfterBattlefieldControllerChanges,
  syncPreparedCopiesFromControlChangeEffects,
  applyMillReplacementEffectsToSteps,
} from './oracleIrServerMillCounterPreparedSync.js';
import { queueSacrificeChoicePromptsFromOracleIRResult } from './oracleIrServerApplyDeps.js';

export function applyOracleIRStepsOnServer(
  ctx: GameContext,
  state: any,
  steps: readonly OracleEffectStep[],
  irCtx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  params?: {
    controller?: PlayerID;
    targetPlayerId?: PlayerID;
    applyMillReplacements?: boolean;
    triggerItem?: any;
    sourceItem?: any;
    oracleText?: string;
    compoundResume?: boolean;
  },
): OracleIRExecutionResult {
  hydrateOracleIRPlayerZonesFromContext(ctx, state);
  const gameId = String((ctx as any).gameId || 'unknown');
  const graveyardBefore = snapshotGraveyardCardIds(state);
  const exileBefore = snapshotExileCardIds(state);
  const controllersBefore = snapshotBattlefieldControllers(state);
  const countersBefore = snapshotBattlefieldCounters(state);
  const permanentPatchesBefore = snapshotBattlefieldPermanentReplayPatches(state);
  const triggerEmissionBefore = snapshotBattlefieldForTriggerEmission(state);
  const stackBeforeCounter = Array.isArray((state as any).stack)
    ? ((state as any).stack as any[]).map((item) => ({
        id: String(item?.id || ''),
        type: String(item?.type || ''),
        controller: String(item?.controller || ''),
        cardName: String(item?.card?.name || item?.name || 'spell'),
      }))
    : [];

  const controller = (params?.controller || irCtx.controllerId) as PlayerID;
  const adjustedSteps = params?.applyMillReplacements === false
    ? [...steps]
    : applyMillReplacementEffectsToSteps(
        ctx,
        [...steps],
        controller,
        params?.targetPlayerId,
        state,
        irCtx,
      );

  const stepLedger = createEmptyStepLedger(
    irCtx.stepLedger ?? readStepLedgerFromState(state),
  );
  const appliedStepKinds = irCtx.appliedStepKinds
    ? new Map(irCtx.appliedStepKinds)
    : readAppliedStepKindsFromState(state);
  const transitionHaltState: OracleIRTransitionHaltState = irCtx.transitionHaltState ?? {
    halted: false,
    deferred: [],
  };
  const serverBridge = createOracleIRServerExecutionBridge({
    state,
    ledger: stepLedger,
    interactivePlayerChoices: irCtx.interactivePlayerChoices ?? true,
    haltState: transitionHaltState,
    ctx,
  });
  const deferOptionalLookChoices = gameId !== 'unknown'
    && !(ctx as any).isReplaying
    && (
      Boolean((ctx as any).io)
      || isOracleIrTriggerPrimaryEnabled()
      || irCtx.interactivePlayerChoices !== false
    );
  const deferOptionalGrantGraveyardChoices = deferOptionalLookChoices;
  const deferOptionalPerPlayerChoices = deferOptionalLookChoices;

  const libraryCountsBeforeDrawHook: Record<string, number> = {};
  for (const player of ((state as any)?.players || [])) {
    const pid = String(player?.id || '').trim();
    if (!pid) continue;
    const fromPlayer = Array.isArray(player?.library) ? player.library.length : null;
    const fromCtx = typeof (ctx as any)?.libraries?.get === 'function'
      ? Number(((ctx as any).libraries.get(pid) || []).length)
      : null;
    libraryCountsBeforeDrawHook[pid] = Number.isFinite(fromPlayer as any)
      ? Number(fromPlayer)
      : (Number.isFinite(fromCtx as any) ? Number(fromCtx) : 0);
  }

  const result = applyOracleIRStepsToGameState(state, adjustedSteps, {
    ...irCtx,
    stepLedger,
    appliedStepKinds,
    transitionHaltState,
    interactivePlayerChoices: irCtx.interactivePlayerChoices ?? true,
    deferOptionalLookChoices,
    deferOptionalGrantGraveyardChoices,
    deferOptionalPerPlayerChoices,
    deferStackSpellCopiesToServer: true,
    serverBridge,
  }, {
    ...options,
    haltOnPlayerChoiceRequired: options.haltOnPlayerChoiceRequired ?? true,
  });
  Object.assign(state, result.state);
  try {
    // Fire "whenever you draw" triggers for IR draws (Temple Bell, Kynaios, etc.).
    // Turn-based draws already go through zones.draw*; IR commits previously skipped this.
    if (!(ctx as any).isReplaying) {
      const drawStepsApplied = (result.appliedSteps || []).some((step: any) => step?.kind === 'draw');
      if (drawStepsApplied) {
        for (const player of ((state as any)?.players || [])) {
          const pid = String(player?.id || '').trim();
          if (!pid) continue;
          const before = Number(libraryCountsBeforeDrawHook[pid] || 0);
          const afterPlayer = Array.isArray(player?.library) ? player.library.length : null;
          const afterCtx = typeof (ctx as any)?.libraries?.get === 'function'
            ? Number(((ctx as any).libraries.get(pid) || []).length)
            : null;
          const after = Number.isFinite(afterPlayer as any)
            ? Number(afterPlayer)
            : (Number.isFinite(afterCtx as any) ? Number(afterCtx) : before);
          const drawn = Math.max(0, before - after);
          if (drawn > 0) {
            processDrawTriggers(ctx, pid as any, drawn);
          }
        }
      }
    }
    const counterSpellApplied = (result.appliedSteps || []).some((step) => step?.kind === 'counter_spell');
    if (counterSpellApplied && !(ctx as any).isReplaying) {
      const stackAfterIds = new Set(
        (Array.isArray((state as any).stack) ? (state as any).stack : [])
          .map((item: any) => String(item?.id || '').trim())
          .filter(Boolean),
      );
      for (const before of stackBeforeCounter) {
        if (!before.id || stackAfterIds.has(before.id)) continue;
        const wasSpell = !before.type || before.type === 'spell';
        if (!wasSpell) continue;
        processSpellCounteredTriggers(ctx, {
          counteringControllerId: String(controller || ''),
          counteredControllerId: before.controller,
          counteredStackItemId: before.id,
          counteredCardName: before.cardName,
          counteringSourceName: String(irCtx.sourceName || '').trim() || 'Counter',
          counteredWasSpell: true,
        });
      }
    }
  } catch {
    // best-effort ? do not fail IR resolution for trigger emission
  }
  try {
    emitTriggersAfterOracleIRApply(ctx, state, result, triggerEmissionBefore, {
      controller: String(controller || ''),
      sourcePermanentId: String(irCtx?.sourceId || ''),
    });
  } catch {
    // best-effort ? do not fail IR resolution for trigger emission
  }
  syncGraveyardCastFreeExilePermissionsFromOracleIR(state, adjustedSteps, result, irCtx);
  mirrorGraveyardCastingPermissionsToDurable(state);
  syncCastingModifierGrantsFromOracleIRResult(
    state,
    controller,
    String(irCtx.sourceName || '').trim() || undefined,
    result,
    params?.triggerItem ?? params?.sourceItem,
  );
  syncNextSpellCostReductionFromOracleIRResult(state as any, params.controller, result, irCtx);

  queueOracleIrDeferredReplacementPrompts(ctx, transitionHaltState, {
    controller: String(controller),
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    sourceOracle: String(
      params?.oracleText
      || params?.triggerItem?.card?.oracle_text
      || params?.sourceItem?.card?.oracle_text
      || '',
    ).trim() || undefined,
    continuationSteps: result.pendingContinuationSteps,
  });
  enrichBattlefieldTokenImages(state);
  syncDerivedContinuousEffects(state);
  syncCounterReplacementEffectsAfterOracleIR(ctx, state, countersBefore);
  syncAllOracleIRPlayerZonesAfterResolution(ctx);
  syncImpulseExilePlayPermissionsToState(state);
  bridgeScheduleDelayedFlickerReturnsFromOracleIRResult(ctx, state, result, exileBefore, {
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  const resolutionQueueStepsBefore = gameId && gameId !== 'unknown' && !(ctx as any).isReplaying
    ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
    : 0;
  const queueOracleIrResolutionPrompts = () => {
  const resolutionTriggerItem = params?.triggerItem ?? params?.sourceItem;
  queueTopLibraryChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueSacrificeChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    targetPlayerId: params?.targetPlayerId,
    triggerItem: resolutionTriggerItem,
  });
  queueUnlessPayChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueDiscardChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  syncIrPendingDiscardFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    irCtx,
  });
  queueConniveChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueAddManaChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueAddCounterTargetSelectionPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueCounterDistributionPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueEachPlayerCounterPlacementPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
  });
  bridgeGameStateOracleEffectsAfterOracleIR(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
    effectText: String(params?.oracleText || adjustedSteps.map((step) => String((step as any).raw || '')).filter(Boolean).join(' ')),
  });
  bridgeCreatedTokenEtbTriggersAfterOracleIR(ctx, state, result);
  queueOracleIrReflexiveWhenYouDoFollowups(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
    battlefieldIdsBefore: new Set(triggerEmissionBefore.permanents.keys()),
  });
  queuePlayerChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueJoinForcesPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueVotePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueChoiceFamilyPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    item: params?.sourceItem || params?.triggerItem,
    card: params?.sourceItem?.card,
    effectiveCard: params?.sourceItem?.card || { name: irCtx.sourceName },
  });
  queueMoveZoneChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueMoveZoneDestinationChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueChooseOneImpulseExilePlayPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  queueDiscoverCastOrHandPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueCastableCopiedSpellPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueOptionalStepChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
  });
  queueControllerMayPutLandFromHandPromptsFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
  });
  queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
    irCtx,
  });
  queueProliferateChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueFlipCoinLifeStakesPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueRedistributeLifeTotalsPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueBlightChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queuePopulateChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueExploreChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueLookChooseChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueSearchLibraryChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    sourceItem: (params as any)?.sourceItem,
  });
  queueChoosePileChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueChangeTargetChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueTapOrUntapChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueTapMatchingPermanentsChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueRepeatedZoneDraftChoicePromptFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueSeparateIntoPilesPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  bridgeLibraryChaosExchangeFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    sourceItem: resolutionTriggerItem,
  });
  queueCopyPermanentChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    sourceItem: params?.sourceItem ?? resolutionTriggerItem,
    oracleText: params?.oracleText,
  });
  };
  if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying) {
    ResolutionQueueManager.runWithDeferredStepAddedEvents(gameId, queueOracleIrResolutionPrompts);
  } else {
    queueOracleIrResolutionPrompts();
  }
  const resolutionQueueStepsAfter = gameId && gameId !== 'unknown' && !(ctx as any).isReplaying
    ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
    : resolutionQueueStepsBefore;
  persistUnqueuedPendingContinuationFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    resolutionQueueStepsBefore,
    resolutionQueueStepsAfter,
  });
  syncPreparedCopiesAfterBattlefieldControllerChanges(state, controllersBefore);
  syncPreparedCopiesFromControlChangeEffects(state);
  resyncPreparedExileCopiesWithControllers(state);
  syncIrTemporaryGrantEffectsToServerTemporaryAbilities(
    state,
    String(irCtx.sourceName || '').trim() || 'Ability',
  );
  syncIrPowerToughnessModifiersToTemporaryPTMods(
    state,
    String(irCtx.sourceName || '').trim() || 'Ability',
  );
  syncIrImpulseExileToPendingImpulseDraws(
    state,
    result,
    String(irCtx.sourceName || '').trim() || 'Ability',
  );
  syncIrAtNextEndStepTokenSacrificeFromOracleIRResult(state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  syncIrReanimationRidersFromOracleIRResult(state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  syncIrPreparedStateFromOracleIRResult(state, result, irCtx);
  syncIrCopyTokenProvenanceFromOracleIRResult(state, result, irCtx);
  syncIrLinkedExilesFromOracleIRResult(ctx, state, result, irCtx);
  syncIrGraveyardExilesToSourcePermanentExiledCards(
    state,
    result,
    graveyardBefore,
    exileBefore,
    irCtx,
    params,
  );
  if (!(ctx as any).isReplaying) {
    persistCounterDiffsFromOracleIR(ctx, countersBefore, state, {
      sourceId: String(irCtx.sourceId || '').trim() || undefined,
      sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
      ...(params?.compoundResume ? { compoundResume: true } : {}),
    });
    persistBattlefieldPermanentPatchesFromOracleIR(ctx, permanentPatchesBefore, state, {
      sourceId: String(irCtx.sourceId || '').trim() || undefined,
      sourceName: String(irCtx.sourceName || '').trim() || undefined,
      ...(params?.compoundResume ? { compoundResume: true } : {}),
    });
    persistOracleIrReplayMutationsFromExecution(ctx, result, {
      sourceId: String(irCtx.sourceId || '').trim() || undefined,
      sourceName: String(irCtx.sourceName || '').trim() || undefined,
      ...(params?.compoundResume ? { compoundResume: true } : {}),
    });
  }
  return result;
}
