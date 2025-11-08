/**
 * Scryfall service + decklist parsing + legality validation.
 * Uses the built-in global fetch (Node 18+). No external fetch dependency.
 *
 * Exports:
 * - normalizeName, parseDecklist
 * - fetchCardByExactName, fetchCardByExactNameStrict, fetchCardById
 * - fetchCardsByExactNamesBatch
 * - validateDeck
 *
 * Notes:
 * - Includes power/toughness when available.
 * - Handles split/mdfc faces minimally by preserving top-level fields and faces if present.
 * - Simple in-memory cache by normalized name and by card id.
 */

//
// Types
//
export type ParsedLine = { name: string; count: number };

export type ScryfallCard = {
  id: string;
  name: string;
  oracle_id?: string;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: { small?: string; normal?: string; art_crop?: string };
  legalities?: Record<string, string>;
  power?: string;
  toughness?: string;
  layout?: string;
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: { small?: string; normal?: string; art_crop?: string };
    power?: string;
    toughness?: string;
  }>;
};

//
// Normalization + decklist parsing
//
export function normalizeName(s: string) {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/’/g, "'")
    .replace(/\s+\/\/\s+/g, ' // ');
}

export function parseDecklist(list: string): ParsedLine[] {
  const lines = list
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const acc = new Map<string, number>();

  for (const raw of lines) {
    if (/^(SB:|SIDEBOARD)/i.test(raw)) continue;

    let name = '';
    let count = 1;

    // "3 Card Name" or "3x Card Name"
    const mPrefix = raw.match(/^(\d+)x?\s+(.+)$/i);
    if (mPrefix) {
      count = Math.max(1, parseInt(mPrefix[1], 10) || 1);
      name = mPrefix[2];
    } else {
      // "Card Name x3"
      const mSuffix = raw.match(/^(.*)\s+x(\d+)$/i);
      if (mSuffix) {
        name = mSuffix[1];
        count = Math.max(1, parseInt(mSuffix[2], 10) || 1);
      } else {
        name = raw;
        count = 1;
      }
    }

    name = normalizeName(name);
    if (!name) continue;
    acc.set(name, (acc.get(name) || 0) + count);
  }

  return Array.from(acc.entries()).map(([name, count]) => ({ name, count }));
}

//
// Cache + helpers
//
const cache = new Map<string, ScryfallCard>();
function lcKey(name: string) {
  return normalizeName(name).toLowerCase();
}

function ensureFetch(): typeof fetch {
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') {
    throw new Error('Global fetch is not available. Use Node 18+ or polyfill fetch.');
  }
  return f.bind(globalThis);
}

async function doFetchJSON(url: string, options?: RequestInit, retries = 3, backoffMs = 300): Promise<any> {
  const f = ensureFetch();
  let attempt = 0;
  for (;;) {
    const res = await f(url, {
      ...(options || {}),
      headers: {
        Accept: 'application/json',
        ...(options?.headers || {})
      }
    });
    if (res.ok) {
      return res.json();
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After')) || (backoffMs * Math.pow(2, attempt));
      await new Promise(r => setTimeout(r, retryAfter));
      attempt++;
      continue;
    }
    throw new Error(`Scryfall error ${res.status} (${url})`);
  }
}

function toCachedCard(data: any): ScryfallCard {
  const card: ScryfallCard = {
    id: data.id,
    name: data.name,
    oracle_id: data.oracle_id,
    cmc: data.cmc,
    mana_cost: data.mana_cost,
    type_line: data.type_line,
    oracle_text: data.oracle_text,
    image_uris: data.image_uris
      ? { small: data.image_uris.small, normal: data.image_uris.normal, art_crop: data.image_uris.art_crop }
      : undefined,
    legalities: data.legalities,
    power: data.power,
    toughness: data.toughness,
    layout: data.layout,
    card_faces: Array.isArray(data.card_faces)
      ? data.card_faces.map((f: any) => ({
          name: f.name,
          mana_cost: f.mana_cost,
          type_line: f.type_line,
          oracle_text: f.oracle_text,
          image_uris: f.image_uris
            ? { small: f.image_uris.small, normal: f.image_uris.normal, art_crop: f.image_uris.art_crop }
            : undefined,
          power: f.power,
          toughness: f.toughness
        }))
      : undefined
  };
  cache.set(lcKey(card.name), card);
  cache.set(card.id, card);
  return card;
}

//
// Exact-name and id fetchers
//
export async function fetchCardByExactName(name: string): Promise<ScryfallCard> {
  const key = lcKey(name);
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(normalizeName(name))}`;
  const data = await doFetchJSON(url);
  return toCachedCard(data);
}

export async function fetchCardByExactNameStrict(name: string): Promise<ScryfallCard> {
  const normalized = normalizeName(name);
  const key = lcKey(normalized);
  const hit = cache.get(key);
  if (hit) return hit;
  const quoted = `"${normalized}"`;
  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(quoted)}`;
  const data = await doFetchJSON(url);
  return toCachedCard(data);
}

export async function fetchCardById(id: string): Promise<ScryfallCard> {
  const hit = cache.get(id);
  if (hit) return hit;
  const url = `https://api.scryfall.com/cards/${encodeURIComponent(id)}`;
  const data = await doFetchJSON(url);
  return toCachedCard(data);
}

//
// Batch /collection fetch
//
export async function fetchCardsByExactNamesBatch(
  names: string[],
  batchSize = 75,
  sleepMsBetweenBatches = 120
): Promise<Map<string, ScryfallCard>> {
  const out = new Map<string, ScryfallCard>();
  const pending: string[] = [];

  for (const n of names) {
    const key = lcKey(n);
    const hit = cache.get(key);
    if (hit) out.set(key, hit);
    else pending.push(n);
  }

  for (let i = 0; i < pending.length; i += batchSize) {
    const chunk = pending.slice(i, i + batchSize);
    const payload = { identifiers: chunk.map(name => ({ name: normalizeName(name) })) };

    const data = await doFetchJSON('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!Array.isArray(data.data)) throw new Error('Invalid Scryfall /collection response');

    for (const d of data.data) {
      const card = toCachedCard(d);
      out.set(lcKey(card.name), card);
    }

    if (i + batchSize < pending.length) {
      await new Promise(r => setTimeout(r, sleepMsBetweenBatches));
    }
  }

  return out;
}

//
// Deck legality (format-level)
//
export function validateDeck(
  format: string,
  cards: ScryfallCard[]
): { illegal: { name: string; reason: string }[]; warnings: string[] } {
  const illegal: { name: string; reason: string }[] = [];
  const warnings: string[] = [];
  const fmt = (format || '').toLowerCase();

  // Format legality flags (from Scryfall)
  for (const c of cards) {
    const status = c.legalities?.[fmt];
    if (status && status !== 'legal') {
      illegal.push({ name: c.name, reason: `not legal in ${format} (${status})` });
    }
  }

  // Commander singleton rule (excluding basics)
  if (fmt === 'commander') {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.name, (counts.get(c.name) || 0) + 1);

    for (const [name, count] of counts) {
      if (count > 1) {
        const card = cards.find(c => c.name === name);
        const type = card?.type_line || '';
        const isBasic = /\bBasic\b/i.test(type) || /\bBasic Land\b/i.test(type);
        if (!isBasic) illegal.push({ name, reason: `duplicate copies (${count})` });
      }
    }
  }

  return { illegal, warnings };
}