/**
 * Offline bake: populate server/data/precon-decklists.sqlite from legacy JSON and/or Wizards pages.
 *
 * Runtime import reads SQLite only — no live Wizards/Moxfield calls during gameplay.
 *
 * Wizards fetches are throttled (one announcement page per set, delay between sets).
 *
 * Usage:
 *   npx tsx scripts/bake-precon-decklists.ts
 *   npx tsx scripts/bake-precon-decklists.ts --json-only
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
} from '../src/services/preconDecklistStore.js';
import { fetchWizardsPreconDecklist } from '../src/services/wizardsPreconDecklists.js';

const MIN_UNIQUE = 50;
const MIN_TOTAL = 90;

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
  return { jsonOnly, wizardsOnly, setFilter, delayMs, force };
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
      const decksNeedingFetch = set.decks.filter((deck) => {
        const existing = getPreconDecklistLines(setCode, deck.name);
        const total = existing?.reduce((sum, line) => sum + (line.count || 1), 0) ?? 0;
        return force || !existing || existing.length < MIN_UNIQUE || total < MIN_TOTAL;
      });

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
            console.warn(`[missing] ${setCode} / ${deck.name}`);
            failedDecks += 1;
            continue;
          }

          const totalCards = parsed.reduce((sum, line) => sum + (line.count || 1), 0);
          if (parsed.length < MIN_UNIQUE || totalCards < MIN_TOTAL) {
            console.warn(
              `[thin] ${setCode} / ${deck.name}: ${parsed.length} unique / ${totalCards} total cards`,
            );
          }

          upsertPreconDecklist(setCode, deck.name, parsed, {
            source: 'wizards',
            sourceUrl: url,
          });
          fetchedDecks += 1;
          console.log(`[ok] ${setCode} / ${deck.name}: ${parsed.length} unique / ${totalCards} total`);
        } catch (err) {
          console.warn(`[error] ${setCode} / ${deck.name}:`, err instanceof Error ? err.message : err);
          failedDecks += 1;
        }
      }
    }
  }

  return { fetchedSets, fetchedDecks, failedDecks, skippedSets };
}

async function main() {
  const { jsonOnly, wizardsOnly, setFilter, delayMs, force } = parseArgs(process.argv.slice(2));

  console.log(`Precon SQLite path: ${getPreconDecklistDatabasePath()}`);

  if (!wizardsOnly) {
    const { imported, skipped } = importLegacyJsonPreconDecklists();
    console.log(`Legacy JSON import: imported=${imported} skipped=${skipped}`);
  }

  let wizardsStats = { fetchedSets: 0, fetchedDecks: 0, failedDecks: 0, skippedSets: 0 };
  if (!jsonOnly) {
    wizardsStats = await bakeFromWizards(setFilter, delayMs, force);
    console.log(
      `Wizards bake: sets=${wizardsStats.fetchedSets} decks=${wizardsStats.fetchedDecks} failed=${wizardsStats.failedDecks} unmapped=${wizardsStats.skippedSets}`,
    );
  }

  const total = countPreconDecks();
  const thin = listPreconDeckMeta().filter(
    (meta) => meta.uniqueCount < MIN_UNIQUE || meta.cardCount < MIN_TOTAL,
  );

  console.log(`Done. ${total} decks in SQLite.`);
  if (thin.length > 0) {
    console.warn(`Thin/missing decks (${thin.length}):`);
    for (const meta of thin) {
      console.warn(`  ${meta.setCode} / ${meta.deckName}: ${meta.uniqueCount} unique / ${meta.cardCount} total`);
    }
  }

  process.exit(wizardsStats.failedDecks > 0 && total === 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
