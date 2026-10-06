/**
 * MTGJSON deck index helpers for the precon bake (scripts/bake-precon-decklists.ts).
 *
 * The bake maps catalog decks (shared/src/precons.ts) to MTGJSON deck files by name. The local
 * DeckList.json index can be older than the AllDeckFiles folder, so newly added deck files are
 * merged in from the folder itself. Only Commander products are indexed: MTGJSON types
 * "Commander Deck" / "MTGO Commander Deck". Land packs, Secret Lair drops, theme/welcome/demo
 * decks, box sets and 60-card Brawl decks are excluded.
 */
import fs from 'node:fs';
import path from 'node:path';

export type MtgJsonDeckListEntry = {
  code?: string;
  fileName?: string;
  name?: string;
  type?: string;
};

export function isCommanderDeckType(type: unknown): boolean {
  return /commander/i.test(String(type || ''));
}

/** Index commander entries by lower-cased name, plus the name without a trailing "(...)" suffix. */
export function buildCommanderDeckIndex(entries: MtgJsonDeckListEntry[]): Map<string, MtgJsonDeckListEntry[]> {
  const byName = new Map<string, MtgJsonDeckListEntry[]>();
  for (const entry of entries) {
    if (!isCommanderDeckType(entry.type)) continue;
    const name = String(entry.name || '').trim().toLowerCase();
    if (!name) continue;
    for (const alias of new Set([name, name.replace(/\s+\([^)]*\)\s*$/, '')])) {
      const list = byName.get(alias) || [];
      list.push(entry);
      byName.set(alias, list);
    }
  }
  return byName;
}

/**
 * Deck files in `decksDir` that the DeckList index does not mention, as index entries.
 * Files that cannot be parsed are reported through `onSkip` and ignored.
 */
export function listLocalDeckEntriesMissingFromIndex(
  decksDir: string,
  knownFileNames: Iterable<string>,
  onSkip?: (fileName: string, reason: string) => void,
): MtgJsonDeckListEntry[] {
  if (!fs.existsSync(decksDir)) return [];
  const known = new Set([...knownFileNames].map((name) => String(name || '').toLowerCase()));
  const extra: MtgJsonDeckListEntry[] = [];
  for (const file of fs.readdirSync(decksDir)) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const fileName = file.slice(0, -'.json'.length);
    if (known.has(fileName.toLowerCase())) continue;
    try {
      const body = JSON.parse(fs.readFileSync(path.join(decksDir, file), 'utf8'));
      const deck = body?.data ?? body;
      extra.push({ code: deck?.code, fileName, name: deck?.name, type: deck?.type });
    } catch (error) {
      onSkip?.(file, error instanceof Error ? error.message : String(error));
    }
  }
  return extra;
}