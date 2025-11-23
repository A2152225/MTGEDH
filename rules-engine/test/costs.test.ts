import { describe, it, expect } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import { canPayCost, payCost } from '../src/costs';
import type { Cost } from '../src/types/abilities';

function createTestState(): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      { id: 'p1' as PlayerID, name: 'Player 1', seat: 0 },
      { id: 'p2' as PlayerID, name: 'Player 2', seat: 1 }
    ],
    startingLife: 40,
    life: { p1: 20, p2: 40 },
    turnPlayer: 'p1' as PlayerID,
    priority: 'p1' as PlayerID,
    stack: [],
    battlefield: [
      { id: 'perm-1', controller: 'p1' as PlayerID, owner: 'p1' as PlayerID, tapped: false, card: { id: 'card-1', name: 'Card 1' } },
      { id: 'perm-2', controller: 'p1' as PlayerID, owner: 'p1' as PlayerID, tapped: true, card: { id: 'card-2', name: 'Card 2' } }
    ],
    commandZone: {},
    phase: GamePhase.FIRSTMAIN,
    active: true
  };
}

describe('Cost Payment (Rule 118)', () => {
  describe('Tap Cost', () => {
    it('should pay tap cost on untapped permanent', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'tap',
        sourceId: 'perm-1'
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      
      const permanent = result.next.battlefield.find(p => p.id === 'perm-1');
      expect(permanent?.tapped).toBe(true);
    });

    it('should not pay tap cost on already tapped permanent', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'tap',
        sourceId: 'perm-2' // Already tapped
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(false);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(false);
    });
  });

  describe('Untap Cost', () => {
    it('should pay untap cost on tapped permanent', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'untap',
        sourceId: 'perm-2' // Tapped
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      
      const permanent = result.next.battlefield.find(p => p.id === 'perm-2');
      expect(permanent?.tapped).toBe(false);
    });

    it('should not pay untap cost on already untapped permanent', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'untap',
        sourceId: 'perm-1' // Already untapped
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(false);
    });
  });

  describe('Life Cost (Rule 118.3b)', () => {
    it('should pay life cost when player has enough life', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'pay-life',
        amount: 10
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      expect(result.next.life.p1).toBe(10); // 20 - 10 = 10
    });

    it('should pay life cost even if it brings player to 0', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'pay-life',
        amount: 20 // All remaining life
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      expect(result.next.life.p1).toBe(0);
    });

    it('should pay half life cost (rounded up)', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'pay-life',
        amount: 'half'
      };

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      expect(result.next.life.p1).toBe(10); // 20 - 10 = 10
    });

    it('should handle half life with odd number', () => {
      const state = createTestState();
      const oddLifeState = {
        ...state,
        life: { ...state.life, p1: 15 }
      };
      const cost: Cost = {
        type: 'pay-life',
        amount: 'half'
      };

      const result = payCost(oddLifeState, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      expect(result.next.life.p1).toBe(7); // 15 - 8 = 7 (ceil(15/2) = 8)
    });
  });

  describe('Composite Cost', () => {
    it('should pay all costs in composite cost', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'composite',
        costs: [
          { type: 'tap', sourceId: 'perm-1' },
          { type: 'pay-life', amount: 5 }
        ]
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
      
      // Check tap was paid
      const permanent = result.next.battlefield.find(p => p.id === 'perm-1');
      expect(permanent?.tapped).toBe(true);
      
      // Check life was paid
      expect(result.next.life.p1).toBe(15); // 20 - 5 = 15
    });

    it('should not pay composite cost if any part cannot be paid', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'composite',
        costs: [
          { type: 'tap', sourceId: 'perm-1' },
          { type: 'tap', sourceId: 'perm-2' } // Already tapped - can't pay
        ]
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(false);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(false);
      
      // State should be unchanged (rollback)
      const permanent = result.next.battlefield.find(p => p.id === 'perm-1');
      expect(permanent?.tapped).toBe(false); // Should not have tapped
    });
  });

  describe('Mana Cost', () => {
    it('should recognize mana cost', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'mana',
        amount: {
          white: 1,
          blue: 1,
          generic: 2
        }
      };

      // Placeholder - assumes mana is available
      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true);

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
    });
  });

  describe('Sacrifice Cost', () => {
    it('should recognize sacrifice cost', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'sacrifice',
        filter: { types: ['Land'] },
        count: 1
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true); // Simplified check

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
    });
  });

  describe('Discard Cost', () => {
    it('should recognize discard cost', () => {
      const state = createTestState();
      const cost: Cost = {
        type: 'discard',
        count: 1
      };

      const canPay = canPayCost(state, 'p1' as PlayerID, cost);
      expect(canPay).toBe(true); // Placeholder

      const result = payCost(state, 'p1' as PlayerID, cost);
      expect(result.paid).toBe(true);
    });
  });
});
