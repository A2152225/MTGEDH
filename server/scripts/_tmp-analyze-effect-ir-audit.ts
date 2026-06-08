import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

async function main() {
  const auditMod = await import('./trigger-coverage-audit.ts');
  // Mirror audit helpers by re-importing after load - use assess path via reading audit output patterns

  const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
  const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
  const mod = await import('../../rules-engine/src/oracleIRParser.js');
  const parseOracleTextToIR = mod.parseOracleTextToIR;

  function effectTextForIrAudit(effectText: string): string {
    const raw = String(effectText || '').trim();
    const stripped = raw
      .replace(/\([^()]*\)/g, ' ')
      .replace(/\s+\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.length >= 4 ? stripped : raw;
  }

  function isIgnorable(raw: string): boolean {
    const n = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    return (
      /^an additional card$/i.test(n) ||
      /^draft a card from this permanent's spellbook$/i.test(n) ||
      /^return this card transformed under its owner's control$/i.test(n) ||
      /^combine it with target host$/i.test(n) ||
      /^collect your reward$/i.test(n) ||
      /^excess combat$/i.test(n) ||
      /^the result$/i.test(n) ||
      /^craft only as a sorcery\.\)?$/i.test(n) ||
      /^augment only as a sorcery\.\)?$/i.test(n) ||
      /^you may forage$/i.test(n) ||
      /^it unspecializes$/i.test(n)
    );
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
      if (raw && !isIgnorable(raw)) gaps.push(raw);
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      collectUnknown(child, gaps);
    }
  }

  const clusters = new Map<string, { count: number; samples: string[] }>();

  for (const card of cards) {
    const o = card.card_faces
      ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
      : String(card.oracle_text || '');
    if (!o) continue;
    const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
    for (const t of parsed) {
      if (!serverDetectsTrigger(card, t)) continue;
      const gaps: string[] = [];
      const ir = parseOracleTextToIR(effectTextForIrAudit(t.effect), card.name);
      for (const ability of ir.abilities || []) {
        for (const step of ability.steps || []) collectUnknown(step, gaps);
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
  let total = 0;
  for (const [, v] of sorted) total += v.count;
  console.log(`audit-style effect_ir_gap: ${total} triggers in ${sorted.length} clusters`);
  for (const [k, v] of sorted.slice(0, 45)) {
    console.log(`\n[${v.count}] ${k}`);
    for (const s of v.samples) console.log(`  ${s}`);
  }
}

main().catch(console.error);
