import type { SavedDeckDetail, SavedDeckSummary } from '../../../shared/src/decks';
import { authHeaders, getStoredSessionToken } from './authSessionStorage';

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const extra = authHeaders();
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(input, { ...init, credentials: 'include', headers });
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Log in to see your server decks.');
    }
    const message = typeof (data as { error?: string }).error === 'string'
      ? (data as { error: string }).error
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchServerDeckSummaries(): Promise<SavedDeckSummary[]> {
  const data = await readJson<{ decks?: SavedDeckSummary[] }>(await apiFetch('/api/decks'));
  return data.decks || [];
}

export async function fetchMyServerDeckSummaries(): Promise<SavedDeckSummary[]> {
  const data = await readJson<{ decks?: SavedDeckSummary[] }>(await apiFetch('/api/decks/mine'));
  return data.decks || [];
}

export async function fetchLoadableServerDeckSummaries(): Promise<SavedDeckSummary[]> {
  const publicDecks = await fetchServerDeckSummaries();
  if (!getStoredSessionToken()) return publicDecks;
  try {
    const mine = await fetchMyServerDeckSummaries();
    const seen = new Set(publicDecks.map((d) => d.id));
    return [...mine.filter((d) => !seen.has(d.id)), ...publicDecks];
  } catch {
    return publicDecks;
  }
}

export async function fetchServerDeckDetail(deckId: string): Promise<SavedDeckDetail> {
  const data = await readJson<{ deck: SavedDeckDetail }>(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`));
  return data.deck;
}

export async function saveServerDeckViaApi(payload: {
  name: string;
  text: string;
  playerId?: string;
  playerName?: string;
  cacheCards?: boolean;
  visibility?: 'public' | 'private';
}): Promise<{ deckId: string; cardCount: number }> {
  return readJson(await apiFetch('/api/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function updateServerDeckViaApi(
  deckId: string,
  payload: {
    name: string;
    text: string;
    playerId?: string;
    cacheCards?: boolean;
    visibility?: 'public' | 'private';
  },
): Promise<SavedDeckSummary> {
  const data = await readJson<{ deck: SavedDeckSummary }>(
    await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return data.deck;
}

export async function renameServerDeckViaApi(
  deckId: string,
  name: string,
  playerId?: string,
): Promise<SavedDeckSummary> {
  const data = await readJson<{ deck: SavedDeckSummary }>(
    await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, playerId }),
    }),
  );
  return data.deck;
}

export async function deleteServerDeckViaApi(deckId: string, playerId?: string): Promise<void> {
  await readJson(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  }));
}

export type DeckCardLookupResult = {
  query: string;
  found: boolean;
  name?: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    art_crop?: string;
  };
};

/** Local-first card preview lookup (no Scryfall). Caps at 200 names server-side. */
export async function lookupDeckCardsViaApi(names: string[]): Promise<DeckCardLookupResult[]> {
  if (names.length === 0) return [];
  const data = await readJson<{ cards?: DeckCardLookupResult[] }>(
    await apiFetch('/api/cards/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    }),
  );
  return data.cards || [];
}
