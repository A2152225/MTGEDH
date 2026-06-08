/**
 * Cluster audit misses without importing trigger-coverage-audit (which runs full scan on load).
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

const auditMod = await import(pathToFileURL('./trigger-coverage-audit.ts').href);
const serverDetectsTrigger = auditMod.serverDetectsTrigger as (card: any, trigger: any) => boolean;

const oraclePath = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8')).meta.oraclePath;
const cards = JSON.parse(readFileSync(oraclePath, 'utf8'));

const clusters = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  const faces = card.card_faces;
  const oracle = Array.isArray(faces) && faces.length
    ? faces.map((f: any) => String(f.oracle_text || '')).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  if (!oracle) continue;
  const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', String(card.name));
  for (const trigger of parsed) {
    if (serverDetectsTrigger(card, trigger)) continue;
    const cond = String(trigger.condition || trigger.triggerFilter || '').trim();
    const key = `[${trigger.event}] ${cond.slice(0, 75).toLowerCase().replace(/\{[^}]+\}/g, '{m}').replace(/\d+/g, 'N')}`;
    const entry = clusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) entry.samples.push(`${card.name}: ${cond.slice(0, 100)}`);
    clusters.set(key, entry);
  }
}

const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`audit not_detected clusters: ${sorted.length}`);
for (const [key, v] of sorted.slice(0, 50)) {
  console.log(`\n[${v.count}] ${key}`);
  for (const s of v.samples) console.log(`  ${s}`);
}
