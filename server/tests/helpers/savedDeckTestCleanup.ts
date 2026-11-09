/**
 * Shared cleanup for tests that insert into the aux saved-decks table.
 *
 * Why this exists:
 * - Vitest uses a per-worker `:memory:` aux DB (see `resolveAuxDbFile`), but that
 *   memory DB is still shared across test files in the same worker.
 * - Upcoming AI decision/eval suites may seed many ephemeral decks / board layouts;
 *   without cleanup, those rows accumulate and pollute later list/get assertions.
 *
 * Usage:
 *   const decks = createSavedDeckTracker();
 *   decks.installAfterEach(); // or installAfterAll() when a fixture is shared across its
 *   decks.track(savedId);
 */
import { afterAll, afterEach } from 'vitest';
import { clearAllDecksForTests, deleteDeck } from '../../src/db/decks.js';
import { resolveAuxDbFile } from '../../src/db/auxDbFile.js';

export function assertAuxDbIsolatedForTests(): void {
  const file = resolveAuxDbFile();
  if (file !== ':memory:') {
    throw new Error(
      `Aux DB must be :memory: under vitest (got ${file}). Refusing to track/create decks against a file DB.`,
    );
  }
}

export type SavedDeckTracker = {
  track: (id: string | null | undefined) => string | undefined;
  cleanup: () => void;
  installAfterEach: () => void;
  installAfterAll: () => void;
};

export function createSavedDeckTracker(): SavedDeckTracker {
  assertAuxDbIsolatedForTests();
  const ids: string[] = [];

  const cleanup = () => {
    while (ids.length) {
      const id = ids.pop();
      if (!id) continue;
      try {
        deleteDeck(id);
      } catch {
        /* ignore */
      }
    }
  };

  return {
    track(id) {
      if (id) ids.push(String(id));
      return id ? String(id) : undefined;
    },
    cleanup,
    installAfterEach() {
      afterEach(cleanup);
    },
    installAfterAll() {
      afterAll(cleanup);
    },
  };
}

/** Wipe every deck in the worker's aux DB. Prefer for AI eval suites that seed many fixtures. */
export function wipeAllSavedDecksForTests(): number {
  assertAuxDbIsolatedForTests();
  return clearAllDecksForTests();
}
