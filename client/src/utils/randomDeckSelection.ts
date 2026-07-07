import type { SavedDeckSummary } from '../../../shared/src/decks';
import { listAllPrecons } from '../../../shared/src/precons';

export type SavedLocalDeckRef = {
  id: string;
  name: string;
  text: string;
  savedAt: number;
};

export type RandomDeckChoice =
  | { source: 'local'; deck: SavedLocalDeckRef; label: string }
  | { source: 'server'; deckId: string; label: string }
  | {
      source: 'precon';
      commanders: string[];
      deckName: string;
      setName: string;
      year: number;
      setCode: string;
      colorIdentity: string;
      label: string;
    };

export function buildRandomDeckPool(options: {
  localDecks: readonly SavedLocalDeckRef[];
  serverDecks: readonly SavedDeckSummary[];
  includeServer: boolean;
  includePrecons: boolean;
}): RandomDeckChoice[] {
  const pool: RandomDeckChoice[] = [];

  for (const deck of options.localDecks) {
    if (!deck.text?.trim()) continue;
    pool.push({
      source: 'local',
      deck,
      label: deck.name || 'Local deck',
    });
  }

  if (options.includeServer) {
    for (const deck of options.serverDecks) {
      pool.push({
        source: 'server',
        deckId: deck.id,
        label: deck.name,
      });
    }
  }

  if (options.includePrecons) {
    for (const { year, set, deck } of listAllPrecons()) {
      pool.push({
        source: 'precon',
        commanders: deck.commanders,
        deckName: deck.name,
        setName: set.name,
        year,
        setCode: set.code,
        colorIdentity: deck.colorIdentity,
        label: `${deck.name} (${set.name})`,
      });
    }
  }

  return pool;
}

export function pickRandomDeck(
  pool: readonly RandomDeckChoice[],
  rng: () => number = Math.random,
): RandomDeckChoice | null {
  if (pool.length === 0) return null;
  const index = Math.floor(rng() * pool.length);
  return pool[Math.min(Math.max(index, 0), pool.length - 1)] ?? null;
}

export function describeRandomDeckSource(choice: RandomDeckChoice): string {
  switch (choice.source) {
    case 'local':
      return 'local save';
    case 'server':
      return 'server deck';
    case 'precon':
      return 'precon';
    default:
      return 'deck';
  }
}

export type RandomDeckApplyHandlers = {
  onImportLocal: (text: string, name?: string) => void;
  onUseServerDeck: (deckId: string) => void;
  onImportPrecon: (payload: {
    commanders: string[];
    deckName: string;
    setName: string;
    year: number;
    setCode: string;
    colorIdentity: string;
  }) => void;
};

export function applyRandomDeckChoice(
  choice: RandomDeckChoice,
  handlers: RandomDeckApplyHandlers,
): void {
  switch (choice.source) {
    case 'local':
      handlers.onImportLocal(choice.deck.text, choice.deck.name);
      break;
    case 'server':
      handlers.onUseServerDeck(choice.deckId);
      break;
    case 'precon':
      handlers.onImportPrecon({
        commanders: choice.commanders,
        deckName: choice.deckName,
        setName: choice.setName,
        year: choice.year,
        setCode: choice.setCode,
        colorIdentity: choice.colorIdentity,
      });
      break;
    default:
      break;
  }
}

export function executeRandomDeckPick(options: {
  localDecks: readonly SavedLocalDeckRef[];
  serverDecks: readonly import('../../../shared/src/decks').SavedDeckSummary[];
  includeServer: boolean;
  includePrecons: boolean;
  handlers: RandomDeckApplyHandlers;
  rng?: () => number;
}): { ok: true; choice: RandomDeckChoice } | { ok: false; error: string } {
  const pool = buildRandomDeckPool({
    localDecks: options.localDecks,
    serverDecks: options.serverDecks,
    includeServer: options.includeServer,
    includePrecons: options.includePrecons,
  });
  const choice = pickRandomDeck(pool, options.rng);
  if (!choice) {
    return {
      ok: false,
      error: 'No decks available to pick from yet. Save a local deck or try again after server decks load.',
    };
  }
  applyRandomDeckChoice(choice, options.handlers);
  return { ok: true, choice };
}
