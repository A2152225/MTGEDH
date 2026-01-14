/*
  Blight Audit (Lorwyn Eclipsed)

  Scans MTGJSON AtomicCards.json for any entries whose *rules text* or keyword list
  mentions the standalone word "Blight" (not just card names).

  Run:
    npm run blight:audit --workspace=server

  Optional env:
    BLIGHT_AUDIT_SAMPLE_LIMIT=50
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type AtomicCardsRoot = {
  data?: Record<string, Array<Record<string, any>>>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const atomicCardsPathCandidates = [
  path.join(repoRoot, 'AtomicCards.json'),
  path.join(repoRoot, 'atomicCards.json'),
  path.join(repoRoot, 'atomic_cards.json'),
];

function firstExistingOrThrow(paths: string[]): string {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`AtomicCards.json not found. Tried: ${paths.join(', ')}`);
}

function normalizeText(t: unknown): string {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const SAMPLE_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.BLIGHT_AUDIT_SAMPLE_LIMIT || '30', 10) || 30
);

const BLIGHT_WORD = /\bblight\b/i;
const BLIGHT_N = /\bblight\s*(\d+)\b/i;

const atomicCardsPath = firstExistingOrThrow(atomicCardsPathCandidates);
const raw = fs.readFileSync(atomicCardsPath, 'utf8');
const root = JSON.parse(raw) as AtomicCardsRoot;
const data = root?.data || {};

type Hit = {
  name: string;
  setCode?: string;
  number?: string;
  snippet: string;
  blightN?: number;
  via: 'text' | 'keywords';
};

const hits: Hit[] = [];
const nCounts = new Map<number, number>();
let rowsScanned = 0;

for (const [name, printings] of Object.entries(data)) {
  if (!Array.isArray(printings)) continue;

  for (const printing of printings) {
    rowsScanned++;

    const textRaw = printing?.text ?? printing?.originalText ?? '';
    const text = normalizeText(textRaw);
    const keywords: string[] = Array.isArray(printing?.keywords)
      ? printing.keywords.map((k: any) => String(k))
      : [];

    const textHasBlight = BLIGHT_WORD.test(text);
    const keywordsHasBlight = keywords.some(k => BLIGHT_WORD.test(String(k)));

    if (!textHasBlight && !keywordsHasBlight) continue;

    // Prefer text hits since that's the user’s key signal.
    const via: Hit['via'] = textHasBlight ? 'text' : 'keywords';

    const m = text.match(BLIGHT_N) || keywords.map(String).join(' ').match(BLIGHT_N);
    const n = m ? Number.parseInt(m[1], 10) : undefined;
    if (Number.isFinite(n)) nCounts.set(n!, (nCounts.get(n!) || 0) + 1);

    const idx = text.toLowerCase().indexOf('blight');
    const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + 160)).trim() : text.slice(0, 220);

    hits.push({
      name,
      setCode: printing?.setCode || printing?.set || printing?.set_code,
      number: printing?.number,
      snippet,
      blightN: Number.isFinite(n) ? n : undefined,
      via,
    });
  }
}

hits.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

console.log(`AtomicCards path: ${atomicCardsPath}`);
console.log(`Rows scanned: ${rowsScanned}`);
console.log(`Hits (text or keywords contain \\bblight\\b): ${hits.length}`);

if (nCounts.size) {
  const sorted = Array.from(nCounts.entries()).sort((a, b) => a[0] - b[0]);
  console.log(`\nBlight N counts (best-effort parse):`);
  for (const [n, c] of sorted) console.log(`  Blight ${n}: ${c}`);
}

console.log(`\nSamples (limit ${SAMPLE_LIMIT}):`);
for (const h of hits.slice(0, SAMPLE_LIMIT)) {
  const tag = h.via === 'keywords' ? '[keywords]' : '[text]';
  const nTag = typeof h.blightN === 'number' ? ` Blight ${h.blightN}` : '';
  const printTag = h.setCode ? ` (${h.setCode}${h.number ? ` #${h.number}` : ''})` : '';
  console.log(`- ${h.name}${printTag}${nTag} ${tag}: ${h.snippet}`);
}

if (hits.length > SAMPLE_LIMIT) {
  console.log(`\n… ${hits.length - SAMPLE_LIMIT} more (increase BLIGHT_AUDIT_SAMPLE_LIMIT).`);
}
