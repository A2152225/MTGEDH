/**
 * Test suite for modular action handlers
 * Tests sacrifice, search library, combat, and fetchland actions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../shared/src';
import { GameStep } from '../../shared/src';
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
  // Combat validation helpers
  isCurrentlyCreature,
  hasDefender,
  hasHaste,
  canPermanentAttack,
  canPermanentBlock,
  getLegalAttackers,
  getLegalBlockers,
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
        graveyard: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ],
    startingLife: 40,
    life: { player1: 40, player2: 40 },
    turnPlayer: 'player1',
    priority: 'player1',
    stack: [],
    // Centralized battlefield (current architecture)
    battlefield: [
      { id: 'perm1', controller: 'player1', owner: 'player1', tapped: false, card: { name: 'Evolving Wilds', type_line: 'Land' } },
      { id: 'perm2', controller: 'player1', owner: 'player1', tapped: false, card: { name: 'Mountain', type_line: 'Basic Land — Mountain' } },
      { id: 'perm3', controller: 'player2', owner: 'player2', tapped: false, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
    ],
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
    // Check centralized battlefield (current architecture)
    expect(result.next.battlefield?.length).toBe(2); // 3 permanents - 1 sacrificed = 2
    const player = result.next.players.find(p => p.id === 'player1');
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
    
    // Check centralized battlefield (3 original + 1 new = 4)
    expect(result.next.battlefield?.length).toBe(4);
    const player = result.next.players.find(p => p.id === 'player1');
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
    
    // Check centralized battlefield for the new permanent
    const newPermanent = result.next.battlefield?.find((p: any) => p.card?.name === 'Forest');
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
    // Add creatures for combat testing to centralized battlefield
    gameState.battlefield.push({
      id: 'creature1',
      controller: 'player1',
      owner: 'player1',
      tapped: false,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    });
    gameState.battlefield.push({
      id: 'creature2',
      controller: 'player2',
      owner: 'player2',
      tapped: false,
      card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' },
    });
    gameState.step = GameStep.DECLARE_ATTACKERS;
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
    gameState.step = GameStep.MAIN1;
    
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
    // Set the fetchland to tapped in centralized battlefield
    const fetchland = gameState.battlefield.find(p => p.id === 'perm1');
    if (fetchland) {
      (fetchland as any).tapped = true;
    }
    
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
    
    // Evolving Wilds should be sacrificed from centralized battlefield
    expect(result.next.battlefield?.some((p: any) => p.id === 'perm1')).toBe(false);
    
    // Should have a new land on centralized battlefield (3 original - 1 sacrificed + 1 new = 3)
    expect(result.next.battlefield?.some((p: any) => p.card?.name === 'Forest')).toBe(true);
    
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

describe('Combat Validation Helpers', () => {
  describe('isCurrentlyCreature', () => {
    it('should return true for permanents with Creature type line', () => {
      const creature = {
        id: 'c1',
        card: { type_line: 'Creature — Bear' },
      };
      expect(isCurrentlyCreature(creature)).toBe(true);
    });

    it('should return false for enchantments', () => {
      const enchantment = {
        id: 'e1',
        card: { type_line: 'Enchantment' },
      };
      expect(isCurrentlyCreature(enchantment)).toBe(false);
    });

    it('should return false for artifacts without creature type', () => {
      const artifact = {
        id: 'a1',
        card: { type_line: 'Artifact' },
      };
      expect(isCurrentlyCreature(artifact)).toBe(false);
    });

    it('should return true for artifact creatures', () => {
      const artifactCreature = {
        id: 'ac1',
        card: { type_line: 'Artifact Creature — Golem' },
      };
      expect(isCurrentlyCreature(artifactCreature)).toBe(true);
    });

    it('should return false for lands without animation', () => {
      const land = {
        id: 'l1',
        card: { type_line: 'Land' },
      };
      expect(isCurrentlyCreature(land)).toBe(false);
    });

    it('should return true for permanents with Creature in types array', () => {
      const animated = {
        id: 'a1',
        types: ['Artifact', 'Creature'],
        card: { type_line: 'Artifact' },
      };
      expect(isCurrentlyCreature(animated)).toBe(true);
    });

    it('should return false when type removal modifier removes creature type', () => {
      const transformed = {
        id: 't1',
        card: { type_line: 'Creature — Horror' },
        modifiers: [
          { type: 'typeChange', removesTypes: ['Creature'] },
        ],
      };
      expect(isCurrentlyCreature(transformed)).toBe(false);
    });

    it('should return false for vehicles that have not been crewed', () => {
      const vehicle = {
        id: 'v1',
        card: { type_line: 'Artifact — Vehicle', oracle_text: 'Crew 3' },
      };
      expect(isCurrentlyCreature(vehicle)).toBe(false);
    });

    it('should return true for vehicles that have been crewed', () => {
      const crewedVehicle = {
        id: 'v1',
        card: { type_line: 'Artifact — Vehicle', oracle_text: 'Crew 3' },
        crewed: true,
      };
      expect(isCurrentlyCreature(crewedVehicle)).toBe(true);
    });

    it('should return false for spacecraft that have not been stationed', () => {
      const spacecraft = {
        id: 's1',
        card: { type_line: 'Artifact — Spacecraft', oracle_text: 'Station 4' },
      };
      expect(isCurrentlyCreature(spacecraft)).toBe(false);
    });

    it('should return true for spacecraft that have been stationed', () => {
      const stationedSpacecraft = {
        id: 's1',
        card: { type_line: 'Artifact — Spacecraft', oracle_text: 'Station 4' },
        stationed: true,
      };
      expect(isCurrentlyCreature(stationedSpacecraft)).toBe(true);
    });

    it('should return false for bestow creatures attached as auras', () => {
      const bestowAsAura = {
        id: 'b1',
        card: { type_line: 'Enchantment Creature — Spirit', oracle_text: 'Bestow {3}{W}{W}' },
        attachedTo: 'creature1',
      };
      expect(isCurrentlyCreature(bestowAsAura)).toBe(false);
    });

    it('should return true for bestow creatures not attached (standalone)', () => {
      const bestowCreature = {
        id: 'b1',
        card: { type_line: 'Enchantment Creature — Spirit', oracle_text: 'Bestow {3}{W}{W}' },
      };
      expect(isCurrentlyCreature(bestowCreature)).toBe(true);
    });

    it('should return true for animated artifacts (Tezzeret effect)', () => {
      const animatedArtifact = {
        id: 'a1',
        card: { type_line: 'Artifact' },
        isCreature: true,
      };
      expect(isCurrentlyCreature(animatedArtifact)).toBe(true);
    });

    it('should return true for permanents with animation modifier', () => {
      const animatedByTezzeret = {
        id: 'a1',
        card: { type_line: 'Artifact' },
        modifiers: [
          { type: 'animation', active: true },
        ],
      };
      expect(isCurrentlyCreature(animatedByTezzeret)).toBe(true);
    });

    it('should return false for creatures affected by Imprisoned in the Moon', () => {
      const imprisoned = {
        id: 'c1',
        card: { type_line: 'Creature — Angel' },
        modifiers: [
          { type: 'imprisonedInTheMoon', newTypeLine: 'Land' },
        ],
      };
      expect(isCurrentlyCreature(imprisoned)).toBe(false);
    });
  });

  describe('hasDefender', () => {
    it('should return true for creatures with defender keyword', () => {
      const wall = {
        id: 'w1',
        card: { oracle_text: 'Defender' },
      };
      expect(hasDefender(wall)).toBe(true);
    });

    it('should return false for regular creatures', () => {
      const bear = {
        id: 'b1',
        card: { oracle_text: '' },
      };
      expect(hasDefender(bear)).toBe(false);
    });

    it('should return true for creatures with granted defender', () => {
      const creature = {
        id: 'c1',
        grantedAbilities: ['defender'],
        card: { oracle_text: '' },
      };
      expect(hasDefender(creature)).toBe(true);
    });
  });

  describe('hasHaste', () => {
    it('should return true for creatures with haste keyword', () => {
      const hasty = {
        id: 'h1',
        card: { oracle_text: 'Haste' },
      };
      expect(hasHaste(hasty)).toBe(true);
    });

    it('should return false for regular creatures', () => {
      const slow = {
        id: 's1',
        card: { oracle_text: '' },
      };
      expect(hasHaste(slow)).toBe(false);
    });

    it('should return true for creatures with granted haste', () => {
      const creature = {
        id: 'c1',
        grantedAbilities: ['haste'],
        card: { oracle_text: '' },
      };
      expect(hasHaste(creature)).toBe(true);
    });
  });

  describe('canPermanentAttack', () => {
    it('should allow untapped creatures to attack', () => {
      const creature = {
        id: 'c1',
        tapped: false,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
      };
      const result = canPermanentAttack(creature);
      expect(result.canParticipate).toBe(true);
    });

    it('should reject tapped creatures', () => {
      const creature = {
        id: 'c1',
        tapped: true,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
      };
      const result = canPermanentAttack(creature);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('tapped');
    });

    it('should reject non-creatures (enchantments)', () => {
      const enchantment = {
        id: 'e1',
        tapped: false,
        card: { type_line: 'Enchantment', oracle_text: '' },
      };
      const result = canPermanentAttack(enchantment);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('Only creatures can attack');
    });

    it('should reject creatures with defender', () => {
      const wall = {
        id: 'w1',
        tapped: false,
        card: { type_line: 'Creature — Wall', oracle_text: 'Defender' },
      };
      const result = canPermanentAttack(wall);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('defender');
    });

    it('should reject creatures with summoning sickness without haste', () => {
      const sick = {
        id: 's1',
        tapped: false,
        summoningSickness: true,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
      };
      const result = canPermanentAttack(sick);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('summoning sickness');
    });

    it('should allow creatures with summoning sickness if they have haste', () => {
      const hasty = {
        id: 'h1',
        tapped: false,
        summoningSickness: true,
        card: { type_line: 'Creature — Goblin', oracle_text: 'Haste' },
      };
      const result = canPermanentAttack(hasty);
      expect(result.canParticipate).toBe(true);
    });

    it('should reject creatures with cantAttack modifier', () => {
      const pacified = {
        id: 'p1',
        tapped: false,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
        modifiers: [{ type: 'cantAttack', reason: 'Pacifism' }],
      };
      const result = canPermanentAttack(pacified);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('Pacifism');
    });
  });

  describe('canPermanentBlock', () => {
    it('should allow untapped creatures to block', () => {
      const creature = {
        id: 'c1',
        tapped: false,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
      };
      const result = canPermanentBlock(creature);
      expect(result.canParticipate).toBe(true);
    });

    it('should reject tapped creatures', () => {
      const creature = {
        id: 'c1',
        tapped: true,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
      };
      const result = canPermanentBlock(creature);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('tapped');
    });

    it('should reject non-creatures', () => {
      const artifact = {
        id: 'a1',
        tapped: false,
        card: { type_line: 'Artifact', oracle_text: '' },
      };
      const result = canPermanentBlock(artifact);
      expect(result.canParticipate).toBe(false);
      expect(result.reason).toContain('Only creatures can block');
    });

    it('should reject creatures with cantBlock modifier', () => {
      const goaded = {
        id: 'g1',
        tapped: false,
        card: { type_line: 'Creature — Bear', oracle_text: '' },
        modifiers: [{ type: 'cantBlock', reason: 'Goaded' }],
      };
      const result = canPermanentBlock(goaded);
      expect(result.canParticipate).toBe(false);
    });
  });

  describe('getLegalAttackers', () => {
    it('should return only legal attackers from battlefield', () => {
      const gameState = {
        players: [
          {
            id: 'player1',
          },
        ],
        // Use centralized battlefield
        battlefield: [
          { id: 'c1', controller: 'player1', tapped: false, card: { type_line: 'Creature — Bear', oracle_text: '' } },
          { id: 'c2', controller: 'player1', tapped: true, card: { type_line: 'Creature — Bear', oracle_text: '' } },
          { id: 'e1', controller: 'player1', tapped: false, card: { type_line: 'Enchantment', oracle_text: '' } },
          { id: 'c3', controller: 'player1', tapped: false, card: { type_line: 'Creature — Wall', oracle_text: 'Defender' } },
        ],
      } as unknown as GameState;

      const attackers = getLegalAttackers(gameState, 'player1');
      expect(attackers).toEqual(['c1']); // Only the untapped creature without defender
    });

    it('should exclude creatures with summoning sickness unless they have haste', () => {
      const gameState = {
        players: [
          {
            id: 'player1',
          },
        ],
        // Use centralized battlefield
        battlefield: [
          { id: 'c1', controller: 'player1', tapped: false, summoningSickness: true, card: { type_line: 'Creature — Bear', oracle_text: '' } },
          { id: 'c2', controller: 'player1', tapped: false, summoningSickness: true, card: { type_line: 'Creature — Goblin', oracle_text: 'Haste' } },
        ],
      } as unknown as GameState;

      const attackers = getLegalAttackers(gameState, 'player1');
      expect(attackers).toEqual(['c2']); // Only the creature with haste
    });
  });

  describe('getLegalBlockers', () => {
    it('should return only legal blockers from battlefield', () => {
      const gameState = {
        players: [
          {
            id: 'player1',
          },
        ],
        // Use centralized battlefield
        battlefield: [
          { id: 'c1', controller: 'player1', tapped: false, card: { type_line: 'Creature — Bear', oracle_text: '' } },
          { id: 'c2', controller: 'player1', tapped: true, card: { type_line: 'Creature — Bear', oracle_text: '' } },
          { id: 'e1', controller: 'player1', tapped: false, card: { type_line: 'Enchantment', oracle_text: '' } },
        ],
      } as unknown as GameState;

      const blockers = getLegalBlockers(gameState, 'player1');
      expect(blockers).toEqual(['c1']); // Only the untapped creature
    });
  });
});

describe('Combat Validation in Actions', () => {
  let gameState: GameState;

  beforeEach(() => {
    gameState = {
      id: 'test-game',
      format: 'commander',
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          seat: 0,
          life: 40,
          battlefield: [],
        },
        {
          id: 'player2',
          name: 'Player 2',
          seat: 1,
          life: 40,
          battlefield: [],
        },
      ],
      startingLife: 40,
      life: { player1: 40, player2: 40 },
      turnPlayer: 'player1',
      priority: 'player1',
      stack: [],
      battlefield: [],
      commandZone: {},
      phase: 'combat' as any,
      step: 'DECLARE_ATTACKERS',
      active: true,
      turnOrder: ['player1', 'player2'],
      activePlayerIndex: 0,
    } as any;
  });

  it('should reject attacking with an enchantment (Cryptolith Rite case)', () => {
    // Add to centralized battlefield
    gameState.battlefield.push({
      id: 'enchantment1',
      controller: 'player1',
      owner: 'player1',
      tapped: false,
      card: { name: 'Cryptolith Rite', type_line: 'Enchantment', oracle_text: '' },
    });

    const action = {
      type: 'declareAttackers' as const,
      playerId: 'player1',
      attackers: [{ creatureId: 'enchantment1', defendingPlayerId: 'player2' }],
    };

    const result = validateDeclareAttackers(gameState, action);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('Only creatures can attack');
  });

  it('should reject attacking with a creature that has summoning sickness', () => {
    // Add to centralized battlefield
    gameState.battlefield.push({
      id: 'creature1',
      controller: 'player1',
      owner: 'player1',
      tapped: false,
      summoningSickness: true,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    });

    const action = {
      type: 'declareAttackers' as const,
      playerId: 'player1',
      attackers: [{ creatureId: 'creature1', defendingPlayerId: 'player2' }],
    };

    const result = validateDeclareAttackers(gameState, action);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('summoning sickness');
  });

  it('should allow attacking with a creature with haste even with summoning sickness', () => {
    // Add to centralized battlefield
    gameState.battlefield.push({
      id: 'creature1',
      controller: 'player1',
      owner: 'player1',
      tapped: false,
      summoningSickness: true,
      card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', oracle_text: 'Haste' },
    });

    const action = {
      type: 'declareAttackers' as const,
      playerId: 'player1',
      attackers: [{ creatureId: 'creature1', defendingPlayerId: 'player2' }],
    };

    const result = validateDeclareAttackers(gameState, action);
    expect(result.legal).toBe(true);
  });

  it('should reject blocking with a non-creature permanent', () => {
    gameState.step = GameStep.DECLARE_BLOCKERS;
    
    // Add an attacker
    (gameState as any).combat = {
      attackers: [{ cardId: 'attacker1', defendingPlayerId: 'player2' }],
      blockers: [],
    };

    // Add to centralized battlefield
    gameState.battlefield.push({
      id: 'artifact1',
      controller: 'player2',
      owner: 'player2',
      tapped: false,
      card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    });

    const action = {
      type: 'declareBlockers' as const,
      playerId: 'player2',
      blockers: [{ blockerId: 'artifact1', attackerId: 'attacker1' }],
    };

    const result = validateDeclareBlockers(gameState, action);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('Only creatures can block');
  });
});
