import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
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

const cards = JSON.parse(readFileSync('D:/Git/MTGEDH/oracle-cards.json', 'utf8'));
for (const name of ['Sygg, Wanderwine Wisdom', 'Game Knights Live']) {
  const card = cards.find((c: { name: string }) => c.name.startsWith(name));
  if (!card) continue;
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    const audited = effectTextForIrAudit(t.effect);
    const ir = parseOracleTextToIR(audited, card.name);
    const gaps: string[] = [];
    for (const a of ir.abilities || []) {
      for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
    }
    if (gaps.length) {
      console.log('\n===', card.name, t.event, '===');
      console.log('raw effect:', t.effect);
      console.log('audited:', audited);
      console.log('gaps:', gaps);
      console.log('steps:', JSON.stringify(ir.abilities[0]?.steps, null, 2));
    }
  }
}
