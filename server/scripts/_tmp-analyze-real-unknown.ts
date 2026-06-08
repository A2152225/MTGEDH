import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function getOracle(card: { oracle_text?: string; card_faces?: { oracle_text?: string }[] }) {
  return card.card_faces
    ? card.card_faces.map((f) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

function isMinigameOracle(card: { name: string; oracle_text?: string; card_faces?: { oracle_text?: string }[] }) {
  const o = getOracle(card);
  return /\bOBJECTIVE:\b/i.test(o) || /\|\s*\d+\s*pack/i.test(o) || /\(minigame\)/i.test(card.name);
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const clusters = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  const o = getOracle(card);
  if (!o || isMinigameOracle(card)) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    if (serverDetectsTrigger(card, t)) continue;
    const whenChunks = o.split('\n').filter((line) => /^(when|whenever|at)\b/i.test(line.trim()));
    const key = whenChunks.length
      ? whenChunks[0].slice(0, 70).toLowerCase().replace(/\{[^}]+\}/g, '{m}').replace(/\d+/g, 'N')
      : 'no_when_line';
    const entry = clusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) entry.samples.push(`${card.name}: ${whenChunks[0]?.slice(0, 100) || o.slice(0, 100)}`);
    clusters.set(key, entry);
  }
}

const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
console.log('real unknown clusters:', sorted.length);
for (const [k, v] of sorted.slice(0, 40)) {
  console.log(`\n[${v.count}] ${k}`);
  for (const s of v.samples) console.log(' ', s);
}
