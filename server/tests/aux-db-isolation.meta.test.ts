import { describe, expect, it } from 'vitest';
import { resolveAuxDbFile } from '../src/db/auxDbFile.js';
import { clearAllDecksForTests, listDecks, saveDeck } from '../src/db/decks.js';
import { assertAuxDbIsolatedForTests, wipeAllSavedDecksForTests } from './helpers/savedDeckTestCleanup.js';

describe('aux DB isolation (meta)', () => {
  it('uses an in-memory aux DB under vitest so saved-deck tests cannot touch the live file', () => {
    expect(resolveAuxDbFile()).toBe(':memory:');
    expect(() => assertAuxDbIsolatedForTests()).not.toThrow();
  });

  it('can wipe ephemeral decks from the shared worker memory DB (AI eval cleanup path)', () => {
    assertAuxDbIsolatedForTests();
    const id = `deck_meta_wipe_${Date.now().toString(36)}`;
    saveDeck({
      id,
      name: 'Meta Wipe Fixture',
      text: '1 Sol Ring',
      created_by_id: 'test_meta',
      created_by_name: 'Test Meta',
      card_count: 1,
    });
    expect(listDecks().some((d) => d.id === id)).toBe(true);
    expect(wipeAllSavedDecksForTests()).toBeGreaterThanOrEqual(1);
    expect(clearAllDecksForTests()).toBe(0);
    expect(listDecks().some((d) => d.id === id)).toBe(false);
  });
});
