/** Dump all full-card ir_gap raw strings. Run: npx tsx scripts/_tmp-dump-ir-gaps.ts */
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
await loadEffectIrParser();

function collectUnknowns(value: unknown, gaps: string[] = []): string[] {
  if (!value || typeof value !== 'object') return gaps;
  if (Array.isArray(value)) {
    for (const x of value) collectUnknowns(x, gaps);
    return gaps;
  }
  const r = value as Record<string, unknown>;
  if (r.kind === 'unknown') {
    const raw = String(r.raw || '').trim();
    if (raw) gaps.push(raw);
    return gaps;
  }
  for (const [k, c] of Object.entries(r)) {
    if (!['raw', 'text', 'effectText'].includes(k)) collectUnknowns(c, gaps);
  }
  return gaps;
}

const cards = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')
) as any[];

const entries: Array<{ card: string; text: string; gaps: string[] }> = [];
const gapSet = new Set<string>();

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
    entries.push({ card: card.name, text, gaps: irGaps });
    for (const g of irGaps) gapSet.add(g);
  }
}

const out = path.join(__dirname, 'out', 'all-full-card-ir-gaps.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ count: entries.length, uniqueGaps: [...gapSet].sort(), entries }, null, 2));
console.log(`entries=${entries.length} uniqueGaps=${gapSet.size}`);
for (const g of [...gapSet].sort()) console.log('GAP:', g.slice(0, 120));
console.log('Wrote', out);
