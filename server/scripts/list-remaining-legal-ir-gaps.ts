import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

type OracleCard = {
  name: string;
  set?: string;
  set_type?: string;
  border_color?: string;
  legalities?: Record<string, string>;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
};

function isExcludedFromLegalIrGapReport(card: OracleCard): boolean {
  const border = String(card.border_color || '').toLowerCase();
  if (border === 'silver' || border === 'gold') return true;
  if (/\(minigame\)/i.test(card.name)) return true;
  if (!isCommanderLegalCard(card)) return true;
  return false;
}

type GapRow = {
  card: string;
  set: string;
  event: string;
  gap: string;
};

await loadEffectIrParser();

const oraclePath = path.join(repoRoot, 'oracle-cards.json');
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];

const rows: GapRow[] = [];
const byGap = new Map<string, { count: number; cards: string[] }>();

for (const card of cards) {
  if (!isEligible(card)) continue;
  if (isExcludedFromLegalIrGapReport(card)) continue;

  const triggers = parseTriggeredAbilitiesFromText(
    getCombinedOracleText(card),
    'GAP_SRC',
    'P1',
    card.name,
  );

  for (const trigger of triggers) {
    const gaps = hasUnknownIRSteps(trigger.effect, card.name);
    if (!gaps.length) continue;
    const gap = gaps[0];
    rows.push({
      card: card.name,
      set: String(card.set || ''),
      event: String(trigger.event),
      gap,
    });
    const key = gap;
    const entry = byGap.get(key) || { count: 0, cards: [] };
    entry.count += 1;
    if (entry.cards.length < 4 && !entry.cards.includes(card.name)) {
      entry.cards.push(card.name);
    }
    byGap.set(key, entry);
  }
}

const sorted = [...byGap.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

const outDir = path.resolve(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'remaining-legal-ir-gaps.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      filters: {
        auditEligible: true,
        requireCommanderLegal: true,
        excludeSilverGoldBorder: true,
        excludeMinigameNames: true,
      },
      totalTriggersWithGaps: rows.length,
      uniqueGapPatterns: sorted.length,
      patterns: sorted.map(([gap, info]) => ({
        gap,
        count: info.count,
        exampleCards: info.cards,
      })),
      entries: rows,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`Commander-legal triggers with IR gaps: ${rows.length}`);
console.log(`Unique gap patterns: ${sorted.length}`);
console.log(`Wrote ${outPath}`);
