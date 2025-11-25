/**
 * Test suite for modular action handlers
 * Tests sacrifice, search library, combat, and fetchland actions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../shared/src';
import { RulesEngineEvent, type RulesEvent } from '../src/core/events';
import {
  executeSacrifice,
  validateSacrifice,
  executeSearchLibrary,
  validateSearchLibrary,
  executeDeclareAttackers,
  validateDeclareAttackers,
  executeDeclareBlockers,
  validateDeclareBlockers,
  executeCombatDamage,
  executeFetchland,
  validateFetchland,
} from '../src/actions';

// Helper to create a mock game state
function createMockGameState(): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      {
        id: 'player1',
        name: 'Player 1',
        seat: 0,
        life: 40,
        library: [
          { id: 'card1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'card2', name: 'Island', type_line: 'Basic Land — Island' },
          { id: 'card3', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        ],
        hand: [],
        battlefield: [
          { id: 'perm1', controller: 'player1', owner: 'player1', tapped: false, card: { name: 'Evolving Wilds', type_line: 'Land' } },
          { id: 'perm2', controller: 'player1', owner: 'player1', tapped: false, card: { name: 'Mountain', type_line: 'Basic Land — Mountain' } },
        ],
        graveyard: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      {
        id: 'player2',
        name: 'Player 2',
        seat: 1,
        life: 40,
        library: [],
        hand: [],
        battlefield: [
          { id: 'perm3', controller: 'player2', owner: 'player2', tapped: false, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
        ],
        graveyard: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ],
    startingLife: 40,
    life: { player1: 40, player2: 40 },
    turnPlayer: 'player1',
    priority: 'player1',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: 'precombatMain',
    step: 'main',
    active: true,
    turnOrder: ['player1', 'player2'],
    activePlayerIndex: 0,
  } as any;
}

// Helper to create action context
function createMockContext(gameStates: Map<string, GameState>) {
  const emittedEvents: RulesEvent[] = [];
  
  return {
    getState: (gameId: string) => gameStates.get(gameId),
    setState: (gameId: string, state: GameState) => gameStates.set(gameId, state),
    emit: (event: RulesEvent) => emittedEvents.push(event),
    gameId: 'test-game',
    getEmittedEvents: () => emittedEvents,
  };
}

describe('Sacrifice Action', () => {
  let gameState: GameState;
  let gameStates: Map<string, GameState>;
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    gameState = createMockGameState();
    gameStates = new Map([['test-game', gameState]]);
    context = createMockContext(gameStates);
  });

  it('should validate sacrifice of controlled permanent', () => {
    const action = {
      type: 'sacrifice' as const,
      playerId: 'player1',
      permanentId: 'perm1',
    };
    
    const result = validateSacrifice(gameState, action);
    expect(result.legal).toBe(true);
  });

  it('should reject sacrifice of non-existent permanent', () => {
    const action = {
      type: 'sacrifice' as const,
      playerId: 'player1',
      permanentId: 'nonexistent',
    };
    
    const result = validateSacrifice(gameState, action);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('should execute sacrifice and move to graveyard', () => {
    const action = {
      type: 'sacrifice' as const,
      playerId: 'player1',
      permanentId: 'perm1',
    };
    
    const result = executeSacrifice('test-game', action, context);
    
    expect(result.next).toBeDefined();
    const player = result.next.players.find(p => p.id === 'player1');
    expect(player?.battlefield?.length).toBe(1); // One permanent removed
    expect(player?.graveyard?.length).toBe(1); // Added to graveyard
    expect(result.log).toContain('Sacrificed Evolving Wilds');
  });

  it('should emit PERMANENT_SACRIFICED event', () => {
    const action = {
      type: 'sacrifice' as const,
      playerId: 'player1',
      permanentId: 'perm1',
    };
    
    executeSacrifice('test-game', action, context);
    
    const events = context.getEmittedEvents();
    expect(events.some(e => e.type === RulesEngineEvent.PERMANENT_SACRIFICED)).toBe(true);
  });
});

describe('Search Library Action', () => {
  let gameState: GameState;
  let gameStates: Map<string, GameState>;
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    gameState = createMockGameState();
    gameStates = new Map([['test-game', gameState]]);
    context = createMockContext(gameStates);
  });

  it('should validate search on non-empty library', () => {
    const action = {
      type: 'searchLibrary' as const,
      playerId: 'player1',
      criteria: { cardType: 'basic land' },
    };
    
    const result = validateSearchLibrary(gameState, action);
    expect(result.legal).toBe(true);
  });

  it('should search and put card into hand by default', () => {
    const action = {
      type: 'searchLibrary' as const,
      playerId: 'player1',
      criteria: { cardType: 'basic land' },
      selectedCardIds: ['card1'],
    };
    
    const result = executeSearchLibrary('test-game', action, context);
    
    const player = result.next.players.find(p => p.id === 'player1');
    expect(player?.hand?.length).toBe(1);
    expect(player?.library?.length).toBe(2); // One removed
  });

  it('should search and put card onto battlefield', () => {
    const action = {
      type: 'searchLibrary' as const,
      playerId: 'player1',
      criteria: { cardType: 'basic land' },
      destination: 'battlefield' as const,
      selectedCardIds: ['card1'],
    };
    
    const result = executeSearchLibrary('test-game', action, context);
    
    const player = result.next.players.find(p => p.id === 'player1');
    expect(player?.battlefield?.length).toBe(3); // Two original + one new
    expect(player?.library?.length).toBe(2);
  });

  it('should put land onto battlefield tapped if specified', () => {
    const action = {
      type: 'searchLibrary' as const,
      playerId: 'player1',
      criteria: { cardType: 'basic land' },
      destination: 'battlefield' as const,
      tapped: true,
      selectedCardIds: ['card1'],
    };
    
    const result = executeSearchLibrary('test-game', action, context);
    
    const player = result.next.players.find(p => p.id === 'player1');
    const newPermanent = player?.battlefield?.find((p: any) => p.card?.name === 'Forest');
    expect(newPermanent?.tapped).toBe(true);
  });

  it('should shuffle library after search', () => {
    const action = {
      type: 'searchLibrary' as const,
      playerId: 'player1',
      criteria: { cardType: 'basic land' },
      selectedCardIds: ['card1'],
    };
    
    executeSearchLibrary('test-game', action, context);
    
    const events = context.getEmittedEvents();
    expect(events.some(e => e.type === RulesEngineEvent.LIBRARY_SHUFFLED)).toBe(true);
  });

  it('should handle fail to find', () => {
    const action = {
      type: 'searchLibrary' as const,
      playerId: 'player1',
      criteria: { cardType: 'basic land' },
      failToFind: true,
    };
    
    const result = executeSearchLibrary('test-game', action, context);
    
    expect(result.log?.some(l => l.includes('failed to find'))).toBe(true);
  });
});

describe('Combat Actions', () => {
  let gameState: GameState;
  let gameStates: Map<string, GameState>;
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    gameState = createMockGameState();
    // Add creatures for combat testing
    (gameState.players[0] as any).battlefield.push({
      id: 'creature1',
      controller: 'player1',
      owner: 'player1',
      tapped: false,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    });
    (gameState.players[1] as any).battlefield.push({
      id: 'creature2',
      controller: 'player2',
      owner: 'player2',
      tapped: false,
      card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' },
    });
    gameState.step = 'DECLARE_ATTACKERS';
    gameStates = new Map([['test-game', gameState]]);
    context = createMockContext(gameStates);
  });

  it('should validate declare attackers in correct step', () => {
    const action = {
      type: 'declareAttackers' as const,
      playerId: 'player1',
      attackers: [{ creatureId: 'creature1', defendingPlayerId: 'player2' }],
    };
    
    const result = validateDeclareAttackers(gameState, action);
    expect(result.legal).toBe(true);
  });

  it('should reject declare attackers in wrong step', () => {
    gameState.step = 'main';
    
    const action = {
      type: 'declareAttackers' as const,
      playerId: 'player1',
      attackers: [{ creatureId: 'creature1', defendingPlayerId: 'player2' }],
    };
    
    const result = validateDeclareAttackers(gameState, action);
    expect(result.legal).toBe(false);
  });

  it('should execute declare attackers and tap creatures', () => {
    const action = {
      type: 'declareAttackers' as const,
      playerId: 'player1',
      attackers: [{ creatureId: 'creature1', defendingPlayerId: 'player2' }],
    };
    
    const result = executeDeclareAttackers('test-game', action, context);
    
    expect(result.next.combat).toBeDefined();
    expect(result.next.combat?.attackers?.length).toBe(1);
  });

  it('should execute combat damage to player', () => {
    const action = {
      type: 'dealCombatDamage' as const,
      playerId: 'player1',
      attackers: [{
        attackerId: 'creature1',
        damage: 2,
        defendingPlayerId: 'player2',
        creature: { name: 'Grizzly Bears', power: 2 },
      }],
    };
    
    const result = executeCombatDamage('test-game', action, context);
    
    const player2 = result.next.players.find(p => p.id === 'player2');
    expect(player2?.life).toBe(38); // 40 - 2 damage
  });

  it('should track commander damage', () => {
    const action = {
      type: 'dealCombatDamage' as const,
      playerId: 'player1',
      attackers: [{
        attackerId: 'creature1',
        damage: 5,
        defendingPlayerId: 'player2',
        creature: { id: 'commander1', name: 'Edgar Markov', power: 5, isCommander: true },
      }],
    };
    
    const result = executeCombatDamage('test-game', action, context);
    
    const player2 = result.next.players.find(p => p.id === 'player2');
    expect(player2?.commanderDamage?.['commander1']).toBe(5);
  });
});

describe('Fetchland Action', () => {
  let gameState: GameState;
  let gameStates: Map<string, GameState>;
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    gameState = createMockGameState();
    gameStates = new Map([['test-game', gameState]]);
    context = createMockContext(gameStates);
  });

  it('should validate fetchland activation', () => {
    const action = {
      type: 'activateFetchland' as const,
      playerId: 'player1',
      sourceId: 'perm1',
    };
    
    const result = validateFetchland(gameState, action);
    expect(result.legal).toBe(true);
  });

  it('should reject already tapped fetchland', () => {
    (gameState.players[0] as any).battlefield[0].tapped = true;
    
    const action = {
      type: 'activateFetchland' as const,
      playerId: 'player1',
      sourceId: 'perm1',
    };
    
    const result = validateFetchland(gameState, action);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('tapped');
  });

  it('should execute fetchland: sacrifice, search, put onto battlefield', () => {
    const action = {
      type: 'activateFetchland' as const,
      playerId: 'player1',
      sourceId: 'perm1',
      searchCriteria: { cardType: 'basic land' },
      tapped: true,
      selectedCardIds: ['card1'],
    };
    
    const result = executeFetchland('test-game', action, context);
    
    const player = result.next.players.find(p => p.id === 'player1');
    
    // Evolving Wilds should be sacrificed
    expect(player?.battlefield?.some((p: any) => p.id === 'perm1')).toBe(false);
    
    // Should have a new land on battlefield
    expect(player?.battlefield?.some((p: any) => p.card?.name === 'Forest')).toBe(true);
    
    // Evolving Wilds should be in graveyard (was sacrificed)
    expect(player?.graveyard?.length).toBe(1);
    
    // Library should have one less card
    expect(player?.library?.length).toBe(2);
  });

  it('should pay life for true fetchlands', () => {
    const action = {
      type: 'activateFetchland' as const,
      playerId: 'player1',
      sourceId: 'perm1',
      payLife: 1,
      searchCriteria: { cardType: 'basic land' },
      tapped: false,
      selectedCardIds: ['card1'],
    };
    
    const result = executeFetchland('test-game', action, context);
    
    const player = result.next.players.find(p => p.id === 'player1');
    expect(player?.life).toBe(39); // 40 - 1 life
  });
});
