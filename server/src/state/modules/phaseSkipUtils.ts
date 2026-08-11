/**
 * Shared phase-skip trigger stops and continuation after intermediate stops resolve.
 * Used by skipToPhase and passPriority resume paths.
 */
import type { Server } from 'socket.io';
import type { PlayerID } from '../../../../shared/src/index.js';
import { appendEvent } from '../../db/index.js';
import { broadcastGame, getPlayerName } from '../../socket/util.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { uid } from '../utils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { getCurrentGoaders } from './goad-effects.js';
import {
  getUpkeepTriggersForPlayer,
  autoProcessCumulativeUpkeepMana,
} from './upkeep-triggers.js';
import {
  processSagaLoreCountersAtPrecombatMain,
  pushSagaChapterTriggersToStack,
} from './triggerSagaLoreUtils.js';
import {
  getDrawStepTriggers,
  getPrecombatMainTriggers,
  getPostcombatMainTriggers,
  getEndOfCombatTriggers,
  getBeginningOfCombatTriggers,
  getEndStepTriggers,
} from './triggered-abilities.js';
import { processRadCountersAtPrecombatMain } from './triggers/rad-counters.js';
import {
  maybeProcessPendingAttractionVisitRoll,
  processAttractionVisitRollAtPrecombatMain,
} from './triggers/attraction-visit.js';
import { consumePlayerSkipNextUntapStep, playerHasSkipNextUntapStep } from './skipUntapStepUtils.js';
import { getMaxHandSizeForPlayer } from './handSizeUtils.js';
import { performUntapStepTurnAction, shouldPerformDrawStepTurnAction, shouldPerformUntapStepTurnAction } from './turn.js';
import { drawCards } from './zones.js';
import { recalculatePlayerEffects } from './game-state-effects.js';

export type PendingPhaseSkip = {
  targetPhase: string;
  targetStep: string;
  requestedBy: string;
  skipOriginPhase?: string;
  skipOriginStep?: string;
  /** Step where the skip last stopped for triggers; used to avoid re-firing on resume */
  lastStopStep?: string;
  /** Set when Rule 504.1 draw happens during an intermediate DRAW stop */
  drawStepActionPerformed?: boolean;
  /** Set when Rule 502.3 untap happens while scanning through UNTAP */
  untapStepActionPerformed?: boolean;
  /** Permanents untapped during scan; included on intermediate skipToPhase replay events */
  untappedDuringSkipIds?: string[];
};

export type PhaseSkipTriggerStopResult = 'stopped' | 'ready_to_complete' | 'blocked';

export type PhaseSkipContext = {
  game: any;
  gameId: string;
  io?: Server;
  playerId: string;
  turnPlayer: string;
  targetPhase: string;
  targetStep: string;
  skipOriginPhase?: string;
  skipOriginStep?: string;
  logPrefix?: string;
  emitError?: (code: string, message: string) => void;
  /** When true, append auto-continuation metadata to skipToPhase events */
  autoContinue?: boolean;
};

const CURRENT_PHASE_ORDER = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'begincombat',
  'declareattackers',
  'declareblockers',
  'combatdamage',
  'endcombat',
  'main2',
  'endstep',
  'cleanup',
];

function normalizeStep(step: string): string {
  return String(step || '').toLowerCase().replace(/_/g, '');
}

/** Scan cursor for trigger stops; advances past lastStopStep once that stop has resolved. */
function resolvePhaseSkipScanIdx(game: any, currentIdx: number): number {
  if (currentIdx < 0) {
    return currentIdx;
  }

  const pending = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
  const stack = (game.state as any).stack;
  const stackEmpty = !Array.isArray(stack) || stack.length === 0;
  if (!pending?.lastStopStep || !stackEmpty) {
    return currentIdx;
  }

  const lastStopIdx = CURRENT_PHASE_ORDER.indexOf(normalizeStep(pending.lastStopStep));
  if (lastStopIdx >= 0 && currentIdx === lastStopIdx) {
    return lastStopIdx + 1;
  }

  return currentIdx;
}

function atOrBeforePhase(scanIdx: number, phaseIdx: number, currentStepNormalized: string): boolean {
  if (scanIdx >= 0) {
    return scanIdx <= phaseIdx;
  }
  return currentStepNormalized === '';
}

function buildPendingPhaseSkip(
  ctx: PhaseSkipContext,
  existing?: PendingPhaseSkip | null,
): PendingPhaseSkip {
  return {
    targetPhase: ctx.targetPhase,
    targetStep: ctx.targetStep,
    requestedBy: ctx.playerId,
    skipOriginPhase: existing?.skipOriginPhase ?? ctx.skipOriginPhase,
    skipOriginStep: existing?.skipOriginStep ?? ctx.skipOriginStep,
    drawStepActionPerformed: existing?.drawStepActionPerformed,
    untapStepActionPerformed: existing?.untapStepActionPerformed,
    untappedDuringSkipIds: existing?.untappedDuringSkipIds,
  };
}

/** Rule 502.3: perform untap step turn action once while skipping through UNTAP. */
function performUntapStepTurnActionDuringPhaseSkip(ctx: PhaseSkipContext): string[] {
  const { game, turnPlayer } = ctx;
  if (!turnPlayer) return [];

  const pending = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
  if (pending?.untapStepActionPerformed) {
    return [];
  }

  if (!shouldPerformUntapStepTurnAction(game, String(turnPlayer))) {
    const pendingExisting = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
    (game.state as any).pendingPhaseSkip = {
      ...(pendingExisting ?? buildPendingPhaseSkip(ctx)),
      untapStepActionPerformed: true,
    };
    if (playerHasSkipNextUntapStep(game, String(turnPlayer))) {
      consumePlayerSkipNextUntapStep(game, String(turnPlayer));
    }
    debug(2, `[phaseSkip] Skipped untap step turn action for ${turnPlayer} (untap step skipped)`);
    return [];
  }

  const untappedIds = performUntapStepTurnAction(game, String(turnPlayer));

  const pendingExisting = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
  (game.state as any).pendingPhaseSkip = {
    ...(pendingExisting ?? buildPendingPhaseSkip(ctx)),
    untapStepActionPerformed: true,
    ...(untappedIds.length > 0 ? { untappedDuringSkipIds: untappedIds } : {}),
  };

  debug(2, `[phaseSkip] Untapped ${untappedIds.length} permanent(s) for ${turnPlayer} at untap step during phase skip`);
  return untappedIds;
}

/** Rule 504.1: perform draw step turn action once while skipping through DRAW. */
function performDrawStepTurnActionDuringPhaseSkip(ctx: PhaseSkipContext): unknown[] {
  const { game, gameId, turnPlayer } = ctx;
  if (!turnPlayer) return [];

  const pending = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
  if (pending?.drawStepActionPerformed) {
    return [];
  }

  if (!shouldPerformDrawStepTurnAction(game, String(turnPlayer))) {
    return [];
  }

  try {
    recalculatePlayerEffects(game, turnPlayer);
  } catch (err) {
    debugWarn(1, '[phaseSkip] Failed to recalculate player effects before draw:', err);
  }

  const additionalDraws = (game as any).additionalDrawsPerTurn?.[turnPlayer] || 0;
  const totalDraws = 1 + additionalDraws;
  let drawn: unknown[] = [];

  try {
    if (typeof (game as any).drawCards === 'function') {
      const result = (game as any).drawCards(turnPlayer, totalDraws);
      if (Array.isArray(result)) {
        drawn = result;
      }
    } else {
      drawn = drawCards(game as any, turnPlayer, totalDraws);
    }
  } catch (err) {
    debugWarn(1, '[phaseSkip] Failed to perform draw step turn action:', err);
    return [];
  }

  const pendingExisting = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
  if (pendingExisting) {
    (game.state as any).pendingPhaseSkip = {
      ...pendingExisting,
      drawStepActionPerformed: true,
    };
  } else {
    (game.state as any).pendingPhaseSkip = {
      ...buildPendingPhaseSkip(ctx),
      drawStepActionPerformed: true,
    };
  }

  try {
    appendEvent(gameId, game?.seq || 0, 'drawCards', {
      playerId: turnPlayer,
      count: totalDraws,
      reason: 'skipToPhase_drawStep',
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(drawCards drawStep) failed:', e);
  }

  debug(2, `[phaseSkip] Drew ${drawn.length} card(s) for ${turnPlayer} at draw step during phase skip`);
  return drawn;
}

function persistTriggeredAbilityPush(
  gameId: string,
  game: any,
  payload: Record<string, unknown>,
  reason: string,
): void {
  try {
    appendEvent(gameId, game?.seq ?? 0, 'pushTriggeredAbility', payload);
  } catch (err) {
    debugWarn(1, `[phaseSkip] appendEvent(pushTriggeredAbility ${reason}) failed:`, err);
  }
}

function stopAtPhaseForTriggers(
  ctx: PhaseSkipContext,
  stopPhase: string,
  stopStep: string,
  triggers: any[],
  triggerType: string,
  fromStepLabel: string,
): boolean {
  const { game, gameId, turnPlayer, playerId, targetPhase, targetStep, logPrefix = '[phaseSkip]' } = ctx;

  const filteredTriggers = (triggers || []).filter(Boolean);
  if (filteredTriggers.length === 0) {
    return false;
  }

  debug(2, `${logPrefix} STOPPING at ${stopStep}: Found ${filteredTriggers.length} trigger(s) that must resolve first`);

  (game.state as any).phase = stopPhase;
  (game.state as any).step = stopStep;
  (game.state as any).pendingPhaseSkip = {
    ...buildPendingPhaseSkip(ctx, (game.state as any).pendingPhaseSkip),
    lastStopStep: stopStep,
  };

  (game.state as any).stack = (game.state as any).stack || [];

  const triggersByController = new Map<string, typeof triggers>();
  const triggerItemsByController = new Map<
    string,
    Array<{ id: string; sourceName: string; effect: string; imageUrl?: string }>
  >();

  for (const trigger of filteredTriggers) {
    const controller = trigger.controllerId || turnPlayer;
    const existing = triggersByController.get(controller) || [];
    existing.push(trigger);
    triggersByController.set(controller, existing);
  }

  const players = Array.isArray((game.state as any).players)
    ? (game.state as any).players.map((p: any) => p.id)
    : [];
  const orderedPlayers = [turnPlayer, ...players.filter((p: string) => p !== turnPlayer)];

  for (const controllerId of orderedPlayers) {
    if (!controllerId) continue;

    const playerTriggers = triggersByController.get(controllerId) || [];
    if (playerTriggers.length === 0) continue;

    if (playerTriggers.length > 1) {
      const triggerItems = playerTriggers.map((trigger: any) => {
        const triggerId = uid(`${triggerType}_trigger`);
        return {
          id: triggerId,
          sourceId: trigger.permanentId,
          sourceName: trigger.cardName,
          effect: trigger.description || trigger.effect,
          triggerType,
          mandatory: trigger.mandatory !== false,
          imageUrl: trigger.imageUrl,
        };
      });
      triggerItemsByController.set(String(controllerId), triggerItems);

      for (const item of triggerItems) {
        const stackItem = {
          id: item.id,
          type: 'triggered_ability',
          controller: controllerId,
          source: item.sourceId,
          permanentId: item.sourceId,
          sourceName: item.sourceName,
          description: item.effect,
          triggerType,
          mandatory: item.mandatory,
          effect: item.effect,
          triggeringPlayer: turnPlayer,
        };
        (game.state as any).stack.push(stackItem);
        persistTriggeredAbilityPush(gameId, game, {
          triggerId: item.id,
          sourceId: item.sourceId,
          permanentId: item.sourceId,
          sourceName: item.sourceName,
          controllerId,
          description: item.effect,
          triggerType,
          effect: item.effect,
          mandatory: item.mandatory,
          triggeringPlayer: turnPlayer,
        }, `${triggerType} skip trigger`);
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TRIGGER_ORDER,
        playerId: controllerId as PlayerID,
        description: `Choose the order to put ${triggerItems.length} triggered abilities on the stack`,
        mandatory: true,
        triggers: triggerItems.map((item: any) => ({
          id: item.id,
          sourceName: item.sourceName,
          effect: item.effect,
          imageUrl: item.imageUrl,
        })),
        requireAll: true,
      });
    } else {
      const trigger = playerTriggers[0];
      const triggerId = uid(`${triggerType}_trigger`);
      const stackItem = {
        id: triggerId,
        type: 'triggered_ability',
        controller: controllerId,
        source: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        description: trigger.description || trigger.effect,
        triggerType,
        mandatory: trigger.mandatory !== false,
        effect: trigger.effect,
        triggeringPlayer: turnPlayer,
      };
      (game.state as any).stack.push(stackItem);
      persistTriggeredAbilityPush(gameId, game, {
        triggerId,
        sourceId: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        controllerId,
        description: trigger.description || trigger.effect,
        triggerType,
        effect: trigger.effect,
        mandatory: trigger.mandatory !== false,
        triggeringPlayer: turnPlayer,
      }, `${triggerType} skip trigger`);
    }
  }

  (game.state as any).priority = turnPlayer;

  if (ctx.io) {
    broadcastGame(ctx.io, game, gameId);
  }

  try {
    const triggerOrderRequests = orderedPlayers
      .map((orderedPlayerId) => {
        const playerTriggers = triggersByController.get(orderedPlayerId) || [];
        if (playerTriggers.length <= 1) {
          return null;
        }
        return {
          playerId: orderedPlayerId,
          description: `Choose the order to put ${playerTriggers.length} triggered abilities on the stack`,
          requireAll: true,
          triggers: (triggerItemsByController.get(String(orderedPlayerId)) || []).map((item) => ({
            id: item.id,
            sourceName: item.sourceName,
            effect: item.effect,
            imageUrl: item.imageUrl,
          })),
        };
      })
      .filter(Boolean);

    const untappedDuringSkip = (game.state as any).pendingPhaseSkip?.untappedDuringSkipIds;
    appendEvent(gameId, game?.seq || 0, 'skipToPhase', {
      playerId,
      from: fromStepLabel,
      to: stopStep,
      targetPhase: stopPhase,
      targetStep: stopStep,
      finalTargetPhase: targetPhase,
      finalTargetStep: targetStep,
      pendingPhaseSkip: (game.state as any).pendingPhaseSkip,
      priority: turnPlayer,
      triggerOrderRequests,
      auto: ctx.autoContinue || undefined,
      ...(Array.isArray(untappedDuringSkip) && untappedDuringSkip.length > 0
        ? { untappedPermanentIds: untappedDuringSkip }
        : {}),
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(skipToPhase) failed:', e);
  }

  return true;
}

/**
 * Scan from the game's current step toward targetPhase/targetStep and stop if triggers must resolve.
 */
export function processPhaseSkipTriggerStops(ctx: PhaseSkipContext): PhaseSkipTriggerStopResult {
  const { game, gameId, turnPlayer, targetPhase, targetStep, logPrefix = '[phaseSkip]' } = ctx;
  const currentStep = String(game.state?.step || '').toUpperCase();
  const currentStepNormalized = normalizeStep(currentStep);
  const targetStepNormalized = normalizeStep(targetStep);
  const currentIdx = CURRENT_PHASE_ORDER.indexOf(currentStepNormalized);
  const targetIdx = CURRENT_PHASE_ORDER.indexOf(targetStepNormalized);
  const scanIdx = resolvePhaseSkipScanIdx(game, currentIdx);

  const persistAndStop = (
    stopPhase: string,
    stopStep: string,
    triggers: any[],
    triggerType: string,
  ): PhaseSkipTriggerStopResult | null => {
    if (stopAtPhaseForTriggers(ctx, stopPhase, stopStep, triggers, triggerType, currentStep)) {
      return 'stopped';
    }
    return null;
  };

  const untapIdx = CURRENT_PHASE_ORDER.indexOf('untap');
  const isTargetPastUntap = targetIdx > untapIdx;
  const isSkippingThroughUntap =
    atOrBeforePhase(scanIdx, untapIdx, currentStepNormalized) &&
    isTargetPastUntap &&
    targetStepNormalized !== 'untap';

  if (isSkippingThroughUntap && turnPlayer) {
    try {
      performUntapStepTurnActionDuringPhaseSkip(ctx);
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to perform untap step turn action:`, err);
    }
  }

  const upkeepIdx = CURRENT_PHASE_ORDER.indexOf('upkeep');
  const isTargetAfterUpkeep = targetIdx > upkeepIdx;
  const isSkippingThroughUpkeep =
    atOrBeforePhase(scanIdx, upkeepIdx, currentStepNormalized) &&
    isTargetAfterUpkeep &&
    targetStepNormalized !== 'upkeep';

  if (isSkippingThroughUpkeep && turnPlayer) {
    try {
      const processedMana = autoProcessCumulativeUpkeepMana(game, turnPlayer);
      if (processedMana.length > 0 && ctx.io) {
        for (const item of processedMana) {
          const manaStr = Object.entries(item.manaAdded)
            .map(([type, amount]) => `${amount} ${type}`)
            .join(', ');
          ctx.io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${item.permanentId}`,
            gameId,
            from: 'system',
            message: `${item.cardName}: Added ${manaStr} to ${getPlayerName(game, turnPlayer)}'s mana pool (${item.ageCounters} age counters)`,
            ts: Date.now(),
          });
        }
      }

      const upkeepTriggers = getUpkeepTriggersForPlayer(game, turnPlayer);
      if (upkeepTriggers?.length > 0) {
        const stopResult = persistAndStop('beginning', 'UPKEEP', upkeepTriggers, 'upkeep');
        if (stopResult === 'stopped') return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check upkeep triggers:`, err);
    }
  }

  const drawStepIdx = CURRENT_PHASE_ORDER.indexOf('draw');
  const isTargetDrawOrLater = targetIdx >= drawStepIdx;
  const isSkippingThroughDraw =
    atOrBeforePhase(scanIdx, drawStepIdx, currentStepNormalized) &&
    isTargetDrawOrLater &&
    targetStepNormalized !== 'draw';

  if (isSkippingThroughDraw && turnPlayer) {
    try {
      performDrawStepTurnActionDuringPhaseSkip(ctx);

      const drawTriggers = getDrawStepTriggers(game, turnPlayer);
      if (drawTriggers?.length > 0) {
        const stopResult = persistAndStop('beginning', 'DRAW', drawTriggers, 'draw_step');
        if (stopResult === 'stopped') return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check draw step triggers:`, err);
    }
  }

  const main1StepIdx = CURRENT_PHASE_ORDER.indexOf('main1');
  const isTargetMain1OrLater = targetIdx >= main1StepIdx;
  const isSkippingThroughMain1 =
    atOrBeforePhase(scanIdx, main1StepIdx, currentStepNormalized) &&
    isTargetMain1OrLater &&
    targetStepNormalized !== 'main1';

  if (isSkippingThroughMain1 && turnPlayer) {
    try {
      const sagaLoreResult = processSagaLoreCountersAtPrecombatMain(game, turnPlayer);
      if (sagaLoreResult.chapterTriggers.length > 0) {
        pushSagaChapterTriggersToStack(game, turnPlayer, sagaLoreResult.chapterTriggers);
        (game.state as any)._pendingAttractionVisitRollPlayer = turnPlayer;
      } else {
        processAttractionVisitRollAtPrecombatMain(game, turnPlayer);
      }

      const precombatMainTriggers = getPrecombatMainTriggers(game, turnPlayer);
      if (precombatMainTriggers.length > 0) {
        const stopResult = persistAndStop('precombatMain', 'MAIN1', precombatMainTriggers, 'precombat_main');
        if (stopResult === 'stopped') return 'stopped';
      }

      processRadCountersAtPrecombatMain(game, turnPlayer);

      const pendingStackTriggers = ((game.state as any).stack || []).some(
        (item: any) => item?.type === 'triggered_ability',
      );
      if (pendingStackTriggers) {
        (game.state as any).phase = 'precombatMain';
        (game.state as any).step = 'MAIN1';
        (game.state as any).pendingPhaseSkip = {
          ...buildPendingPhaseSkip(ctx, (game.state as any).pendingPhaseSkip),
          lastStopStep: 'MAIN1',
        };
        (game.state as any).priority = turnPlayer;
        if (ctx.io) {
          broadcastGame(ctx.io, game, gameId);
        }
        try {
          appendEvent(gameId, game?.seq || 0, 'skipToPhase', {
            playerId: ctx.playerId,
            from: currentStep,
            to: 'MAIN1',
            targetPhase: 'precombatMain',
            targetStep: 'MAIN1',
            finalTargetPhase: targetPhase,
            finalTargetStep: targetStep,
            pendingPhaseSkip: (game.state as any).pendingPhaseSkip,
            priority: turnPlayer,
            existingStackTriggers: true,
            auto: ctx.autoContinue || undefined,
          });
        } catch (e) {
          debugWarn(1, 'appendEvent(skipToPhase existing stack) failed:', e);
        }
        return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check precombat main triggers:`, err);
    }
  }

  const beginCombatIdx = CURRENT_PHASE_ORDER.indexOf('begincombat');
  const isTargetCombatOrLater = targetIdx >= beginCombatIdx;
  const isSkippingThroughCombat =
    atOrBeforePhase(scanIdx, beginCombatIdx, currentStepNormalized) &&
    isTargetCombatOrLater &&
    targetStepNormalized !== 'begincombat';

  if (isSkippingThroughCombat && turnPlayer) {
    try {
      const combatTriggers = getBeginningOfCombatTriggers(game, turnPlayer);
      if (combatTriggers?.length > 0) {
        const stopResult = persistAndStop('combat', 'BEGIN_COMBAT', combatTriggers, 'begin_combat');
        if (stopResult === 'stopped') return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check combat triggers:`, err);
    }
  }

  const declareAttackersIdx = CURRENT_PHASE_ORDER.indexOf('declareattackers');
  const isTargetAfterDeclareAttackers = targetIdx > declareAttackersIdx;
  const isSkippingPastCombat =
    scanIdx >= 0
      ? scanIdx < declareAttackersIdx
      : currentStepNormalized === '';
  const isSkippingPastCombatWithTarget = isSkippingPastCombat && isTargetAfterDeclareAttackers;

  if (isSkippingPastCombatWithTarget && turnPlayer) {
    try {
      const battlefield = (game.state as any)?.battlefield || [];
      const currentTurn = (game.state as any).turn;

      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== turnPlayer) continue;

        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;

        if (getCurrentGoaders(permanent, battlefield, currentTurn).length === 0) continue;
        if (permanent.tapped) continue;

        const enteredThisTurn = permanent.enteredThisTurn === true;
        if (enteredThisTurn) {
          const oracleText = (permanent.card?.oracle_text || '').toLowerCase();
          const grantedAbilities = permanent.grantedAbilities || [];
          const hasHaste =
            oracleText.includes('haste') ||
            grantedAbilities.some((a: string) => a && a.toLowerCase().includes('haste'));
          if (!hasHaste) continue;
        }

        const oracleText = (permanent.card?.oracle_text || '').toLowerCase();
        const grantedAbilities = permanent.grantedAbilities || [];
        if (oracleText.includes("can't attack") || oracleText.includes('cannot attack')) continue;

        const hasCantAttack = grantedAbilities.some((a: string) => {
          const abilityText = (a || '').toLowerCase();
          return abilityText.includes("can't attack") || abilityText.includes('cannot attack');
        });
        if (hasCantAttack) continue;

        const creatureName = permanent.card?.name || 'A creature';
        debug(2, `${logPrefix} BLOCKED: ${creatureName} is goaded and must attack (Rule 701.15b)`);
        ctx.emitError?.(
          'SKIP_TO_PHASE',
          `${creatureName} is goaded and must attack this combat. You cannot skip past the declare attackers step.`,
        );
        return 'blocked';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check goaded creatures:`, err);
    }
  }

  const endCombatStepIdx = CURRENT_PHASE_ORDER.indexOf('endcombat');
  const isTargetEndCombatOrLater = targetIdx >= endCombatStepIdx;
  const isSkippingThroughEndCombat =
    atOrBeforePhase(scanIdx, endCombatStepIdx, currentStepNormalized) &&
    isTargetEndCombatOrLater &&
    targetStepNormalized !== 'endcombat';

  if (isSkippingThroughEndCombat && turnPlayer) {
    try {
      const endCombatTriggers = getEndOfCombatTriggers(game, turnPlayer);
      if (endCombatTriggers?.length > 0) {
        const stopResult = persistAndStop('combat', 'END_COMBAT', endCombatTriggers, 'end_combat');
        if (stopResult === 'stopped') return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check end of combat triggers:`, err);
    }
  }

  const main2StepIdx = CURRENT_PHASE_ORDER.indexOf('main2');
  const isTargetMain2OrLater = targetIdx >= main2StepIdx;
  const isSkippingThroughMain2 =
    atOrBeforePhase(scanIdx, main2StepIdx, currentStepNormalized) && isTargetMain2OrLater;

  if (isSkippingThroughMain2 && turnPlayer) {
    try {
      const postcombatMainTriggers = getPostcombatMainTriggers(game, turnPlayer);
      if (postcombatMainTriggers?.length > 0) {
        const stopResult = persistAndStop('postcombatMain', 'MAIN2', postcombatMainTriggers, 'postcombat_main');
        if (stopResult === 'stopped') return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check postcombat main triggers:`, err);
    }
  }

  const endStepIdx = CURRENT_PHASE_ORDER.indexOf('endstep');
  const isSkippingToEndStep =
    atOrBeforePhase(scanIdx, endStepIdx, currentStepNormalized) &&
    (targetStepNormalized === 'endstep' || targetStepNormalized === 'end');

  if (isSkippingToEndStep && turnPlayer) {
    try {
      const endTriggers = getEndStepTriggers(game, turnPlayer);
      if (endTriggers?.length > 0) {
        const stopResult = persistAndStop('ending', 'END_STEP', endTriggers, 'end_step');
        if (stopResult === 'stopped') return 'stopped';
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to check end step triggers:`, err);
    }
  }

  return 'ready_to_complete';
}

export function canResumePendingPhaseSkip(game: any, gameId: string): boolean {
  const pendingSkip = game?.state?.pendingPhaseSkip;
  if (!pendingSkip) return false;
  if (game.state.stack?.length > 0) return false;

  const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (queueSummary.hasPending) return false;

  const pendingOrdering = (game.state as any).pendingTriggerOrdering;
  if (pendingOrdering && Object.keys(pendingOrdering).length > 0) return false;

  return true;
}

export type PhaseSkipCompletionResult = {
  untappedPermanentIds: string[];
  drawnCards: unknown[];
};

/**
 * Apply turn-based actions and final phase jump when no more trigger stops remain.
 * Does not handle CLEANUP discard / nextStep — caller retains that for skipToPhase.
 */
export function completePendingPhaseSkipCore(ctx: PhaseSkipContext): PhaseSkipCompletionResult {
  const result: PhaseSkipCompletionResult = { untappedPermanentIds: [], drawnCards: [] };
  const { game, gameId, playerId, turnPlayer, targetPhase, targetStep } = ctx;
  const skipOriginPhase = String(
    ctx.skipOriginPhase ?? (game.state as any).pendingPhaseSkip?.skipOriginPhase ?? '',
  ).toLowerCase();
  const skipOriginStep = String(
    ctx.skipOriginStep ?? (game.state as any).pendingPhaseSkip?.skipOriginStep ?? '',
  ).toUpperCase();
  const fromStep = String(game.state?.step || '').toUpperCase();

  const pendingSkip = (game.state as any).pendingPhaseSkip as PendingPhaseSkip | undefined;
  const drawStepActionPerformed = pendingSkip?.drawStepActionPerformed === true;
  const untapStepActionPerformed = pendingSkip?.untapStepActionPerformed === true;

  (game.state as any).phase = targetPhase;
  (game.state as any).step = targetStep;
  delete (game.state as any).pendingPhaseSkip;

  try {
    (game.state as any).justSkippedToPhase = {
      playerId,
      phase: targetPhase,
      step: targetStep,
    };
  } catch {
    /* best-effort */
  }

  const targetStepUpper = targetStep.toUpperCase();
  const targetPhaseLower = targetPhase.toLowerCase();
  const wasBeginningPhase =
    skipOriginPhase === 'beginning' || skipOriginPhase === 'pre_game' || skipOriginPhase === '';
  const isTargetMainPhase =
    targetPhaseLower.includes('main') || targetStepUpper === 'MAIN1' || targetStepUpper === 'MAIN2';

  const isEarlyBeginningStep =
    skipOriginStep === '' ||
    skipOriginStep === 'UNTAP' ||
    skipOriginStep === 'UPKEEP' ||
    skipOriginPhase === 'pre_game';
  const isTargetAtOrPastDraw =
    targetStepUpper === 'DRAW' ||
    isTargetMainPhase ||
    targetStepUpper === 'BEGIN_COMBAT' ||
    targetStepUpper === 'DECLARE_ATTACKERS';

  const needsUntap =
    wasBeginningPhase &&
    isEarlyBeginningStep &&
    targetStepUpper !== 'UNTAP' &&
    !untapStepActionPerformed &&
    turnPlayer &&
    shouldPerformUntapStepTurnAction(game, String(turnPlayer));
  const needsDraw =
    wasBeginningPhase && isEarlyBeginningStep && isTargetAtOrPastDraw && !drawStepActionPerformed;

  if (needsUntap && turnPlayer) {
    try {
      result.untappedPermanentIds = performUntapStepTurnAction(game, String(turnPlayer));
    } catch (err) {
      debugWarn(1, '[phaseSkip] Failed to untap permanents:', err);
    }
  }

  if (needsDraw && turnPlayer) {
    try {
      if (
        typeof game.drawCards === 'function' &&
        shouldPerformDrawStepTurnAction(game, String(turnPlayer))
      ) {
        try {
          recalculatePlayerEffects(game, turnPlayer);
        } catch (recalcErr) {
          debugWarn(1, '[phaseSkip] Failed to recalculate player effects:', recalcErr);
        }

        const additionalDraws = game.additionalDrawsPerTurn?.[turnPlayer] || 0;
        const totalDraws = 1 + additionalDraws;
        const drawn = game.drawCards(turnPlayer, totalDraws);
        if (Array.isArray(drawn)) {
          result.drawnCards = drawn;
        }

        try {
          appendEvent(gameId, game?.seq || 0, 'drawCards', {
            playerId: turnPlayer,
            count: totalDraws,
            reason: 'skipToPhase',
          });
        } catch (e) {
          debugWarn(1, 'appendEvent(drawCards) failed:', e);
        }
      }
    } catch (err) {
      debugWarn(1, '[phaseSkip] Failed to draw card:', err);
    }
  }

  try {
    (game.state as any).combat = undefined;
    const battlefield = (game.state as any)?.battlefield;
    if (Array.isArray(battlefield)) {
      for (const permanent of battlefield) {
        if (!permanent) continue;
        if (permanent.attacking !== undefined) permanent.attacking = undefined;
        if (permanent.blocking !== undefined) permanent.blocking = undefined;
        if (permanent.blockedBy !== undefined) permanent.blockedBy = undefined;
      }
    }
  } catch (err) {
    debugWarn(1, '[phaseSkip] Failed to clear combat state:', err);
  }

  try {
    (game.state as any).priorityPassedBy = new Set<string>();
    if (turnPlayer) {
      (game.state as any).priority = turnPlayer;
    }
  } catch (err) {
    debugWarn(1, '[phaseSkip] Failed to reset priority tracking:', err);
  }

  try {
    appendEvent(gameId, game?.seq || 0, 'skipToPhase', {
      playerId,
      from: fromStep,
      to: targetStep,
      targetPhase,
      targetStep,
      auto: ctx.autoContinue || undefined,
      reason: ctx.autoContinue ? 'phase_skip_triggers_resolved' : undefined,
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(skipToPhase complete) failed:', e);
  }

  return result;
}

export type PhaseSkipResumeResult = 'stopped' | 'completed' | 'blocked' | 'noop';

export function resumePendingPhaseSkip(ctx: PhaseSkipContext): PhaseSkipResumeResult {
  if (!canResumePendingPhaseSkip(ctx.game, ctx.gameId)) {
    return 'noop';
  }

  const pending = (ctx.game.state as any).pendingPhaseSkip as PendingPhaseSkip;
  const turnPlayer = String(ctx.game.state?.turnPlayer || '').trim();
  if (!pending || !turnPlayer) {
    return 'noop';
  }

  maybeProcessPendingAttractionVisitRoll(ctx.game);

  const resumeCtx: PhaseSkipContext = {
    ...ctx,
    playerId: pending.requestedBy,
    turnPlayer,
    targetPhase: pending.targetPhase,
    targetStep: pending.targetStep,
    skipOriginPhase: pending.skipOriginPhase ?? ctx.skipOriginPhase,
    skipOriginStep: pending.skipOriginStep ?? ctx.skipOriginStep,
    autoContinue: true,
    logPrefix: ctx.logPrefix ?? '[passPriority]',
  };

  const stopResult = processPhaseSkipTriggerStops(resumeCtx);
  if (stopResult === 'stopped') {
    return 'stopped';
  }
  if (stopResult === 'blocked') {
    return 'blocked';
  }

  completePendingPhaseSkipCore(resumeCtx);

  if (ctx.io) {
    ctx.io.to(ctx.gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId: ctx.gameId,
      from: 'system',
      message: `Phase skip triggers resolved. Continuing to ${pending.targetStep}.`,
      ts: Date.now(),
    });
    if (typeof ctx.game.bumpSeq === 'function') {
      ctx.game.bumpSeq();
    }
  }

  return 'completed';
}

export type SkipToCleanupResult = {
  queuedCleanupDiscard: boolean;
};

export type SkipToCleanupContext = {
  game: any;
  gameId: string;
  turnPlayer: string;
  onAfterNextStep?: () => void;
};

/**
 * Rule 514.1–514.2: cleanup discard prompt or auto-advance via nextStep when skipping to CLEANUP.
 */
export function handleSkipToCleanupPhase(ctx: SkipToCleanupContext): SkipToCleanupResult {
  const result: SkipToCleanupResult = { queuedCleanupDiscard: false };
  const { game, gameId, turnPlayer, onAfterNextStep } = ctx;
  if (!turnPlayer) return result;

  try {
    const zones = game.state?.zones?.[turnPlayer];
    const hand = Array.isArray(zones?.hand) ? zones.hand : [];
    const maxHandSize = getMaxHandSizeForPlayer(game.state, turnPlayer);

    if (maxHandSize !== Infinity) {
      const discardCount = Math.max(0, hand.length - maxHandSize);
      if (discardCount > 0) {
        const handOptions = hand
          .filter((c: any) => c && c.id)
          .map((c: any) => ({
            id: String(c.id),
            label: String(c.name || c.label || 'Unknown'),
            imageUrl: c.imageUrl || c.image_url || c.image_uris?.normal,
          }));

        if (handOptions.length > 0) {
          const zoneHandSnapshot = hand
            .filter((c: any) => c && typeof c === 'object' && c.id)
            .map((c: any) => ({ ...c, zone: 'hand' }));
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.DISCARD_SELECTION,
            playerId: turnPlayer as any,
            sourceName: 'Cleanup Step',
            description: `Cleanup: discard ${discardCount} card(s) to maximum hand size (${maxHandSize}).`,
            mandatory: true,
            hand: handOptions,
            zoneHandSnapshot,
            discardCount,
            currentHandSize: handOptions.length,
            maxHandSize,
            reason: 'cleanup',
            priority: -10,
          } as any);
          result.queuedCleanupDiscard = true;
          debug(2, `[phaseSkip] Queued cleanup discard step for ${turnPlayer}: discard ${discardCount}`);
        } else {
          debugWarn(1, `[phaseSkip] Cannot queue cleanup discard step - hand is empty/unknown for ${turnPlayer}`);
        }
      }
    } else {
      debug(2, `[phaseSkip] Player ${turnPlayer} has no maximum hand size effect`);
    }
  } catch (err) {
    debugWarn(1, '[phaseSkip] Failed to check discard during cleanup:', err);
  }

  if (!result.queuedCleanupDiscard) {
    try {
      const battlefield = (game.state as any)?.battlefield;
      if (Array.isArray(battlefield)) {
        for (const permanent of battlefield) {
          if (permanent && typeof permanent.damage === 'number' && permanent.damage > 0) {
            permanent.damage = 0;
          }
        }
      }
      debug(2, '[phaseSkip] Cleared damage from permanents during cleanup');
    } catch (err) {
      debugWarn(1, '[phaseSkip] Failed to clear damage during cleanup:', err);
    }

    try {
      if (typeof game.nextStep === 'function') {
        game.nextStep();
        onAfterNextStep?.();
        appendEvent(gameId, game?.seq || 0, 'nextStep', { reason: 'skipToPhaseCleanup' });
        debug(2, `[phaseSkip] Cleanup complete, advanced via nextStep for game ${gameId}`);
      }
    } catch (err) {
      debugWarn(1, '[phaseSkip] Failed to advance after cleanup:', err);
    }
  }

  return result;
}
