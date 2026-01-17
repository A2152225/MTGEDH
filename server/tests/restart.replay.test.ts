import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { transformDbEventsForReplay } from '../src/socket/util';
import type { KnownCardRef, PlayerID } from '../../shared/src';

const DEBUG_TESTS = process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true';
const debug = (...args: any[]) => {
  if (DEBUG_TESTS) console.log(...args);
};

function mkCards(n: number, prefix = 'Card'): Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    name: `${prefix} ${i + 1}`,
    type_line: 'Test',
    oracle_text: ''
  }));
}

describe('Server restart replay', () => {
  it('should produce identical library order after server restart and replay', () => {
    const gameId = 'restart_test_1';
    const p1 = 'p_test' as PlayerID;
    const deck = mkCards(30);
    const seed = 123456789;

    // Session 1: Original game flow (before server restart)
    const g1 = createInitialGameState(gameId);
    g1.seedRng(seed);
    g1.importDeckResolved(p1, deck);
    g1.shuffleLibrary(p1);
    g1.drawCards(p1, 7);
    
    const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib1 = g1.peekTopN(p1, 10).map((c: any) => c.name);
    
    debug('Session 1 - Hand:', hand1);
    debug('Session 1 - Library (top 10):', lib1);

    // Simulate persisted events in database format { type, payload }
    const dbEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'shuffleLibrary', payload: { playerId: p1 } },
      { type: 'drawCards', payload: { playerId: p1, count: 7 } }
    ];

    // Transform to replay format (as done in GameManager.ensureGame)
    const replayEvents = transformDbEventsForReplay(dbEvents);
    debug('Replay events (first 2):', replayEvents.slice(0, 2));

    // Session 2: Server restart - new game context + replay
    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib2 = g2.peekTopN(p1, 10).map((c: any) => c.name);
    
    debug('Session 2 (replay) - Hand:', hand2);
    debug('Session 2 (replay) - Library (top 10):', lib2);

    // Both should be identical
    expect(hand2).toEqual(hand1);
    expect(lib2).toEqual(lib1);
  });
  
  it('should preserve library order when only import+shuffle events are replayed (no draw)', () => {
    const gameId = 'restart_test_2';
    const p1 = 'p_test' as PlayerID;
    const deck = mkCards(30);
    const seed = 987654321;

    // Session 1
    const g1 = createInitialGameState(gameId);
    g1.seedRng(seed);
    g1.importDeckResolved(p1, deck);
    g1.shuffleLibrary(p1);
    
    const lib1 = g1.peekTopN(p1, 30).map((c: any) => c.name);
    debug('Session 1 - Full library order (first 10):', lib1.slice(0, 10));

    // Database format
    const dbEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'shuffleLibrary', payload: { playerId: p1 } }
    ];
    
    const replayEvents = transformDbEventsForReplay(dbEvents);

    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const lib2 = g2.peekTopN(p1, 30).map((c: any) => c.name);
    debug('Session 2 (replay) - Full library order (first 10):', lib2.slice(0, 10));

    expect(lib2).toEqual(lib1);
  });
  
  it('verifies that the rngSeed event is correctly transformed from DB format', () => {
    const dbEvents = [
      { type: 'rngSeed', payload: { seed: 12345 } }
    ];
    
    const replayEvents = transformDbEventsForReplay(dbEvents);
    
    // After transformation, the event should be { type: 'rngSeed', seed: 12345 }
    expect(replayEvents[0]).toEqual({ type: 'rngSeed', seed: 12345 });
  });
  
  it('should correctly replay mulligan events after server restart', () => {
    const gameId = 'mulligan_test_1';
    const p1 = 'p_test' as PlayerID;
    const deck = mkCards(60);
    const seed = 11111111;

    // Session 1: Original flow - import, shuffle, draw, then mulligan
    const g1 = createInitialGameState(gameId);
    g1.seedRng(seed);
    g1.importDeckResolved(p1, deck);
    g1.shuffleLibrary(p1);
    g1.drawCards(p1, 7);
    
    // Initial hand before mulligan
    const handBeforeMulligan = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    debug('Before mulligan - Hand:', handBeforeMulligan);
    
    // Mulligan: hand goes to library, shuffle, draw 7
    (g1 as any).moveHandToLibrary(p1);
    g1.shuffleLibrary(p1);
    g1.drawCards(p1, 7);
    
    const handAfterMulligan = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const libAfterMulligan = g1.peekTopN(p1, 10).map((c: any) => c.name);
    debug('After mulligan - Hand:', handAfterMulligan);
    debug('After mulligan - Library (top 10):', libAfterMulligan);

    // Session 2: Replay with mulligan event
    const dbEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'shuffleLibrary', payload: { playerId: p1 } },
      { type: 'drawCards', payload: { playerId: p1, count: 7 } },
      { type: 'mulligan', payload: { playerId: p1 } }  // This is the key event
    ];
    
    const replayEvents = transformDbEventsForReplay(dbEvents);

    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib2 = g2.peekTopN(p1, 10).map((c: any) => c.name);
    debug('Session 2 (replay) - Hand:', hand2);
    debug('Session 2 (replay) - Library (top 10):', lib2);

    // After replay, both hands and libraries should match
    expect(hand2).toEqual(handAfterMulligan);
    expect(lib2).toEqual(libAfterMulligan);
  });

  it('should replay setCommander + opening draw flow correctly', () => {
    const gameId = 'commander_draw_test';
    const p1 = 'p_test' as PlayerID;
    // Create a deck with some legendary creatures
    const deck = [
      { id: 'commander_1', name: 'Legendary Commander', type_line: 'Legendary Creature - Human', oracle_text: '' },
      ...mkCards(59, 'Card')
    ];
    const seed = 55555555;

    // Session 1: deck import, set pendingInitialDraw, then setCommander (triggers shuffle+draw)
    const g1 = createInitialGameState(gameId);
    g1.seedRng(seed);
    g1.importDeckResolved(p1, deck);
    
    // Mark pending initial draw (as happens in deck import flow)
    (g1 as any).pendingInitialDraw.add(p1);
    
    // Set commander - this should trigger shuffle + draw because pending flag is set and hand is empty
    g1.setCommander(p1, ['Legendary Commander'], ['commander_1']);
    
    const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib1 = g1.peekTopN(p1, 10).map((c: any) => c.name);
    debug('Session 1 - Hand after setCommander:', hand1);
    debug('Session 1 - Library (top 10):', lib1);
    
    // Verify hand was drawn
    expect(hand1.length).toBe(7);

    // Session 2: Replay the events (including the shuffle+draw that setCommander triggered)
    // In the fixed version, shuffle+draw events should be persisted separately
    const dbEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'setCommander', payload: { playerId: p1, commanderNames: ['Legendary Commander'], commanderIds: ['commander_1'] } },
      // These events should now be persisted by the fix:
      { type: 'shuffleLibrary', payload: { playerId: p1 } },
      { type: 'drawCards', payload: { playerId: p1, count: 7 } }
    ];
    
    const replayEvents = transformDbEventsForReplay(dbEvents);

    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib2 = g2.peekTopN(p1, 10).map((c: any) => c.name);
    debug('Session 2 (replay) - Hand:', hand2);
    debug('Session 2 (replay) - Library (top 10):', lib2);

    // After replay, hands and libraries should match
    expect(hand2).toEqual(hand1);
    expect(lib2).toEqual(lib1);
  });
  
  it('should handle backward compatibility: old games without explicit shuffle/draw events', () => {
    const gameId = 'backward_compat_test';
    const p1 = 'p_test' as PlayerID;
    const deck = [
      { id: 'commander_1', name: 'Legendary Commander', type_line: 'Legendary Creature - Human', oracle_text: '' },
      ...mkCards(59, 'Card')
    ];
    const seed = 77777777;

    // Session 1: Original game with pending draw flag
    const g1 = createInitialGameState(gameId);
    g1.seedRng(seed);
    g1.importDeckResolved(p1, deck);
    (g1 as any).pendingInitialDraw.add(p1);
    g1.setCommander(p1, ['Legendary Commander'], ['commander_1']);
    
    const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib1 = g1.peekTopN(p1, 10).map((c: any) => c.name);
    debug('Backward compat - Session 1 - Hand:', hand1);
    debug('Backward compat - Session 1 - Library (top 10):', lib1);
    
    expect(hand1.length).toBe(7);

    // Session 2: OLD-STYLE events (no explicit shuffle/draw after setCommander)
    // This simulates games created before the fix
    const oldStyleEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'setCommander', payload: { playerId: p1, commanderNames: ['Legendary Commander'], commanderIds: ['commander_1'] } }
      // NO shuffleLibrary or drawCards events - this is the old format
    ];
    
    const replayEvents = transformDbEventsForReplay(oldStyleEvents);

    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib2 = g2.peekTopN(p1, 10).map((c: any) => c.name);
    debug('Backward compat - Session 2 (replay) - Hand:', hand2);
    debug('Backward compat - Session 2 (replay) - Library (top 10):', lib2);

    // After replay with backward compat, hands and libraries should match
    expect(hand2.length).toBe(7);
    expect(hand2).toEqual(hand1);
    expect(lib2).toEqual(lib1);
  });

  it('should correctly replay playLand events and preserve lands on battlefield', () => {
    const gameId = 'land_replay_test';
    const p1 = 'p_test' as PlayerID;
    // Create a deck with lands at the top to ensure we draw one
    // Put the land first so after deterministic shuffle, we're more likely to get it
    const land = { id: 'land_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', image_uris: { small: 'forest.jpg' } };
    const deck = [
      land,
      ...mkCards(59, 'Card')
    ];
    const seed = 12121212; // Use a seed that results in the land being drawn

    // Session 1: import deck, draw (no shuffle to ensure deterministic result)
    const g1 = createInitialGameState(gameId);
    g1.seedRng(seed);
    g1.importDeckResolved(p1, deck);
    // Don't shuffle - just draw the first 7 cards including the land
    g1.drawCards(p1, 7);
    
    // The land should be in hand (it's the first card in the deck)
    const hand1Before = (g1.state.zones?.[p1]?.hand ?? []) as any[];
    const landInHand = hand1Before.find((c: any) => c.type_line?.toLowerCase().includes('land'));
    
    expect(landInHand).toBeDefined();
    expect(landInHand?.name).toBe('Forest');
    
    // Play the land
    g1.playLand(p1, landInHand);
    
    const battlefield1 = (g1.state?.battlefield ?? []) as any[];
    const landsOnBattlefield1 = battlefield1.filter((p: any) => 
      p.controller === p1 && p.card?.type_line?.toLowerCase().includes('land')
    );
    
    debug('Land replay - Session 1 - Lands on battlefield:', landsOnBattlefield1.map((p: any) => p.card?.name));
    
    // The land should be on the battlefield
    expect(landsOnBattlefield1.length).toBe(1);
    expect(landsOnBattlefield1[0].card.name).toBe('Forest');

    // Session 2: Replay with full card data in playLand event (the fix)
    const dbEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'drawCards', payload: { playerId: p1, count: 7 } },
      // The fix: include full card data in the event so replay works after server restart
      { type: 'playLand', payload: { playerId: p1, cardId: landInHand.id, card: landInHand } },
    ];
    
    const replayEvents = transformDbEventsForReplay(dbEvents);

    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const battlefield2 = (g2.state?.battlefield ?? []) as any[];
    const landsOnBattlefield2 = battlefield2.filter((p: any) => 
      p.controller === p1 && p.card?.type_line?.toLowerCase().includes('land')
    );
    
    debug('Land replay - Session 2 (replay) - Lands on battlefield:', landsOnBattlefield2.map((p: any) => p.card?.name));

    // After replay, the land should still be on battlefield
    expect(landsOnBattlefield2.length).toBe(1);
    expect(landsOnBattlefield2[0].card.name).toBe('Forest');
  });
});
