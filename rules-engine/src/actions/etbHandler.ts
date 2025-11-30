/**
 * actions/etbHandler.ts
 * 
 * Handles Enter The Battlefield (ETB) triggers.
 * Processes token creation, counter placement, and other ETB effects.
 */

import type { GameState, BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { EngineResult, ActionContext, BaseAction } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { isETBTokenCreator, getETBTokenConfig } from '../cards/etbTokenCreators';
import { COMMON_TOKENS, createTokenPermanent, type TokenCharacteristics } from '../tokenCreation';
import { hasEcho, getEchoConfig } from '../cards/echoCards';
import { TriggerEvent } from '../triggeredAbilities';

export interface ETBAction extends BaseAction {
  readonly type: 'processETB';
  readonly permanentId: string;
  readonly permanentName: string;
}

/**
 * Process ETB triggers for a permanent that just entered the battlefield
 */
export function processETBTriggers(
  gameId: string,
  permanentId: string,
  permanentName: string,
  controllerId: string,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return { 
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState, 
      log: ['Game not found'] 
    };
  }
  
  const logs: string[] = [];
  let updatedState = state;
  
  // Check if this is a known ETB token creator
  const etbConfig = getETBTokenConfig(permanentName);
  if (etbConfig) {
    const result = processETBTokenCreation(updatedState, controllerId, etbConfig, gameId, context);
    updatedState = result.state;
    logs.push(...result.logs);
  }
  
  // Check for vanishing counters (Deep Forest Hermit)
  if (etbConfig?.vanishingCounters) {
    const result = addVanishingCounters(updatedState, permanentId, etbConfig.vanishingCounters);
    updatedState = result.state;
    logs.push(...result.logs);
  }
  
  // Check for echo (Deranged Hermit)
  if (hasEcho(permanentName)) {
    logs.push(`${permanentName} has Echo - payment required on next upkeep`);
    // Mark the permanent as needing echo payment
    updatedState = markForEcho(updatedState, permanentId);
  }
  
  // Emit ETB event for other triggers
  context.emit({
    type: RulesEngineEvent.CARD_PUT_ONTO_BATTLEFIELD,
    timestamp: Date.now(),
    gameId,
    data: {
      permanentId,
      permanentName,
      controllerId,
      triggeredTokens: etbConfig ? true : false,
    },
  });
  
  return {
    next: updatedState,
    log: logs,
  };
}

/**
 * Process ETB token creation
 */
function processETBTokenCreation(
  state: GameState,
  controllerId: string,
  config: { 
    tokenType: string; 
    tokenCount: number | 'X';
    customToken?: TokenCharacteristics;
    buffEffect?: { power: number; toughness: number; types: string[] };
  },
  gameId: string,
  context: ActionContext
): { state: GameState; logs: string[] } {
  const logs: string[] = [];
  let updatedState = state;
  
  // Determine token count
  let count: number;
  if (config.tokenCount === 'X') {
    // For "X" counts like Avenger of Zendikar, count lands
    const player = state.players.find(p => p.id === controllerId);
    const lands = (player?.battlefield || []).filter((p: BattlefieldPermanent) => {
      const card = p.card as KnownCardRef;
      return card?.type_line?.toLowerCase().includes('land');
    });
    count = lands.length;
  } else {
    count = config.tokenCount;
  }
  
  if (count === 0) {
    return { state: updatedState, logs };
  }
  
  // Get token characteristics
  const tokenChars = config.customToken || COMMON_TOKENS[config.tokenType];
  if (!tokenChars) {
    logs.push(`Warning: Unknown token type ${config.tokenType}`);
    return { state: updatedState, logs };
  }
  
  // Create tokens
  const newTokens: BattlefieldPermanent[] = [];
  for (let i = 0; i < count; i++) {
    const token = createTokenPermanent(tokenChars, controllerId);
    newTokens.push(token);
  }
  
  // Add tokens to player's battlefield
  const updatedPlayers = updatedState.players.map(p => {
    if (p.id === controllerId) {
      return {
        ...p,
        battlefield: [...(p.battlefield || []), ...newTokens],
      };
    }
    return p;
  });
  
  updatedState = {
    ...updatedState,
    players: updatedPlayers,
  };
  
  logs.push(`Created ${count} ${tokenChars.name} token${count > 1 ? 's' : ''}`);
  
  // Emit token created events
  for (const token of newTokens) {
    context.emit({
      type: RulesEngineEvent.CARD_PUT_ONTO_BATTLEFIELD,
      timestamp: Date.now(),
      gameId,
      data: {
        permanentId: token.id,
        permanentName: (token.card as KnownCardRef)?.name || 'Token',
        controllerId,
        isToken: true,
      },
    });
  }
  
  return { state: updatedState, logs };
}

/**
 * Add vanishing counters to a permanent
 */
function addVanishingCounters(
  state: GameState,
  permanentId: string,
  counters: number
): { state: GameState; logs: string[] } {
  const logs: string[] = [];
  
  const updatedPlayers = state.players.map(p => ({
    ...p,
    battlefield: (p.battlefield || []).map((perm: BattlefieldPermanent) => {
      if (perm.id === permanentId) {
        return {
          ...perm,
          counters: {
            ...perm.counters,
            time: counters,
          },
        };
      }
      return perm;
    }),
  }));
  
  logs.push(`Added ${counters} time counter${counters > 1 ? 's' : ''} (Vanishing ${counters})`);
  
  return {
    state: { ...state, players: updatedPlayers },
    logs,
  };
}

/**
 * Mark a permanent as needing echo payment
 */
function markForEcho(state: GameState, permanentId: string): GameState {
  const updatedPlayers = state.players.map(p => ({
    ...p,
    battlefield: (p.battlefield || []).map((perm: BattlefieldPermanent) => {
      if (perm.id === permanentId) {
        return {
          ...perm,
          needsEchoPayment: true,
        } as BattlefieldPermanent;
      }
      return perm;
    }),
  }));
  
  return { ...state, players: updatedPlayers };
}

/**
 * Process echo upkeep trigger
 */
export function processEchoUpkeep(
  gameId: string,
  playerId: string,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return { 
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState, 
      log: ['Game not found'] 
    };
  }
  
  const player = state.players.find(p => p.id === playerId);
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  const logs: string[] = [];
  const echoPerms = (player.battlefield || []).filter((p: any) => p.needsEchoPayment);
  
  for (const perm of echoPerms) {
    const card = perm.card as KnownCardRef;
    const echoConfig = getEchoConfig(card?.name || '');
    if (echoConfig) {
      logs.push(`${card?.name || 'Permanent'} - pay ${echoConfig.echoCost} or sacrifice`);
      // Note: Actual payment choice would be handled by UI
    }
  }
  
  return {
    next: state,
    log: logs,
  };
}

/**
 * Sacrifice a permanent for not paying echo
 */
export function sacrificeForEcho(
  state: GameState,
  permanentId: string,
  playerId: string
): GameState {
  const updatedPlayers = state.players.map(p => {
    if (p.id !== playerId) return p;
    
    const permanent = (p.battlefield || []).find((perm: BattlefieldPermanent) => perm.id === permanentId);
    const updatedBattlefield = (p.battlefield || []).filter((perm: BattlefieldPermanent) => perm.id !== permanentId);
    
    return {
      ...p,
      battlefield: updatedBattlefield,
      graveyard: permanent ? [...(p.graveyard || []), permanent.card || permanent] : p.graveyard,
    };
  });
  
  return { ...state, players: updatedPlayers };
}
