/**
 * actions/turnActions.ts
 * 
 * Turn-based actions that happen automatically at specific steps.
 * Rule 703: These don't use the stack.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { GameStep } from './gamePhases';
import {
  checkEmptyLibraryDrawWin,
  checkUpkeepWinConditions,
  resolveSpecialUpkeepOutcomes,
  clearEndOfTurnWinLossEffects,
} from '../winEffectCards';
import { consumeNextDrawStepSkipEffect } from '../phaseTransitionTriggers';
import { removeExpiredShields } from '../keywordAbilities/regeneration';

/**
 * Execute turn-based action for untap step
 * Rule 703.4c: Active player untaps all their permanents
 */
export function executeUntapStep(
  state: GameState,
  activePlayerId: string
): { state: GameState; logs: string[] } {
  const logs: string[] = [];
  
  // Count tapped permanents controlled by active player
  const tappedCount = (state.battlefield || []).filter(
    (perm: any) => perm.controller === activePlayerId && perm.tapped
  ).length;
  
  if (tappedCount > 0) {
    logs.push(`${activePlayerId} untaps ${tappedCount} permanents`);
  }
  
  // Expire "until your next turn" style temporary effects such as detain.
  const updatedBattlefield = (state.battlefield || []).map((perm: any) => {
    const expiringTurnEffects = Array.isArray(perm?.temporaryEffects)
      ? perm.temporaryEffects.filter((effect: any) => String(effect?.expiresOnControllerTurn || '').trim() === activePlayerId)
      : [];
    const remainingTemporaryEffects = Array.isArray(perm?.temporaryEffects)
      ? perm.temporaryEffects.filter((effect: any) => String(effect?.expiresOnControllerTurn || '').trim() !== activePlayerId)
      : [];
    const expiringGrantedAbilitySet = new Set(
      expiringTurnEffects
        .flatMap((effect: any) => Array.isArray(effect?.grantedAbilities) ? effect.grantedAbilities : [])
        .map((ability: unknown) => String(ability || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const remainingGrantedAbilities = Array.isArray(perm?.grantedAbilities)
      ? perm.grantedAbilities.filter((ability: unknown) => !expiringGrantedAbilitySet.has(String(ability || '').trim().toLowerCase()))
      : [];
    const skipUntapForStep = expiringTurnEffects.some(
      (effect: any) => String(effect?.description || '').trim().toLowerCase() === "doesn't untap during your next untap step"
    );

    if (perm.controller === activePlayerId) {
      return {
        ...perm,
        tapped: skipUntapForStep ? perm.tapped : false,
        ...(remainingTemporaryEffects.length > 0 ? { temporaryEffects: remainingTemporaryEffects } : { temporaryEffects: undefined }),
        ...(remainingGrantedAbilities.length > 0 ? { grantedAbilities: remainingGrantedAbilities } : { grantedAbilities: undefined }),
      };
    }
    return {
      ...perm,
      ...(remainingTemporaryEffects.length > 0 ? { temporaryEffects: remainingTemporaryEffects } : { temporaryEffects: undefined }),
      ...(remainingGrantedAbilities.length > 0 ? { grantedAbilities: remainingGrantedAbilities } : { grantedAbilities: undefined }),
    };
  });
  
  return {
    state: { ...state, battlefield: updatedBattlefield },
    logs,
  };
}

/**
 * Execute turn-based action for draw step
 * Rule 703.4d: Active player draws a card
 */
export function executeDrawStep(
  state: GameState,
  activePlayerId: string,
  context: ActionContext,
  gameId: string
): { state: GameState; logs: string[] } {
  const logs: string[] = [];
  const skipResult = consumeNextDrawStepSkipEffect(state, activePlayerId);
  if (skipResult.skippedBy) {
    logs.push(`${activePlayerId} skips their draw step due to ${skipResult.skippedBy}`);
    return { state: skipResult.state, logs };
  }

  state = skipResult.state;
  const player = state.players.find(p => p.id === activePlayerId);
  
  if (!player) {
    return { state, logs: ['Player not found'] };
  }
  
  const library = [...(player.library || [])];
  if (library.length === 0) {
    const winCheck = checkEmptyLibraryDrawWin(activePlayerId, 0, (state.battlefield || []) as any, state.players as any, ((state as any).winLossEffects || []) as any);
    if (winCheck.playerWins) {
      logs.push(...winCheck.log);
      logs.push(`${activePlayerId} wins the game`);
      return {
        state: {
          ...state,
          winner: activePlayerId,
          status: 'finished' as any,
          winReason: winCheck.winReason as any,
        } as GameState,
        logs,
      };
    }

    logs.push(`${activePlayerId} cannot draw (empty library)`);
    if (winCheck.blockedBy) {
      logs.push(...winCheck.log);
    }
    return { state, logs };
  }
  
  const [drawnCard] = library.splice(0, 1);
  logs.push(`${activePlayerId} draws a card`);
  
  const updatedPlayers = state.players.map(p =>
    p.id === activePlayerId
      ? { ...p, library, hand: [...(p.hand || []), drawnCard] }
      : p
  );
  
  context.emit({
    type: RulesEngineEvent.CARD_DRAWN,
    timestamp: Date.now(),
    gameId,
    data: { playerId: activePlayerId, cardId: drawnCard.id },
  });
  
  return {
    state: { ...state, players: updatedPlayers },
    logs,
  };
}

/**
 * Execute turn-based action for cleanup step
 * Rule 703.4n/p: Discard to hand size, remove damage
 */
export function executeCleanupStep(
  state: GameState,
  activePlayerId: string
): { state: GameState; logs: string[]; discardRequired: number } {
  const logs: string[] = [];
  const player = state.players.find(p => p.id === activePlayerId);
  
  if (!player) {
    return { state, logs: ['Player not found'], discardRequired: 0 };
  }
  
  // Check for discard requirement
  // Note: Default max hand size is 7, but can be modified by effects
  // Read from player state if available, otherwise use default
  const maxHandSize = (player as any).maxHandSize ?? 7;
  const handSize = (player.hand || []).length;
  const discardRequired = Math.max(0, handSize - maxHandSize);
  
  if (discardRequired > 0) {
    logs.push(`${activePlayerId} must discard ${discardRequired} cards`);
  }
  
  // Remove damage from all permanents on centralized battlefield
  const updatedBattlefield = (state.battlefield || []).map((perm: any) => {
    const expiringTemporaryEffects = Array.isArray(perm?.temporaryEffects)
      ? perm.temporaryEffects.filter((effect: any) => effect?.expiresAt === 'end_of_turn' || effect?.expiresAt === 'end_of_combat')
      : [];
    const remainingTemporaryEffects = Array.isArray(perm?.temporaryEffects)
      ? perm.temporaryEffects.filter((effect: any) => effect?.expiresAt !== 'end_of_turn' && effect?.expiresAt !== 'end_of_combat')
      : [];
    const expiringGrantedAbilitySet = new Set(
      expiringTemporaryEffects
        .flatMap((effect: any) => Array.isArray(effect?.grantedAbilities) ? effect.grantedAbilities : [])
        .map((ability: unknown) => String(ability || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const remainingGrantedAbilities = Array.isArray(perm?.grantedAbilities)
      ? perm.grantedAbilities.filter((ability: unknown) => !expiringGrantedAbilitySet.has(String(ability || '').trim().toLowerCase()))
      : [];
    const remainingModifiers = Array.isArray(perm?.modifiers)
      ? perm.modifiers.filter((modifier: any) => modifier?.duration !== 'end_of_turn' && modifier?.duration !== 'end_of_combat')
      : [];

    return {
      ...perm,
      counters: {
        ...perm.counters,
        damage: 0,
      },
      damageSourceIds: [],
      ...(remainingTemporaryEffects.length > 0 ? { temporaryEffects: remainingTemporaryEffects } : { temporaryEffects: undefined }),
      ...(remainingGrantedAbilities.length > 0 ? { grantedAbilities: remainingGrantedAbilities } : { grantedAbilities: undefined }),
      ...(remainingModifiers.length > 0 ? { modifiers: remainingModifiers } : { modifiers: undefined }),
    };
  });
  
  logs.push('Damage removed from all permanents');
  
  const clearedState = clearEndOfTurnWinLossEffects({ ...state, battlefield: updatedBattlefield } as GameState);
  const remainingRegenerationShields = removeExpiredShields(
    Array.isArray((clearedState as any).regenerationShields)
      ? ((clearedState as any).regenerationShields as any[])
      : []
  );

  return {
    state: {
      ...(clearedState as any),
      regenerationShields: remainingRegenerationShields,
    } as GameState,
    logs,
    discardRequired,
  };
}

/**
 * Execute turn-based action for current step
 */
export function executeTurnBasedAction(
  gameId: string,
  state: GameState,
  context: ActionContext
): EngineResult<GameState> {
  const activePlayer = state.players[state.activePlayerIndex || 0];
  const step = state.step;
  let currentState = state;
  const allLogs: string[] = [];
  
  // Handle step-based actions using shared GameStep values
  if (step === GameStep.UNTAP) {
    const result = executeUntapStep(currentState, activePlayer.id);
    currentState = result.state;
    allLogs.push(...result.logs);
  } else if (step === GameStep.DRAW) {
    const result = executeDrawStep(currentState, activePlayer.id, context, gameId);
    currentState = result.state;
    allLogs.push(...result.logs);
  } else if (step === GameStep.CLEANUP) {
    const result = executeCleanupStep(currentState, activePlayer.id);
    currentState = result.state;
    allLogs.push(...result.logs);
  } else if (step === GameStep.UPKEEP) {
    allLogs.push('Upkeep step begins');
    const specialOutcome = resolveSpecialUpkeepOutcomes(currentState, activePlayer.id);
    currentState = specialOutcome.state;
    allLogs.push(...specialOutcome.log);
    if ((currentState as any).status === 'finished') {
      return { next: currentState, log: allLogs };
    }

    const player = currentState.players.find(p => p.id === activePlayer.id);
    const librarySize = (player?.library || []).length;
    const handSize = (player?.hand || []).length;
    const graveyardCreatureCount = (player?.graveyard || []).filter((card: any) =>
      String(card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    const upkeepWinCheck = checkUpkeepWinConditions(
      activePlayer.id,
      librarySize,
      handSize,
      graveyardCreatureCount,
      (currentState.battlefield || []) as any,
      currentState.players as any,
      ((currentState as any).winLossEffects || []) as any,
    );
    allLogs.push(...(upkeepWinCheck.log || []));
    if (upkeepWinCheck.playerWins) {
      currentState = {
        ...currentState,
        winner: activePlayer.id,
        status: 'finished' as any,
        winReason: upkeepWinCheck.winReason as any,
      } as GameState;
      allLogs.push(`${activePlayer.id} wins the game`);
    }
  } else if (step === GameStep.MAIN1 || step === GameStep.MAIN2) {
    allLogs.push('Main phase');
  } else if (step === GameStep.BEGIN_COMBAT) {
    allLogs.push('Beginning of combat');
  } else if (step === GameStep.END) {
    allLogs.push('End step begins');
  } else {
    allLogs.push(`Step: ${step}`);
  }
  
  context.emit({
    type: RulesEngineEvent.STEP_STARTED,
    timestamp: Date.now(),
    gameId,
    data: { step, phase: state.phase },
  });
  
  return { next: currentState, log: allLogs };
}
