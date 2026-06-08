import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isEligible,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

type OracleCard = {
  name: string;
  set?: string;
  border_color?: string;
  set_type?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
};

type GapRow = {
  card: string;
  set: string;
  border: string;
  setType: string;
  event: string;
  gap: string;
};

async function main(): Promise<void> {
  await loadEffectIrParser();
  const cards = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8'),
  ) as OracleCard[];

  const rows: GapRow[] = [];
  const byGap = new Map<string, { count: number; cards: string[] }>();
  const seen = new Set<string>();

  for (const card of cards) {
    if (!isEligible(card)) continue;
    const oracleId = `${card.name}:${getCombinedOracleText(card)}`;
    if (seen.has(oracleId)) continue;
    seen.add(oracleId);

    const triggers = parseTriggeredAbilitiesFromText(
      getCombinedOracleText(card),
      'AUDIT',
      'P1',
      card.name,
    );
    for (const trigger of triggers) {
      for (const gap of hasUnknownIRSteps(trigger.effect, card.name)) {
        rows.push({
          card: card.name,
          set: String(card.set || ''),
          border: String(card.border_color || ''),
          setType: String(card.set_type || ''),
          event: String(trigger.event || ''),
          gap,
        });
        const info = byGap.get(gap) || { count: 0, cards: [] };
        info.count += 1;
        if (info.cards.length < 5 && !info.cards.includes(card.name)) info.cards.push(card.name);
        byGap.set(gap, info);
      }
    }
  }

  const outDir = path.resolve(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'all-ir-gaps.json');
  const sorted = [...byGap.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalTriggersWithGaps: rows.length,
        uniqueGapPatterns: sorted.length,
        patterns: sorted.map(([gap, info]) => ({ gap, count: info.count, exampleCards: info.cards })),
        entries: rows,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Triggers with IR gaps: ${rows.length}`);
  console.log(`Unique patterns: ${sorted.length}`);
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
