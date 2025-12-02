/**
 * server/src/services/scryfall.ts
 *
 * Scryfall helpers, decklist parser, caching and fetch helpers.
 *
 * Notes:
 * - Uses the built-in global fetch (Node 18+). No external fetch dependency.
 * - In-memory cache keyed by normalized lower-case names.
 * - fetchCardByExactNameStrict implements robust fallbacks:
 *    1) strict quoted exact lookup
 *    2) non-quoted exact lookup
 *    3) wildcard search with '*' replacing spaces (Scryfall search)
 *    4) no-space name attempts (common typo)
 *
 * This improves resolving names like "surge spanner" when exact match fails.
 */

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
    .replace(/\s+/g, " ")
    .replace(/’/g, "'")
    .replace(/\s+\/\/\s+/g, " // ");
}

/**
 * Check if a line should be skipped during deck parsing.
 * This includes sideboard markers, comments, and section headers.
 */
export function shouldSkipDeckLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // Skip sideboard markers and comments
  if (/^(SB:|SIDEBOARD|\/\/|#)/i.test(trimmed)) return true;
  // Skip section headers
  if (/^(DECK|COMMANDER|MAINBOARD|MAYBEBOARD|CONSIDERING)$/i.test(trimmed)) return true;
  return false;
}

/**
 * Strip Moxfield/Scryfall-style set and collector number suffixes from a card name.
 * Handles patterns like:
 *   - "Sol Ring (C14) 276" -> "Sol Ring"
 *   - "Sol Ring (C14:276)" -> "Sol Ring"
 *   - "Sol Ring 276 (C14)" -> "Sol Ring"
 *   - "Sol Ring (commander 2014) 276" -> "Sol Ring"
 * 
 * Note: A similar implementation exists in server/src/db/decks.ts.
 * The duplication is intentional to avoid circular dependencies between db and services.
 */
function stripSetCollectorNumber(name: string): string {
  let result = name;
  
  // Pattern 1: (SET) NUMBER at end - e.g., "(C14) 276" or "(ELD) 331"
  // Set names can be up to 15 chars to handle longer names like "commander 2014"
  result = result.replace(/\s+\([A-Za-z0-9][A-Za-z0-9 ]{0,14}\)\s+\d+[A-Za-z]?$/i, '');
  
  // Pattern 2: (SET:NUMBER) at end - e.g., "(C14:276)"
  result = result.replace(/\s+\([A-Za-z0-9]{2,10}:\d+[A-Za-z]?\)$/i, '');
  
  // Pattern 3: NUMBER (SET) at end - e.g., "276 (C14)"
  result = result.replace(/\s+\d+[A-Za-z]?\s+\([A-Za-z0-9]{2,10}\)$/i, '');
  
  // Pattern 4: Just (SET) at end without number - e.g., "(C14)"
  result = result.replace(/\s+\([A-Za-z0-9]{2,10}\)$/i, '');
  
  // Pattern 5: Trailing collector number only (common in some exports) - e.g., "Sol Ring 276"
  // Collector numbers are 1-4 digits, optionally followed by a letter (e.g., "236a" for variants)
  // Only strip if preceded by whitespace to avoid removing numbers from card names
  result = result.replace(/\s+\d{1,4}[A-Za-z]?$/, '');
  
  return result.trim();
}

export function parseDecklist(list: string): ParsedLine[] {
  // Preprocess: Handle Moxfield copy-paste format where everything is on one line
  // Pattern: "Commander(1) 1 Card Name Creatures(40) 1 Card Name ..."
  // We need to split on section headers and card entries
  let preprocessed = list;
  
  // Check if input looks like Moxfield single-line format (has section headers like "Creatures(40)")
  if (/\w+\(\d+\)/.test(list) && list.split('\n').length <= 3) {
    // Remove section headers like "Commander(1)", "Creatures(40)", "Lands(37)", etc.
    preprocessed = list.replace(/\b(Commander|Creatures?|Sorcery|Sorceries|Instant|Instants|Artifact|Artifacts|Enchantment|Enchantments|Land|Lands|Planeswalker|Planeswalkers|Battle|Battles)\s*\(\d+\)\s*/gi, '\n');
    
    // Split on card entries: "1 Card Name" or "16 Forest"
    // Insert newlines before each card count pattern, but be careful not to break card names with numbers
    preprocessed = preprocessed.replace(/\s+(\d+)\s+([A-Z])/g, '\n$1 $2');
  }
  
  const lines = preprocessed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const acc = new Map<string, number>();

  for (const raw of lines) {
    // Skip sideboard markers, comments, section headers, and empty lines
    if (shouldSkipDeckLine(raw)) continue;

    let name = "";
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

    // Strip Moxfield/Scryfall-style set and collector number suffixes
    name = stripSetCollectorNumber(name);
    
    name = normalizeName(name);
    if (!name) continue;
    acc.set(name, (acc.get(name) || 0) + count);
  }

  return Array.from(acc.entries()).map(([name, count]) => ({ name, count }));
}

/**
 * Expand a parsed decklist into individual card lines.
 * Cards with count > 1 will be expanded into that many separate entries.
 * 
 * Example:
 *   Input: [{ name: "Forest", count: 4 }, { name: "Sol Ring", count: 1 }]
 *   Output: [
 *     { name: "Forest", count: 1 },
 *     { name: "Forest", count: 1 },
 *     { name: "Forest", count: 1 },
 *     { name: "Forest", count: 1 },
 *     { name: "Sol Ring", count: 1 }
 *   ]
 * 
 * This is useful for displaying decklists where each card instance should be shown separately.
 */
export function expandDecklistToIndividualCards(cards: ParsedLine[]): ParsedLine[] {
  const expanded: ParsedLine[] = [];
  for (const card of cards) {
    const count = Math.max(1, card.count || 1);
    for (let i = 0; i < count; i++) {
      expanded.push({ name: card.name, count: 1 });
    }
  }
  return expanded;
}

/**
 * Convert a ParsedLine array to a decklist string format,
 * expanding cards with quantity > 1 into separate lines.
 * 
 * Example:
 *   Input: [{ name: "Forest", count: 4 }, { name: "Sol Ring", count: 1 }]
 *   Output: "1 Forest\n1 Forest\n1 Forest\n1 Forest\n1 Sol Ring"
 */
export function parsedDecklistToExpandedString(cards: ParsedLine[]): string {
  const lines: string[] = [];
  for (const card of cards) {
    const count = Math.max(1, card.count || 1);
    for (let i = 0; i < count; i++) {
      lines.push(`1 ${card.name}`);
    }
  }
  return lines.join('\n');
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
  if (typeof f !== "function") {
    throw new Error("Global fetch is not available. Use Node 18+ or polyfill fetch.");
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
        Accept: "application/json",
        ...(options?.headers || {}),
      },
    });
    if (res.ok) {
      return res.json();
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("Retry-After")) || backoffMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, retryAfter));
      attempt++;
      continue;
    }
    throw new Error(`Scryfall error ${res.status} (${url})`);
  }
}

function toCachedCard(data: any): ScryfallCard {
  // For double-faced cards (transform, modal_dfc, etc.), image_uris is on card_faces, not top-level
  // Use first face's image_uris as fallback when top-level is missing
  const frontFaceImages = data.card_faces?.[0]?.image_uris ?? null;
  const resolvedImageUris = data.image_uris ?? frontFaceImages;

  const card: ScryfallCard = {
    id: data.id,
    name: data.name,
    oracle_id: data.oracle_id,
    cmc: data.cmc,
    mana_cost: data.mana_cost,
    type_line: data.type_line,
    oracle_text: data.oracle_text,
    image_uris: resolvedImageUris
      ? { small: resolvedImageUris.small, normal: resolvedImageUris.normal, art_crop: resolvedImageUris.art_crop }
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
          toughness: f.toughness,
        }))
      : undefined,
  };
  try {
    cache.set(lcKey(card.name), card);
    cache.set(card.id, card);
    if (card.card_faces) {
      for (const f of card.card_faces) if (f.name) cache.set(lcKey(f.name), card);
    }
  } catch (e) {
    /* ignore caching errors */
  }
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

/**
 * Strict-name lookup with fallbacks:
 * 1) quoted exact
 * 2) non-quoted exact
 * 3) wildcard search (replace spaces with '*')
 * 4) no-space attempt
 */
export async function fetchCardByExactNameStrict(name: string): Promise<ScryfallCard> {
  const normalized = normalizeName(name);
  const key = lcKey(normalized);
  const hit = cache.get(key);
  if (hit) return hit;

  // 1) strict quoted exact
  try {
    const quoted = `"${normalized}"`;
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(quoted)}`;
    const data = await doFetchJSON(url);
    return toCachedCard(data);
  } catch (err) {
    // continue to fallback
  }

  // 2) non-quoted exact (less strict)
  try {
    const url2 = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(normalized)}`;
    const data2 = await doFetchJSON(url2);
    return toCachedCard(data2);
  } catch (err) {
    // continue
  }

  // 3) wildcard search if name contains spaces
  // Replace spaces with '*' so "surge spanner" -> "surge*spanner"
  // Use Scryfall search endpoint with name: query
  try {
    if (/\s+/.test(normalized)) {
      const wildcard = normalized.replace(/\s+/g, "*");
      const q = `name:"${wildcard}"`;
      const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints`;
      const res = await doFetchJSON(url);
      if (res && Array.isArray(res.data) && res.data.length > 0) {
        // prefer exact normalized match if present in results
        const exact = res.data.find((c: any) => lcKey(c.name) === key);
        if (exact) return toCachedCard(exact);
        // Check for double-faced cards where a face name matches
        const faceMatch = res.data.find((c: any) => {
          if (Array.isArray(c.card_faces)) {
            return c.card_faces.some((f: any) => f.name && lcKey(f.name) === key);
          }
          return false;
        });
        if (faceMatch) return toCachedCard(faceMatch);
        // otherwise return the first reasonable candidate
        return toCachedCard(res.data[0]);
      }
    }
  } catch (err) {
    // ignore and try next fallback
  }

  // 4) try no-space concatenation (surgespanner)
  try {
    const noSpace = normalized.replace(/\s+/g, "");
    if (noSpace && noSpace !== normalized) {
      try {
        const url3 = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(noSpace)}`;
        const d3 = await doFetchJSON(url3);
        return toCachedCard(d3);
      } catch {}
      // fallback to searching no-space as a name phrase
      try {
        const q = `name:"${noSpace}"`;
        const url4 = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints`;
        const r4 = await doFetchJSON(url4);
        if (r4 && Array.isArray(r4.data) && r4.data.length > 0) return toCachedCard(r4.data[0]);
      } catch {}
    }
  } catch (err) {
    // final fallback
  }

  // 5) Try fuzzy search as last resort for partial names (like single face of double-faced cards)
  try {
    const url5 = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(normalized)}`;
    const data5 = await doFetchJSON(url5);
    return toCachedCard(data5);
  } catch (err) {
    // final fallback failed
  }

  throw new Error(`Scryfall: card not found (strict) for "${name}"`);
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
    const payload = { identifiers: chunk.map((name) => ({ name: normalizeName(name) })) };

    let data: any;
    try {
      data = await doFetchJSON("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // fallback: try to resolve items individually using strict lookup with robust fallbacks
      for (const n of chunk) {
        try {
          const c = await fetchCardByExactNameStrict(n);
          out.set(lcKey(n), c);
        } catch (e) {
          // leave unresolved
        }
        // small throttle
        await new Promise((r) => setTimeout(r, 60));
      }
      // continue to next batch
      if (i + batchSize < pending.length) await new Promise((r) => setTimeout(r, sleepMsBetweenBatches));
      continue;
    }

    if (!Array.isArray(data.data)) throw new Error("Invalid Scryfall /collection response");

    for (const d of data.data) {
      try {
        const card = toCachedCard(d);
        out.set(lcKey(card.name), card);
        // Also add face names for double-faced cards
        if (card.card_faces) {
          for (const f of card.card_faces) {
            if (f.name) out.set(lcKey(f.name), card);
          }
        }
      } catch {
        // ignore individual conversion errors
      }
    }

    if (i + batchSize < pending.length) await new Promise((r) => setTimeout(r, sleepMsBetweenBatches));
  }

  return out;
}

/**
 * Fetch cards from a specific set that match a color identity.
 * This is useful for fetching precon deck cards from Commander sets.
 * 
 * @param setCode - The set code (e.g., "C21", "MOC", "DSC")
 * @param colorIdentity - The color identity to filter by (e.g., "WUB", "RG")
 * @returns Array of ScryfallCard objects matching the criteria
 */
export async function fetchCardsFromSetByColorIdentity(
  setCode: string,
  colorIdentity: string
): Promise<ScryfallCard[]> {
  const results: ScryfallCard[] = [];
  
  // Build the Scryfall search query
  // e.g., "set:c21 id<=WUB" for cards in C21 that fit within WUB color identity
  // Note: 'C' represents colorless and is filtered out since Scryfall uses id<=<colors>
  // For colorless commanders, we search with no color restriction
  const colors = colorIdentity.toUpperCase().split('').filter(c => 'WUBRG'.includes(c));
  const colorQuery = colors.length > 0 ? `id<=${colors.join('')}` : 'id<=C'; // id<=C means colorless only
  const query = `set:${setCode.toLowerCase()} ${colorQuery}`.trim();
  
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=cmc&unique=cards`;
  
  try {
    while (url) {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'MTGEDH-DeckImporter/1.0' }
      });
      
      if (!resp.ok) {
        console.warn(`Scryfall search failed for "${query}": ${resp.status}`);
        break;
      }
      
      const data = await resp.json();
      
      if (data.data && Array.isArray(data.data)) {
        results.push(...data.data);
      }
      
      // Handle pagination
      url = data.has_more ? data.next_page : '';
      
      // Rate limiting
      if (url) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
  } catch (err) {
    console.error(`Error fetching cards from set ${setCode}:`, err);
  }
  
  return results;
}

//
// Deck legality (format-level)
//
export function validateDeck(format: string, cards: ScryfallCard[]): { illegal: { name: string; reason: string }[]; warnings: string[] } {
  const illegal: { name: string; reason: string }[] = [];
  const warnings: string[] = [];
  const fmt = (format || "").toLowerCase();

  // Format legality flags (from Scryfall)
  for (const c of cards) {
    const status = c.legalities?.[fmt];
    if (status && status !== "legal") {
      illegal.push({ name: c.name, reason: `not legal in ${format} (${status})` });
    }
  }

  // Commander singleton rule (excluding basics)
  if (fmt === "commander") {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.name, (counts.get(c.name) || 0) + 1);

    for (const [name, count] of counts) {
      if (count > 1) {
        const card = cards.find((c) => c.name === name);
        const type = card?.type_line || "";
        const isBasic = /\bBasic\b/i.test(type) || /\bBasic Land\b/i.test(type);
        if (!isBasic) illegal.push({ name, reason: `duplicate copies (${count})` });
      }
    }
  }

  return { illegal, warnings };
}

//
// Moxfield URL parsing and deck fetching
//

/**
 * Extract the deck ID from a Moxfield URL.
 * Supports various Moxfield URL formats:
 * - https://moxfield.com/decks/{deckId}
 * - https://www.moxfield.com/decks/{deckId}
 * - https://moxfield.com/decks/{deckId}?...
 * 
 * @param url - The Moxfield deck URL
 * @returns The deck ID if found, null otherwise
 */
export function extractMoxfieldDeckId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  
  // Match patterns like moxfield.com/decks/{deckId}
  const match = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

/**
 * Moxfield API response types (subset of what we need)
 */
interface MoxfieldCardEntry {
  quantity: number;
  card: {
    name: string;
    scryfall_id?: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
  };
}

interface MoxfieldDeckResponse {
  id: string;
  name: string;
  format?: string;
  mainboard?: Record<string, MoxfieldCardEntry>;
  commanders?: Record<string, MoxfieldCardEntry>;
  sideboard?: Record<string, MoxfieldCardEntry>;
  companions?: Record<string, MoxfieldCardEntry>;
  // Additional sections that Moxfield API may include
  maybeboard?: Record<string, MoxfieldCardEntry>;
  considering?: Record<string, MoxfieldCardEntry>;
  // Some API versions may use different structures
  boards?: {
    mainboard?: Record<string, MoxfieldCardEntry>;
    commanders?: Record<string, MoxfieldCardEntry>;
    sideboard?: Record<string, MoxfieldCardEntry>;
    companions?: Record<string, MoxfieldCardEntry>;
  };
  publicId?: string;
}

/**
 * Fetch a deck from Moxfield by URL or deck ID.
 * 
 * @param urlOrId - Either a full Moxfield URL or just the deck ID
 * @returns Object containing deck name, commanders, and card list as ParsedLine array
 * @throws Error if the deck cannot be fetched or parsed
 */
export async function fetchDeckFromMoxfield(urlOrId: string): Promise<{
  name: string;
  commanders: string[];
  cards: ParsedLine[];
  format?: string;
}> {
  // Extract deck ID from URL if needed
  const deckId = urlOrId.includes('moxfield.com') 
    ? extractMoxfieldDeckId(urlOrId) 
    : urlOrId;
  
  if (!deckId) {
    throw new Error('Invalid Moxfield URL or deck ID');
  }
  
  // Moxfield API endpoint
  const apiUrl = `https://api2.moxfield.com/v2/decks/all/${encodeURIComponent(deckId)}`;
  
  console.log(`[fetchDeckFromMoxfield] Fetching deck from: ${apiUrl}`);
  
  const f = ensureFetch();
  
  let data: MoxfieldDeckResponse;
  try {
    const response = await f(apiUrl, {
      headers: {
        'User-Agent': 'MTGEDH-DeckImporter/1.0',
        'Accept': 'application/json',
      },
    });
    
    console.log(`[fetchDeckFromMoxfield] Response status: ${response.status}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Moxfield deck not found: ${deckId}`);
      }
      if (response.status === 403) {
        // Cloudflare protection or rate limiting
        console.error(`[fetchDeckFromMoxfield] Access denied (403). This is likely Cloudflare protection. The Moxfield API may require browser-based access.`);
        throw new Error(`Moxfield API access denied (403). The deck may be private or Moxfield is blocking automated requests. Try importing manually by copying the decklist.`);
      }
      throw new Error(`Moxfield API error: ${response.status}`);
    }
    
    data = await response.json() as MoxfieldDeckResponse;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Moxfield')) {
      throw err;
    }
    console.error(`[fetchDeckFromMoxfield] Fetch failed:`, err);
    throw new Error(`Failed to fetch deck from Moxfield: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  // Log raw response structure for debugging (keys only, not the full data)
  const dataKeys = Object.keys(data);
  console.log(`[fetchDeckFromMoxfield] Response keys: ${dataKeys.join(', ')}`);
  
  // Handle alternative API response structure where data might be nested in 'boards'
  const boardsData = data.boards || data;
  
  // Get commanders section (try multiple possible locations)
  const commandersSection = (boardsData as any).commanders || data.commanders || {};
  
  // Get mainboard section (try multiple possible locations)
  const mainboardSection = (boardsData as any).mainboard || data.mainboard || {};
  
  // Log section sizes for debugging
  const commandersSectionSize = Object.keys(commandersSection).length;
  const mainboardSectionSize = Object.keys(mainboardSection).length;
  console.log(`[fetchDeckFromMoxfield] Commanders section: ${commandersSectionSize} entries, Mainboard section: ${mainboardSectionSize} entries`);
  
  // Extract commanders
  const commanders: string[] = [];
  for (const entry of Object.values(commandersSection)) {
    const typedEntry = entry as MoxfieldCardEntry;
    if (typedEntry?.card?.name) {
      commanders.push(typedEntry.card.name);
    }
  }
  
  // Extract cards from all relevant sections
  const cards: ParsedLine[] = [];
  const seenCards = new Set<string>(); // Track cards to avoid duplicates
  
  // Helper function to add cards from a section
  const addCardsFromSection = (section: Record<string, MoxfieldCardEntry> | undefined, sectionName: string) => {
    if (!section || typeof section !== 'object') {
      console.log(`[fetchDeckFromMoxfield] Section "${sectionName}" is empty or invalid`);
      return;
    }
    
    const entries = Object.values(section);
    let addedCount = 0;
    
    for (const entry of entries) {
      if (entry?.card?.name) {
        const normalizedName = entry.card.name.toLowerCase();
        if (!seenCards.has(normalizedName)) {
          cards.push({
            name: entry.card.name,
            count: entry.quantity || 1,
          });
          seenCards.add(normalizedName);
          addedCount++;
        }
      }
    }
    
    if (addedCount > 0) {
      console.log(`[fetchDeckFromMoxfield] Added ${addedCount} cards from "${sectionName}" section`);
    }
  };
  
  // Add commanders first (they should be in the deck)
  addCardsFromSection(commandersSection, 'commanders');
  
  // Add mainboard cards
  addCardsFromSection(mainboardSection, 'mainboard');
  
  // Also check for companions (they should be included in the deck too)
  const companionsSection = (boardsData as any).companions || data.companions;
  addCardsFromSection(companionsSection, 'companions');
  
  // Log total card count for debugging
  const totalCards = cards.reduce((sum, c) => sum + c.count, 0);
  console.log(`[fetchDeckFromMoxfield] Deck "${data.name}": ${cards.length} unique cards, ${totalCards} total cards`);
  
  // Warn if we only got commanders (likely an API issue)
  if (cards.length === commanders.length && commanders.length > 0) {
    console.warn(`[fetchDeckFromMoxfield] Warning: Only commanders found in deck "${data.name}". Mainboard may be empty or API response format may have changed.`);
    console.warn(`[fetchDeckFromMoxfield] Response structure: ${JSON.stringify(dataKeys)}`);
  }
  
  return {
    name: data.name || 'Imported Deck',
    commanders,
    cards,
    format: data.format,
  };
}

/**
 * Check if a string looks like a Moxfield URL
 */
export function isMoxfieldUrl(str: string): boolean {
  return /moxfield\.com\/decks\//i.test(str);
}