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

describe('RNG determinism and replay', () => {
  it('replays the same shuffle/draw sequence with the same seed and events', () => {
    const gameId = 'rng_game_1';
    const p1 = 'p_test' as PlayerID;
    const deck = mkCards(30);

    // Session 1: seed, import, shuffle, draw 5
    const g1 = createInitialGameState(gameId);
    g1.seedRng(123456789);
    g1.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g1.applyEvent({ type: 'drawCards', playerId: p1, count: 5 });
    const hand1 = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

    // Session 2: replay the same events
    const g2 = createInitialGameState(gameId);
    g2.applyEvent({ type: 'rngSeed', seed: 123456789 });
    g2.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g2.applyEvent({ type: 'drawCards', playerId: p1, count: 5 });
    const hand2 = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

    expect(hand2).toEqual(hand1);
  });

  it('double-shuffle leads to a different order than single-shuffle (with same seed)', () => {
    const gameId = 'rng_game_2';
    const p1 = 'p_test' as PlayerID;
    const deck = mkCards(30);

    const seed = 987654321;

    // Single shuffle
    const g1 = createInitialGameState(gameId);
    g1.applyEvent({ type: 'rngSeed', seed });
    g1.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g1.applyEvent({ type: 'drawCards', playerId: p1, count: 5 });
    const handSingle = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

    // Double shuffle
    const g2 = createInitialGameState(gameId);
    g2.applyEvent({ type: 'rngSeed', seed });
    g2.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g2.applyEvent({ type: 'drawCards', playerId: p1, count: 5 });
    const handDouble = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

    expect(handDouble).not.toEqual(handSingle);
  });

  it('later shuffle is deterministic given prior history (seed + prior draws)', () => {
    const gameId = 'rng_game_3';
    const p1 = 'p_test' as PlayerID;
    const deck = mkCards(40);
    const seed = 42424242;

    const g1 = createInitialGameState(gameId);
    g1.applyEvent({ type: 'rngSeed', seed });
    g1.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g1.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
    g1.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g1.applyEvent({ type: 'drawCards', playerId: p1, count: 3 });
    const handNow = (g1.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

    // Replay same sequence
    const g2 = createInitialGameState(gameId);
    g2.applyEvent({ type: 'rngSeed', seed });
    g2.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g2.applyEvent({ type: 'drawCards', playerId: p1, count: 7 });
    g2.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g2.applyEvent({ type: 'drawCards', playerId: p1, count: 3 });
    const handReplay = (g2.state.zones?.[p1]?.hand ?? []).map((c: any) => c.name);

    expect(handReplay).toEqual(handNow);
  });
});