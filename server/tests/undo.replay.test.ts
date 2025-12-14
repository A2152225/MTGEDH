/**
 * Test suite for undo functionality
 * Tests that undo properly restores game state including:
 * - RNG state (for deterministic shuffles)
 * - Library order
 * - Hand contents (including mulligan results)
 * - Graveyard contents
 * - Battlefield state
 * - Life totals
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { transformDbEventsForReplay } from '../src/socket/util';
import type { KnownCardRef, PlayerID } from '../../shared/src';

function mkCards(n: number, prefix = 'Card'): Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    name: `${prefix} ${i + 1}`,
    type_line: 'Test',
    oracle_text: ''
  }));
}

function mkLand(id: string, name: string): Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'> {
  return {
    id,
    name,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.'
  };
}

describe('Undo and Replay', () => {
  describe('RNG state restoration after reset+replay', () => {
    it('should produce identical shuffle results after reset and replay', () => {
      const gameId = 'undo_rng_test_1';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);
      const seed = 123456789;

      // Session 1: Play a game with RNG seed, import, shuffle, draw
      const g1 = createInitialGameState(gameId);
      g1.applyEvent({ type: 'rngSeed', seed });
      g1.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      g1.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      
      const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib1 = g1.peekTopN!(p1, 10).map((c: any) => c.name);
      
      console.log('Session 1 - Hand:', hand1);
      console.log('Session 1 - Library (top 10):', lib1);

      // Simulate undo: reset the game and replay the same events
      // This mimics what performUndo does
      g1.reset!(true); // preservePlayers = true
      
      // Replay events
      const replayEvents = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 }
      ];
      g1.replay!(replayEvents);
      
      const hand2 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib2 = g1.peekTopN!(p1, 10).map((c: any) => c.name);
      
      console.log('After reset+replay - Hand:', hand2);
      console.log('After reset+replay - Library (top 10):', lib2);

      // Both should be identical - this is the key test for undo correctness
      expect(hand2).toEqual(hand1);
      expect(lib2).toEqual(lib1);
    });

    it('should produce correct partial state when undoing some actions', () => {
      const gameId = 'undo_partial_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);
      const seed = 987654321;

      // Full game session
      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      game.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      game.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      game.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      
      // Capture state BEFORE additional draws (this is what we want after undo)
      const handBeforeExtraDraw = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const libBeforeExtraDraw = game.peekTopN!(p1, 10).map((c: any) => c.name);
      
      console.log('State before extra draw - Hand:', handBeforeExtraDraw);
      console.log('State before extra draw - Library (top 10):', libBeforeExtraDraw);
      
      // Draw 3 more cards (these are the actions we want to undo)
      game.applyEvent({ type: 'drawCards', playerId: p1, count: 3 });
      
      const handAfterExtraDraw = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      console.log('State after extra draw - Hand:', handAfterExtraDraw);
      expect(handAfterExtraDraw.length).toBe(10); // 7 + 3

      // Now undo by reset + replay without the extra draw
      game.reset!(true);
      
      const partialReplayEvents = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 }
        // Note: No extra drawCards event - we're undoing that
      ];
      game.replay!(partialReplayEvents);
      
      const handAfterUndo = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const libAfterUndo = game.peekTopN!(p1, 10).map((c: any) => c.name);
      
      console.log('State after undo - Hand:', handAfterUndo);
      console.log('State after undo - Library (top 10):', libAfterUndo);

      // After undo, state should match the state before extra draw
      expect(handAfterUndo).toEqual(handBeforeExtraDraw);
      expect(libAfterUndo).toEqual(libBeforeExtraDraw);
      expect(handAfterUndo.length).toBe(7);
    });
  });

  describe('Mulligan state restoration', () => {
    it('should correctly restore mulligan state after undo', () => {
      const gameId = 'undo_mulligan_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(60);
      const seed = 11111111;

      const game = createInitialGameState(gameId);
      
      // Initial setup
      game.applyEvent({ type: 'rngSeed', seed });
      game.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      game.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      game.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      
      // Capture initial hand before mulligan
      const initialHand = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      console.log('Initial hand before mulligan:', initialHand);
      expect(initialHand.length).toBe(7);
      
      // Mulligan
      game.applyEvent({ type: 'mulligan', playerId: p1 });
      
      const handAfterMulligan = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      console.log('Hand after mulligan:', handAfterMulligan);
      expect(handAfterMulligan.length).toBe(7);
      
      // The hands should be different after mulligan (new random draw)
      // Note: There's a small chance they could be the same, but very unlikely with 60 cards
      
      // Now undo the mulligan by reset + replay without the mulligan event
      game.reset!(true);
      
      const eventsWithoutMulligan = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 }
        // No mulligan event
      ];
      game.replay!(eventsWithoutMulligan);
      
      const handAfterUndoMulligan = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      console.log('Hand after undoing mulligan:', handAfterUndoMulligan);
      
      // After undoing mulligan, we should have the original hand back
      expect(handAfterUndoMulligan).toEqual(initialHand);
    });
  });

  describe('Graveyard and battlefield restoration', () => {
    it('should properly clear and restore zones after undo', () => {
      const gameId = 'undo_zones_test';
      const p1 = 'p_test' as PlayerID;
      const deck = [
        mkLand('land_1', 'Forest'),
        ...mkCards(29)
      ];
      const seed = 222222222;

      const game = createInitialGameState(gameId);
      
      // Setup
      game.applyEvent({ type: 'rngSeed', seed });
      game.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      // Don't shuffle to ensure the land is first
      game.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      
      const hand1 = (game.state.zones?.[p1]?.hand ?? []) as any[];
      console.log('Initial hand:', hand1.map((c: any) => c.name));
      
      // Find the land in hand
      const landInHand = hand1.find((c: any) => c.type_line?.toLowerCase().includes('land'));
      expect(landInHand).toBeDefined();
      
      // Play the land (this adds to battlefield)
      game.playLand(p1, landInHand);
      
      const battlefield = (game.state?.battlefield ?? []) as any[];
      console.log('Battlefield after playing land:', battlefield.map((p: any) => p.card?.name));
      expect(battlefield.length).toBe(1);
      
      const handAfterLand = (game.state.zones?.[p1]?.hand ?? []) as any[];
      console.log('Hand after playing land:', handAfterLand.map((c: any) => c.name));
      expect(handAfterLand.length).toBe(6); // One card moved to battlefield
      
      // Now undo by reset + replay without the playLand event
      game.reset!(true);
      
      const eventsWithoutLand = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'drawCards', playerId: p1, count: 7 }
        // No playLand event
      ];
      game.replay!(eventsWithoutLand);
      
      const battlefieldAfterUndo = (game.state?.battlefield ?? []) as any[];
      const handAfterUndo = (game.state.zones?.[p1]?.hand ?? []) as any[];
      
      console.log('Battlefield after undo:', battlefieldAfterUndo.length);
      console.log('Hand after undo:', handAfterUndo.map((c: any) => c.name));
      
      // Battlefield should be empty, hand should have 7 cards again
      expect(battlefieldAfterUndo.length).toBe(0);
      expect(handAfterUndo.length).toBe(7);
      
      // The land should be back in hand
      const landBackInHand = handAfterUndo.find((c: any) => c.type_line?.toLowerCase().includes('land'));
      expect(landBackInHand).toBeDefined();
    });
  });

  describe('DB event format transformation', () => {
    it('should correctly transform DB events for replay', () => {
      const dbEvents = [
        { type: 'rngSeed', payload: { seed: 12345 } },
        { type: 'deckImportResolved', payload: { playerId: 'p1', cards: [{ id: 'c1', name: 'Card 1' }] } },
        { type: 'shuffleLibrary', payload: { playerId: 'p1' } },
        { type: 'drawCards', payload: { playerId: 'p1', count: 7 } },
        { type: 'mulligan', payload: { playerId: 'p1' } }
      ];
      
      const replayEvents = transformDbEventsForReplay(dbEvents);
      
      // Verify transformations
      expect(replayEvents[0]).toEqual({ type: 'rngSeed', seed: 12345 });
      expect(replayEvents[1]).toEqual({ 
        type: 'deckImportResolved', 
        playerId: 'p1', 
        cards: [{ id: 'c1', name: 'Card 1' }] 
      });
      expect(replayEvents[2]).toEqual({ type: 'shuffleLibrary', playerId: 'p1' });
      expect(replayEvents[3]).toEqual({ type: 'drawCards', playerId: 'p1', count: 7 });
      expect(replayEvents[4]).toEqual({ type: 'mulligan', playerId: 'p1' });
    });
  });

  describe('RNG determinism verification', () => {
    it('should produce identical results for the same seed with multiple sequential operations', () => {
      // This test verifies that given the same seed and same sequence of operations,
      // the RNG always produces the same results - critical for undo to work correctly
      const gameId = 'rng_determinism_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(60);
      const seed = 333333333;

      // Run the same sequence of operations twice in separate game instances
      // Both should produce identical results
      
      // First run
      const g1 = createInitialGameState(gameId);
      g1.applyEvent({ type: 'rngSeed', seed });
      g1.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      g1.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      // Mulligan (shuffle hand into library, shuffle, draw 7 again)
      g1.applyEvent({ type: 'mulligan', playerId: p1 });
      // Draw 3 more cards
      g1.applyEvent({ type: 'drawCards', playerId: p1, count: 3 });
      // Shuffle hand (uses RNG)
      g1.applyEvent({ type: 'shuffleHand', playerId: p1 });
      
      const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib1 = g1.peekTopN!(p1, 10).map((c: any) => c.name);
      
      // Second run - completely new game instance with same operations
      const g2 = createInitialGameState(gameId + '_copy');
      g2.applyEvent({ type: 'rngSeed', seed });
      g2.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      g2.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      g2.applyEvent({ type: 'mulligan', playerId: p1 });
      g2.applyEvent({ type: 'drawCards', playerId: p1, count: 3 });
      g2.applyEvent({ type: 'shuffleHand', playerId: p1 });
      
      const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib2 = g2.peekTopN!(p1, 10).map((c: any) => c.name);
      
      // Both runs should produce identical results
      expect(hand2).toEqual(hand1);
      expect(lib2).toEqual(lib1);
      expect(hand1.length).toBe(10); // 7 from mulligan + 3 more draws
    });

    it('should produce different results with different seeds', () => {
      const gameId = 'rng_diff_seeds_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);

      // First seed
      const g1 = createInitialGameState(gameId + '_1');
      g1.applyEvent({ type: 'rngSeed', seed: 111111111 });
      g1.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      g1.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

      // Different seed
      const g2 = createInitialGameState(gameId + '_2');
      g2.applyEvent({ type: 'rngSeed', seed: 222222222 });
      g2.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      g2.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

      // Different seeds should produce different hands (statistically very unlikely to match)
      expect(hand2).not.toEqual(hand1);
    });

    it('should maintain RNG state across multiple shuffles deterministically', () => {
      // This tests that multiple shuffles in sequence are all deterministic
      const gameId = 'rng_multi_shuffle_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);
      const seed = 444444444;

      const events = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 5 },
        { type: 'shuffleLibrary', playerId: p1 }, // Second shuffle
        { type: 'drawCards', playerId: p1, count: 5 },
        { type: 'shuffleLibrary', playerId: p1 }, // Third shuffle
        { type: 'drawCards', playerId: p1, count: 5 },
      ];

      // Run 1
      const g1 = createInitialGameState(gameId);
      for (const e of events) g1.applyEvent(e);
      const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib1 = g1.peekTopN!(p1, 10).map((c: any) => c.name);

      // Run 2 - same events via replay
      const g2 = createInitialGameState(gameId + '_replay');
      g2.replay!(events);
      const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib2 = g2.peekTopN!(p1, 10).map((c: any) => c.name);

      expect(hand2).toEqual(hand1);
      expect(lib2).toEqual(lib1);
      expect(hand1.length).toBe(15); // 5 + 5 + 5
    });
  });

  describe('Multi-player undo scenarios', () => {
    it('should preserve both players hands after undo when shuffle/draw events are persisted', () => {
      // This test simulates the bug scenario where undo was changing hands
      // The fix ensures that when events include explicit shuffle/draw for each player,
      // the replay produces identical results
      const gameId = 'undo_multiplayer_test';
      const p1 = 'p_human' as PlayerID;
      const p2 = 'p_ai' as PlayerID;
      const deck1 = mkCards(30, 'Human_Card');
      const deck2 = mkCards(30, 'AI_Card');
      const seed = 555555555;

      // Initial game setup - both players import, shuffle, draw
      const game = createInitialGameState(gameId);
      
      // These events simulate what would be persisted to the database
      const allEvents = [
        { type: 'rngSeed', seed },
        // AI player setup
        { type: 'deckImportResolved', playerId: p2, cards: deck2 },
        { type: 'setCommander', playerId: p2, commanderNames: ['AI Commander'], commanderIds: ['AI_Card_1'] },
        { type: 'shuffleLibrary', playerId: p2 },
        { type: 'drawCards', playerId: p2, count: 7 },
        // Human player setup
        { type: 'deckImportResolved', playerId: p1, cards: deck1 },
        { type: 'setCommander', playerId: p1, commanderNames: ['Human Commander'], commanderIds: ['Human_Card_1'] },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 },
        // Some game actions
        { type: 'drawCards', playerId: p1, count: 1 }, // Turn 1 draw
      ];

      // Apply all events
      for (const e of allEvents) game.applyEvent(e);
      
      const humanHand1 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const aiHand1 = (game.state.zones?.[p2]?.hand ?? []).map((c: any) => c.name);

      // Simulate undo: reset and replay all but the last event
      game.reset!(true);
      const eventsWithoutLast = allEvents.slice(0, -1);
      game.replay!(eventsWithoutLast);
      
      const humanHand2 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      const aiHand2 = (game.state.zones?.[p2]?.hand ?? []).map((c: any) => c.name);

      // Human hand should have one less card (the undone draw)
      expect(humanHand2.length).toBe(humanHand1.length - 1);
      // But the original 7 cards should be the same
      expect(humanHand2).toEqual(humanHand1.slice(0, 7));
      // AI hand should be completely unchanged
      expect(aiHand2).toEqual(aiHand1);
    });

    it('should handle repeated undos without changing hands', () => {
      // Simulates the bug where clicking undo multiple times gave different hands each time
      const gameId = 'undo_repeated_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);
      const seed = 666666666;

      const setupEvents = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 },
      ];

      const gameActions = [
        { type: 'drawCards', playerId: p1, count: 1 },
        { type: 'drawCards', playerId: p1, count: 1 },
        { type: 'drawCards', playerId: p1, count: 1 },
      ];

      const game = createInitialGameState(gameId);
      
      // Apply setup events
      for (const e of setupEvents) game.applyEvent(e);
      const initialHand = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // Apply game actions
      for (const e of gameActions) game.applyEvent(e);
      
      // Now simulate undoing each action one by one
      // Each undo should give the same hand if we undo to the same point
      
      // Undo 1: back to 9 cards
      game.reset!(true);
      game.replay!([...setupEvents, ...gameActions.slice(0, 2)]);
      const hand9 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // Undo 2: back to 8 cards  
      game.reset!(true);
      game.replay!([...setupEvents, ...gameActions.slice(0, 1)]);
      const hand8 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // Undo 3: back to 7 cards (initial)
      game.reset!(true);
      game.replay!(setupEvents);
      const hand7 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // The hand at 7 cards should match the initial hand
      expect(hand7).toEqual(initialHand);
      // The hand at 8 cards should be initial + first draw
      expect(hand8.slice(0, 7)).toEqual(initialHand);
      expect(hand8.length).toBe(8);
      // The hand at 9 cards should be initial + first two draws
      expect(hand9.slice(0, 7)).toEqual(initialHand);
      expect(hand9.length).toBe(9);
    });
  });
});

  describe('RNG state after reset', () => {
    it('should clear RNG state on reset so replay can re-seed correctly', () => {
      // This test verifies the root cause of the undo bug:
      // When reset() is called, the RNG state must be cleared so that
      // the rngSeed event during replay can properly re-initialize it.
      // If RNG is not cleared, subsequent shuffles will use a different
      // RNG state and produce different results.
      
      const gameId = 'rng_reset_state_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);
      const seed = 777777777;

      const game = createInitialGameState(gameId);
      
      // Apply events
      game.applyEvent({ type: 'rngSeed', seed });
      game.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
      game.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
      game.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
      
      const hand1 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // Reset should clear RNG state
      game.reset!(true);
      
      // After reset, RNG should be in a cleared/unknown state
      // Replaying events should re-seed it
      const replayEvents = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 }
      ];
      game.replay!(replayEvents);
      
      const hand2 = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // The hands should be identical because the RNG was properly reset
      // and re-seeded with the same seed
      expect(hand2).toEqual(hand1);
    });

    it('should handle multiple reset-replay cycles deterministically', () => {
      const gameId = 'rng_multi_reset_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(30);
      const seed = 888888888;

      const events = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 },
        { type: 'drawCards', playerId: p1, count: 1 },
      ];

      const game = createInitialGameState(gameId);
      for (const e of events) game.applyEvent(e);
      const originalHand = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
      
      // Multiple reset-replay cycles should all produce the same result
      for (let i = 0; i < 5; i++) {
        game.reset!(true);
        game.replay!(events);
        const hand = (game.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
        expect(hand).toEqual(originalHand);
      }
    });
  });
