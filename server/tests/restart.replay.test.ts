import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { KnownCardRef, PlayerID } from '../../shared/src';

function mkCards(n: number, prefix = 'Card'): Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    name: `${prefix} ${i + 1}`,
    type_line: 'Test',
    oracle_text: ''
  }));
}

// Simulate the event transformation that happens in GameManager.ensureGame
function transformDbEventsForReplay(events: Array<{ type: string; payload?: any }>): any[] {
  return events.map((e: any) =>
    e && e.type
      ? e.payload && typeof e.payload === "object"
        ? { type: e.type, ...(e.payload as any) }
        : { type: e.type }
      : e
  );
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
    
    console.log('Session 1 - Hand:', hand1);
    console.log('Session 1 - Library (top 10):', lib1);

    // Simulate persisted events in database format { type, payload }
    const dbEvents = [
      { type: 'rngSeed', payload: { seed } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: deck } },
      { type: 'shuffleLibrary', payload: { playerId: p1 } },
      { type: 'drawCards', payload: { playerId: p1, count: 7 } }
    ];

    // Transform to replay format (as done in GameManager.ensureGame)
    const replayEvents = transformDbEventsForReplay(dbEvents);
    console.log('Replay events (first 2):', replayEvents.slice(0, 2));

    // Session 2: Server restart - new game context + replay
    const g2 = createInitialGameState(gameId);
    (g2 as any).replay(replayEvents);
    
    const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const lib2 = g2.peekTopN(p1, 10).map((c: any) => c.name);
    
    console.log('Session 2 (replay) - Hand:', hand2);
    console.log('Session 2 (replay) - Library (top 10):', lib2);

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
    console.log('Session 1 - Full library order (first 10):', lib1.slice(0, 10));

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
    console.log('Session 2 (replay) - Full library order (first 10):', lib2.slice(0, 10));

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
    console.log('Before mulligan - Hand:', handBeforeMulligan);
    
    // Mulligan: hand goes to library, shuffle, draw 7
    (g1 as any).moveHandToLibrary(p1);
    g1.shuffleLibrary(p1);
    g1.drawCards(p1, 7);
    
    const handAfterMulligan = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);
    const libAfterMulligan = g1.peekTopN(p1, 10).map((c: any) => c.name);
    console.log('After mulligan - Hand:', handAfterMulligan);
    console.log('After mulligan - Library (top 10):', libAfterMulligan);

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
    console.log('Session 2 (replay) - Hand:', hand2);
    console.log('Session 2 (replay) - Library (top 10):', lib2);

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
    console.log('Session 1 - Hand after setCommander:', hand1);
    console.log('Session 1 - Library (top 10):', lib1);
    
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
    console.log('Session 2 (replay) - Hand:', hand2);
    console.log('Session 2 (replay) - Library (top 10):', lib2);

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
    console.log('Backward compat - Session 1 - Hand:', hand1);
    console.log('Backward compat - Session 1 - Library (top 10):', lib1);
    
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
    console.log('Backward compat - Session 2 (replay) - Hand:', hand2);
    console.log('Backward compat - Session 2 (replay) - Library (top 10):', lib2);

    // After replay with backward compat, hands and libraries should match
    expect(hand2.length).toBe(7);
    expect(hand2).toEqual(hand1);
    expect(lib2).toEqual(lib1);
  });
});
