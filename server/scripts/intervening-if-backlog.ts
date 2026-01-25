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
  fallback?: ClauseStats[];
  unknown?: ClauseStats[];
};

function guessBucket(clauseLower: string): string {
  const c = String(clauseLower || '').toLowerCase();

  if (c.includes('clockwise') || c.includes('counterclockwise')) return 'turn-order-direction';
  if (c.includes('tomb of annihilation') || c.includes('dungeon') || c.includes('initiative')) return 'dungeon/initiative';
  if (c.includes('evidence')) return 'evidence/collect';
  if (c.includes('gift')) return 'gift';
  if (c.includes('team')) return 'team';
  if (c.includes("mana ability") || c.includes('activated')) return 'ability/stack-metadata';
  if (c.includes('target')) return 'targeting/stack-metadata';
  if (c.includes('that player') || c.includes('that creature')) return 'needs-event-refs';
  if (c.includes('entered the battlefield') || c.includes('died')) return 'turn-tracking';
  return 'misc';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const maybeAuditPath = args.find((a) => a && !a.startsWith('-'));
  const auditPath = maybeAuditPath
    ? path.resolve(maybeAuditPath)
    : path.resolve(process.cwd(), 'scripts', 'out', 'intervening-if-audit.json');

  if (!fs.existsSync(auditPath)) {
    console.error(`Audit report not found: ${auditPath}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as AuditReport;
  const recognized = Array.isArray(report.recognized) ? report.recognized : [];

  const recognizedNull = recognized.filter((r) => typeof (r as any).sampleResult !== 'boolean');
  recognizedNull.sort((a, b) => b.count - a.count || a.clauseLower.localeCompare(b.clauseLower));

  const outPath = path.resolve(process.cwd(), '..', 'docs', 'intervening-if-recognized-null-backlog.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const lines: string[] = [];
  lines.push('# Intervening-if recognized-null backlog');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Source: server/scripts/out/intervening-if-audit.json`);
  lines.push(`- Recognized-null clause strings: ${recognizedNull.length}`);
  lines.push('');
  lines.push('Each item below is a distinct intervening-if clause string that the evaluator recognizes but returns `null` for under the audit probe context.');
  lines.push('In real gameplay, many become decidable once event refs/stack metadata are plumbed into `isInterveningIfSatisfied()` calls.');
  lines.push('');

  for (const row of recognizedNull) {
    const bucket = guessBucket(row.clauseLower);
    const examples = Array.isArray(row.exampleCards) ? row.exampleCards.slice(0, 6) : [];
    const examplesStr = examples.length ? ` — e.g. ${examples.join(', ')}` : '';
    lines.push(`- [ ] (${row.count}) [${bucket}] ${row.clause}${examplesStr}`);
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Wrote: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
