import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../rules-engine/src/oracleIRParser.ts';

const require = createRequire(import.meta.url);
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { streamObject } = require('stream-json/streamers/StreamObject');

type SourceName = 'oracle-cards' | 'AtomicCards';

type AuditArgs = {
  oraclePath: string;
  atomicPath: string;
  outPath: string;
  maxExamples: number;
  top: number;
  includeOracle: boolean;
  includeAtomic: boolean;
};

type AuditCard = {
  name: string;
  oracleText: string;
  oracleId: string;
  source: SourceName;
};

type GapRecord = {
  key: string;
  raw: string;
  gapType: 'unknown-step' | 'unknown-fragment';
  fieldPath: string;
  count: number;
  exampleCards: string[];
  exampleClauses: string[];
  sources: Record<SourceName, number>;
};

type CorpusStats = {
  seenUniqueCards: number;
  scannedOracleCards: number;
  scannedAtomicCards: number;
  skippedDuplicateOracleId: number;
  cardsWithAnyGap: number;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]): AuditArgs {
  const args: AuditArgs = {
    oraclePath: path.join(repoRoot, 'oracle-cards.json'),
    atomicPath: path.join(repoRoot, 'AtomicCards.json'),
    outPath: path.join(repoRoot, 'tools', 'oracle-ir-gap-audit.json'),
    maxExamples: 5,
    top: 100,
    includeOracle: true,
    includeAtomic: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');

    if (arg === '--oracle' && next) {
      args.oraclePath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--atomic' && next) {
      args.atomicPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--out' && next) {
      args.outPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--max-examples' && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) args.maxExamples = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === '--top' && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) args.top = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === '--oracle-only') {
      args.includeOracle = true;
      args.includeAtomic = false;
      continue;
    }
    if (arg === '--atomic-only') {
      args.includeOracle = false;
      args.includeAtomic = true;
      continue;
    }
  }

  return args;
}

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(name: string): string {
  return normalizeText(name).toLowerCase();
}

function buildFallbackOracleId(name: string, oracleText: string): string {
  return `name:${normalizeName(name)}|text:${normalizeText(oracleText).toLowerCase()}`;
}

function shouldIgnoreGap(raw: string, gapType: GapRecord['gapType']): boolean {
  const normalized = normalizeText(raw);
  if (!normalized) return true;
  if (/^\(/.test(normalized)) return true;

  const lower = normalized.toLowerCase();
  if (gapType === 'unknown-step') {
    if (/^(flying|trample|flash|vigilance|haste|first strike|double strike|reach|deathtouch|menace|defender|lifelink|hexproof|ward \{[^}]+\}|indestructible|skulk|prowess|fear|intimidate|horsemanship)$/i.test(normalized)) {
      return true;
    }
    if (/^(flying|trample|flash|vigilance|haste|first strike|double strike|reach|deathtouch|menace|defender|lifelink|hexproof|ward \{[^}]+\}|indestructible|skulk|prowess|fear|intimidate|horsemanship)(?:,\s*(flying|trample|flash|vigilance|haste|first strike|double strike|reach|deathtouch|menace|defender|lifelink|hexproof|ward \{[^}]+\}|indestructible|skulk|prowess|fear|intimidate|horsemanship))+$/i.test(normalized)) {
      return true;
    }
    if (/^(flying|trample|flash|vigilance|haste|first strike|double strike|reach|deathtouch|menace|defender|lifelink|hexproof|ward \{[^}]+\}|indestructible|skulk|prowess|fear|intimidate|horsemanship)\s*\(/i.test(normalized)) {
      return true;
    }
    if (/^enchant\s+/.test(lower)) return true;
    if (/^equip\s+\{[^}]+\}/.test(lower)) return true;
    if (/^morph\s+\{[^}]+\}/.test(lower)) return true;
    if (/^megamorph\s+\{[^}]+\}/.test(lower)) return true;
    if (/^bestow\s+\{[^}]+\}/.test(lower)) return true;
    if (/^prototype\s+\{[^}]+\}\s+[-\d/]+/.test(lower)) return true;
    if (/^devoid\b/.test(lower)) return true;
    if (/^this land enters tapped$/.test(lower)) return true;
    if (/^turn it face up any time for its morph cost\.\)$/.test(lower)) return true;
    if (/^convoke\b/.test(lower)) return true;
    if (/^partner\s*\(/.test(lower)) return true;
    if (/^changeling\s*\(/.test(lower)) return true;
    if (/^this creature can't block$/.test(lower)) return true;
    if (/^this spell costs .* less to cast\b/.test(lower)) return true;
  }

  return false;
}

function isOracleEligible(card: any): boolean {
  if (!card || typeof card !== 'object') return false;
  if (!Array.isArray(card.games) || !card.games.includes('paper')) return false;
  if (card.digital === true || card.oversized === true) return false;
  const setType = String(card.set_type || '').toLowerCase();
  if (setType === 'token' || setType === 'memorabilia' || setType === 'minigame') return false;
  const borderColor = String(card.border_color || '').toLowerCase();
  if (borderColor === 'silver' || borderColor === 'gold') return false;
  return typeof card.oracle_text === 'string' && card.oracle_text.trim().length > 0;
}

function isAtomicEligible(printing: any): boolean {
  if (!printing || typeof printing !== 'object') return false;
  const availability = Array.isArray(printing.availability) ? printing.availability.map((v: unknown) => String(v || '').toLowerCase()) : [];
  if (!availability.includes('paper')) return false;
  const borderColor = String(printing.borderColor || '').toLowerCase();
  if (borderColor === 'silver' || borderColor === 'gold') return false;
  const layout = String(printing.layout || '').toLowerCase();
  if (layout.includes('token')) return false;
  return typeof printing.text === 'string' && printing.text.trim().length > 0;
}

function pushExample(target: string[], value: string, maxExamples: number): void {
  if (!value) return;
  if (target.includes(value)) return;
  if (target.length < maxExamples) target.push(value);
}

function addGap(
  map: Map<string, GapRecord>,
  raw: string,
  gapType: GapRecord['gapType'],
  fieldPath: string,
  card: AuditCard,
  clauseText: string,
  maxExamples: number,
): void {
  const normalizedRaw = normalizeText(raw);
  if (!normalizedRaw) return;
  if (shouldIgnoreGap(normalizedRaw, gapType)) return;
  const key = `${gapType}|${fieldPath}|${normalizedRaw.toLowerCase()}`;
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.sources[card.source] += 1;
    pushExample(existing.exampleCards, card.name, maxExamples);
    pushExample(existing.exampleClauses, normalizeText(clauseText), maxExamples);
    return;
  }

  map.set(key, {
    key,
    raw: normalizedRaw,
    gapType,
    fieldPath,
    count: 1,
    exampleCards: [card.name],
    exampleClauses: normalizeText(clauseText) ? [normalizeText(clauseText)] : [],
    sources: {
      'oracle-cards': card.source === 'oracle-cards' ? 1 : 0,
      AtomicCards: card.source === 'AtomicCards' ? 1 : 0,
    },
  });
}

function collectUnknownFragments(
  value: unknown,
  fieldPath: string,
  clauseText: string,
  card: AuditCard,
  gapMap: Map<string, GapRecord>,
  maxExamples: number,
  rootStep = false,
): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectUnknownFragments(entry, `${fieldPath}[${index}]`, clauseText, card, gapMap, maxExamples);
    });
    return;
  }

  const record = value as Record<string, unknown>;
  const valueKind = String(record.kind || '');
  if (valueKind === 'unknown') {
    addGap(gapMap, String(record.raw || clauseText || ''), rootStep ? 'unknown-step' : 'unknown-fragment', fieldPath, card, clauseText, maxExamples);
    return;
  }

  for (const [childKey, childValue] of Object.entries(record)) {
    if (childKey === 'raw' || childKey === 'text' || childKey === 'effectText') continue;
    const nextPath = fieldPath ? `${fieldPath}.${childKey}` : childKey;
    collectUnknownFragments(childValue, nextPath, clauseText, card, gapMap, maxExamples);
  }
}

function processCard(card: AuditCard, gapMap: Map<string, GapRecord>, stats: CorpusStats, maxExamples: number): void {
  const parsed = parseOracleTextToIR(card.oracleText, card.name);
  let sawGap = false;

  for (const ability of parsed.abilities || []) {
    for (const step of ability.steps || []) {
      const before = gapMap.size;
      collectUnknownFragments(step, String((step as any)?.kind || 'step'), String((step as any)?.raw || ability.effectText || ability.text || card.oracleText), card, gapMap, maxExamples, true);
      if (gapMap.size !== before) sawGap = true;
    }
  }

  if (sawGap) stats.cardsWithAnyGap += 1;
}

async function readOracleCards(args: AuditArgs, seenOracleIds: Set<string>, gapMap: Map<string, GapRecord>, stats: CorpusStats): Promise<void> {
  if (!args.includeOracle || !fs.existsSync(args.oraclePath)) return;

  const pipeline = chain([
    fs.createReadStream(args.oraclePath),
    parser(),
    streamArray(),
  ]);

  for await (const chunk of pipeline) {
    const card = chunk?.value;
    if (!isOracleEligible(card)) continue;

    const oracleText = String(card.oracle_text || '');
    const oracleId = String(card.oracle_id || card.id || buildFallbackOracleId(String(card.name || ''), oracleText));
    if (seenOracleIds.has(oracleId)) {
      stats.skippedDuplicateOracleId += 1;
      continue;
    }
    seenOracleIds.add(oracleId);

    const auditCard: AuditCard = {
      name: String(card.name || '(unknown)'),
      oracleText,
      oracleId,
      source: 'oracle-cards',
    };
    stats.scannedOracleCards += 1;
    stats.seenUniqueCards += 1;
    processCard(auditCard, gapMap, stats, args.maxExamples);
  }
}

async function readAtomicCards(args: AuditArgs, seenOracleIds: Set<string>, gapMap: Map<string, GapRecord>, stats: CorpusStats): Promise<void> {
  if (!args.includeAtomic || !fs.existsSync(args.atomicPath)) return;

  const pipeline = chain([
    fs.createReadStream(args.atomicPath),
    parser(),
    pick({ filter: 'data' }),
    streamObject(),
  ]);

  for await (const chunk of pipeline) {
    const printings = Array.isArray(chunk?.value) ? chunk.value : [];
    for (const printing of printings) {
      if (!isAtomicEligible(printing)) continue;

      const oracleText = String(printing.text || '');
      const oracleId = String(printing.scryfallOracleId || printing.uuid || buildFallbackOracleId(String(printing.name || chunk?.key || ''), oracleText));
      if (seenOracleIds.has(oracleId)) {
        stats.skippedDuplicateOracleId += 1;
        continue;
      }
      seenOracleIds.add(oracleId);

      const auditCard: AuditCard = {
        name: String(printing.name || chunk?.key || '(unknown)'),
        oracleText,
        oracleId,
        source: 'AtomicCards',
      };
      stats.scannedAtomicCards += 1;
      stats.seenUniqueCards += 1;
      processCard(auditCard, gapMap, stats, args.maxExamples);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const stats: CorpusStats = {
    seenUniqueCards: 0,
    scannedOracleCards: 0,
    scannedAtomicCards: 0,
    skippedDuplicateOracleId: 0,
    cardsWithAnyGap: 0,
  };
  const seenOracleIds = new Set<string>();
  const gapMap = new Map<string, GapRecord>();

  await readOracleCards(args, seenOracleIds, gapMap, stats);
  await readAtomicCards(args, seenOracleIds, gapMap, stats);

  const rankedGaps = [...gapMap.values()]
    .sort((left, right) => right.count - left.count || left.raw.localeCompare(right.raw))
    .slice(0, args.top)
    .map((gap, index) => ({
      rank: index + 1,
      ...gap,
    }));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      oraclePath: fs.existsSync(args.oraclePath) ? args.oraclePath : null,
      atomicPath: fs.existsSync(args.atomicPath) ? args.atomicPath : null,
      includeOracle: args.includeOracle,
      includeAtomic: args.includeAtomic,
      maxExamples: args.maxExamples,
      top: args.top,
    },
    stats,
    topGaps: rankedGaps,
  };

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Unique cards parsed: ${stats.seenUniqueCards}`);
  console.log(`Cards with gaps: ${stats.cardsWithAnyGap}`);
  console.log(`Gap records: ${gapMap.size}`);
  console.log(`Wrote report: ${args.outPath}`);
  console.log('Top gaps:');
  for (const gap of rankedGaps.slice(0, Math.min(20, rankedGaps.length))) {
    console.log(`${gap.rank}. [${gap.gapType}] ${gap.raw} (${gap.count})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});