/**
 * rules-bridge.ts
 * 
 * Bridge layer that integrates the rules engine with the existing server infrastructure.
 * This allows gradual migration from the current state management to rules-engine-based validation.
 * 
 * Usage:
 * 1. Import RulesBridge in GameManager
 * 2. Wrap game actions with validation
 * 3. Forward rules events to Socket.IO clients
 */

import type { Server } from 'socket.io';
import { rulesEngine, RulesEngineEvent, type RulesEvent } from '../../rules-engine/src/RulesEngineAdapter.js';
import type { GameState, PlayerID, CommanderInfo } from '../../shared/src/index.js';

/**
 * Bridge between existing game state and rules engine
 */
export class RulesBridge {
  private gameId: string;
  private io: Server;
  
  constructor(gameId: string, io: Server) {
    this.gameId = gameId;
    this.io = io;
    
    // Set up event forwarding from rules engine to Socket.IO
    this.setupEventForwarding();
  }
  
  /**
   * Initialize the rules engine for this game
   */
  initialize(gameState: any): void {
    // Convert existing game state format to rules engine format
    const rulesGameState = this.convertToRulesEngineState(gameState);
    rulesEngine.initializeGame(this.gameId, rulesGameState);
  }
  
  /**
   * Validate an action through the rules engine
   */
  validateAction(action: any): { legal: boolean; reason?: string } {
    return rulesEngine.validateAction(this.gameId, action);
  }
  
  /**
   * Execute an action through the rules engine
   */
  executeAction(action: any): { success: boolean; error?: string } {
    const validation = this.validateAction(action);
    
    if (!validation.legal) {
      return { success: false, error: validation.reason };
    }
    
    try {
      const result = rulesEngine.executeAction(this.gameId, action);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Forward rules engine events to Socket.IO clients
   */
  private setupEventForwarding(): void {
    // Spell events
    rulesEngine.on(RulesEngineEvent.SPELL_CAST, (event) => {
      this.io.to(this.gameId).emit('spellCast', {
        gameId: this.gameId,
        spell: event.data.spell,
        caster: event.data.caster,
        timestamp: event.timestamp,
      });
    });
    
    rulesEngine.on(RulesEngineEvent.SPELL_RESOLVED, (event) => {
      this.io.to(this.gameId).emit('spellResolved', {
        gameId: this.gameId,
        spell: event.data.spell,
        timestamp: event.timestamp,
      });
    });
    
    // Combat events
    rulesEngine.on(RulesEngineEvent.ATTACKERS_DECLARED, (event) => {
      this.io.to(this.gameId).emit('attackersDeclared', {
        gameId: this.gameId,
        attackers: event.data.attackers,
        defender: event.data.defender,
        timestamp: event.timestamp,
      });
    });
    
    rulesEngine.on(RulesEngineEvent.BLOCKERS_DECLARED, (event) => {
      this.io.to(this.gameId).emit('blockersDeclared', {
        gameId: this.gameId,
        blockers: event.data.blockers,
        timestamp: event.timestamp,
      });
    });
    
    rulesEngine.on(RulesEngineEvent.DAMAGE_DEALT, (event) => {
      this.io.to(this.gameId).emit('damageDealt', {
        gameId: this.gameId,
        damage: event.data,
        timestamp: event.timestamp,
      });
    });
    
    // Game state events
    rulesEngine.on(RulesEngineEvent.PRIORITY_PASSED, (event) => {
      this.io.to(this.gameId).emit('priorityPassed', {
        gameId: this.gameId,
        from: event.data.from,
        to: event.data.to,
        timestamp: event.timestamp,
      });
    });
    
    rulesEngine.on(RulesEngineEvent.STATE_BASED_ACTIONS, (event) => {
      this.io.to(this.gameId).emit('stateBasedActions', {
        gameId: this.gameId,
        actions: event.data.actions,
        timestamp: event.timestamp,
      });
    });
    
    // Win/loss events - DISABLED until rules engine properly validates win conditions
    // The rules engine currently fires spurious PLAYER_WON events on routine actions
    // like land plays. We disable these handlers to prevent "X wins the game!" spam.
    // TODO: Re-enable when rules engine properly checks win conditions (life <= 0, poison >= 10, etc.)
    
    // rulesEngine.on(RulesEngineEvent.PLAYER_LOST, (event) => {
    //   this.io.to(this.gameId).emit('playerLost', {
    //     gameId: this.gameId,
    //     playerId: event.data.playerId,
    //     reason: event.data.reason,
    //     timestamp: event.timestamp,
    //   });
    //   
    //   this.io.to(this.gameId).emit('chat', {
    //     id: `loss_${event.timestamp}`,
    //     gameId: this.gameId,
    //     from: 'system',
    //     message: `${event.data.playerId} lost the game: ${event.data.reason}`,
    //     ts: event.timestamp,
    //   });
    // });
    // 
    // rulesEngine.on(RulesEngineEvent.PLAYER_WON, (event) => {
    //   this.io.to(this.gameId).emit('playerWon', {
    //     gameId: this.gameId,
    //     playerId: event.data.playerId,
    //     reason: event.data.reason,
    //     timestamp: event.timestamp,
    //   });
    //   
    //   this.io.to(this.gameId).emit('chat', {
    //     id: `win_${event.timestamp}`,
    //     gameId: this.gameId,
    //     from: 'system',
    //     message: `${event.data.playerId} wins the game!`,
    //     ts: event.timestamp,
    //   });
    // });
    // 
    // rulesEngine.on(RulesEngineEvent.GAME_ENDED, (event) => {
    //   this.io.to(this.gameId).emit('gameEnded', {
    //     gameId: this.gameId,
    //     winner: event.data.winner,
    //     reason: event.data.reason,
    //     timestamp: event.timestamp,
    //   });
    // });
    
    // Card events
    rulesEngine.on(RulesEngineEvent.CARD_DRAWN, (event) => {
      this.io.to(this.gameId).emit('cardDrawn', {
        gameId: this.gameId,
        playerId: event.data.playerId,
        timestamp: event.timestamp,
      });
    });
    
    rulesEngine.on(RulesEngineEvent.PERMANENT_DESTROYED, (event) => {
      this.io.to(this.gameId).emit('permanentDestroyed', {
        gameId: this.gameId,
        permanent: event.data.permanent,
        timestamp: event.timestamp,
      });
    });
  }
  
  /**
   * Convert existing game state to rules engine format
   */
  private convertToRulesEngineState(existingState: any): GameState {
    const players = this.convertPlayers(existingState);
    const turnOrder = this.extractTurnOrder(existingState);
    const activePlayerIndex = this.getActivePlayerIndex(existingState);
    const priorityPlayerIndex = this.getPriorityPlayerIndex(existingState);
    
    // Map existing state structure to rules engine GameState interface
    return {
      id: this.gameId,
      format: existingState.format || 'commander',
      players: players.map((p: any) => ({ id: p.id, name: p.name, seat: turnOrder.indexOf(p.id) })),
      turnOrder,
      activePlayerIndex,
      turnPlayer: turnOrder[activePlayerIndex] || turnOrder[0],
      priority: turnOrder[priorityPlayerIndex] || turnOrder[0],
      turn: existingState.turn || 0,
      phase: this.mapPhase(existingState.phase),
      step: this.mapStep(existingState.step),
      stack: existingState.stack || [],
      combat: existingState.combat,
      startingLife: existingState.startingLife || 40,
      life: this.extractLifeTotals(players),
      battlefield: existingState.battlefield || [],
      commandZone: this.extractCommandZone(players),
      allowUndos: false,
      turnTimerEnabled: false,
      turnTimerSeconds: 0,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      spectators: [],
      status: this.mapStatus(existingState.phase),
      active: true,
    };
  }
  
  private convertPlayers(state: any): any[] {
    const players = state.players || [];
    return players.map((p: any) => ({
      id: p.id || p.playerId,
      name: p.name || 'Unknown',
      life: p.life ?? state.startingLife ?? 40,
      hand: state.zones?.[p.id]?.hand || [],
      library: state.zones?.[p.id]?.library || [],
      graveyard: state.zones?.[p.id]?.graveyard || [],
      battlefield: state.zones?.[p.id]?.battlefield || [],
      exile: state.zones?.[p.id]?.exile || [],
      commandZone: state.commandZone?.[p.id] || [],
      counters: p.counters || {},
      hasLost: p.hasLost || false,
      commanderDamage: p.commanderDamage,
    }));
  }
  
  private extractTurnOrder(state: any): string[] {
    if (state.turnOrder) return state.turnOrder;
    return (state.players || []).map((p: any) => p.id || p.playerId);
  }
  
  private getActivePlayerIndex(state: any): number {
    if (typeof state.activePlayerIndex === 'number') return state.activePlayerIndex;
    if (state.turnPlayer && state.players) {
      const idx = state.players.findIndex((p: any) => 
        (p.id || p.playerId) === state.turnPlayer
      );
      return idx >= 0 ? idx : 0;
    }
    return 0;
  }
  
  private getPriorityPlayerIndex(state: any): number {
    if (typeof state.priorityPlayerIndex === 'number') return state.priorityPlayerIndex;
    if (state.priority && state.players) {
      const idx = state.players.findIndex((p: any) => 
        (p.id || p.playerId) === state.priority
      );
      return idx >= 0 ? idx : 0;
    }
    return this.getActivePlayerIndex(state);
  }
  
  private mapPhase(phase: any): any {
    if (!phase || phase === 'PRE_GAME') return 'beginning';
    const phaseStr = String(phase).toLowerCase();
    if (phaseStr.includes('main')) {
      return phaseStr.includes('post') ? 'postcombatMain' : 'precombatMain';
    }
    return phaseStr;
  }
  
  private mapStep(step: any): any {
    if (!step) return 'untap';
    return String(step).toLowerCase();
  }
  
  private mapStatus(phase: any): any {
    if (!phase || phase === 'PRE_GAME') return 'waiting';
    return 'inProgress';
  }
  
  private extractLifeTotals(players: any[]): Record<PlayerID, number> {
    const lifeTotals: Record<PlayerID, number> = {};
    for (const p of players) {
      lifeTotals[p.id] = p.life || 40;
    }
    return lifeTotals;
  }
  
  private extractCommandZone(players: any[]): Record<PlayerID, CommanderInfo> {
    const commandZone: Record<PlayerID, CommanderInfo> = {};
    for (const p of players) {
      commandZone[p.id] = {
        commanderIds: p.commandZone?.map((c: any) => c.id) || [],
        commanderNames: p.commandZone?.map((c: any) => c.name) || [],
        tax: 0,
      };
    }
    return commandZone;
  }
}

/**
 * Create a rules bridge for a game
 */
export function createRulesBridge(gameId: string, io: Server): RulesBridge {
  return new RulesBridge(gameId, io);
}
