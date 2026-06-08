import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseTriggeredAbility } from '../../rules-engine/src/oracleTextParser.js';
import { detectTriggeredAbilityEvent } from '../../rules-engine/src/triggeredAbilitiesEventDetection.js';
import { TriggerEvent } from '../../rules-engine/src/triggeredAbilitiesTypes.js';

function getOracle(card: any) {
  return card.card_faces
    ? card.card_faces.map((f: any) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

function splitChunks(text: string): string[] {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const line of lines) {
    if (/^(when|whenever|at)\b/i.test(line)) chunks.push(line);
  }
  return chunks;
}

function isUnknown(card: any, t: any): boolean {
  if (t.triggerFilter !== 'unknown_trigger_pattern') return false;
  const cond = String(t.condition || '').toLowerCase().trim();
  if (cond && cond !== 'unknown_trigger_pattern') {
    return detectTriggeredAbilityEvent(cond, TriggerEvent).filter === 'unknown_trigger_pattern';
  }
  const oracle = getOracle(card);
  const effectPrefix = String(t.effect || '').toLowerCase().slice(0, 24);
  for (const chunk of splitChunks(oracle)) {
    const parsed = parseTriggeredAbility(chunk);
    if (!parsed?.triggerCondition || !parsed.effect) continue;
    const chunkEffect = String(parsed.effect || '').toLowerCase();
    if (effectPrefix && !chunkEffect.startsWith(effectPrefix.slice(0, 16)) && !effectPrefix.startsWith(chunkEffect.slice(0, 16))) continue;
    if (detectTriggeredAbilityEvent(parsed.triggerCondition.toLowerCase(), TriggerEvent).filter !== 'unknown_trigger_pattern') return false;
  }
  return true;
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const clusters = new Map<string, number>();

for (const card of cards) {
  const o = getOracle(card);
  if (!o) continue;
  for (const t of parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name)) {
    if (!isUnknown(card, t)) continue;
    const key = String(t.effect || '').slice(0, 60).toLowerCase();
    clusters.set(key, (clusters.get(key) || 0) + 1);
  }
}

console.log('event_unknown count:', [...clusters.values()].reduce((a, b) => a + b, 0));
for (const [k, v] of [...clusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`[${v}] ${k}`);
}
