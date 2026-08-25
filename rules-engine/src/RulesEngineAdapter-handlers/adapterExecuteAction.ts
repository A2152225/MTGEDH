// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: executeAction.
// Public entry symbols: executeAction.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import type { RulesEvent } from '../core/events';
import {
  advanceGame,
  checkBecomesBlockedTriggers,
  checkCombatDamageToPlayerTriggers,
  completeMulliganPhase,
  drawInitialHand,
  executeCombatDamage,
  executeDeclareAttackers,
  executeDeclareBlockers,
  executeFetchland,
  executeSacrifice,
  executeSearchLibrary,
  initializeGame,
  processMulligan,
} from '../actions';
import { dispatchRulesEngineAction } from '../rulesEngineAdapterActionDispatch';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterExecuteActionHost = any;

  /**
   * Execute a validated action and apply state changes atomically
   */
export function executeAction(this: AdapterExecuteActionHost, gameId: string, action: any): EngineResult<GameState> {
    const validation = this.validateAction(gameId, action);
    if (!validation.legal) {
      return {
        next: this.gameStates.get(gameId)!,
        log: [`Action rejected: ${validation.reason}`],
      };
    }
    
    const currentState = this.gameStates.get(gameId);
    if (!currentState) {
      return {
        next: currentState!,
        log: ['Game not found'],
      };
    }
    
    // Create action context for modular handlers
    const actionContext = {
      getState: (gid: string) => this.gameStates.get(gid),
      setState: (gid: string, state: GameState) => this.gameStates.set(gid, state),
      getStack: (gid: string) => this.stacks.get(gid),
      setStack: (gid: string, stack: any) => this.stacks.set(gid, stack),
      emit: (event: RulesEvent) => this.emit(event),
      gameId,
    };
    
    const result = dispatchRulesEngineAction({
      currentState,
      action,
      handlers: {
        passPriority: () => this.passPriority(gameId, action.playerId),
        castSpell: () => this.castSpellAction(gameId, action),
        playLand: () => this.playLandAction(gameId, action),
        tapForMana: () => this.tapForManaAction(gameId, action),
        activateAbility: () => this.activateAbilityAction(gameId, action),
        declareAttackers: () => executeDeclareAttackers(gameId, action, actionContext),
        declareBlockers: () => {
          const blockersResult = executeDeclareBlockers(gameId, action, actionContext);
          const blockedAssignments = Array.from(
            new Map(
              (action.blockers || []).map((blocker: any) => {
                const attackerId = String(blocker?.attackerId || '').trim();
                const defendingPlayerId = String(
                  ((blockersResult.next.combat?.attackers || []) as any[]).find(
                    attacker => String((attacker as any)?.permanentId || '').trim() === attackerId
                  )?.defending || ''
                ).trim();
                return [attackerId, { attackerId, defendingPlayerId }];
              })
            ).values()
          ).filter((assignment: any) => Boolean(String(assignment?.attackerId || '').trim()));

          const triggerResult = checkBecomesBlockedTriggers(blockersResult.next, blockedAssignments as any);
          return {
            next: triggerResult.state,
            log: [
              ...(blockersResult.log || []),
              ...(triggerResult.logs || []),
            ],
          };
        },
        resolveStack: () => this.resolveStackTop(gameId),
        advanceGame: () => advanceGame(gameId, actionContext),
        sacrifice: () => executeSacrifice(gameId, action, actionContext),
        searchLibrary: () => executeSearchLibrary(gameId, action, actionContext),
        payLife: () => this.payLifeAction(gameId, action),
        activateFetchland: () => executeFetchland(gameId, action, actionContext),
        dealCombatDamage: () => {
          const combatResult = executeCombatDamage(gameId, action, actionContext);
          const triggerResult = checkCombatDamageToPlayerTriggers(
            combatResult.next,
            action.playerId,
            action.attackers || []
          );
          return {
            next: triggerResult.state,
            log: [
              ...(combatResult.log || []),
              ...(triggerResult.logs || []),
            ],
          };
        },
        initializeGame: () => initializeGame(gameId, action.players, actionContext),
        drawInitialHand: () => drawInitialHand(gameId, action.playerId, action.handSize || 7, actionContext),
        mulligan: () => processMulligan(gameId, action.playerId, action.keep, actionContext),
        completeMulligan: () => completeMulliganPhase(gameId, actionContext),
      },
    });
    
    let syncedResultState: GameState = {
      ...result.next,
      stack: [...(((this.stacks.get(gameId)?.objects as any[]) || ((result.next as any).stack as any[]) || []))] as any,
    };

    const diesAfterAction = this.processDiesDelayedTriggers(
      gameId,
      currentState,
      syncedResultState
    );
    syncedResultState = diesAfterAction.state;

    const controlLossAfterAction = this.processControlLossDelayedTriggers(
      gameId,
      currentState,
      syncedResultState
    );
    syncedResultState = controlLossAfterAction.state;

    // Update stored state
    this.gameStates.set(gameId, syncedResultState);
    
    // Check state-based actions after each action
    const sbaResult = this.checkStateBasedActions(gameId, syncedResultState);
    let syncedSbaState: GameState = {
      ...sbaResult.next,
      stack: [...(((this.stacks.get(gameId)?.objects as any[]) || ((sbaResult.next as any).stack as any[]) || []))] as any,
    };

    const diesAfterSba = this.processDiesDelayedTriggers(
      gameId,
      syncedResultState,
      syncedSbaState
    );
    syncedSbaState = diesAfterSba.state;

    const controlLossAfterSba = this.processControlLossDelayedTriggers(
      gameId,
      syncedResultState,
      syncedSbaState
    );
    syncedSbaState = controlLossAfterSba.state;
    this.gameStates.set(gameId, syncedSbaState);
    
    return {
      next: syncedSbaState,
      log: [
        ...(result.log || []),
        ...(diesAfterAction.log || []),
        ...(controlLossAfterAction.log || []),
        ...(sbaResult.log || []),
        ...(diesAfterSba.log || []),
        ...(controlLossAfterSba.log || []),
      ],
    };
  }
