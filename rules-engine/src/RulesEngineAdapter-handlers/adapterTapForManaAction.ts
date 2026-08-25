// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: tapForManaAction.
// Public entry symbols: tapForManaAction.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { tapPermanentForMana, type TapForManaContext } from '../manaAbilities';
import { ManaType } from '../types/mana';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterTapForManaActionHost = any;

  /**
   * Tap permanent for mana
   */
export function tapForManaAction(this: AdapterTapForManaActionHost, gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    const context: TapForManaContext = {
      permanentId: action.permanentId,
      permanentName: action.permanentName || 'Permanent',
      controllerId: action.playerId,
      manaToAdd: action.manaToAdd || [{ type: ManaType.COLORLESS, amount: 1 }],
      currentlyTapped: action.currentlyTapped || false,
    };
    
    const result = tapPermanentForMana(context, player.manaPool);
    
    if (!result.success) {
      return { next: state, log: [result.error || 'Failed to tap for mana'] };
    }
    
    // Update player's mana pool
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, manaPool: result.manaPoolAfter! }
        : p
    );
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    this.emit({
      type: RulesEngineEvent.MANA_ADDED,
      timestamp: Date.now(),
      gameId,
      data: { 
        playerId: action.playerId,
        manaAdded: result.manaAdded,
        source: action.permanentName,
      },
    });
    
    this.emit({
      type: RulesEngineEvent.PERMANENT_TAPPED,
      timestamp: Date.now(),
      gameId,
      data: { 
        permanentId: action.permanentId,
        controllerId: action.playerId,
      },
    });
    
    return {
      next: nextState,
      log: result.log || [`Tapped ${action.permanentName} for mana`],
    };
  }
