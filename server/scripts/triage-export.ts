/**
 * Triage export: prints ONE JSON digest of unforwarded open player issue
 * reports and new stall reports, for forwarding to the Bug Fixer bot.
 *
 *   npm run triage:export                 # dry run (read-only)
 *   npm run triage:export -- --mark       # also mark exported items forwarded
 *
 * Options: --mark, --pretty, --max-issues=N (default 25), --max-stalls=N
 * (default 10), --db=<issue-reports.sqlite>, --stall-dir=<folder>.
 * Env overrides: ISSUE_REPORTS_SQLITE_FILE, MTGEDH_STALL_REPORT_DIR.
 */
import { buildTriageDigest } from '../src/triage/triageExport.js';

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return undefined;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: npm run triage:export -- [--mark] [--pretty] [--max-issues=N] [--max-stalls=N] [--db=FILE] [--stall-dir=DIR]\n',
    );
    return;
  }
  const maxIssues = readOption(args, 'max-issues');
  const maxStalls = readOption(args, 'max-stalls');
  const digest = buildTriageDigest({
    mark: args.includes('--mark'),
    issuesDbFile: readOption(args, 'db'),
    stallDir: readOption(args, 'stall-dir'),
    maxIssues: maxIssues !== undefined ? Number(maxIssues) : undefined,
    maxStalls: maxStalls !== undefined ? Number(maxStalls) : undefined,
  });
  process.stdout.write(`${JSON.stringify(digest, null, args.includes('--pretty') ? 2 : 0)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`triage-export failed: ${(err as Error)?.stack || String(err)}\n`);
  process.exitCode = 1;
}
