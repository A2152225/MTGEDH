/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: handleAIPriority (main AI priority decision loop).
 *
 * Public entry symbols: handleAIPriority.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { AIDecisionType, type AIDecisionContext } from "../../../../rules-engine/src/AIEngine.js";
import { hydrateGameStateOracleText } from "../../state/modules/cardOracleHydration.js";
import { canAct, canPlayLand } from "../../state/modules/can-respond.js";
import { runSBA } from "../../state/modules/counters_tokens.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { isPlayerCompletingSpellCast } from "../game-actions.js";
import { isGameReplayLocked } from "../../gameRestoreState.js";
import { noteGameStallAiFailure } from "../../state/modules/gameStall/gameStallDetector.js";
import { broadcastGame, ensureGame } from "../util.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { playerCannotReceivePriority } from "../../state/modules/priorityEligibility.js";
import { AI_FAST_CONTINUE_MS, AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { executeAdvanceStep } from "./aiAdvanceAndDecisionExecutors.js";
import { tryHandleAiCleanupStep } from "./aiCleanupStepHandlers.js";
import {
  clearAiPendingSpellCastSettleCounts,
  takeAiPendingSpellCastSettleSlot,
} from "./aiPendingSpellCastSettle.js";
import {
  tryAIReadyManaRockBeforeNextTurn,
  tryAITapManaRocksOtherPlayersWillUntap,
} from "./aiManaRockEndStepUntap.js";
import { getPendingBlockerDeclaration } from "./aiGameCleanupHandlers.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";
import { consumeAIFastPassDecision } from "./aiFastPassPrecheck.js";
import {
  executeDeclareAttackers,
  executeDeclareBlockers,
  executePassPriority,
} from "./aiPriorityPassCombatExecutors.js";
import { handleAiPendingResolutionStepWithLoopBreak } from "./aiResolutionStepLoopBreak.js";
import {
  maybeForceUnstickAfterStackSighting,
  tryPassOnStackedTargetedTrigger,
} from "./aiStuckStackUnstick.js";
import { listAttackersAgainstDefender } from "../combat-handlers/combatMustBeBlockedIfAble.js";
import { rememberAIFailedSpellCast } from "./aiLandAuraCommander.js";
import {
  aiEngine,
  getAIPendingSpellCastStatus,
  runExclusiveAIAction,
  scheduleAIPriority,
  setAIActionDebugStage,
} from "./aiScheduler.js";
import type {
  AIActionCandidate,
  AIActionCandidateQuery,
  AICastableCommanderCandidate,
  AICastableSpellCandidate,
  AICastAttemptDescriptor,
  AISupportedCardSourceZone,
} from "./aiActionCandidateTypes.js";
import {
  candidatesFromAIActionList,
  recordDecision,
  traceContextFromGame,
} from "./aiDecisionTrace.js";
import { takeShadow } from "./aiBrain.js";

async function tryAIResponseActions(io: Server, gameId: string, playerId: PlayerID, game: any): Promise<boolean> {
  return getAIHandlerDeps().tryAIResponseActions(io, gameId, playerId, game);
}

async function enumerateAIActionCandidates(
  game: any,
  playerId: PlayerID,
  query: AIActionCandidateQuery,
): Promise<AIActionCandidate[]> {
  return getAIHandlerDeps().enumerateAIActionCandidates(game, playerId, query);
}

function captureAICastControlFlowSnapshot(gameId: string, game: any, playerId: PlayerID) {
  return getAIHandlerDeps().captureAICastControlFlowSnapshot(gameId, game, playerId);
}

function didAICastAttemptChangeControlFlow(
  gameId: string,
  game: any,
  playerId: PlayerID,
  candidate: AICastAttemptDescriptor,
  before: any,
): boolean {
  return getAIHandlerDeps().didAICastAttemptChangeControlFlow(gameId, game, playerId, candidate, before);
}

async function handleAIResolutionStep(io: Server, gameId: string, playerId: PlayerID, step: any): Promise<void> {
  return getAIHandlerDeps().handleAIResolutionStep(io, gameId, playerId, step);
}

async function executeAIActivateAbility(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  action: any,
  continueAfterResolution = true,
): Promise<boolean> {
  return getAIHandlerDeps().executeAIActivateAbility(io, gameId, playerId, action, continueAfterResolution);
}

function getAIActionContext(game: any): any {
  return getAIHandlerDeps().getAIActionContext(game);
}

function getAIMaxHandSize(game: any, playerId: PlayerID): number {
  return getAIHandlerDeps().getAIMaxHandSize(game, playerId);
}

function checkShouldTapLandsForManaRetention(game: any, playerId: PlayerID): { shouldTap: boolean; reason: string } {
  return getAIHandlerDeps().checkShouldTapLandsForManaRetention(game, playerId);
}

async function executeAITapLandsForMana(io: Server, gameId: string, playerId: PlayerID): Promise<boolean> {
  return getAIHandlerDeps().executeAITapLandsForMana(io, gameId, playerId);
}

async function executeAIPlayLand(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardId: string,
  sourceZone: AISupportedCardSourceZone = 'hand',
  selectedFaceIndex?: number,
): Promise<boolean> {
  return getAIHandlerDeps().executeAIPlayLand(io, gameId, playerId, cardId, sourceZone, selectedFaceIndex);
}

async function executeAICastSpell(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  candidate: AICastableSpellCandidate,
): Promise<boolean> {
  return getAIHandlerDeps().executeAICastSpell(io, gameId, playerId, candidate);
}

async function executeAICastCommander(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  candidate: AICastableCommanderCandidate,
): Promise<boolean> {
  return getAIHandlerDeps().executeAICastCommander(io, gameId, playerId, candidate);
}

/**
 * Handle AI turn when it's an AI player's priority
 * This is the main AI decision-making function that handles:
 * - Playing lands
 * - Casting spells
 * - Advancing steps
 * - Discarding during cleanup
 * - Passing turn to next player
 */
export async function handleAIPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  return runExclusiveAIAction(io, gameId, playerId, 'priority', async () => {
  const stage = (label: string) => setAIActionDebugStage(gameId, playerId, `priority:${label}`);
  stage('enter');
  if (!isAIPlayer(gameId, playerId)) {
    return;
  }
  
  const game = ensureGame(gameId);
  if (!game || !game.state) {
    debugWarn(2, '[AI] handleAIPriority: game not found', { gameId, playerId });
    return;
  }
  if (isGameReplayLocked(game, gameId)) {
    debug(2, '[AI] handleAIPriority skipped during undo/restore replay', { gameId, playerId });
    return;
  }
  
  // Check if this AI player has lost the game
  const players = game.state.players || [];
  const aiPlayer = players.find((p: any) => p.id === playerId);
  const ctx = (game as any).ctx || game;
  if (playerCannotReceivePriority(aiPlayer, ctx) || (ctx.inactive instanceof Set && ctx.inactive.has(playerId))) {
    if (game.state.priority === playerId) {
      debug(1, '[AI] Eliminated/inactive AI still holds priority; auto-passing:', { gameId, playerId });
      await executePassPriority(io, gameId, playerId);
    } else {
      debug(1, '[AI] AI player has left the game, skipping priority handling:', { gameId, playerId });
    }
    return;
  }
  
  // Stuck stack tops (Anikthea / Sylvan Offering deferred IR) can burn an entire
  // exclusive-action tick without ever completing a pass — sight them on entry.
  stage('check-stuck-stack');
  if (await maybeForceUnstickAfterStackSighting(io, game, gameId, playerId)) {
    stage('stuck-stack-cleared');
    return;
  }

  // If THIS AI has pending resolution steps, resolve them before priority actions.
  // Returning early here left AI stuck after reconnect/replay (STEP_ADDED does not re-fire).
  stage('check-pending-steps');
  if (ResolutionQueueManager.playerHasPendingSteps(gameId, playerId)) {
    try {
      const queue = ResolutionQueueManager.getQueue(gameId);
      const aiStep = queue?.steps?.find((s: any) =>
        s?.playerId === playerId
        && String(s?.status || '').toLowerCase() !== 'completed'
        && String(s?.status || '').toLowerCase() !== 'cancelled'
      );
      if (aiStep) {
        // Cap + turn-scoped source block (Mirko END library_search recreate). Extracted so
        // this file stays under the TS soft ceiling; see aiResolutionStepLoopBreak.ts.
        const broke = await handleAiPendingResolutionStepWithLoopBreak(
          io,
          game,
          gameId,
          playerId,
          aiStep,
          handleAIResolutionStep,
          executePassPriority,
        );
        if (broke) return;
      }
    } catch (err) {
      debugWarn(1, '[AI] Failed to resolve pending resolution step before priority:', err);
      noteGameStallAiFailure(gameId, playerId, err, 'aiResolutionStep');
    }
    debug(1, '[AI] AI player has pending resolution steps but none found to resolve:', { gameId, playerId });
    // Do not soft-deadlock: STEP_ADDED may still arrive, or another seat may clear the queue.
    scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
    return;
  }

  if (isPlayerCompletingSpellCast(game, playerId)) {
    debug(1, '[AI] AI player has in-flight spell cast completion, deferring priority handling:', { gameId, playerId });
    stage('defer-completing-cast');
    scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
    return;
  }
  
  const phase = String(game.state.phase || '').toLowerCase();
  const step = String((game.state as any).step || '').toLowerCase();
  const isAITurn = game.state.turnPlayer === playerId;
  const stackEmpty = !game.state.stack || game.state.stack.length === 0;
  const hasPriority = game.state.priority === playerId;
  stage(`phase=${phase};step=${step};prio=${hasPriority ? 1 : 0}`);
  
  debug(1, '[AI] AI player checking priority:', { 
    gameId, 
    playerId, 
    phase, 
    step, 
    isAITurn, 
    stackEmpty,
    priority: game.state.priority,
    hasPriority
  });
  
  if (
    await tryHandleAiCleanupStep(io, game, gameId, playerId, {
      isAITurn,
      hasPriority,
      handleAIResolutionStep,
      executePassPriority,
    })
  ) {
    return;
  }

  // Critical check: AI should NOT act if it doesn't have priority
  // This prevents the AI from getting into an infinite loop of passing priority
  // and prevents the AI from advancing during opponent's turn
  if (!hasPriority) {
    debug(1, '[AI] AI does not have priority, skipping action');
    return;
  }
  
  debug(1, '[AI] AI has priority, proceeding with action');
  
  try {
    try {
      const resolutionModule = await import('../resolution.js');
      if (resolutionModule?.processPendingCascades) {
        await resolutionModule.processPendingCascades(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingScry) {
        resolutionModule.processPendingScry(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingSurveil) {
        resolutionModule.processPendingSurveil(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingPonder) {
        resolutionModule.processPendingPonder(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingBottomOrder) {
        resolutionModule.processPendingBottomOrder(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingLimDulsVault) {
        resolutionModule.processPendingLimDulsVault(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingDanceWithCalamity) {
        resolutionModule.processPendingDanceWithCalamity(io as any, game, gameId);
      }
      if (resolutionModule?.processPendingOracleIrCompoundResume) {
        resolutionModule.processPendingOracleIrCompoundResume(io as any, game, gameId);
      }
    } catch {
      // best-effort only
    }

    // Check for Resolution Queue steps that the AI needs to respond to
    // This handles trigger ordering, Kynaios choices, and other player interactions
    const queue = ResolutionQueueManager.getQueue(gameId);
    if (queue && queue.steps.length > 0) {
      const aiStep = queue.steps.find((s: any) => s.playerId === playerId);
      if (aiStep) {
        debug(1, `[AI] AI has pending Resolution Queue step: ${aiStep.type}`);
        await handleAIResolutionStep(io, gameId, playerId, aiStep);
        return;
      }
    }
    
    // Clean up any legacy pending state that shouldn't exist
    const pendingTriggerOrdering = (game.state as any).pendingTriggerOrdering?.[playerId];
    if (pendingTriggerOrdering) {
      debugWarn(1, '[AI] Found deprecated pendingTriggerOrdering state - cleaning up');
      delete (game.state as any).pendingTriggerOrdering[playerId];
      if (Object.keys((game.state as any).pendingTriggerOrdering || {}).length === 0) {
        delete (game.state as any).pendingTriggerOrdering;
      }
    }
    
    // Clean up any legacy Kynaios choice state
    const pendingKynaiosChoice = (game.state as any).pendingKynaiosChoice;
    if (pendingKynaiosChoice) {
      debugWarn(1, '[AI] Found deprecated pendingKynaiosChoice state - cleaning up');
      delete (game.state as any).pendingKynaiosChoice;
    }
    
    // CRITICAL: Check for stuck pendingSpellCasts that could cause infinite loops
    // This can happen when a spell with targets gets stuck in the targeting workflow
    // Clean up any pendingSpellCasts that belong to this AI player
    const pendingCastStatus = getAIPendingSpellCastStatus(gameId, game, playerId);
    if (pendingCastStatus.effectIds.length > 0) {
      const settleSlot =
        pendingCastStatus.trackedEffectIds.length > 0 || game.state.priority !== playerId
          ? takeAiPendingSpellCastSettleSlot(game, String(playerId))
          : 'orphan';
      if (settleSlot === 'wait') {
        debug(1, '[AI] Waiting for pending spell cast flow to settle', {
          gameId,
          playerId,
          trackedEffectIds: pendingCastStatus.trackedEffectIds,
          priority: game.state.priority,
        });
        // Must wake again: otherwise a tracked cast/prompt can leave this seat holding
        // priority with the exclusive lock released and no follow-up scheduled (MAIN1/MAIN2 stalls).
        if (game.state.priority === playerId) {
          scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        }
        return;
      }

      const pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
      const toClear =
        pendingCastStatus.orphanedEffectIds.length > 0
          ? pendingCastStatus.orphanedEffectIds
          : pendingCastStatus.effectIds;
      debugWarn(2, `[AI] Cleaning up ${toClear.length} stuck pending spell cast(s)`);
      for (const effectId of toClear) {
        const castInfo = pendingSpellCasts[effectId];
        debugWarn(2, `[AI] Removing stuck spell cast: ${castInfo?.cardName || 'unknown'} (effectId: ${effectId})`);
        rememberAIFailedSpellCast(game, String(playerId), String(castInfo?.cardId || ''));
        delete pendingSpellCasts[effectId];
      }
      clearAiPendingSpellCastSettleCounts(game, String(playerId));
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      debugWarn(1, '[AI] Stuck pending spell cast cleaned up — passing priority to avoid cast retry loop');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // If it's not the AI's turn, handle special cases where non-turn player needs to act
    if (!isAITurn) {
      // DECLARE_BLOCKERS step: The defending player (non-turn player) needs to declare blockers
      if (phase === 'combat' && (step.includes('blockers') || step === 'declare_blockers')) {
        debug(1, '[AI] Not AI turn, but it\'s DECLARE_BLOCKERS step - AI needs to decide on blockers');
        
        // Check if blockers have already been declared using the blockersDeclaredBy array
        const state = game.state as any;
        const blockersDeclaredBy = state.blockersDeclaredBy || [];
        const alreadyDeclared = blockersDeclaredBy.includes(playerId);
        
        if (!alreadyDeclared) {
          hydrateGameStateOracleText(game.state, (game as any).libraries);

          // AI needs to declare blockers
          const battlefield = game.state?.battlefield || [];
          const attackingCreatures = listAttackersAgainstDefender(battlefield, playerId);
          
          const context: AIDecisionContext = {
            gameState: game.state as any,
            playerId,
            decisionType: AIDecisionType.DECLARE_BLOCKERS,
            options: [],
            constraints: {
              attackers: attackingCreatures,
            },
          };
          
          const decision = await aiEngine.makeDecision(context);
          
          if (decision.action?.blockers?.length > 0) {
            await executeDeclareBlockers(io, gameId, playerId, decision.action.blockers);
            return;
          } else {
            // AI chooses not to block - explicitly declare empty blockers to mark as "declared"
            debug(1, '[AI] AI chooses not to block - declaring empty blockers');
            await executeDeclareBlockers(io, gameId, playerId, []);
            return;
          }
        } else {
          debug(1, `[AI] Blockers already declared for ${playerId}, skipping`);
        }
      }
      
      // CRITICAL: During DECLARE_BLOCKERS step, check if ALL defending players have declared
      // Don't let AI pass priority until all humans have had a chance to select blockers
      if (phase === 'combat' && (step.includes('blockers') || step === 'declare_blockers')) {
        const pendingBlockers = getPendingBlockerDeclaration(game, gameId);
        if (pendingBlockers.hasPending && !pendingBlockers.defendingPlayerIsAI) {
          debug(1, `[AI] Waiting for human defender ${pendingBlockers.defendingPlayer || 'unknown'} to declare blockers, not passing priority`);
          // Don't take any action - wait for humans to declare blockers
          return;
        }
      }
      
      // Scheduler's fast-pass precheck already found no response for this exact window.
      const opponentMain = phase.includes('main') || step.includes('main');
      if (opponentMain && stackEmpty && await tryAITapManaRocksOtherPlayersWillUntap(io, gameId, playerId, game)) {
        return;
      }
      // Empty-stack beginning/ending: do not activate "responses" off-turn. That churn
      // prevented all-pass on END (seq tens of thousands, no turn advance).
      const quietEmptyStackPhase =
        stackEmpty
        && (
          phase === 'ending'
          || phase === 'end'
          || phase === 'beginning'
          || phase.includes('begin')
        );
      if (
        !quietEmptyStackPhase
        && !consumeAIFastPassDecision(gameId, playerId, game)
        && await tryAIResponseActions(io, gameId, playerId, game)
      ) {
        return;
      }

      // Default behavior for non-turn player: pass priority
      debug(1, '[AI] Not AI turn, passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    if (await tryPassOnStackedTargetedTrigger(io, game, gameId, playerId, executePassPriority)) {
      return;
    }

    // If there's something on the stack, try player-style responses first.
    if (!stackEmpty) {
      if (!consumeAIFastPassDecision(gameId, playerId, game) && await tryAIResponseActions(io, gameId, playerId, game)) {
        return;
      }

      debug(1, '[AI] Stack not empty, passing priority to let it resolve');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // Handle different phases/steps
    
    // MAIN PHASES: Play lands and cast spells
    const isMainPhase = phase.includes('main') || step.includes('main');
    
    if (isMainPhase) {
      // Check if AI will need to discard at end of turn (hand size > 7)
      // If so, be more aggressive about casting spells
      const zones = game.state?.zones?.[playerId];
      const handSize = Array.isArray(zones?.hand) ? zones.hand.length : 0;
      const maxHandSize = getAIMaxHandSize(game, playerId);
      const willNeedToDiscard = handSize > maxHandSize;
      
      if (willNeedToDiscard) {
        debug(1, `[AI] Hand size ${handSize} exceeds max ${maxHandSize} - will prioritize casting spells to avoid discarding`);
      }
      
      const mainPhaseActionContext = getAIActionContext(game);
      const landCandidates = await enumerateAIActionCandidates(game, playerId, {
        mode: 'main',
        kinds: ['play_land'],
      });

      if (landCandidates.length > 0) {
        for (const candidate of landCandidates) {
          if (candidate.kind !== 'play_land') continue;

          const landCandidate = candidate.land;
          debug(1, '[AI] Playing land:', { name: landCandidate.card?.name, sourceZone: landCandidate.sourceZone });
          const playedLand = await executeAIPlayLand(
            io,
            gameId,
            playerId,
            landCandidate.card.id,
            landCandidate.sourceZone,
            landCandidate.selectedFaceIndex,
          );
          if (playedLand) {
            // After playing land, continue with more actions
            scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
            return;
          }
        }

        debugWarn(1, '[AI] Land action candidate(s) produced no state change, continuing main-phase decisions');
      } else if (canPlayLand(mainPhaseActionContext, playerId)) {
        debugWarn(1, '[AI] Shared canPlayLand reported a playable land, but AI found no supported land action candidate in hand/library/graveyard/exile');
      } else {
        debug(1, '[AI] No supported land candidate available in hand, library, graveyard, or exile');
      }
      
      // A doesn't-untap rock that Unwinding Clock (or similar) will untap on other
      // players' turns is tapped for mana every turn, including this one.
      if (stackEmpty && await tryAITapManaRocksOtherPlayersWillUntap(io, gameId, playerId, game)) {
        return;
      }

      // IMPORTANT: Tap lands for mana retention effects BEFORE combat
      // This is critical for cards like Omnath, Locus of Mana which gain power from green mana in pool
      // By tapping green-producing lands now, Omnath will be stronger during the combat phase
      // HOWEVER: Only do this ONCE per turn to avoid infinite loops
      const shouldTapLands = checkShouldTapLandsForManaRetention(game, playerId);
      if (shouldTapLands.shouldTap) {
        debug(1, `[AI] Tapping lands for mana retention before combat (${shouldTapLands.reason})`);
        const didTap = await executeAITapLandsForMana(io, gameId, playerId);
        if (didTap) {
          // After tapping lands, continue with more actions (in case we can now cast something)
          scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
          return;
        }
      }

      const sharedMainPhaseCanAct = canAct(mainPhaseActionContext, playerId);
      if (!sharedMainPhaseCanAct) {
        debug(1, '[AI] Shared canAct reports no player-style main-phase actions; passing priority');
        await executePassPriority(io, gameId, playerId);
        return;
      }

      // Cap own-turn main-phase ability activations per step. Unbounded activate→schedule
      // loops froze MAIN1 with seq in the thousands (selfplay-1000-11-3).
      const mainActivationWindowKey = `${playerId}:${Number((game.state as any).turnNumber || 0)}:${String((game.state as any).step || '')}`;
      const mainActivationCounts = ((game.state as any)._aiMainPhaseActivationCount ||= {}) as Record<string, number>;
      const mainActivationsTaken = Number(mainActivationCounts[mainActivationWindowKey] || 0);
      const maxMainActivations = 6;
      const allowMainActivations = mainActivationsTaken < maxMainActivations;
      
      const primaryActionKinds: AIActionCandidate['kind'][] = willNeedToDiscard
        ? ['cast_commander', 'cast_spell']
        : allowMainActivations
          ? ['activate_ability', 'cast_commander', 'cast_spell']
          : ['cast_commander', 'cast_spell'];

      const actionCandidates = await enumerateAIActionCandidates(game, playerId, {
        mode: 'main',
        kinds: primaryActionKinds,
        willNeedToDiscard,
      });
      const priorityTraceCandidates = candidatesFromAIActionList(actionCandidates);
      const priorityShadow = takeShadow(actionCandidates);
      const recordPriorityChoice = (chosen: number | null, note?: string) => {
        recordDecision({
          ...traceContextFromGame(game, gameId, playerId),
          kind: 'priority',
          candidates: priorityTraceCandidates,
          chosen,
          note,
          shadow: priorityShadow,
        });
      };

      for (let candidateIndex = 0; candidateIndex < actionCandidates.length; candidateIndex++) {
        const candidate = actionCandidates[candidateIndex];
        if (candidate.kind === 'activate_ability') {
          if (!allowMainActivations) continue;
          if (willNeedToDiscard) {
            debug(1, '[AI] Activating ability (after spell-priority ordering):', candidate.ability.action.cardName);
          } else {
            debug(1, '[AI] Activating ability:', candidate.ability.action.cardName, '-', candidate.ability.reasoning);
          }
          if (await executeAIActivateAbility(io, gameId, playerId, candidate.ability.action)) {
            mainActivationCounts[mainActivationWindowKey] = mainActivationsTaken + 1;
            recordPriorityChoice(candidateIndex);
            scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
            return;
          }

          debugWarn(1, '[AI] Main-phase ability candidate produced no state change; continuing to next action', {
            gameId,
            playerId,
            permanentId: candidate.ability.action?.permanentId,
            cardName: candidate.ability.action?.cardName,
          });
          continue;
        }

        if (candidate.kind === 'cast_commander') {
          debug(1, '[AI] Casting commander from command zone:', candidate.commander.card.name);
          const beforeCast = captureAICastControlFlowSnapshot(gameId, game, playerId);
          const castProgressed = await executeAICastCommander(io, gameId, playerId, candidate.commander);
          if (castProgressed) {
            recordPriorityChoice(candidateIndex);
            scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
            return;
          }

          if (didAICastAttemptChangeControlFlow(gameId, game, playerId, {
            card: candidate.commander.card,
            sourceZone: 'command',
          }, beforeCast)) {
            recordPriorityChoice(candidateIndex, 'control-flow-changed');
            return;
          }
        }

        if (candidate.kind === 'cast_spell') {
          const candidateSpell = candidate.spell;
          if (willNeedToDiscard) {
            debug(1, `[AI] Casting spell to avoid discard: ${candidateSpell.castCard?.name || candidateSpell.card?.name} from ${candidateSpell.sourceZone} (hand: ${handSize}/${maxHandSize})`);
          } else {
            debug(1, '[AI] Casting spell:', {
              name: candidateSpell.castCard?.name || candidateSpell.card?.name,
              sourceZone: candidateSpell.sourceZone,
              priority: candidateSpell.priority,
            });
          }

          const beforeCast = captureAICastControlFlowSnapshot(gameId, game, playerId);
          const castProgressed = await executeAICastSpell(io, gameId, playerId, candidateSpell);
          if (castProgressed) {
            recordPriorityChoice(candidateIndex);
            scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
            return;
          }

          if (didAICastAttemptChangeControlFlow(gameId, game, playerId, candidateSpell, beforeCast)) {
            recordPriorityChoice(candidateIndex, 'control-flow-changed');
            return;
          }
        }
      }

      if (willNeedToDiscard && allowMainActivations) {
        const fallbackAbilityCandidates = await enumerateAIActionCandidates(game, playerId, {
          mode: 'main',
          kinds: ['activate_ability'],
          willNeedToDiscard,
        });

        for (const candidate of fallbackAbilityCandidates) {
          if (candidate.kind !== 'activate_ability') continue;

          debug(1, '[AI] Activating ability (after spell-priority ordering):', candidate.ability.action.cardName);
          if (await executeAIActivateAbility(io, gameId, playerId, candidate.ability.action)) {
            mainActivationCounts[mainActivationWindowKey] = mainActivationsTaken + 1;
            recordPriorityChoice(null, 'fallback-ability');
            scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
            return;
          }

          debugWarn(1, '[AI] Fallback ability candidate produced no state change; continuing to next option', {
            gameId,
            playerId,
            permanentId: candidate.ability.action?.permanentId,
            cardName: candidate.ability.action?.cardName,
          });
        }
      }

      if (canAct(mainPhaseActionContext, playerId)) {
        debug(2, '[AI] Shared canAct still reports available actions after AI exhausted supported main-phase choices');
      }
      
      // No more actions, pass priority (don't advance step directly - let priority system handle it)
      // This allows other players to get priority and potentially take actions
      // The step will advance automatically when all players pass priority
      debug(1, '[AI] Main phase, no more actions, passing priority');
      recordPriorityChoice(null, 'pass');
      await executePassPriority(io, gameId, playerId, {
        allowActiveMainPhaseAutoAdvance: true,
      });
      return;
    }
    
    // COMBAT PHASES: Handle attack/block declarations
    if (phase === 'combat') {
      if (step.includes('attackers') || step === 'declare_attackers') {
        const state = game.state as any;
        const attackersDeclaredBy: string[] = Array.isArray(state.attackersDeclaredBy) ? state.attackersDeclaredBy : [];
        if (attackersDeclaredBy.includes(playerId)) {
          if (await tryAIResponseActions(io, gameId, playerId, game)) {
            return;
          }

          debug(1, '[AI] Attackers already declared (in attackersDeclaredBy), passing priority for responses');
          await executePassPriority(io, gameId, playerId);
          return;
        }

        // Check if attackers have already been declared this step
        // by looking for any creatures marked as attacking
        const battlefield = game.state?.battlefield || [];
        const alreadyDeclaredAttackers = battlefield.some((perm: any) => 
          perm.controller === playerId && perm.attacking
        );
        
        if (alreadyDeclaredAttackers) {
          // Attackers already declared, try response actions before passing priority.
          if (await tryAIResponseActions(io, gameId, playerId, game)) {
            return;
          }

          // Attackers already declared, just pass priority to allow responses
          debug(1, '[AI] Attackers already declared, passing priority for responses');
          await executePassPriority(io, gameId, playerId);
          return;
        }
        
        // CRITICAL: Run state-based actions before AI makes attack decisions
        // This ensures Gods with insufficient devotion have notCreature flag set
        // and other SBA-affected permanents are updated (Rule 704.5n)
        const sbaCtx = { 
          state: game.state, 
          bumpSeq: () => { if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq(); },
          gameId 
        } as any;
        runSBA(sbaCtx);
        
        hydrateGameStateOracleText(game.state, (game as any).libraries);

        // Determine what type of decision is needed
        const context: AIDecisionContext = {
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.DECLARE_ATTACKERS,
          options: [],
        };
        
        const decision = await aiEngine.makeDecision(context);
        const attackList = Array.isArray(decision.action?.attackers) ? decision.action.attackers : [];
        recordDecision({
          ...traceContextFromGame(game, gameId, playerId),
          kind: 'attack',
          candidates: attackList.map((a: any) => ({
            kind: 'attacker',
            name: String(a?.creatureId || ''),
            score: 1,
          })),
          chosen: attackList.length > 0 ? 0 : null,
          note: attackList.length > 0
            ? `attackers=${attackList.length}`
            : 'no-attackers',
        });
        
        if (attackList.length > 0) {
          await executeDeclareAttackers(io, gameId, playerId, attackList);
        } else {
          debug(1, '[AI] No attackers to declare, skipping attackers step');
          await executeDeclareAttackers(io, gameId, playerId, []);
        }
        return;
      }
      
      if (step.includes('blockers') || step === 'declare_blockers') {
        // Check if blockers have already been declared this step using blockersDeclaredBy array
        const state = game.state as any;
        const blockersDeclaredBy = state.blockersDeclaredBy || [];
        const alreadyDeclared = blockersDeclaredBy.includes(playerId);
        
        const pendingBlockers = getPendingBlockerDeclaration(game, gameId);
        if (pendingBlockers.hasPending && !pendingBlockers.defendingPlayerIsAI) {
          debug(1, `[AI] As attacker, waiting for human defender ${pendingBlockers.defendingPlayer || 'unknown'} to declare blockers`);
          // Don't take any action - wait for humans to declare blockers
          return;
        }

        // The attacking player is the turn player - they cannot block their own attackers
        const attackingPlayerId = game.state.turnPlayer;

        if (playerId === attackingPlayerId) {
          debug(1, '[AI] Attacking player does not declare blockers, passing priority for defender declarations/responses');
          await executePassPriority(io, gameId, playerId);
          return;
        }
        
        if (alreadyDeclared) {
          // Blockers already declared, try response actions before passing priority.
          if (await tryAIResponseActions(io, gameId, playerId, game)) {
            return;
          }

          // Blockers already declared, just pass priority to allow responses
          debug(1, '[AI] Blockers already declared (in blockersDeclaredBy), passing priority for responses');
          await executePassPriority(io, gameId, playerId);
          return;
        }
        
        hydrateGameStateOracleText(game.state, (game as any).libraries);

        // Get the attacking creatures aimed at this defender (attacking is a player/permanent id, not boolean true)
        const battlefield = game.state?.battlefield || [];
        const attackingCreatures = listAttackersAgainstDefender(battlefield, playerId);
        
        const context: AIDecisionContext = {
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.DECLARE_BLOCKERS,
          options: [],
          constraints: {
            attackers: attackingCreatures,
          },
        };
        
        const decision = await aiEngine.makeDecision(context);
        const blockList = Array.isArray(decision.action?.blockers) ? decision.action.blockers : [];
        recordDecision({
          ...traceContextFromGame(game, gameId, playerId),
          kind: 'block',
          candidates: blockList.map((b: any) => ({
            kind: 'block',
            name: `${String(b?.blockerId || '')}->${String(b?.attackerId || '')}`,
            score: 1,
          })),
          chosen: blockList.length > 0 ? 0 : null,
          note: blockList.length > 0
            ? `blocks=${blockList.length}`
            : 'no-blocks',
        });
        
        if (blockList.length > 0) {
          await executeDeclareBlockers(io, gameId, playerId, blockList);
        } else {
          // AI chooses not to block - explicitly declare empty blockers to mark as "declared"
          debug(1, '[AI] No blockers to declare, declaring empty blockers');
          await executeDeclareBlockers(io, gameId, playerId, []);
        }
        return;
      }
      
      if (await tryAIResponseActions(io, gameId, playerId, game)) {
        return;
      }

      // Other combat steps - just pass priority (only active player can advance combat)
      debug(1, '[AI] Combat step', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // BEGINNING PHASES - the untap step should advance directly.
    // nextTurn currently leaves the active player with priority in UNTAP for engine compatibility,
    // but routing that state through passPriority can loop on auto-pass instead of leaving UNTAP.
    if (phase === 'beginning' || phase.includes('begin')) {
      const normalizedStep = String(step || '').toLowerCase();
      const isUntapStep = normalizedStep === 'untap';
      stage(`beginning:${normalizedStep || 'none'}`);

      if (isUntapStep && isAITurn && stackEmpty) {
        debug(1, '[AI] Beginning phase, step:', step, '- advancing out of untap');
        stage('beginning:advance-untap');
        await executeAdvanceStep(io, gameId, playerId);
        stage('beginning:advance-untap-done');
        return;
      }

      // Empty-stack UPKEEP/DRAW: do not scan/activate response abilities. That path
      // (continueAfterResolution=false + schedule) can churn activations forever without
      // passing priority, freezing turn advance in self-play (seed 599380 / turn 17).
      // Stacked upkeep triggers still hit tryAIResponseActions below.
      if (stackEmpty) {
        debug(1, '[AI] Beginning phase, step:', step, '- empty stack, passing priority');
        stage('beginning:empty-stack-pass');
        await executePassPriority(io, gameId, playerId);
        stage('beginning:empty-stack-pass-done');
        return;
      }

      stage('beginning:try-response');
      if (await tryAIResponseActions(io, gameId, playerId, game)) {
        stage('beginning:response-took-action');
        // tryAIResponseActions schedules on success; keep a follow-up in case a path forgot.
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        return;
      }

      debug(1, '[AI] Beginning phase, step:', step, '- passing priority');
      stage('beginning:pass-priority');
      await executePassPriority(io, gameId, playerId);
      stage('beginning:pass-priority-done');
      return;
    }
    
    // ENDING PHASE (End step) - only active player can advance
    if (phase === 'ending' || phase === 'end') {
      // Empty-stack END: skip response ability/spell churn. That loop bumped seq into
      // the tens of thousands without turn advance (selfplay-1000-0-1 stall). Stacked
      // end-step triggers still use tryAIResponseActions below.
      if (!stackEmpty) {
        stage('ending:try-response');
        if (await tryAIResponseActions(io, gameId, playerId, game)) {
          stage('ending:response-took-action');
          scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
          return;
        }
      }

      // End step of the turn before this AI's turn: spare mana readies a rock
      // that was tapped on a prior turn and will not untap by itself.
      if (await tryAIReadyManaRockBeforeNextTurn(io, gameId, playerId, game)) {
        stage('ending:ready-mana-rock');
        return;
      }

      debug(1, '[AI] Ending phase, step:', step, '- passing priority');
      stage('ending:pass-priority');
      await executePassPriority(io, gameId, playerId);
      stage('ending:pass-priority-done');
      return;
    }
    
    if (await tryAIResponseActions(io, gameId, playerId, game)) {
      return;
    }

    // Default: pass priority instead of advancing (let the game engine handle step advancement)
    debug(1, '[AI] Unknown phase/step, passing priority');
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error handling AI priority:', error);
    noteGameStallAiFailure(gameId, playerId, error, 'handleAIPriority');
    // Fallback: try to advance step or pass priority
    try {
      if (isAITurn && stackEmpty) {
        await executeAdvanceStep(io, gameId, playerId);
      } else {
        await executePassPriority(io, gameId, playerId);
      }
    } catch (e) {
      debugError(1, '[AI] Failed fallback action:', e);
    }
  }
  });
}
