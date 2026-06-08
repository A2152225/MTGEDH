import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

function isSilverBorder(card: { border_color?: string; set_type?: string; set?: string }): boolean {
  if (card.border_color === 'silver') return true;
  if (card.set_type === 'funny') return true;
  const funnySets = new Set(['ugl', 'unh', 'ust', 'und', 'unf', 'unk', 'ugm', 'uhd']);
  return funnySets.has(String(card.set || '').toLowerCase());
}

function collectGaps(value: unknown): string[] {
  const gaps: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ((v as { kind?: string }).kind === 'unknown') {
      gaps.push(String((v as { raw?: string }).raw || ''));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, c] of Object.entries(v)) {
      if (!['raw', 'text', 'effectText'].includes(k)) walk(c);
    }
  };
  walk(value);
  return gaps;
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const clusters = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  if (isSilverBorder(card)) continue;
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (!serverDetectsTrigger(card, t)) continue;
    const ir = parseOracleTextToIR(effectTextForIrAudit(t.effect), card.name);
    const gaps: string[] = [];
    for (const a of ir.abilities || []) {
      for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
    }
    if (gaps.length === 0) continue;
    const key = gaps[0].slice(0, 90).toLowerCase();
    const entry = clusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) {
      entry.samples.push(`${card.name} [${t.event}]: ${gaps.join(' | ').slice(0, 120)}`);
    }
    clusters.set(key, entry);
  }
}

const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
let total = 0;
for (const [, v] of sorted) total += v.count;
console.log(`non-silver effect_ir_gap triggers: ${total} in ${sorted.length} clusters`);
for (const [k, v] of sorted.slice(0, 50)) {
  console.log(`\n[${v.count}] ${k}`);
  for (const s of v.samples) console.log(`  ${s}`);
}
