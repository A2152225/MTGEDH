/**
 * Offline bake: populate server/data/precon-decklists.sqlite from legacy JSON,
 * Wizards announcement pages, MTGJSON Commander decks, and optional Moxfield URLs.
 *
 * Runtime import reads SQLite only — no live Wizards/Moxfield calls during gameplay.
 *
 * Usage:
 *   npx tsx scripts/bake-precon-decklists.ts
 *   npx tsx scripts/bake-precon-decklists.ts --json-only
 *   npx tsx scripts/bake-precon-decklists.ts --mtgjson-only
 *   npx tsx scripts/bake-precon-decklists.ts --sets=CMD,AFC
 *   npx tsx scripts/bake-precon-decklists.ts --sets=MSC --force
 *   PRECON_BAKE_DELAY_MS=4000 npx tsx scripts/bake-precon-decklists.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { COMMANDER_PRECONS } from '../../shared/src/precons.js';
import { getPreconWizardsAnnouncementUrl } from '../src/data/preconWizardsUrls.js';
import { parseWizardsRunOnDecklist } from '../src/services/bundledPreconDecklists.js';
import {
  countPreconDecks,
  getPreconDecklistDatabasePath,
  getPreconDecklistLines,
  listPreconDeckMeta,
  upsertPreconDecklist,
  type PreconDeckSource,
} from '../src/services/preconDecklistStore.js';
import { fetchDeckFromMoxfield, isMoxfieldUrl, type ParsedLine } from '../src/services/scryfall.js';
import { fetchWizardsPreconDecklist } from '../src/services/wizardsPreconDecklists.js';

const MIN_UNIQUE = 50;
const MIN_TOTAL = 90;
const MTGJSON_DECK_LIST_URL = 'https://mtgjson.com/api/v5/DeckList.json';
const MTGJSON_DECK_URL = (fileName: string) =>
  `https://mtgjson.com/api/v5/decks/${encodeURIComponent(fileName)}.json`;

type MtgJsonDeckListEntry = {
  code?: string;
  fileName?: string;
  name?: string;
  type?: string;
};

type MtgJsonDeckCard = {
  name?: string;
  count?: number;
};

type MtgJsonDeckPayload = {
  name?: string;
  code?: string;
  type?: string;
  commander?: MtgJsonDeckCard[];
  mainBoard?: MtgJsonDeckCard[];
  sideBoard?: MtgJsonDeckCard[];
};

function importLegacyJsonPreconDecklists(): { imported: number; skipped: number } {
  const jsonDir = path.join(path.dirname(getPreconDecklistDatabasePath()), 'precon-decklists');
  if (!fs.existsSync(jsonDir)) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  for (const fileName of fs.readdirSync(jsonDir)) {
    if (!fileName.endsWith('.json')) continue;
    const setCode = fileName.replace(/\.json$/i, '').toUpperCase();
    const filePath = path.join(jsonDir, fileName);
    try {
      const decks = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, string>;
      for (const [deckName, rawText] of Object.entries(decks)) {
        const existing = getPreconDecklistLines(setCode, deckName);
        if (existing && existing.length >= MIN_UNIQUE) {
          skipped += 1;
          continue;
        }
        const lines = parseWizardsRunOnDecklist(rawText);
        if (lines.length < MIN_UNIQUE) {
          skipped += 1;
          continue;
        }
        upsertPreconDecklist(setCode, deckName, lines, {
          source: 'json-import',
          sourceUrl: null,
          fetchedAt: fs.statSync(filePath).mtimeMs,
        });
        imported += 1;
      }
    } catch (error) {
      console.warn(`[json-import] failed ${filePath}:`, error);
    }
  }

  return { imported, skipped };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]) {
  const jsonOnly = argv.includes('--json-only');
  const wizardsOnly = argv.includes('--wizards-only');
  const moxfieldOnly = argv.includes('--moxfield-only');
  const mtgjsonOnly = argv.includes('--mtgjson-only');
  const force = argv.includes('--force');
  const setsArg = argv.find((arg) => arg.startsWith('--sets='));
  const setFilter = setsArg
    ? new Set(
        setsArg
          .slice('--sets='.length)
          .split(',')
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
      )
    : null;
  const delayMs = Math.max(0, Number.parseInt(process.env.PRECON_BAKE_DELAY_MS || '3000', 10) || 3000);
  return { jsonOnly, wizardsOnly, moxfieldOnly, mtgjsonOnly, setFilter, delayMs, force };
}

function deckNeedsBake(setCode: string, deckName: string, force: boolean): boolean {
  const existing = getPreconDecklistLines(setCode, deckName);
  const total = existing?.reduce((sum, line) => sum + (line.count || 1), 0) ?? 0;
  return force || !existing || existing.length < MIN_UNIQUE || total < MIN_TOTAL;
}

function mergeCardLines(cards: MtgJsonDeckCard[]): ParsedLine[] {
  const merged = new Map<string, ParsedLine>();
  for (const card of cards) {
    const name = String(card?.name || '').trim();
    if (!name) continue;
    const count = Math.max(1, Number(card.count) || 1);
    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) existing.count += count;
    else merged.set(key, { name, count });
  }
  return [...merged.values()];
}

function upsertParsedDeck(
  setCode: string,
  deckName: string,
  parsed: ParsedLine[],
  meta: { source: PreconDeckSource; sourceUrl?: string | null },
): boolean {
  if (!parsed.length) return false;
  const totalCards = parsed.reduce((sum, line) => sum + (line.count || 1), 0);
  if (parsed.length < MIN_UNIQUE || totalCards < MIN_TOTAL) {
    console.warn(
      `[thin] ${setCode} / ${deckName}: ${parsed.length} unique / ${totalCards} total cards (${meta.source})`,
    );
  }
  upsertPreconDecklist(setCode, deckName, parsed, meta);
  console.log(
    `[ok-${meta.source}] ${setCode} / ${deckName}: ${parsed.length} unique / ${totalCards} total`,
  );
  return true;
}

async function bakeFromWizards(setFilter: Set<string> | null, delayMs: number, force: boolean) {
  let fetchedSets = 0;
  let fetchedDecks = 0;
  let failedDecks = 0;
  let skippedSets = 0;

  for (const yearData of COMMANDER_PRECONS) {
    for (const set of yearData.sets) {
      const setCode = String(set.code || '').trim().toUpperCase();
      if (setFilter && !setFilter.has(setCode)) continue;

      const setUrl = getPreconWizardsAnnouncementUrl(setCode);
      const decksNeedingFetch = set.decks.filter((deck) => deckNeedsBake(setCode, deck.name, force));

      const decksWithUrls = decksNeedingFetch
        .map((deck) => ({
          deck,
          url: getPreconWizardsAnnouncementUrl(setCode, deck.name) || setUrl,
        }))
        .filter((entry) => Boolean(entry.url));

      if (decksNeedingFetch.length > 0 && decksWithUrls.length === 0) {
        skippedSets += 1;
        console.warn(`[skip-set] ${setCode}: no Wizards announcement URL mapped`);
        continue;
      }

      if (decksWithUrls.length === 0) {
        console.log(`[cached] ${setCode}: all ${set.decks.length} decks already in SQLite`);
        continue;
      }

      if (fetchedSets > 0 && delayMs > 0) {
        console.log(`[delay] waiting ${delayMs}ms before fetching ${setCode}...`);
        await sleep(delayMs);
      }

      fetchedSets += 1;
      console.log(`[fetch-set] ${setCode} (${decksWithUrls.length}/${set.decks.length} decks)`);

      for (const { deck, url } of decksWithUrls) {
        try {
          const parsed = await fetchWizardsPreconDecklist(setCode, deck.name, url);
          if (!parsed || parsed.length === 0) {
            console.warn(`[missing-wizards] ${setCode} / ${deck.name}`);
            failedDecks += 1;
            continue;
          }
          if (upsertParsedDeck(setCode, deck.name, parsed, { source: 'wizards', sourceUrl: url })) {
            fetchedDecks += 1;
          } else {
            failedDecks += 1;
          }
        } catch (err) {
          console.warn(`[error] ${setCode} / ${deck.name}:`, err instanceof Error ? err.message : err);
          failedDecks += 1;
        }
      }
    }
  }

  return { fetchedSets, fetchedDecks, failedDecks, skippedSets };
}

async function loadMtgJsonCommanderIndex(): Promise<Map<string, MtgJsonDeckListEntry[]>> {
  const response = await fetch(MTGJSON_DECK_LIST_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`MTGJSON DeckList error: ${response.status}`);
  }
  const body = (await response.json()) as { data?: MtgJsonDeckListEntry[] } | MtgJsonDeckListEntry[];
  const entries = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
  const byName = new Map<string, MtgJsonDeckListEntry[]>();
  for (const entry of entries) {
    if (!/commander/i.test(String(entry.type || ''))) continue;
    const name = String(entry.name || '').trim().toLowerCase();
    if (!name) continue;
    const list = byName.get(name) || [];
    list.push(entry);
    byName.set(name, list);
  }
  return byName;
}

function pickMtgJsonEntry(
  index: Map<string, MtgJsonDeckListEntry[]>,
  setCode: string,
  deckName: string,
): MtgJsonDeckListEntry | null {
  const candidates = index.get(deckName.trim().toLowerCase()) || [];
  if (candidates.length === 0) return null;
  const code = setCode.trim().toUpperCase();
  return (
    candidates.find((entry) => String(entry.code || '').toUpperCase() === code) ||
    candidates.find((entry) => String(entry.fileName || '').toUpperCase().endsWith(`_${code}`)) ||
    candidates[0] ||
    null
  );
}

async function fetchMtgJsonDeckLines(fileName: string): Promise<ParsedLine[]> {
  const response = await fetch(MTGJSON_DECK_URL(fileName), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`MTGJSON deck ${fileName} error: ${response.status}`);
  }
  const body = (await response.json()) as { data?: MtgJsonDeckPayload } | MtgJsonDeckPayload;
  const deck = (body as { data?: MtgJsonDeckPayload }).data || (body as MtgJsonDeckPayload);
  return mergeCardLines([...(deck.commander || []), ...(deck.mainBoard || [])]);
}

async function bakeFromMtgJson(setFilter: Set<string> | null, delayMs: number, force: boolean) {
  let fetchedDecks = 0;
  let failedDecks = 0;
  let skipped = 0;
  let unmapped = 0;

  console.log('[mtgjson] loading DeckList index...');
  const index = await loadMtgJsonCommanderIndex();
  console.log(`[mtgjson] indexed ${index.size} commander deck names`);

  const targets: Array<{ setCode: string; deckName: string; fileName: string }> = [];
  for (const yearData of COMMANDER_PRECONS) {
    for (const set of yearData.sets) {
      const setCode = String(set.code || '').trim().toUpperCase();
      if (setFilter && !setFilter.has(setCode)) continue;
      for (const deck of set.decks) {
        if (!deckNeedsBake(setCode, deck.name, force)) {
          skipped += 1;
          continue;
        }
        const entry = pickMtgJsonEntry(index, setCode, deck.name);
        if (!entry?.fileName) {
          unmapped += 1;
          console.warn(`[unmapped-mtgjson] ${setCode} / ${deck.name}`);
          continue;
        }
        targets.push({ setCode, deckName: deck.name, fileName: entry.fileName });
      }
    }
  }

  console.log(`[mtgjson] ${targets.length} decks to fetch`);

  for (let i = 0; i < targets.length; i += 1) {
    const { setCode, deckName, fileName } = targets[i];
    if (i > 0 && delayMs > 0) await sleep(Math.min(delayMs, 500));
    try {
      const parsed = await fetchMtgJsonDeckLines(fileName);
      if (!parsed.length) {
        console.warn(`[missing-mtgjson] ${setCode} / ${deckName}`);
        failedDecks += 1;
        continue;
      }
      if (
        upsertParsedDeck(setCode, deckName, parsed, {
          source: 'mtgjson',
          sourceUrl: MTGJSON_DECK_URL(fileName),
        })
      ) {
        fetchedDecks += 1;
      } else {
        failedDecks += 1;
      }
    } catch (err) {
      console.warn(
        `[error-mtgjson] ${setCode} / ${deckName}:`,
        err instanceof Error ? err.message : err,
      );
      failedDecks += 1;
    }
  }

  return { fetchedDecks, failedDecks, skipped, unmapped };
}

/** Optional Moxfield fill — often 403 from automated clients; keep as last resort. */
async function bakeFromMoxfield(setFilter: Set<string> | null, delayMs: number, force: boolean) {
  let fetchedDecks = 0;
  let failedDecks = 0;
  let skipped = 0;

  const targets: Array<{ setCode: string; deckName: string; url: string }> = [];
  for (const yearData of COMMANDER_PRECONS) {
    for (const set of yearData.sets) {
      const setCode = String(set.code || '').trim().toUpperCase();
      if (setFilter && !setFilter.has(setCode)) continue;
      for (const deck of set.decks) {
        if (!deckNeedsBake(setCode, deck.name, force)) {
          skipped += 1;
          continue;
        }
        const url = String(deck.decklistUrl || '').trim();
        if (!url || !isMoxfieldUrl(url)) continue;
        targets.push({ setCode, deckName: deck.name, url });
      }
    }
  }

  console.log(`[moxfield] ${targets.length} decks to fetch (${skipped} already cached)`);

  for (let index = 0; index < targets.length; index += 1) {
    const { setCode, deckName, url } = targets[index];
    if (index > 0 && delayMs > 0) await sleep(Math.min(delayMs, 1500));
    try {
      const moxfieldDeck = await fetchDeckFromMoxfield(url);
      const parsed = moxfieldDeck?.cards || [];
      if (!parsed.length) {
        console.warn(`[missing-moxfield] ${setCode} / ${deckName}`);
        failedDecks += 1;
        continue;
      }
      if (upsertParsedDeck(setCode, deckName, parsed, { source: 'moxfield', sourceUrl: url })) {
        fetchedDecks += 1;
      } else {
        failedDecks += 1;
      }
    } catch (err) {
      console.warn(
        `[error-moxfield] ${setCode} / ${deckName}:`,
        err instanceof Error ? err.message : err,
      );
      failedDecks += 1;
    }
  }

  return { fetchedDecks, failedDecks, skipped };
}

async function main() {
  const { jsonOnly, wizardsOnly, moxfieldOnly, mtgjsonOnly, setFilter, delayMs, force } = parseArgs(
    process.argv.slice(2),
  );

  console.log(`Precon SQLite path: ${getPreconDecklistDatabasePath()}`);

  if (!wizardsOnly && !moxfieldOnly && !mtgjsonOnly) {
    const { imported, skipped } = importLegacyJsonPreconDecklists();
    console.log(`Legacy JSON import: imported=${imported} skipped=${skipped}`);
  }

  let wizardsStats = { fetchedSets: 0, fetchedDecks: 0, failedDecks: 0, skippedSets: 0 };
  if (!jsonOnly && !moxfieldOnly && !mtgjsonOnly) {
    wizardsStats = await bakeFromWizards(setFilter, delayMs, force);
    console.log(
      `Wizards bake: sets=${wizardsStats.fetchedSets} decks=${wizardsStats.fetchedDecks} failed=${wizardsStats.failedDecks} unmapped=${wizardsStats.skippedSets}`,
    );
  }

  let mtgjsonStats = { fetchedDecks: 0, failedDecks: 0, skipped: 0, unmapped: 0 };
  if (!jsonOnly && !wizardsOnly && !moxfieldOnly) {
    mtgjsonStats = await bakeFromMtgJson(setFilter, delayMs, force);
    console.log(
      `MTGJSON bake: decks=${mtgjsonStats.fetchedDecks} failed=${mtgjsonStats.failedDecks} skipped=${mtgjsonStats.skipped} unmapped=${mtgjsonStats.unmapped}`,
    );
  }

  let moxfieldStats = { fetchedDecks: 0, failedDecks: 0, skipped: 0 };
  if (!jsonOnly && !wizardsOnly && !mtgjsonOnly && process.env.PRECON_BAKE_MOXFIELD === '1') {
    moxfieldStats = await bakeFromMoxfield(setFilter, delayMs, force);
    console.log(
      `Moxfield bake: decks=${moxfieldStats.fetchedDecks} failed=${moxfieldStats.failedDecks} skipped=${moxfieldStats.skipped}`,
    );
  } else if (moxfieldOnly) {
    moxfieldStats = await bakeFromMoxfield(setFilter, delayMs, force);
    console.log(
      `Moxfield bake: decks=${moxfieldStats.fetchedDecks} failed=${moxfieldStats.failedDecks} skipped=${moxfieldStats.skipped}`,
    );
  }

  const total = countPreconDecks();
  const thin = listPreconDeckMeta().filter(
    (meta) => meta.uniqueCount < MIN_UNIQUE || meta.cardCount < MIN_TOTAL,
  );

  const catalogMissing: string[] = [];
  for (const yearData of COMMANDER_PRECONS) {
    for (const set of yearData.sets) {
      for (const deck of set.decks) {
        if (deckNeedsBake(set.code, deck.name, false)) {
          catalogMissing.push(`${set.code} / ${deck.name}`);
        }
      }
    }
  }

  console.log(`Done. ${total} decks in SQLite.`);
  if (thin.length > 0) {
    console.warn(`Thin decks (${thin.length}):`);
    for (const meta of thin) {
      console.warn(`  ${meta.setCode} / ${meta.deckName}: ${meta.uniqueCount} unique / ${meta.cardCount} total`);
    }
  }
  if (catalogMissing.length > 0) {
    console.warn(`Still missing from catalog (${catalogMissing.length}):`);
    for (const entry of catalogMissing) console.warn(`  ${entry}`);
  }

  const failed = wizardsStats.failedDecks + mtgjsonStats.failedDecks + moxfieldStats.failedDecks;
  process.exit(failed > 0 && total === 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
