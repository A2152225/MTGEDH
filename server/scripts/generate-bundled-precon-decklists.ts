import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDER_PRECONS } from '../../shared/src/precons.js';
import { fetchWizardsPreconDecklist, parseWizardsDecklistSection } from '../src/services/wizardsPreconDecklists.js';
import { getPreconWizardsAnnouncementUrl } from '../src/data/preconWizardsUrls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(repoRoot, 'server/data/precon-decklists');

function toBundledText(lines: ReturnType<typeof parseWizardsDecklistSection>): string {
  return lines
    .flatMap((line) => Array.from({ length: Math.max(1, line.count || 1) }, () => `1 ${line.name}`))
    .join(' ');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const setDecks = new Map<string, Record<string, string>>();
  let fetchedSets = 0;
  let fetchedDecks = 0;
  let failedDecks = 0;

  for (const yearData of COMMANDER_PRECONS) {
    for (const set of yearData.sets) {
      const setCode = String(set.code || '').trim().toUpperCase();
      const url = getPreconWizardsAnnouncementUrl(setCode);
      if (!url) continue;
      fetchedSets += 1;

      for (const deck of set.decks) {
        try {
          const parsed = await fetchWizardsPreconDecklist(setCode, deck.name, url);
          if (!parsed || parsed.length === 0) {
            console.warn(`[missing] ${setCode} / ${deck.name}`);
            failedDecks += 1;
            continue;
          }

          const totalCards = parsed.reduce((sum, line) => sum + (line.count || 1), 0);
          if (parsed.length < 50 || totalCards < 90) {
            console.warn(
              `[thin] ${setCode} / ${deck.name}: ${parsed.length} unique / ${totalCards} total cards`,
            );
          }

          const bundledText = toBundledText(parsed);
          if (!setDecks.has(setCode)) setDecks.set(setCode, {});
          setDecks.get(setCode)![deck.name] = bundledText;
          fetchedDecks += 1;
          console.log(`[ok] ${setCode} / ${deck.name}: ${totalCards} cards`);
        } catch (err) {
          console.warn(`[missing] ${setCode} / ${deck.name}:`, err instanceof Error ? err.message : err);
          failedDecks += 1;
        }
      }
    }
  }

  for (const [setCode, decks] of setDecks.entries()) {
    const outPath = path.join(outDir, `${setCode}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(decks, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${outPath} (${Object.keys(decks).length} decks)`);
  }

  console.log(`Done. sets=${fetchedSets} decks=${fetchedDecks} failed=${failedDecks}`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
