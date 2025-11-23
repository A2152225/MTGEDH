// Cost payment implementation following rule 118
import type { GameState, PlayerID } from '../../shared/src';
import type { Cost, ManaAmount } from './types/abilities';

export interface CostResult<T> {
  readonly next: T;
  readonly paid: boolean;
  readonly log?: readonly string[];
}

/**
 * Check if a cost can be paid (rule 118.3)
 * A player can't pay a cost without having the necessary resources
 */
export function canPayCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  cost: Cost
): boolean {
  switch (cost.type) {
    case 'mana':
      return canPayManaCost(state, playerId, cost.amount);
    
    case 'tap':
      return canPayTapCost(state, cost.sourceId);
    
    case 'untap':
      return canPayUntapCost(state, cost.sourceId);
    
    case 'sacrifice':
      return canPaySacrificeCost(state, playerId, cost.filter, cost.count);
    
    case 'discard':
      return canPayDiscardCost(state, playerId, cost.count);
    
    case 'pay-life':
      return canPayLifeCost(state, playerId, cost.amount);
    
    case 'exile':
      return canPayExileCost(state, playerId, cost.source, cost.filter, cost.count);
    
    case 'remove-counters':
      return canPayRemoveCountersCost(state, cost.counterType, cost.count, cost.from);
    
    case 'composite':
      return cost.costs.every(c => canPayCost(state, playerId, c));
    
    default:
      return false;
  }
}

/**
 * Pay a cost (rule 118.1)
 * Carries out the instructions specified by the cost
 */
export function payCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  cost: Cost
): CostResult<GameState> {
  if (!canPayCost(state, playerId, cost)) {
    return {
      next: state,
      paid: false,
      log: ['Cannot pay cost - insufficient resources']
    };
  }

  switch (cost.type) {
    case 'mana':
      return payManaCost(state, playerId, cost.amount);
    
    case 'tap':
      return payTapCost(state, cost.sourceId);
    
    case 'untap':
      return payUntapCost(state, cost.sourceId);
    
    case 'sacrifice':
      return paySacrificeCost(state, playerId, cost.filter, cost.count);
    
    case 'discard':
      return payDiscardCost(state, playerId, cost.count);
    
    case 'pay-life':
      return payLifeCost(state, playerId, cost.amount);
    
    case 'exile':
      return payExileCost(state, playerId, cost.source, cost.filter, cost.count);
    
    case 'remove-counters':
      return payRemoveCountersCost(state, cost.counterType, cost.count, cost.from);
    
    case 'composite':
      return payCompositeCost(state, playerId, cost.costs);
    
    default:
      return {
        next: state,
        paid: false,
        log: ['Unknown cost type']
      };
  }
}

// Mana cost payment (rule 118.3a)
function canPayManaCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  amount: ManaAmount
): boolean {
  // This is simplified - real implementation would check player's mana pool
  // For now, assume we need to track mana pool in player state
  return true; // Placeholder
}

function payManaCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  amount: ManaAmount
): CostResult<GameState> {
  // Simplified - would actually remove mana from player's pool
  return {
    next: state,
    paid: true,
    log: [`${playerId} paid mana cost`]
  };
}

// Tap cost (rule 602.5a)
function canPayTapCost(state: Readonly<GameState>, sourceId: string): boolean {
  const permanent = state.battlefield.find(p => p.id === sourceId);
  if (!permanent) return false;
  
  // Can't tap if already tapped (rule 118.3)
  return !permanent.tapped;
}

function payTapCost(
  state: Readonly<GameState>,
  sourceId: string
): CostResult<GameState> {
  const permanentIndex = state.battlefield.findIndex(p => p.id === sourceId);
  if (permanentIndex === -1) {
    return { next: state, paid: false, log: ['Permanent not found'] };
  }

  const newBattlefield = [...state.battlefield];
  newBattlefield[permanentIndex] = {
    ...newBattlefield[permanentIndex],
    tapped: true
  };

  return {
    next: {
      ...state,
      battlefield: newBattlefield
    },
    paid: true,
    log: [`Tapped ${sourceId}`]
  };
}

// Untap cost
function canPayUntapCost(state: Readonly<GameState>, sourceId: string): boolean {
  const permanent = state.battlefield.find(p => p.id === sourceId);
  if (!permanent) return false;
  
  // Can't untap if already untapped
  return permanent.tapped === true;
}

function payUntapCost(
  state: Readonly<GameState>,
  sourceId: string
): CostResult<GameState> {
  const permanentIndex = state.battlefield.findIndex(p => p.id === sourceId);
  if (permanentIndex === -1) {
    return { next: state, paid: false };
  }

  const newBattlefield = [...state.battlefield];
  newBattlefield[permanentIndex] = {
    ...newBattlefield[permanentIndex],
    tapped: false
  };

  return {
    next: {
      ...state,
      battlefield: newBattlefield
    },
    paid: true,
    log: [`Untapped ${sourceId}`]
  };
}

// Sacrifice cost
function canPaySacrificeCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  filter: any,
  count: number
): boolean {
  // Simplified - would actually check battlefield for matching permanents
  const controlledPermanents = state.battlefield.filter(p => p.controller === playerId);
  return controlledPermanents.length >= count;
}

function paySacrificeCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  filter: any,
  count: number
): CostResult<GameState> {
  // Simplified - would actually move permanents to graveyard
  return {
    next: state,
    paid: true,
    log: [`${playerId} sacrificed ${count} permanent(s)`]
  };
}

// Discard cost
function canPayDiscardCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  count: number
): boolean {
  // Would check player's hand size
  return true; // Placeholder
}

function payDiscardCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  count: number
): CostResult<GameState> {
  return {
    next: state,
    paid: true,
    log: [`${playerId} discarded ${count} card(s)`]
  };
}

// Life cost (rule 118.3b)
function canPayLifeCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  amount: number | 'X' | 'half'
): boolean {
  const life = state.life[playerId];
  if (life === undefined) return false;

  if (amount === 'X') return true; // Can pay any amount
  if (amount === 'half') return life >= 1; // Can always pay half if life > 0
  
  // Rule 118.3b: Player can't pay life cost if they don't have enough life
  // However, they can pay if it brings them to 0 or less (they just lose)
  return life >= amount;
}

function payLifeCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  amount: number | 'X' | 'half'
): CostResult<GameState> {
  const currentLife = state.life[playerId];
  if (currentLife === undefined) {
    return { next: state, paid: false };
  }

  let lifeToLose: number;
  if (amount === 'half') {
    lifeToLose = Math.ceil(currentLife / 2);
  } else if (amount === 'X') {
    lifeToLose = 0; // Would need X value from context
  } else {
    lifeToLose = amount;
  }

  return {
    next: {
      ...state,
      life: {
        ...state.life,
        [playerId]: currentLife - lifeToLose
      }
    },
    paid: true,
    log: [`${playerId} paid ${lifeToLose} life`]
  };
}

// Exile cost
function canPayExileCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  source: string,
  filter: any,
  count: number
): boolean {
  return true; // Placeholder
}

function payExileCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  source: string,
  filter: any,
  count: number
): CostResult<GameState> {
  return {
    next: state,
    paid: true,
    log: [`${playerId} exiled ${count} card(s)`]
  };
}

// Remove counters cost
function canPayRemoveCountersCost(
  state: Readonly<GameState>,
  counterType: string,
  count: number,
  from: any
): boolean {
  return true; // Placeholder
}

function payRemoveCountersCost(
  state: Readonly<GameState>,
  counterType: string,
  count: number,
  from: any
): CostResult<GameState> {
  return {
    next: state,
    paid: true,
    log: [`Removed ${count} ${counterType} counter(s)`]
  };
}

// Composite cost (multiple costs)
function payCompositeCost(
  state: Readonly<GameState>,
  playerId: PlayerID,
  costs: readonly Cost[]
): CostResult<GameState> {
  let currentState = state;
  const logs: string[] = [];

  for (const cost of costs) {
    const result = payCost(currentState, playerId, cost);
    if (!result.paid) {
      return {
        next: state, // Rollback - no costs paid
        paid: false,
        log: [...logs, ...(result.log || []), 'Failed to pay composite cost']
      };
    }
    currentState = result.next;
    if (result.log) {
      logs.push(...result.log);
    }
  }

  return {
    next: currentState,
    paid: true,
    log: logs
  };
}
