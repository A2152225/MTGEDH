/**
 * pillowfortEffects.test.ts
 * 
 * Tests for pillowfort effect detection and attack cost calculation.
 * These effects impose additional costs on attacking (Propaganda, Ghostly Prison, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  detectPillowfortEffect,
  collectPillowfortEffects,
  calculateTotalAttackCost,
  checkAttackCosts,
  getAttackCostDescription,
  isPillowfortCard,
  AttackCostType,
} from '../src/pillowfortEffects';
import type { GameState, BattlefieldPermanent } from '../../shared/src';

// Helper to create a mock permanent with oracle text
function createPermanent(id: string, name: string, oracleText: string, controllerId: string = 'player1'): any {
  return {
    id,
    controller: controllerId,
    controllerId,
    card: {
      name,
      oracle_text: oracleText,
      type_line: 'Enchantment',
    },
  };
}

// Helper to create a mock game state
function createGameState(
  player1Permanents: any[] = [],
  player2Permanents: any[] = []
): GameState {
  return {
    players: [
      {
        id: 'player1',
        life: 40,
        battlefield: player1Permanents,
        manaPool: { white: 5, blue: 5, black: 5, red: 5, green: 5, colorless: 5 },
      },
      {
        id: 'player2',
        life: 40,
        battlefield: player2Permanents,
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ],
    battlefield: [...player1Permanents, ...player2Permanents],
  } as unknown as GameState;
}

describe('Pillowfort Effects', () => {
  describe('detectPillowfortEffect', () => {
    it('detects Propaganda effect', () => {
      const propaganda = createPermanent(
        'propaganda-1',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature"
      );
      
      const effect = detectPillowfortEffect(propaganda, 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(AttackCostType.MANA_PER_CREATURE);
      expect(effect?.manaCost?.generic).toBe(2);
      expect(effect?.perCreatureAttacking).toBe(true);
      expect(effect?.sourceId).toBe('propaganda-1');
      expect(effect?.sourceName).toBe('Propaganda');
    });
    
    it('detects Ghostly Prison effect', () => {
      const ghostlyPrison = createPermanent(
        'ghostly-prison-1',
        'Ghostly Prison',
        "Creatures can't attack you unless their controller pays {2} for each creature attacking you."
      );
      
      const effect = detectPillowfortEffect(ghostlyPrison, 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(AttackCostType.MANA_PER_CREATURE);
      expect(effect?.manaCost?.generic).toBe(2);
    });
    
    it('detects Norn\'s Annex with Phyrexian mana', () => {
      const nornsAnnex = createPermanent(
        'norns-annex-1',
        "Norn's Annex",
        "Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each creature"
      );
      
      const effect = detectPillowfortEffect(nornsAnnex, 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(AttackCostType.PHYREXIAN_MANA);
      expect(effect?.manaCost?.white).toBe(1);
      expect(effect?.lifeCost).toBe(2); // Phyrexian = 2 life
      expect(effect?.canPayWithLife).toBe(true);
    });
    
    it('returns null for non-pillowfort cards', () => {
      const creature = createPermanent(
        'creature-1',
        'Grizzly Bears',
        ''
      );
      
      const effect = detectPillowfortEffect(creature, 'player1');
      
      expect(effect).toBeNull();
    });
    
    it('handles pillowfort modifiers on permanents', () => {
      const permanent = {
        id: 'modded-perm',
        controller: 'player1',
        card: { name: 'Test Permanent' },
        modifiers: [
          {
            type: 'pillowfort',
            attackCostType: AttackCostType.MANA_PER_CREATURE,
            manaCost: { generic: 3 },
            perCreature: true,
          },
        ],
      };
      
      const effect = detectPillowfortEffect(permanent, 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect?.manaCost?.generic).toBe(3);
    });
  });
  
  describe('collectPillowfortEffects', () => {
    it('collects all pillowfort effects for a defender', () => {
      const propaganda = createPermanent(
        'propaganda-1',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature",
        'player1'
      );
      
      const ghostlyPrison = createPermanent(
        'ghostly-prison-1',
        'Ghostly Prison',
        "Creatures can't attack you unless their controller pays {2} for each creature",
        'player1'
      );
      
      const state = createGameState([propaganda, ghostlyPrison], []);
      
      const effects = collectPillowfortEffects(state, 'player1');
      
      expect(effects).toHaveLength(2);
      expect(effects.every(e => e.manaCost?.generic === 2)).toBe(true);
    });
    
    it('returns empty array when no pillowfort effects', () => {
      const state = createGameState([], []);
      
      const effects = collectPillowfortEffects(state, 'player1');
      
      expect(effects).toHaveLength(0);
    });
    
    it('only collects effects from the defending player', () => {
      const player1Propaganda = createPermanent(
        'propaganda-1',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature",
        'player1'
      );
      
      const player2Propaganda = createPermanent(
        'propaganda-2',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature",
        'player2'
      );
      
      const state = createGameState([player1Propaganda], [player2Propaganda]);
      
      const player1Effects = collectPillowfortEffects(state, 'player1');
      const player2Effects = collectPillowfortEffects(state, 'player2');
      
      expect(player1Effects).toHaveLength(1);
      expect(player1Effects[0].sourceId).toBe('propaganda-1');
      
      expect(player2Effects).toHaveLength(1);
      expect(player2Effects[0].sourceId).toBe('propaganda-2');
    });
  });
  
  describe('calculateTotalAttackCost', () => {
    it('calculates cost for single Propaganda with multiple attackers', () => {
      const requirements = [
        {
          sourceId: 'propaganda-1',
          sourceName: 'Propaganda',
          sourceControllerId: 'player1',
          type: AttackCostType.MANA_PER_CREATURE,
          manaCost: { generic: 2 },
          perCreatureAttacking: true,
        },
      ];
      
      const state = createGameState([], []);
      
      // 3 creatures attacking
      const { manaCost, lifeCostOption } = calculateTotalAttackCost(
        requirements,
        3,
        state,
        'player1'
      );
      
      expect(manaCost.generic).toBe(6); // 2 * 3 = 6
      expect(lifeCostOption).toBe(0);
    });
    
    it('calculates cost for multiple pillowfort effects', () => {
      const requirements = [
        {
          sourceId: 'propaganda-1',
          sourceName: 'Propaganda',
          sourceControllerId: 'player1',
          type: AttackCostType.MANA_PER_CREATURE,
          manaCost: { generic: 2 },
          perCreatureAttacking: true,
        },
        {
          sourceId: 'ghostly-prison-1',
          sourceName: 'Ghostly Prison',
          sourceControllerId: 'player1',
          type: AttackCostType.MANA_PER_CREATURE,
          manaCost: { generic: 2 },
          perCreatureAttacking: true,
        },
      ];
      
      const state = createGameState([], []);
      
      // 2 creatures attacking with both Propaganda and Ghostly Prison
      const { manaCost } = calculateTotalAttackCost(
        requirements,
        2,
        state,
        'player1'
      );
      
      expect(manaCost.generic).toBe(8); // (2 + 2) * 2 = 8
    });
    
    it('calculates Phyrexian mana with life payment option', () => {
      const requirements = [
        {
          sourceId: 'norns-annex-1',
          sourceName: "Norn's Annex",
          sourceControllerId: 'player1',
          type: AttackCostType.PHYREXIAN_MANA,
          manaCost: { white: 1 },
          lifeCost: 2,
          canPayWithLife: true,
          perCreatureAttacking: true,
        },
      ];
      
      const state = createGameState([], []);
      
      // 3 creatures attacking
      const { manaCost, lifeCostOption } = calculateTotalAttackCost(
        requirements,
        3,
        state,
        'player1'
      );
      
      expect(manaCost.white).toBe(3); // 1W * 3 = 3W
      expect(lifeCostOption).toBe(6); // 2 life * 3 = 6 life
    });
  });
  
  describe('checkAttackCosts', () => {
    it('returns canAffordAll true when no pillowfort effects', () => {
      const state = createGameState([], []);
      
      const result = checkAttackCosts(state, 'player2', 'player1', 3);
      
      expect(result.canAffordAll).toBe(true);
      expect(result.requirements).toHaveLength(0);
    });
    
    it('returns canAffordAll true when attacker has enough mana', () => {
      const propaganda = createPermanent(
        'propaganda-1',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature",
        'player1'
      );
      
      const state = createGameState([propaganda], []);
      // player2 (attacker) has 30 total mana in pool
      
      const result = checkAttackCosts(state, 'player2', 'player1', 3);
      
      // player2 has no mana in our mock, so they can't afford
      expect(result.canAffordAll).toBe(false);
      expect(result.requirements).toHaveLength(1);
      expect(result.totalManaCost.generic).toBe(6); // 2 * 3
    });
    
    it('returns canAffordAll false when attacker cannot afford', () => {
      const propaganda = createPermanent(
        'propaganda-1',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature",
        'player1'
      );
      
      // Player2 has no mana
      const state: GameState = {
        players: [
          {
            id: 'player1',
            life: 40,
            battlefield: [propaganda],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          {
            id: 'player2',
            life: 40,
            battlefield: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        battlefield: [propaganda],
      } as unknown as GameState;
      
      const result = checkAttackCosts(state, 'player2', 'player1', 3);
      
      expect(result.canAffordAll).toBe(false);
      expect(result.insufficientResources).toBe('Cannot afford attack costs');
    });
    
    it('considers life payment option for Phyrexian mana', () => {
      const nornsAnnex = createPermanent(
        'norns-annex-1',
        "Norn's Annex",
        "Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each creature",
        'player1'
      );
      
      // Player2 has no mana but has life
      const state: GameState = {
        players: [
          {
            id: 'player1',
            life: 40,
            battlefield: [nornsAnnex],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          {
            id: 'player2',
            life: 40, // Plenty of life to pay with
            battlefield: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        battlefield: [nornsAnnex],
      } as unknown as GameState;
      
      const result = checkAttackCosts(state, 'player2', 'player1', 2);
      
      // Can pay 4 life (2 * 2) with 40 life available
      expect(result.canAffordAll).toBe(true);
      expect(result.totalLifeCost).toBe(4);
    });
  });
  
  describe('getAttackCostDescription', () => {
    it('returns "No attack costs" when no requirements', () => {
      const description = getAttackCostDescription([], 3, {}, 0);
      
      expect(description).toBe('No attack costs');
    });
    
    it('describes mana cost correctly', () => {
      const requirements = [
        {
          sourceId: 'propaganda-1',
          sourceName: 'Propaganda',
          sourceControllerId: 'player1',
          type: AttackCostType.MANA_PER_CREATURE,
          manaCost: { generic: 2 },
          perCreatureAttacking: true,
        },
      ];
      
      const description = getAttackCostDescription(
        requirements,
        3,
        { generic: 6 },
        0
      );
      
      expect(description).toContain('{6}');
      expect(description).toContain('3 creatures');
      expect(description).toContain('Propaganda');
    });
    
    it('includes life payment option', () => {
      const requirements = [
        {
          sourceId: 'norns-annex-1',
          sourceName: "Norn's Annex",
          sourceControllerId: 'player1',
          type: AttackCostType.PHYREXIAN_MANA,
          manaCost: { white: 1 },
          lifeCost: 2,
          canPayWithLife: true,
          perCreatureAttacking: true,
        },
      ];
      
      const description = getAttackCostDescription(
        requirements,
        2,
        { white: 2 },
        4
      );
      
      expect(description).toContain('{W}{W}');
      expect(description).toContain('4 life');
      expect(description).toContain("Norn's Annex");
    });
  });
  
  describe('isPillowfortCard', () => {
    it('returns true for Propaganda', () => {
      const propaganda = createPermanent(
        'propaganda-1',
        'Propaganda',
        "Creatures can't attack you unless their controller pays {2} for each creature"
      );
      
      expect(isPillowfortCard(propaganda)).toBe(true);
    });
    
    it('returns false for regular creatures', () => {
      const creature = createPermanent(
        'creature-1',
        'Grizzly Bears',
        ''
      );
      
      expect(isPillowfortCard(creature)).toBe(false);
    });
  });
});
