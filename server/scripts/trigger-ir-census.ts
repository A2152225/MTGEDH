/*
  TRIGGER_PRIMARY census: how many Commander-legal trigger clauses parse through the
  trigger-condition IR (parseTriggerClause) versus fall back to the legacy family path.

  Usage (from server/):
    npm run census:triggers
    npm run census:triggers -- --top=50
  Writes docs/trigger-ir-census.md and server/scripts/out/trigger-ir-census.json.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iterateOracleCards, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';
import { stripReminderParentheticals } from '../../rules-engine/src/oracleReminderText.js';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const topArg = process.argv.find((a) => a.startsWith('--top='));
const TOP = topArg ? Math.max(1, Number(topArg.slice(6)) || 30) : 30;

type Face = { name?: string; oracle_text?: string; type_line?: string };
type Card = Face & { legalities?: Record<string, string>; card_faces?: Face[]; layout?: string };

const ABILITY_WORD = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;
const TRIGGER_START = /^(?:when|whenever|at)\b/i;
/** Reflexive / delayed riders that belong to the preceding ability, not standalone triggers. */
const RIDER = /^(?:when (?:you|they|that player) do\b|at the beginning of (?:the|your) next\b|when (?:that|the) (?:creature|token|permanent)s? (?:dies|leaves) this turn\b)/i;

/** Same sentence split the live family matcher uses (triggerConditionFamilyMatch). */
export function triggerSentencesForCensus(oracleText: string): string[] {
  const text = stripReminderParentheticals(String(oracleText || ''))
    .replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, '""');
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    .map((s) => s.trim())
    .filter((s) => TRIGGER_START.test(s.replace(ABILITY_WORD, '')));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Family key: the trigger condition (text before the first comma), name/numbers normalized. */
export function triggerFamilyKey(sentence: string, cardName: string): string {
  let s = sentence.replace(ABILITY_WORD, '');
  const names = [cardName, ...cardName.split(' // '), cardName.split(',')[0]].filter((n) => n && n.length > 2);
  for (const n of names) s = s.replace(new RegExp(escapeRegex(n), 'gi'), '~');
  const comma = s.indexOf(',');
  const head = comma > 0 ? s.slice(0, comma) : s;
  return head.toLowerCase().replace(/\b\d+\b/g, 'N').replace(/\s+/g, ' ').trim();
}

async function main() {
  let cards = 0;
  let clauses = 0;
  let ir = 0;
  let irNoEffect = 0;
  let riders = 0;
  const fallback = new Map<string, { count: number; cards: Set<string>; example: string }>();
  const seenOracle = new Set<string>();
  for await (const raw of iterateOracleCards(resolveOracleCardsPath(repoRoot))) {
    const card = raw as Card & { oracle_id?: string };
    if (card.legalities?.commander !== 'legal') continue;
    const oid = String(card.oracle_id || card.name);
    if (seenOracle.has(oid)) continue;
    seenOracle.add(oid);
    const faces: Face[] = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces : [card];
    let counted = false;
    for (const face of faces) {
      const name = String(face.name || card.name || '');
      for (const sentence of triggerSentencesForCensus(String(face.oracle_text || ''))) {
        if (RIDER.test(sentence.replace(ABILITY_WORD, ''))) { riders += 1; continue; }
        if (!counted) { cards += 1; counted = true; }
        clauses += 1;
        const parsed = parseTriggerClause(sentence, name);
        if (parsed && parsed.effect) { ir += 1; continue; }
        if (parsed) irNoEffect += 1;
        const key = triggerFamilyKey(sentence, name);
        const entry = fallback.get(key) || { count: 0, cards: new Set<string>(), example: '' };
        entry.count += 1;
        entry.cards.add(String(card.name));
        if (!entry.example) entry.example = sentence.slice(0, 200);
        fallback.set(key, entry);
      }
    }
  }
  const ranked = [...fallback.entries()].sort((a, b) => b[1].cards.size - a[1].cards.size);
  const legacy = clauses - ir;
  const pct = (n: number) => (clauses ? ((n / clauses) * 100).toFixed(1) : '0.0');
  const json = {
    generatedAt: new Date().toISOString(),
    commanderLegalCardsWithTriggers: cards,
    triggerClauses: clauses,
    irParsed: ir,
    legacyFallback: legacy,
    irParsedWithoutEffect: irNoEffect,
    ridersExcluded: riders,
    families: ranked.slice(0, 200).map(([key, v]) => ({ key, clauses: v.count, cards: v.cards.size, examples: [...v.cards].slice(0, 5), sample: v.example })),
  };
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'trigger-ir-census.json'), JSON.stringify(json, null, 2));
  const lines = [
    '# Trigger IR census (TRIGGER_PRIMARY coverage)',
    '',
    `Generated ${json.generatedAt} by \`npm run census:triggers\` (server/scripts/trigger-ir-census.ts).`,
    '',
    'A clause counts as IR when `parseTriggerClause` returns a condition and an effect; otherwise',
    'it falls back to the legacy family detectors. Unique Commander-legal oracle cards; each face scanned.',
    '',
    `| Metric | Count |`,
    `|---|---|`,
    `| Commander-legal cards with trigger clauses | ${cards} |`,
    `| Trigger clauses | ${clauses} |`,
    `| Parsed by trigger IR | ${ir} (${pct(ir)}%) |`,
    `| Legacy fallback | ${legacy} (${pct(legacy)}%) |`,
    `| Reflexive/delayed riders excluded ("when you do", "next end step") | ${riders} |`,
    '',
    `## Top ${TOP} legacy-fallback wordings (by cards affected)`,
    '',
    '| # | Trigger condition | Cards | Clauses | Examples |',
    '|---|---|---|---|---|',
    ...ranked.slice(0, TOP).map(([key, v], i) => `| ${i + 1} | ${key.replace(/\|/g, '/')} | ${v.cards.size} | ${v.count} | ${[...v.cards].slice(0, 3).join('; ').replace(/\|/g, '/')} |`),
    '',
  ];
  const docPath = path.join(repoRoot, 'docs', 'trigger-ir-census.md');
  // Keep the hand-maintained "## Before/after" section (and anything after it) across runs.
  let kept = '';
  try {
    const prior = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
    const at = prior.indexOf('\n## Before/after');
    if (at >= 0) kept = prior.slice(at).replace(/\s+$/, '') + '\n';
  } catch { /* first run */ }
  fs.writeFileSync(docPath, lines.join('\n').replace(/\s+$/, '') + '\n' + kept);
  console.log(`cards=${cards} clauses=${clauses} ir=${ir} (${pct(ir)}%) legacy=${legacy}`);
  for (const [key, v] of ranked.slice(0, TOP)) console.log(`${v.cards.size}\t${key}\t| ${[...v.cards].slice(0, 2).join('; ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });