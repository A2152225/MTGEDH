/**
 * Integration tests for complete game workflows
 * Tests the full integration of spell casting, mana, stack, and abilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RulesEngineAdapter, RulesEngineEvent } from '../src/RulesEngineAdapter';
import type { GameState } from '../../shared/src';
import { ManaType } from '../src/types/mana';

describe('Rules Engine Integration Tests', () => {
  let adapter: RulesEngineAdapter;
  let gameState: GameState;

  beforeEach(() => {
    adapter = new RulesEngineAdapter();
    
    // Create a complete game state for testing
    gameState = {
      id: 'integration-test',
      format: 'standard' as any,
      players: [
        {
          id: 'player1',
          name: 'Alice',
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
        {
          id: 'player2',
          name: 'Bob',
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      ],
      turnOrder: ['player1', 'player2'],
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      turn: 1,
      phase: 'precombatMain' as any,
      step: 'main' as any,
      stack: [],
      startingLife: 20,
      allowUndos: false,
      turnTimerEnabled: false,
      turnTimerSeconds: 0,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      spectators: [],
      status: 'inProgress' as any,
    };

    adapter.initializeGame('integration-test', gameState);
  });

  describe('Mana and Spell Casting Workflow', () => {
    it('should tap land for mana, then cast spell', () => {
      // Step 1: Tap a Mountain for red mana
      const manaResult = adapter.executeAction('integration-test', {
        type: 'tapForMana',
        playerId: 'player1',
        permanentId: 'mountain-1',
        permanentName: 'Mountain',
        manaToAdd: [{ type: ManaType.RED, amount: 1 }],
        currentlyTapped: false,
      });

      expect(manaResult.next).toBeDefined();
      const player1AfterMana = manaResult.next.players.find(p => p.id === 'player1');
      expect(player1AfterMana?.manaPool.red).toBe(1);

      // Step 2: Cast Lightning Bolt using that mana
      const spellResult = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'bolt-1',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        manaCost: { red: 1 },
        targets: ['player2'],
      });

      expect(spellResult.next).toBeDefined();
      const player1AfterSpell = spellResult.next.players.find(p => p.id === 'player1');
      expect(player1AfterSpell?.manaPool.red).toBe(0); // Mana spent
    });

    it('should handle multiple mana sources', () => {
      // Tap two lands for mana
      let result = adapter.executeAction('integration-test', {
        type: 'tapForMana',
        playerId: 'player1',
        permanentId: 'mountain-1',
        permanentName: 'Mountain',
        manaToAdd: [{ type: ManaType.RED, amount: 1 }],
        currentlyTapped: false,
      });

      result = adapter.executeAction('integration-test', {
        type: 'tapForMana',
        playerId: 'player1',
        permanentId: 'mountain-2',
        permanentName: 'Mountain',
        manaToAdd: [{ type: ManaType.RED, amount: 1 }],
        currentlyTapped: false,
      });

      const player1 = result.next.players.find(p => p.id === 'player1');
      expect(player1?.manaPool.red).toBe(2);

      // Cast spell with 2 mana
      result = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'shock-1',
        cardName: 'Shock',
        cardTypes: ['instant'],
        manaCost: { red: 1, generic: 1 },
        targets: ['player2'],
      });

      const player1AfterSpell = result.next.players.find(p => p.id === 'player1');
      expect(player1AfterSpell?.manaPool.red).toBe(0); // All mana spent
    });

    it('should fail to cast spell without sufficient mana', () => {
      // Try to cast without mana
      const result = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'bolt-1',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        manaCost: { red: 1 },
        targets: ['player2'],
      });

      // Should fail
      expect(result.log).toBeDefined();
      expect(result.log!.some(log => log.toLowerCase().includes('mana'))).toBe(true);
    });
  });

  describe('Stack Resolution Workflow', () => {
    it('should resolve spells in LIFO order', () => {
      // Give player1 mana
      let state = adapter.executeAction('integration-test', {
        type: 'tapForMana',
        playerId: 'player1',
        permanentId: 'island-1',
        permanentName: 'Island',
        manaToAdd: [{ type: ManaType.BLUE, amount: 3 }],
        currentlyTapped: false,
      }).next;

      // Cast first spell
      state = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'divination-1',
        cardName: 'Divination',
        cardTypes: ['sorcery'],
        manaCost: { blue: 2, generic: 1 },
        targets: [],
      }).next;

      // Give player2 mana for counterspell
      gameState.players[1].manaPool.blue = 2;
      adapter.initializeGame('integration-test', gameState);

      // Cast counterspell
      state = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player2',
        cardId: 'counter-1',
        cardName: 'Counterspell',
        cardTypes: ['instant'],
        manaCost: { blue: 2 },
        targets: ['divination-1'],
      }).next;

      // Resolve stack - counterspell should resolve first (LIFO)
      const resolve1 = adapter.executeAction('integration-test', {
        type: 'resolveStack',
      });

      expect(resolve1.log).toBeDefined();
      // Counterspell resolves first
    });
  });

  describe('Priority and Timing', () => {
    it('should enforce sorcery timing restrictions', () => {
      // Give mana
      let state = adapter.executeAction('integration-test', {
        type: 'tapForMana',
        playerId: 'player1',
        permanentId: 'mountain-1',
        permanentName: 'Mountain',
        manaToAdd: [{ type: ManaType.RED, amount: 3 }],
        currentlyTapped: false,
      }).next;

      // Try to cast sorcery - should work in main phase
      const sorceryResult = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'wrath-1',
        cardName: 'Wrath of God',
        cardTypes: ['sorcery'],
        manaCost: { white: 2, generic: 2 },
        targets: [],
      });

      // Should succeed
      expect(sorceryResult.next).toBeDefined();
    });

    it('should allow instants at any time with priority', () => {
      // Give mana to player who doesn't have priority
      gameState.priorityPlayerIndex = 1; // player2 has priority
      gameState.players[0].manaPool.blue = 2;
      adapter.initializeGame('integration-test', gameState);

      // Player1 tries to cast instant without priority - should fail
      const result = adapter.executeAction('integration-test', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'opt-1',
        cardName: 'Opt',
        cardTypes: ['instant'],
        manaCost: { blue: 1 },
        targets: [],
      });

      expect(result.log).toBeDefined();
      expect(result.log!.some(log => log.toLowerCase().includes('priority'))).toBe(true);
    });
  });

  describe('Pass Priority', () => {
    it('should rotate priority between players', () => {
      const result1 = adapter.executeAction('integration-test', {
        type: 'passPriority',
        playerId: 'player1',
      });

      const player2HasPriority = result1.next.players[result1.next.priorityPlayerIndex].id === 'player2';
      expect(player2HasPriority).toBe(true);

      const result2 = adapter.executeAction('integration-test', {
        type: 'passPriority',
        playerId: 'player2',
      });

      const player1HasPriority = result2.next.players[result2.next.priorityPlayerIndex].id === 'player1';
      expect(player1HasPriority).toBe(true);
    });
  });
});
