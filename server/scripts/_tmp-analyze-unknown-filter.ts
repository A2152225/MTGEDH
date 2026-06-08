import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseTriggeredAbility } from '../../rules-engine/src/oracleTextParser.js';
import { detectTriggeredAbilityEvent } from '../../rules-engine/src/triggeredAbilitiesEventDetection.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function getOracle(card: any) {
  return card.card_faces
    ? card.card_faces.map((f: any) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

function splitOracleTextIntoTriggerChunks(text: string): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  const triggerStart = /^(when|whenever|at)\b/i;
  const abilityWordWithDash = /^[^\u2014]{2,40}\u2014\s*(when|whenever|at)\b/i;
  for (const line of lines) {
    if (triggerStart.test(line)) { chunks.push(line); continue; }
    if (abilityWordWithDash.test(line)) {
      chunks.push(line);
      const idx = line.indexOf('—');
      if (idx >= 0) {
        const afterDash = line.slice(idx + 1).trim();
        if (afterDash) chunks.push(afterDash);
      }
    }
  }
  return chunks;
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const condClusters = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  const o = getOracle(card);
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    let cond = 'unknown';
    for (const chunk of splitOracleTextIntoTriggerChunks(o)) {
      const p = parseTriggeredAbility(chunk);
      if (!p?.triggerCondition) continue;
      const info = detectTriggeredAbilityEvent(p.triggerCondition.toLowerCase(), 'enters_battlefield' as any);
      if (info.filter !== 'unknown_trigger_pattern') {
        cond = p.triggerCondition.slice(0, 70);
        break;
      }
    }
    const key = cond.toLowerCase().replace(/\{[^}]+\}/g, '{m}').replace(/\d+/g, 'N');
    const entry = condClusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) {
      entry.samples.push(`${card.name} detected=${serverDetectsTrigger(card, t)}: ${cond}`);
    }
    condClusters.set(key, entry);
  }
}

const sorted = [...condClusters.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`unknown_trigger_pattern total: ${sorted.reduce((s, [, v]) => s + v.count, 0)} in ${sorted.length} condition clusters`);
for (const [k, v] of sorted.slice(0, 50)) {
  console.log(`\n[${v.count}] ${k}`);
  for (const s of v.samples) console.log(`  ${s}`);
}
