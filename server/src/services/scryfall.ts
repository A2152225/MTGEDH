// Scryfall fetchers + decklist parser with rate-limit friendly batching
export type ParsedLine = { name: string; count: number };

// Public normalize util so other modules can align keys
export function normalizeName(s: string) {
  return s.trim().replace(/\s+/g, ' ').replace(/’/g, "'");
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

    // Patterns:
    //  - "3 Sol Ring", "3x Sol Ring"
    //  - "Sol Ring x3"
    //  - "Sol Ring" (defaults to 1)
    const mPrefix = raw.match(/^(\d+)x?\s+(.+)$/i);
    if (mPrefix) {
      count = Math.max(1, parseInt(mPrefix[1], 10) || 1);
      name = mPrefix[2];
    } else {
      const mSuffix = raw.match(/^(.*)\s+x(\d+)$/i);
      if (mSuffix) {
        name = mSuffix[1];
        count = Math.max(1, parseInt(mSuffix[2], 10) || 1);
      } else {
        name = raw;
        count = 1; // default when no "x#"
      }
    }

    name = normalizeName(name);
    if (!name) continue;

    acc.set(name, (acc.get(name) || 0) + count);
  }

  return Array.from(acc.entries()).map(([name, count]) => ({ name, count }));
}

export type ScryfallCard = {
  id: string;       // UUID
  name: string;
  oracle_id?: string;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  legalities?: Record<string, string>;
};

const cache = new Map<string, ScryfallCard>(); // keys: lowercase name and card id

function lcKey(name: string) {
  return normalizeName(name).toLowerCase();
}

export async function fetchCardByExactName(name: string): Promise<ScryfallCard> {
  const key = lcKey(name);
  const hit = cache.get(key);
  if (hit) return hit;

  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Scryfall error ${res.status} for ${name}`);
  const data = await res.json();
  const card: ScryfallCard = {
    id: data.id,
    name: data.name,
    oracle_id: data.oracle_id,
    cmc: data.cmc,
    mana_cost: data.mana_cost,
    type_line: data.type_line,
    oracle_text: data.oracle_text,
    legalities: data.legalities
  };
  cache.set(lcKey(card.name), card);
  cache.set(card.id, card);
  return card;
}

// Strict retry: wrap the exact name in quotes as requested
export async function fetchCardByExactNameStrict(name: string): Promise<ScryfallCard> {
  const quoted = `"${normalizeName(name)}"`;
  const key = lcKey(name);
  const hit = cache.get(key);
  if (hit) return hit;

  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(quoted)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Scryfall error ${res.status} for ${name} (strict)`);
  const data = await res.json();
  const card: ScryfallCard = {
    id: data.id,
    name: data.name,
    oracle_id: data.oracle_id,
    cmc: data.cmc,
    mana_cost: data.mana_cost,
    type_line: data.type_line,
    oracle_text: data.oracle_text,
    legalities: data.legalities
  };
  cache.set(lcKey(card.name), card);
  cache.set(card.id, card);
  return card;
}

export async function fetchCardsByExactNamesBatch(names: string[], batchSize = 75): Promise<Map<string, ScryfallCard>> {
  // Return map keyed by normalized lowercase name for reliable lookups
  const out = new Map<string, ScryfallCard>();

  // Resolve cached first
  const pending: string[] = [];
  for (const n of names) {
    const key = lcKey(n);
    const hit = cache.get(key);
    if (hit) {
      out.set(key, hit);
    } else {
      pending.push(n);
    }
  }

  // Chunk pending into /collection requests
  for (let i = 0; i < pending.length; i += batchSize) {
    const chunk = pending.slice(i, i + batchSize);
    const payload = { identifiers: chunk.map(name => ({ name })) };
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Scryfall /collection error ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.data)) throw new Error('Invalid Scryfall collection response');

    for (const d of data.data) {
      const card: ScryfallCard = {
        id: d.id,
        name: d.name,
        oracle_id: d.oracle_id,
        cmc: d.cmc,
        mana_cost: d.mana_cost,
        type_line: d.type_line,
        oracle_text: d.oracle_text,
        legalities: d.legalities
      };
      cache.set(lcKey(card.name), card);
      cache.set(card.id, card);
      out.set(lcKey(card.name), card);
    }

    // Friendly delay between batches
    if (i + batchSize < pending.length) await sleep(120);
  }
  return out;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export function validateDeck(format: string, cards: ScryfallCard[]): { illegal: { name: string; reason: string }[]; warnings: string[] } {
  const illegal: { name: string; reason: string }[] = [];
  const warnings: string[] = [];
  const fmt = format.toLowerCase();

  // Format legality
  for (const c of cards) {
    const status = c.legalities?.[fmt];
    if (status && status !== 'legal') {
      illegal.push({ name: c.name, reason: `not legal in ${format} (${status})` });
    }
  }

  // Commander duplicate rule (ignore Basic Lands)
  if (fmt === 'commander') {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1) {
        const card = cards.find(c => c.name === name);
        const type = card?.type_line || '';
        const isBasic = /\bBasic Land\b/i.test(type) || /\bBasic\b/i.test(type);
        if (!isBasic) illegal.push({ name, reason: `duplicate copies (${count})` });
      }
    }
    if (cards.length !== 100) warnings.push(`deck size is ${cards.length} (Commander typically 100 including commander)`);
  }

  return { illegal, warnings };
}