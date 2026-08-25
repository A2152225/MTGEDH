// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: checkStateBasedActions.
// Public entry symbols: checkStateBasedActions.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { checkPlayerLoss, type PlayerLossCheck } from '../types/gameFlow';
import { playerHasCantLoseEffect } from '../winEffectCards';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterStateBasedActionsHost = any;

  /**
   * Check and apply state-based actions
   */
export function checkStateBasedActions(this: AdapterStateBasedActionsHost, gameId: string, state: GameState): EngineResult<GameState> {
    const logs: string[] = [];
    let currentState = state;
    
    // Check for player losses
    for (const player of state.players) {
      const cantLose = playerHasCantLoseEffect(
        player.id,
        ((currentState as any).battlefield || []) as any,
        currentState.players as any,
        ((currentState as any).winLossEffects || []) as any,
      );

      // Convert Record to Map for commanderDamage if it exists
      const commanderDamageMap = player.commanderDamage 
        ? new Map(Object.entries(player.commanderDamage))
        : undefined;
        
      const lossCheck: PlayerLossCheck = {
        playerId: player.id,
        lifeTotal: player.life,
        poisonCounters: player.counters?.poison || 0,
        librarySize: player.library?.length || 0,
        commanderDamage: commanderDamageMap,
      };
      
      const lossCondition = checkPlayerLoss(lossCheck);
      if (lossCondition) {
        if (cantLose.hasCantLose) {
          logs.push(`${player.id} would lose the game (${lossCondition}) but is protected by ${cantLose.source}`);
          continue;
        }

        logs.push(`${player.id} lost the game: ${lossCondition}`);
        this.emit({
          type: RulesEngineEvent.PLAYER_LOST,
          timestamp: Date.now(),
          gameId,
          data: { playerId: player.id, reason: lossCondition },
        });
      }
    }
    
    // Apply creature death from lethal damage or zero toughness (Rule 704.5f, 704.5g)
    const creatureDeathResult = this.checkCreatureDeaths(currentState, gameId);
    if (creatureDeathResult.deaths.length > 0) {
      currentState = creatureDeathResult.state;
      logs.push(...creatureDeathResult.logs);
    }
    
    // Apply planeswalker death from zero loyalty (Rule 704.5i)
    const planeswalkerDeathResult = this.checkPlaneswalkerDeaths(currentState, gameId);
    if (planeswalkerDeathResult.deaths.length > 0) {
      currentState = planeswalkerDeathResult.state;
      logs.push(...planeswalkerDeathResult.logs);
    }
    
    // Check legend rule (Rule 704.5j)
    const legendResult = this.checkLegendRule(currentState, gameId);
    if (legendResult.sacrificed.length > 0) {
      currentState = legendResult.state;
      logs.push(...legendResult.logs);
    }
    
    // Check for auras attached to illegal permanents (Rule 704.5m)
    const auraResult = this.checkAuraAttachment(currentState, gameId);
    if (auraResult.detached.length > 0) {
      currentState = auraResult.state;
      logs.push(...auraResult.logs);
    }
    
    if (logs.length > 0) {
      this.emit({
        type: RulesEngineEvent.STATE_BASED_ACTIONS,
        timestamp: Date.now(),
        gameId,
        data: { actions: logs },
      });
    }
    
    // Check for win conditions
    const winResult = this.checkWinConditions(gameId, currentState);
    if (winResult.log && winResult.log.length > 0) {
      logs.push(...winResult.log);
      currentState = winResult.next; // Update state with win condition
    }
    
    return {
      next: currentState,
      log: logs.length > 0 ? logs : undefined,
    };
  }
