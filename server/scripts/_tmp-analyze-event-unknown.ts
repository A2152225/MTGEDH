import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const clusters = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    if (!serverDetectsTrigger(card, t)) continue;
    const cond = String(t.condition || t.triggerFilter || '').trim();
    const key = cond.slice(0, 80).toLowerCase().replace(/\{[^}]+\}/g, '{m}').replace(/\d+/g, 'N');
    const entry = clusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) entry.samples.push(`${card.name}: ${cond.slice(0, 100)}`);
    clusters.set(key, entry);
  }
}

const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`event_unknown (detected but unknown filter): ${sorted.reduce((s, [, v]) => s + v.count, 0)} triggers in ${sorted.length} clusters`);
for (const [k, v] of sorted.slice(0, 45)) {
  console.log(`\n[${v.count}] ${k}`);
  for (const s of v.samples) console.log(`  ${s}`);
}
