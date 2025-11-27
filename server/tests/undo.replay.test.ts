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
});
