/**
 * Cluster full-card ir_gap items (unknown IR steps).
 * Run: npx tsx scripts/_tmp-full-card-ir-gap-clusters.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'out', 'full-card-ir-gap-clusters.json');

type Cluster = {
  count: number;
  gap: string;
  cards: string[];
  sampleText: string;
};

await loadEffectIrParser();

const cards = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')
) as any[];

const byGap = new Map<string, Cluster>();
let total = 0;

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card) || isIgnorableCardForIrGap(card)) continue;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;

    const irGaps = hasUnknownIRSteps(text, card.name);
    if (irGaps.length === 0) continue;

    total += 1;
    for (const gap of irGaps) {
      const norm = gap
        .toLowerCase()
        .replace(/\{[^}]+\}/g, '{C}')
        .replace(/\b\d+\b/g, 'N')
        .slice(0, 120);
      const cluster = byGap.get(norm) || {
        count: 0,
        gap: norm,
        cards: [],
        sampleText: text.slice(0, 160),
      };
      cluster.count += 1;
      if (cluster.cards.length < 6 && !cluster.cards.includes(card.name)) {
        cluster.cards.push(card.name);
      }
      byGap.set(norm, cluster);
    }
  }
}

const sorted = [...byGap.values()].sort((a, b) => b.count - a.count);
const report = {
  generatedAt: new Date().toISOString(),
  totalIrGapAbilities: total,
  uniqueGapPatterns: sorted.length,
  topClusters: sorted.slice(0, 80),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`TOTAL_IR_GAP_ABILITIES ${total}`);
console.log(`UNIQUE_PATTERNS ${sorted.length}`);
console.log('\nTOP_CLUSTERS:');
for (const c of sorted.slice(0, 50)) {
  console.log(`[${c.count}] ${c.gap}`);
  console.log(`  e.g. ${c.cards.join(', ')}`);
  console.log(`  ctx: ${c.sampleText.slice(0, 100)}`);
}
console.log(`\nWrote ${outPath}`);
process.exit(0);
