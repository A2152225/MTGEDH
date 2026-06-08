import { readFileSync, writeFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

// Re-import audit helpers by duplicating minimal logic (audit module is heavy).
import { pathToFileURL } from 'url';

async function loadAuditHelpers() {
  const mod = await import('./trigger-coverage-audit.ts');
  return mod as {
    serverDetectsTrigger?: (card: unknown, trigger: unknown) => boolean;
    hasUnknownIRSteps?: (effect: string, cardName: string) => string[];
    effectTextForIrAudit?: (effect: string) => string;
  };
}

function isSilverBorder(card: {
  border_color?: string;
  set_type?: string;
  set?: string;
}): boolean {
  if (card.border_color === 'silver') return true;
  if (card.set_type === 'funny') return true;
  const funnySets = new Set(['ugl', 'unh', 'ust', 'und', 'unf', 'unk', 'ugm', 'uhd', 'acr']);
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

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

// Inline isIgnorable from audit (keep in sync for listing)
function isIgnorableUnknownIrGap(raw: string): boolean {
  const n = raw.trim().toLowerCase();
  if (!n) return true;
  return (
    /^then play passes to the next player$/i.test(n) ||
    /^all players simultaneously reveal their profit cards and/i.test(n) ||
    /^the secretkeeper tells the detective/i.test(n) ||
    /^then if all ten digits are crossed out, you win the game$/i.test(n) ||
    /^then do it two more times\.\)$/i.test(n) ||
    /^you lose the game\.\]$/i.test(n) ||
    /^that player gets a one-time boon with "/i.test(n)
  );
}

type GapEntry = {
  card: string;
  set: string;
  event: string;
  gap: string;
};

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8')) as Array<{
  name: string;
  set?: string;
  border_color?: string;
  set_type?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}>;

const entries: GapEntry[] = [];
const byGap = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  if (isSilverBorder(card)) continue;
  const o = card.card_faces
    ? card.card_faces.map((f) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    const effect = effectTextForIrAudit(t.effect);
    const ir = parseOracleTextToIR(effect, card.name);
    const gaps: string[] = [];
    for (const a of ir.abilities || []) {
      for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
    }
    const filtered = gaps.filter((g) => !isIgnorableUnknownIrGap(g));
    if (!filtered.length) continue;
    const gap = filtered[0];
    entries.push({ card: card.name, set: String(card.set || ''), event: String(t.event), gap });
    const key = gap.toLowerCase();
    const row = byGap.get(key) || { count: 0, samples: [] };
    row.count++;
    if (row.samples.length < 3) row.samples.push(`${card.name} [${t.event}] (${card.set})`);
    byGap.set(key, row);
  }
}

const sorted = [...byGap.entries()].sort((a, b) => b[1].count - a[1].count);
const out = {
  totalTriggersWithGaps: entries.length,
  uniqueGapPatterns: sorted.length,
  gaps: sorted.map(([gap, info]) => ({
    gap,
    count: info.count,
    samples: info.samples,
  })),
  entries,
};

writeFileSync('scripts/out/remaining-legal-ir-gaps.json', JSON.stringify(out, null, 2));
console.log(`Legal/non-silver triggers with IR gaps: ${entries.length}`);
console.log(`Unique gap patterns: ${sorted.length}`);
for (const [gap, info] of sorted.slice(0, 40)) {
  console.log(`\n[${info.count}] ${gap.slice(0, 100)}`);
  for (const s of info.samples) console.log(`  ${s}`);
}
