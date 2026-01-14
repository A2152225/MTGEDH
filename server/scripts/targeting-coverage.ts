/*
  Targeting Template Coverage Report

  Scans local oracle-cards.json and prints counts + samples for
  common targeting restriction phrases.

  This is intended to keep our regex templates aligned with
  real oracle wording (including post-Bloomburrow shortened templates
  like "that entered" / "enters" without explicitly saying "the battlefield").

  Run:
    npm run targeting:coverage --workspace=server

  Optional env:
    TARGETING_COVERAGE_SAMPLE_LIMIT=25
    TARGETING_COVERAGE_ONLY=entered_this_turn,attacking_or_blocking
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OracleCard = {
  oracle_id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
};

// MTGJSON AtomicCards.json is typically:
// { meta: {...}, data: { [cardName]: Array<{ text?: string; originalText?: string; type?: string; ... }> } }
type AtomicCardsRoot = {
  data?: Record<string, Array<Record<string, any>>>;
};

type PatternDef = {
  id: string;
  label: string;
  regex: RegExp;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const oracleCardsPathCandidates = [
  path.join(repoRoot, 'oracle-cards.json'),
  path.join(repoRoot, 'oracle_cards.json'),
];

const atomicCardsPathCandidates = [
  path.join(repoRoot, 'AtomicCards.json'),
  path.join(repoRoot, 'atomicCards.json'),
  path.join(repoRoot, 'atomic_cards.json'),
];

function firstExisting(paths: string[]): string {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No oracle cards json found. Tried: ${paths.join(', ')}`);
}

function firstExistingOrNull(paths: string[]): string | null {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function normalizeOracleText(t: string): string {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

type ScanRow = {
  name: string;
  id?: string;
  text: string;
};

type ScanResult = {
  sourceLabel: string;
  sourcePath: string;
  rowsScanned: number;
  counts: Map<string, number>;
  samples: Map<string, Hit[]>;
};

function scanRows(sourceLabel: string, sourcePath: string, rows: ScanRow[]): ScanResult {
  const counts = new Map<string, number>();
  const samples = new Map<string, Hit[]>();
  for (const def of activePatterns) {
    counts.set(def.id, 0);
    samples.set(def.id, []);
  }

  for (const row of rows) {
    const text = normalizeOracleText(row.text);
    if (!text) continue;

    for (const def of activePatterns) {
      if (!def.regex.test(text)) continue;
      counts.set(def.id, (counts.get(def.id) || 0) + 1);

      const arr = samples.get(def.id)!;
      if (arr.length < SAMPLE_LIMIT) {
        const idx = text.toLowerCase().search(new RegExp(def.regex.source, 'i'));
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + 140);
        const snippet = (idx >= 0 ? text.slice(start, end) : text.slice(0, 180)).trim();
        arr.push({ name: row.name, oracleId: row.id || 'n/a', snippet });
      }
    }
  }

  return { sourceLabel, sourcePath, rowsScanned: rows.length, counts, samples };
}

const PATTERNS: PatternDef[] = [
  // General ETB wording (post-Bloomburrow often omits "the battlefield")
  {
    id: 'etb_when_enters',
    label: 'When … enters (the battlefield)',
    regex: /\bwhen\s+[^.]{0,80}\benters(?:\s+the\s+battlefield)?\b/i,
  },
  {
    id: 'etb_as_enters',
    label: 'As … enters (the battlefield)',
    regex: /\bas\s+[^.]{0,80}\benters(?:\s+the\s+battlefield)?\b/i,
  },
  {
    id: 'etb_whenever_enters',
    label: 'Whenever … enters (the battlefield)',
    regex: /\bwhenever\s+[^.]{0,80}\benters(?:\s+the\s+battlefield)?\b/i,
  },
  {
    id: 'attacking_or_blocking',
    label: 'target attacking or blocking creature',
    regex: /\btarget\s+attacking\s+or\s+blocking\s+creature\b/i,
  },
  {
    id: 'attacked_this_turn',
    label: 'target creature that attacked this turn',
    regex: /\btarget\s+creature\s+that\s+attacked\s+this\s+turn\b/i,
  },
  {
    id: 'blocked_this_turn',
    label: 'target creature that blocked this turn',
    regex: /\btarget\s+creature\s+that\s+blocked\s+this\s+turn\b/i,
  },
  {
    id: 'entered_this_turn',
    label: 'target creature that entered (the battlefield) this turn',
    // post-Bloomburrow: may omit "the battlefield"
    regex: /\btarget\s+creature\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn\b/i,
  },
  {
    id: 'dealt_damage_to_you',
    label: 'target creature that dealt damage to you this turn',
    regex: /\btarget\s+creature\s+that\s+dealt\s+(?:combat\s+)?damage\s+to\s+you\s+this\s+turn\b/i,
  },

  // Counter placement (common oracle targeting templates)
  {
    id: 'p1p1_on_up_to_one_target_creature',
    label: 'Put a +1/+1 counter on up to one target creature',
    regex: /\bput\s+a\s+\+1\/\+1\s+counter\s+on\s+up\s+to\s+one\s+target\s+creature\b/i,
  },
  {
    id: 'm1m1_on_up_to_one_target_creature',
    label: 'Put a -1/-1 counter on up to one target creature',
    regex: /\bput\s+a\s+-1\/-1\s+counter\s+on\s+up\s+to\s+one\s+target\s+creature\b/i,
  },
  {
    id: 'p1p1_on_up_to_n_target_creatures',
    label: 'Put a +1/+1 counter on up to N target creatures',
    regex: /\bput\s+a\s+\+1\/\+1\s+counter\s+on\s+up\s+to\s+(?:one|two|three|four|five|\d+)\s+target\s+creatures\b/i,
  },
  {
    id: 'm1m1_on_up_to_n_target_creatures',
    label: 'Put a -1/-1 counter on up to N target creatures',
    regex: /\bput\s+a\s+-1\/-1\s+counter\s+on\s+up\s+to\s+(?:one|two|three|four|five|\d+)\s+target\s+creatures\b/i,
  },
  {
    id: 'p1p1_on_target_creature_entered_this_turn',
    label: 'Put a +1/+1 counter on target creature that entered (the battlefield) this turn',
    regex: /\bput\s+a\s+\+1\/\+1\s+counter\s+on\s+target\s+creature\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn\b/i,
  },
  {
    id: 'm1m1_on_target_creature_entered_this_turn',
    label: 'Put a -1/-1 counter on target creature that entered (the battlefield) this turn',
    regex: /\bput\s+a\s+-1\/-1\s+counter\s+on\s+target\s+creature\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn\b/i,
  },
];

const SAMPLE_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.TARGETING_COVERAGE_SAMPLE_LIMIT || '20', 10) || 20
);

const ONLY = String(process.env.TARGETING_COVERAGE_ONLY || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const activePatterns = ONLY.length ? PATTERNS.filter(p => ONLY.includes(p.id)) : PATTERNS;

const oracleCardsPath = firstExisting(oracleCardsPathCandidates);

type Hit = { name: string; oracleId: string; snippet: string };

const oracleRaw = fs.readFileSync(oracleCardsPath, 'utf8');
const oracleCards = JSON.parse(oracleRaw) as OracleCard[];
const oracleRows: ScanRow[] = oracleCards.map(c => ({
  name: c.name,
  id: c.oracle_id,
  text: c.oracle_text || '',
}));

const results: ScanResult[] = [];
results.push(scanRows('oracle-cards', oracleCardsPath, oracleRows));

const atomicCardsPath = firstExistingOrNull(atomicCardsPathCandidates);
if (atomicCardsPath) {
  const atomicRaw = fs.readFileSync(atomicCardsPath, 'utf8');
  const atomicRoot = JSON.parse(atomicRaw) as AtomicCardsRoot;
  const data = atomicRoot?.data || {};

  const atomicRows: ScanRow[] = [];
  for (const [name, printings] of Object.entries(data)) {
    if (!Array.isArray(printings)) continue;

    // Prefer a "text" field if present, otherwise "originalText".
    // Some split/DFCs may not be representable cleanly; scanning is best-effort.
    for (let i = 0; i < printings.length; i++) {
      const rec: any = printings[i] || {};
      const text = rec.text ?? rec.originalText ?? '';
      if (!text) continue;
      atomicRows.push({ name, id: rec.uuid ?? rec.scryfallId ?? rec.multiverseId ?? String(i), text });
      break;
    }
  }

  results.push(scanRows('AtomicCards', atomicCardsPath, atomicRows));
}

for (const r of results) {
  console.log(`Source: ${r.sourceLabel}`);
  console.log(`Path:   ${r.sourcePath}`);
  console.log(`Rows scanned: ${r.rowsScanned}`);
  console.log('');

  for (const def of activePatterns) {
    const n = r.counts.get(def.id) || 0;
    console.log(`${def.id}: ${n}  (${def.label})`);

    const arr = r.samples.get(def.id) || [];
    for (const s of arr) {
      console.log(`  - ${s.name} (${s.oracleId}): ${s.snippet}`);
    }

    console.log('');
  }

  console.log('============================================================');
  console.log('');
}
