import fs from 'node:fs';
import path from 'node:path';

type ClauseStats = {
  clause: string;
  clauseLower: string;
  count: number;
  exampleCards: string[];
  evaluation: 'recognized' | 'unknown';
  sampleResult?: boolean;
};

type AuditReport = {
  meta: any;
  recognized?: ClauseStats[];
  unknown?: ClauseStats[];
  topRecognized?: ClauseStats[];
  topUnknown?: ClauseStats[];
};

const WORD_NUMBERS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
]);

const COLORS = new Set(['white', 'blue', 'black', 'red', 'green', 'colorless']);

function signatureFor(clauseLower: string): string {
  const s = String(clauseLower || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Protect quoted strings (card names etc.)
  const quoted = s.replace(/"[^"]+"/g, '"<STR>"');

  const tokens = quoted.split(' ');
  const out: string[] = [];

  for (const raw of tokens) {
    const t = raw
      .replace(/^[,.;:()]+/g, '')
      .replace(/[,.;:()]+$/g, '');

    if (!t) continue;

    if (/^\d+$/.test(t)) {
      out.push('<N>');
      continue;
    }

    if (WORD_NUMBERS.has(t)) {
      out.push('<N>');
      continue;
    }

    if (COLORS.has(t)) {
      out.push('<COLOR>');
      continue;
    }

    // Common structured tokens
    if (t === 'x') {
      out.push('<X>');
      continue;
    }

    out.push(t);
  }

  // Re-inject punctuation-insensitive spacing.
  return out.join(' ');
}

async function main(): Promise<void> {
  const auditPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.cwd(), 'scripts', 'out', 'intervening-if-audit.json');

  if (!fs.existsSync(auditPath)) {
    console.error(`Audit report not found: ${auditPath}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as AuditReport;
  const unknown = Array.isArray(report.unknown) ? report.unknown : [];

  const buckets = new Map<
    string,
    {
      signature: string;
      totalCount: number;
      clauseCount: number;
      examples: Array<{ clause: string; count: number; exampleCards: string[] }>;
    }
  >();

  for (const entry of unknown) {
    const sig = signatureFor(entry.clauseLower);
    const b = buckets.get(sig);
    if (!b) {
      buckets.set(sig, {
        signature: sig,
        totalCount: entry.count,
        clauseCount: 1,
        examples: [{ clause: entry.clauseLower, count: entry.count, exampleCards: entry.exampleCards }],
      });
    } else {
      b.totalCount += entry.count;
      b.clauseCount += 1;
      if (b.examples.length < 20) {
        b.examples.push({ clause: entry.clauseLower, count: entry.count, exampleCards: entry.exampleCards });
      }
    }
  }

  const groups = Array.from(buckets.values()).sort(
    (a, b) => b.totalCount - a.totalCount || b.clauseCount - a.clauseCount || a.signature.localeCompare(b.signature)
  );

  const outDir = path.resolve(process.cwd(), 'scripts', 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const outJson = path.resolve(outDir, 'intervening-if-categories.json');
  fs.writeFileSync(outJson, JSON.stringify({ meta: report.meta, groupCount: groups.length, groups }, null, 2), 'utf8');

  const topLines: string[] = [];
  topLines.push(`# Intervening-if unknown clause categories`);
  topLines.push('');
  topLines.push(`- Generated: ${new Date().toISOString()}`);
  topLines.push(`- Unknown clauses: ${unknown.length}`);
  topLines.push(`- Category groups: ${groups.length}`);
  topLines.push('');

  for (const g of groups.slice(0, 60)) {
    topLines.push(`## ${g.signature}`);
    topLines.push(`- Total occurrences: ${g.totalCount}`);
    topLines.push(`- Unique clause strings: ${g.clauseCount}`);
    topLines.push(`- Examples:`);
    for (const ex of g.examples.slice(0, 8)) {
      topLines.push(`  - (${ex.count}) ${ex.clause}`);
    }
    topLines.push('');
  }

  const outMd = path.resolve(outDir, 'intervening-if-categories.md');
  fs.writeFileSync(outMd, topLines.join('\n'), 'utf8');

  console.log(`Unknown clauses: ${unknown.length}`);
  console.log(`Category groups: ${groups.length}`);
  console.log(`Wrote: ${outJson}`);
  console.log(`Wrote: ${outMd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
