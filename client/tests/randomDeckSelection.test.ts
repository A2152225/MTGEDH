import { describe, expect, it } from 'vitest';

import {
  applyRandomDeckChoice,
  buildRandomDeckPool,
  executeRandomDeckPick,
  pickRandomDeck,
  type RandomDeckChoice,
} from '../src/utils/randomDeckSelection';

describe('randomDeckSelection', () => {
  it('builds a pool from local, server, and precon sources', () => {
    const pool = buildRandomDeckPool({
      localDecks: [{ id: 'l1', name: 'My Local', text: '1 Sol Ring', savedAt: 1 }],
      serverDecks: [{ id: 's1', name: 'Server Deck', created_at: 1, created_by_name: 'P1', card_count: 99 } as any],
      includeServer: true,
      includePrecons: true,
    });

    expect(pool.some((entry) => entry.source === 'local')).toBe(true);
    expect(pool.some((entry) => entry.source === 'server')).toBe(true);
    expect(pool.some((entry) => entry.source === 'precon')).toBe(true);
  });

  it('skips empty local decks', () => {
    const pool = buildRandomDeckPool({
      localDecks: [{ id: 'l1', name: 'Empty', text: '   ', savedAt: 1 }],
      serverDecks: [],
      includeServer: false,
      includePrecons: false,
    });
    expect(pool).toHaveLength(0);
  });

  it('picks deterministically with a seeded rng', () => {
    const pool: RandomDeckChoice[] = [
      { source: 'local', deck: { id: 'a', name: 'A', text: '1 A', savedAt: 1 }, label: 'A' },
      { source: 'local', deck: { id: 'b', name: 'B', text: '1 B', savedAt: 1 }, label: 'B' },
    ];
    expect(pickRandomDeck(pool, () => 0)?.label).toBe('A');
    expect(pickRandomDeck(pool, () => 0.99)?.label).toBe('B');
  });

  it('applies the chosen deck through handlers', () => {
    const calls: string[] = [];
    const result = executeRandomDeckPick({
      localDecks: [{ id: 'l1', name: 'Local', text: '1 Sol Ring', savedAt: 1 }],
      serverDecks: [],
      includeServer: false,
      includePrecons: false,
      rng: () => 0,
      handlers: {
        onImportLocal: (text, name) => calls.push(`local:${name}:${text}`),
        onUseServerDeck: (deckId) => calls.push(`server:${deckId}`),
        onImportPrecon: () => calls.push('precon'),
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(['local:Local:1 Sol Ring']);
  });

  it('applyRandomDeckChoice routes server picks', () => {
    const calls: string[] = [];
    applyRandomDeckChoice(
      { source: 'server', deckId: 'deck-1', label: 'Saved' },
      {
        onImportLocal: () => calls.push('local'),
        onUseServerDeck: (deckId) => calls.push(deckId),
        onImportPrecon: () => calls.push('precon'),
      },
    );
    expect(calls).toEqual(['deck-1']);
  });
});
