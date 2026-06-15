/**
 * Dump remaining parse→execute gaps.
 * Run: npx tsx scripts/_tmp-probe-batch397-gaps.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import {
  collectStepsFromIrText,
  dryRunOracleSteps,
  isBenignFullCardAbilityMetadata,
  isBenignFullCardReplacementMetadata,
} from './executor-coverage-audit.ts';
import {
  collectUnknownIrGapsFromSteps,
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();
const cards = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')
) as any[];

type Row = { card: string; status: string; text: string };
const rows: Row[] = [];
const byKey = new Map<string, { count: number; cards: string[]; status: string; sample: string }>();

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card) || isIgnorableCardForIrGap(card)) continue;
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const abilitySteps = Array.isArray(ability.steps) ? ability.steps : [];
    if (
      ability.type === 'replacement' &&
      abilitySteps.length === 0 &&
      isBenignFullCardReplacementMetadata(text)
    ) {
      continue;
    }
    if (abilitySteps.length === 0 && isBenignFullCardAbilityMetadata(text)) continue;
    if (isBenignFullCardAbilityMetadata(text)) continue;
    if (
      abilitySteps.length > 0 &&
      abilitySteps.every((step) => step.kind === 'unknown') &&
      isBenignFullCardAbilityMetadata(text)
    ) {
      continue;
    }
    const irGaps =
      abilitySteps.length > 0
        ? collectUnknownIrGapsFromSteps(abilitySteps)
        : hasUnknownIRSteps(text, card.name);
    const steps =
      abilitySteps.length > 0 ? abilitySteps : collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status === 'fully_applied' || rec.status === 'choice_required') continue;
    rows.push({ card: card.name, status: rec.status, text });
    const norm = text.toLowerCase().replace(/\{[^}]+\}/g, '{C}').slice(0, 90);
    const key = `${rec.status}|${norm}`;
    const cluster = byKey.get(key) || { count: 0, cards: [], status: rec.status, sample: text.slice(0, 140) };
    cluster.count += 1;
    if (cluster.cards.length < 5 && !cluster.cards.includes(card.name)) cluster.cards.push(card.name);
    byKey.set(key, cluster);
  }
}

const byStatus: Record<string, number> = {};
for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(`TOTAL_GAPS ${rows.length}`);
console.log('BY_STATUS', byStatus);
console.log('\nTOP_CLUSTERS:');
for (const c of [...byKey.values()].sort((a, b) => b.count - a.count)) {
  console.log(`[${c.count}] ${c.status}`);
  console.log(`  ${c.sample}`);
  console.log(`  e.g. ${c.cards.join(', ')}`);
}
process.exit(0);
