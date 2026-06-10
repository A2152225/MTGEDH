/**
 * Cluster full-card parse→execute gaps (status other than fully_applied / choice_required).
 * Run: npx tsx scripts/_tmp-full-card-gap-clusters.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'out', 'full-card-gap-clusters.json');

type Cluster = {
  count: number;
  status: string;
  topReason: string;
  topKind: string;
  sample: string;
  cards: string[];
};

type GapRow = {
  card: string;
  status: string;
  text: string;
  reasonCodes: Record<string, number>;
  stepKinds: Record<string, number>;
};

await loadEffectIrParser();

const cards = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')
) as any[];

const rows: GapRow[] = [];
const clusters = new Map<string, Cluster>();
const byStatus: Record<string, number> = {};

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card) || isIgnorableCardForIrGap(card)) continue;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;

    const irGaps = hasUnknownIRSteps(text, card.name);
    if (irGaps.length > 0) continue;

    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status === 'fully_applied' || rec.status === 'choice_required') continue;

    byStatus[rec.status] = (byStatus[rec.status] || 0) + 1;

    const topReason =
      Object.entries(rec.reasonCodes).sort((a, b) => b[1] - a[1])[0]?.[0] || '?';
    const topKind = Object.entries(rec.stepKinds).sort((a, b) => b[1] - a[1])[0]?.[0] || '?';
    const norm = text
      .toLowerCase()
      .replace(/\{[^}]+\}/g, '{C}')
      .replace(/\b\d+\b/g, 'N')
      .slice(0, 90);
    const key = `${rec.status}|${topReason}|${topKind}|${norm}`;

    const cluster = clusters.get(key) || {
      count: 0,
      status: rec.status,
      topReason,
      topKind,
      sample: text.slice(0, 140),
      cards: [],
    };
    cluster.count += 1;
    if (cluster.cards.length < 6 && !cluster.cards.includes(card.name)) {
      cluster.cards.push(card.name);
    }
    clusters.set(key, cluster);

    rows.push({
      card: card.name,
      status: rec.status,
      text,
      reasonCodes: rec.reasonCodes,
      stepKinds: rec.stepKinds,
    });
  }
}

const sortedClusters = [...clusters.values()].sort((a, b) => b.count - a.count);
const impossible = rows.filter((r) => r.status === 'impossible');

const report = {
  generatedAt: new Date().toISOString(),
  totalGaps: rows.length,
  byStatus,
  impossible,
  topClusters: sortedClusters.slice(0, 60),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`TOTAL_GAPS ${rows.length}`);
console.log('BY_STATUS', byStatus);
console.log(`\nIMPOSSIBLE (${impossible.length}):`);
for (const r of impossible) {
  console.log(` - ${r.card}: ${r.text.slice(0, 100)}`);
  console.log(`   reasons ${JSON.stringify(r.reasonCodes)}`);
}
console.log('\nTOP_CLUSTERS:');
for (const c of sortedClusters.slice(0, 30)) {
  console.log(`[${c.count}] ${c.status} | ${c.topReason} | ${c.topKind}`);
  console.log(`  ${c.sample}`);
  console.log(`  e.g. ${c.cards.join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
process.exit(0);
