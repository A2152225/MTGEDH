import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCombinedOracleText, hasUnknownIRSteps } from './trigger-coverage-audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cardsPath = path.resolve(__dirname, '../../oracle-cards.json');

type OracleCard = {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
};

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

function collectUnknown(value: unknown, gaps: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((v) => collectUnknown(v, gaps));
  const rec = value as Record<string, unknown>;
  if (rec.kind === 'unknown') {
    gaps.push(String(rec.raw || ''));
    return;
  }
  for (const [k, c] of Object.entries(rec)) {
    if (!['raw', 'text', 'effectText'].includes(k)) collectUnknown(c, gaps);
  }
}

async function main(): Promise<void> {
  const { loadEffectIrParser } = await import('./trigger-coverage-audit.js');
  await loadEffectIrParser();

const targets = [
  'Anje, Maid of Dishonor',
  'The Indomitable',
  'Drana, the Last Bloodchief',
  'Unquestioned Authority',
  'Spellbook Vendor',
  "Serpent's Soul-Jar",
  'Arm-Mounted Anchor',
  'Loxodon Peacekeeper',
  "The Toymaker's Trap",
  'Intellect Devourer',
  'Keen Duelist',
  'Denry Klin, Editor in Chief',
  "Bandit's Talent",
  'Soulgorger Orgg',
  'Rose Room Treasurer',
  'Delaying Shield',
  'Alpharael, Dreaming Acolyte',
  "Dead Man's Chest",
  "Tidus, Yuna's Guardian",
  'Diluvian Primordial',
];

const cards: OracleCard[] = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
const byName = new Map(cards.map((c) => [c.name, c]));

for (const name of targets) {
  const card = byName.get(name);
  if (!card) {
    console.log(`\n=== ${name} === NOT FOUND`);
    continue;
  }
  const oracle = getCombinedOracleText(card);
  const triggers = parseTriggeredAbilitiesFromText(oracle, 'PROBE_SRC', 'P1', name);
  console.log(`\n=== ${name} === (${triggers.length} triggers)`);
  for (const t of triggers) {
    if (!t) continue;
    const gaps = hasUnknownIRSteps(t.effect, name);
    if (!gaps.length) {
      console.log(`  OK event=${t.event} effect=${t.effect.slice(0, 60)}...`);
      continue;
    }
    const audited = effectTextForIrAudit(t.effect);
    console.log(`event: ${t.event}`);
    console.log(`effect raw: ${t.effect.slice(0, 200)}`);
    console.log(`effect audited: ${audited.slice(0, 200)}`);
    console.log(`gaps: ${JSON.stringify(gaps)}`);
    const ir = parseOracleTextToIR(audited, name);
    const allGaps: string[] = [];
    for (const a of ir.abilities || []) {
      for (const s of a.steps || []) collectUnknown(s, allGaps);
    }
    console.log(`IR steps: ${JSON.stringify((ir.abilities?.[0]?.steps || []).map((s) => ({ kind: s.kind, raw: (s as { raw?: string }).raw?.slice(0, 80) })), null, 0)}`);
  }
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
