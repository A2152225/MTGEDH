import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

let count = 0;
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
    count++;
    const key = String(t.event || 'unknown');
    const entry = clusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) entry.samples.push(`${card.name}: ${t.effect?.slice(0, 80)}`);
    clusters.set(key, entry);
  }
}

console.log('still unknown filter but detected:', count);
for (const [k, v] of [...clusters.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
  console.log(`[${v.count}] event=${k}`);
  for (const s of v.samples) console.log(' ', s);
}
