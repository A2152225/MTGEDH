/**
 * Command logic for `npm --workspace @mtgedh/server run issues -- <command>`.
 * Kept separate from the script entry point so it can be unit-tested with an injected writer.
 */
import fs from 'node:fs';
import os from 'node:os';
import {
  countIssueReports,
  getIssueReport,
  getIssueReportsDb,
  listIssueReports,
  reopenIssueReport,
  resolveIssueReport,
  resolveIssueReportsDbFile,
  type IssueListFilter,
  type IssueReportRow,
} from './issueReports.js';
import { formatIssueSummary } from './issueReportsCliFormat.js';

export const ISSUES_CLI_USAGE = `Usage (repo root):  npm run issues [open|closed|all]      (PowerShell 5: also works with "-- open")
       npm --workspace @mtgedh/server run issues -- <command> [options]

Friendly views (each report shows player, game, card, category, description, resolution and a card/game summary):
  (no command) | all                  Every report, newest last
  open                                Only open reports
  closed | resolved                   Only resolved reports (closed = alias of resolved)

Commands:
  list [--open|--resolved|--all]      One line per report (default: --open)
  show <id>                           Show one report in full
  resolve <id> [--note "text"] [--by name]   Mark a report resolved
  reopen <id>                         Clear the resolved state
  export --csv [--open|--resolved|--all] [--out file.csv]   Export as CSV (default: all, to stdout)
  path                                Print the issue database file path

Database: ${'server/data/issue-reports.sqlite'} (override with ISSUE_REPORTS_SQLITE_FILE)`;

export type CliIo = { out: (line: string) => void; err: (line: string) => void };

function oneLine(text: string | null | undefined, max: number): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function pickFilter(args: string[], fallback: IssueListFilter): IssueListFilter {
  if (args.includes('--all')) return 'all';
  if (args.includes('--resolved')) return 'resolved';
  if (args.includes('--open')) return 'open';
  return fallback;
}

function readOption(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  const eq = args.find((a) => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : undefined;
}

function parseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function pretty(json: string | null): string {
  if (!json) return '(none)';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export function formatIssueRow(row: IssueReportRow): string {
  const status = row.resolved_at ? 'RESOLVED' : 'OPEN';
  return [
    `#${row.id}  [${status}]  ${row.created_at}`,
    `Card:       ${row.card_name} (${row.card_zone})${row.card_type_line ? ' — ' + row.card_type_line : ''}`,
    `Player:     ${row.player_name ?? row.player_id} (${row.player_id})   Game: ${row.game_id}`,
    `Category:   ${row.category ?? '(none)'}`,
    `Controller: ${row.card_controller ?? '-'}   Owner: ${row.card_owner ?? '-'}   Build: ${row.client_version ?? '-'}`,
    `Local time: ${row.created_at_local ?? '-'}`,
    '',
    'Description:',
    row.description,
    '',
    'Oracle text:',
    row.card_oracle_text ?? '(none)',
    '',
    `Card ids:   card=${row.card_id ?? '-'} permanent=${row.permanent_id ?? '-'} oracle=${row.card_oracle_id ?? '-'} scryfall=${row.card_scryfall_id ?? '-'}`,
    'Card state:',
    pretty(row.card_state),
    'Game context:',
    pretty(row.game_context),
    '',
    row.resolved_at
      ? `Resolved: ${row.resolved_at}${row.resolved_by ? ' by ' + row.resolved_by : ''}\nNotes: ${row.resolution_notes ?? '(none)'}`
      : 'Resolved: no',
  ].join('\n');
}

const CSV_COLUMNS: Array<keyof IssueReportRow> = [
  'id', 'created_at', 'created_at_local', 'player_id', 'player_name', 'game_id', 'card_id', 'permanent_id',
  'card_name', 'card_oracle_id', 'card_scryfall_id', 'card_type_line', 'card_oracle_text', 'card_zone',
  'card_controller', 'card_owner', 'card_state', 'game_context', 'category', 'description', 'client_version',
  'resolved_at', 'resolved_by', 'resolution_notes',
];

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Neutralize spreadsheet formula injection from player-supplied text.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function issuesToCsv(rows: IssueReportRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Runs a CLI command and returns the process exit code. */
export function runIssuesCli(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'path': {
        io.out(resolveIssueReportsDbFile());
        return 0;
      }
      case 'all':
      case 'open':
      case 'closed':
      case 'resolved':
      case undefined: {
        const filter: IssueListFilter = command === 'open' ? 'open' : command === 'closed' || command === 'resolved' ? 'resolved' : 'all';
        const rows = listIssueReports(filter);
        const label = filter === 'resolved' ? 'closed ' : filter === 'all' ? '' : filter + ' ';
        if (rows.length === 0) {
          io.out(`No ${label}issue reports.`);
          return 0;
        }
        io.out(rows.map(formatIssueSummary).join('\n\n'));
        const c = countIssueReports();
        io.out(`\n${rows.length} ${label}report${rows.length === 1 ? '' : 's'} shown. Totals: ${c.open} open, ${c.resolved} closed. Full detail: issues show <id>`);
        return 0;
      }
      case 'list': {
        const filter = pickFilter(rest, 'open');
        const rows = listIssueReports(filter);
        if (rows.length === 0) {
          io.out(`No ${filter === 'all' ? '' : filter + ' '}issue reports.`);
          return 0;
        }
        for (const r of rows) {
          io.out(
            `#${r.id}\t${r.resolved_at ? 'resolved' : 'open'}\t${r.created_at}\t${oneLine(r.card_name, 30)}\t` +
              `${r.category ?? '-'}\t${oneLine(r.player_name ?? r.player_id, 20)}\t${oneLine(r.description, 80)}`,
          );
        }
        const c = countIssueReports();
        io.out(`\n${rows.length} shown. Totals: ${c.open} open, ${c.resolved} resolved.`);
        return 0;
      }
      case 'show': {
        const id = parseId(rest[0]);
        if (id === null) { io.err('show: a numeric <id> is required.'); return 2; }
        const row = getIssueReport(id);
        if (!row) { io.err(`No issue report #${id}.`); return 1; }
        io.out(formatIssueRow(row));
        return 0;
      }
      case 'resolve': {
        const id = parseId(rest[0]);
        if (id === null) { io.err('resolve: a numeric <id> is required.'); return 2; }
        const note = readOption(rest, '--note');
        const by = readOption(rest, '--by') || process.env.USERNAME || safeUser();
        if (!resolveIssueReport(id, { note, by })) { io.err(`No issue report #${id}.`); return 1; }
        io.out(`Issue #${id} marked resolved.`);
        return 0;
      }
      case 'reopen': {
        const id = parseId(rest[0]);
        if (id === null) { io.err('reopen: a numeric <id> is required.'); return 2; }
        if (!reopenIssueReport(id)) { io.err(`No issue report #${id}.`); return 1; }
        io.out(`Issue #${id} reopened.`);
        return 0;
      }
      case 'export': {
        if (!rest.includes('--csv')) { io.err('export: only --csv is supported (use: export --csv).'); return 2; }
        const csv = issuesToCsv(listIssueReports(pickFilter(rest, 'all'), 100000));
        const outFile = readOption(rest, '--out');
        if (outFile) {
          fs.writeFileSync(outFile, csv, 'utf8');
          io.out(`Wrote ${outFile}`);
        } else {
          io.out(csv.replace(/\n$/, ''));
        }
        return 0;
      }
      case 'help':
      case '--help':
      case '-h': {
        io.out(ISSUES_CLI_USAGE);
        return 0;
      }
      default: {
        io.err(`Unknown command: ${command}`);
        io.err(ISSUES_CLI_USAGE);
        return 2;
      }
    }
  } catch (err) {
    io.err(`Error: ${(err as Error)?.message ?? err}`);
    return 1;
  }
}

function safeUser(): string | undefined {
  try { return os.userInfo().username; } catch { return undefined; }
}

/** Touch the DB so the file/table exist even for an empty `list`. */
export function ensureIssueDbForCli(): void {
  getIssueReportsDb();
}