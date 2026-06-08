import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

async function main() {
  const { loadEffectIrParser, hasUnknownIRSteps } = await import('./trigger-coverage-audit.ts') as any;
  // Use inline copy - audit doesn't export hasUnknownIRSteps
  const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
  const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

  // Load IR parser same way audit does
  const mod = await import('../../rules-engine/src/oracleIRParser.js');
  const parseOracleTextToIR = mod.parseOracleTextToIR;

  const clusters = new Map<string, { count: number; samples: string[] }>();

  for (const card of cards) {
    const o = card.card_faces
      ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
      : String(card.oracle_text || '');
    if (!o) continue;
    const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
    for (const t of parsed) {
      if (!serverDetectsTrigger(card, t)) continue;
      const parsedIr = parseOracleTextToIR(t.effect, card.name);
      const gaps: string[] = [];
      for (const ability of parsedIr.abilities || []) {
        for (const step of ability.steps || []) {
          collectUnknown(step, gaps);
        }
      }
      if (gaps.length === 0) continue;
      const key = gaps[0].slice(0, 80).toLowerCase().replace(/\{[^}]+\}/g, '{m}').replace(/\d+/g, 'N');
      const entry = clusters.get(key) || { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 2) {
        entry.samples.push(`${card.name} [${t.event}]: ${gaps[0].slice(0, 100)}`);
      }
      clusters.set(key, entry);
    }
  }

  const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`effect_ir_gap clusters: ${sorted.length}, total triggers: ${sorted.reduce((s, [, v]) => s + v.count, 0)}`);
  for (const [k, v] of sorted.slice(0, 40)) {
    console.log(`\n[${v.count}] ${k}`);
    for (const s of v.samples) console.log(`  ${s}`);
  }
}

function collectUnknown(value: unknown, gaps: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectUnknown(entry, gaps);
    return;
  }
  const record = value as Record<string, unknown>;
  if (String(record.kind || '') === 'unknown') {
    const raw = String(record.raw || '').trim();
    if (raw) gaps.push(raw);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'raw' || key === 'text' || key === 'effectText') continue;
    collectUnknown(child, gaps);
  }
}

main().catch(console.error);
