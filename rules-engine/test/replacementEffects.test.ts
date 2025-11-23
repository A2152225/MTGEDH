import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import {
  applyReplacementEffects,
  createEntersTappedEffect,
  createEntersWithCountersEffect,
  wouldEnterTapped
} from '../src/replacementEffects';
import type {
  ReplacementEffect,
  EnterBattlefieldEvent
} from '../src/types/replacementEffects';

function createTestState(): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      { id: 'p1', name: 'Player 1', seat: 0 },
      { id: 'p2', name: 'Player 2', seat: 1 }
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: GamePhase.FIRSTMAIN,
    active: true
  };
}

describe('Replacement Effects (Rule 614)', () => {
  describe('Enters-the-Battlefield Tapped (Rule 614.12)', () => {
    it('should modify permanent to enter tapped', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'land-1',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      const effect = createEntersTappedEffect('source-1', 'land-1', 0);
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(true);
      expect(result.event.tapped).toBe(true);
      expect(result.log).toBeDefined();
      expect(result.log?.[0]).toContain('enters the battlefield tapped');
    });

    it('should not modify unrelated permanents', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'land-2',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      // Effect targets land-1, not land-2
      const effect = createEntersTappedEffect('source-1', 'land-1', 0);
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(false);
      expect(result.event.tapped).toBe(false);
    });

    it('should check if permanent would enter tapped', () => {
      const state = createTestState();
      const effect = createEntersTappedEffect('source-1', 'land-1', 0);
      const effects: ReplacementEffect[] = [effect];

      const wouldBeTapped = wouldEnterTapped(state, 'land-1', effects);
      expect(wouldBeTapped).toBe(true);

      const wouldNotBeTapped = wouldEnterTapped(state, 'land-2', effects);
      expect(wouldNotBeTapped).toBe(false);
    });
  });

  describe('Enters-the-Battlefield with Counters (Rule 614.1c)', () => {
    it('should add counters when permanent enters', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'creature-1',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      const effect = createEntersWithCountersEffect('source-1', 'creature-1', '+1/+1', 2, 0);
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(true);
      expect(result.event.counters.get('+1/+1')).toBe(2);
      expect(result.log?.[0]).toContain('enters with 2 +1/+1 counter(s)');
    });

    it('should add counters to existing counters', () => {
      const existingCounters = new Map<string, number>();
      existingCounters.set('+1/+1', 1);

      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'creature-1',
        controller: 'p1',
        tapped: false,
        counters: existingCounters,
        timestamp: Date.now()
      };

      const effect = createEntersWithCountersEffect('source-1', 'creature-1', '+1/+1', 2, 0);
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(true);
      expect(result.event.counters.get('+1/+1')).toBe(3); // 1 + 2
    });

    it('should handle different counter types', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'artifact-1',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      const effect = createEntersWithCountersEffect('source-1', 'artifact-1', 'charge', 3, 0);
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(true);
      expect(result.event.counters.get('charge')).toBe(3);
    });
  });

  describe('Multiple Replacement Effects (Rule 616)', () => {
    it('should apply multiple replacement effects in layer order', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'creature-1',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      const effects: ReplacementEffect[] = [
        createEntersTappedEffect('source-1', 'creature-1', 1),
        createEntersWithCountersEffect('source-2', 'creature-1', '+1/+1', 1, 0)
      ];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(true);
      expect(result.event.tapped).toBe(true);
      expect(result.event.counters.get('+1/+1')).toBe(1);
      expect(result.log).toBeDefined();
      expect(result.log?.length).toBeGreaterThan(0);
    });
  });

  describe('Rule 614.5: Replacement effect doesn\'t invoke itself repeatedly', () => {
    it('should apply replacement effect only once', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'permanent-1',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      const effect = createEntersWithCountersEffect('source-1', 'permanent-1', '+1/+1', 2, 0);
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      // Effect should apply once, adding 2 counters
      expect(result.event.counters.get('+1/+1')).toBe(2);
      // Not 4 (which would be if it applied twice)
    });
  });

  describe('Used-up effects', () => {
    it('should not apply used-up replacement effects', () => {
      const event: EnterBattlefieldEvent = {
        id: 'event-1',
        type: 'enter-battlefield',
        permanentId: 'permanent-1',
        controller: 'p1',
        tapped: false,
        counters: new Map(),
        timestamp: Date.now()
      };

      const effect: ReplacementEffect = {
        ...createEntersTappedEffect('source-1', 'permanent-1', 0),
        usedUp: true
      };
      const effects: ReplacementEffect[] = [effect];

      const result = applyReplacementEffects(createTestState(), event, effects);

      expect(result.modified).toBe(false);
      expect(result.event.tapped).toBe(false);
    });
  });
});
