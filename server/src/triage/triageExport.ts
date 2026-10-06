/**
 * server/src/triage/triageExport.ts
 *
 * Builds one compact JSON digest of triage work that has not been forwarded
 * yet (e.g. to the Bug Fixer bot):
 *   - open player issue reports (issue_reports.resolved_at IS NULL) whose
 *     forwarded_at is still NULL, from server/data/issue-reports.sqlite
 *   - stall report files in logs/stall-reports/ with status "new"
 *
 * Dry run by default: the DB is opened read-only and no file is touched.
 * With mark=true, exactly the exported items are marked: issue rows get
 * forwarded_at (added additively through issueReports' COLUMN_MIGRATIONS;
 * resolved_at is never touched) and stall files get status "forwarded".
 * A missing DB file or report folder yields an empty section, not an error.
 * Safe while the game server runs: WAL mode, a busy timeout, short-lived
 * handles, and stall files are rewritten atomically (tmp + rename).
 *
 * Public entry symbols: buildTriageDigest, TriageDigest, TriageExportOptions.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureIssueReportsSchema, resolveIssueReportsDbFile, type IssueReportRow } from '../db/issueReports.js';
import { resolveGameStallReportDir } from '../state/modules/gameStall/gameStallReportWriter.js';

export const TRIAGE_DEFAULT_MAX_ISSUES = 25;
export const TRIAGE_DEFAULT_MAX_STALLS = 10;
/** Stall reports still marked in_progress are skipped until this old (a crashed recovery never finishes). */
export const TRIAGE_STALE_IN_PROGRESS_MS = 10 * 60_000;
const ORACLE_TEXT_CHARS = 400;
const DESCRIPTION_CHARS = 1500;
const GAME_CONTEXT_CHARS = 800;
const STALL_ACTION_EXCERPT = 8;

export interface TriageExportOptions {
  /** Issue DB file. Default: ISSUE_REPORTS_SQLITE_FILE or server/data/issue-reports.sqlite. */
  issuesDbFile?: string;
  /** Stall report folder. Default: MTGEDH_STALL_REPORT_DIR or <repo>/logs/stall-reports. */
  stallDir?: string;
  /** Mark the exported items as forwarded. Default false (read-only dry run). */
  mark?: boolean;
  maxIssues?: number;
  maxStalls?: number;
  now?: Date;
}

export interface TriageIssueDigest {
  id: number;
  created_at: string;
  player_name: string | null;
  game_id: string;
  card_name: string;
  card_type_line: string | null;
  card_oracle_text: string | null;
  card_zone: string;
  category: string | null;
  description: string;
  game_context: string | null;
}

export interface TriageStallDigest {
  file: string;
  gameId: string | null;
  timestamp: string | null;
  reason: string | null;
  rule: string | null;
  turn: unknown;
  phase: unknown;
  step: unknown;
  stuckSeat: string | null;
  recovery: { status: string | null; result: string | null; gameAdvanced: boolean | null; stages: string[] };
  repeatedActions: string[];
}

export interface TriageDigest {
  generatedAt: string;
  mode: 'dry-run' | 'mark';
  openIssueCount: number;
  unforwardedIssueCount: number;
  newStallCount: number;
  newIssues: TriageIssueDigest[];
  newStalls: TriageStallDigest[];
  marked?: { issues: number; stalls: number };
  notes: string[];
}

function trimText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function capCount(value: number | undefined, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------- issues ---

function openIssuesDb(file: string, write: boolean): Database.Database {
  const handle = write
    ? new Database(file, { fileMustExist: true })
    : (() => {
        try {
          return new Database(file, { readonly: true, fileMustExist: true });
        } catch {
          // Read-only WAL open can fail if the -shm file cannot be created; fall back (no writes are issued).
          return new Database(file, { fileMustExist: true });
        }
      })();
  handle.pragma('busy_timeout = 5000');
  if (write) handle.pragma('journal_mode = WAL');
  return handle;
}

function hasColumn(handle: Database.Database, table: string, column: string): boolean {
  const cols = handle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function toIssueDigest(row: IssueReportRow): TriageIssueDigest {
  return {
    id: row.id,
    created_at: row.created_at_local || row.created_at,
    player_name: row.player_name ?? null,
    game_id: row.game_id,
    card_name: row.card_name,
    card_type_line: row.card_type_line ?? null,
    card_oracle_text: trimText(row.card_oracle_text, ORACLE_TEXT_CHARS),
    card_zone: row.card_zone,
    category: row.category ?? null,
    description: trimText(row.description, DESCRIPTION_CHARS) || '',
    game_context: trimText(row.game_context, GAME_CONTEXT_CHARS),
  };
}

function collectIssues(digest: TriageDigest, file: string, maxIssues: number, mark: boolean, now: Date): void {
  if (file !== ':memory:' && !fs.existsSync(file)) {
    digest.notes.push(`issue DB not found (${file}); no issues exported`);
    return;
  }
  let handle: Database.Database | null = null;
  try {
    handle = openIssuesDb(file, mark);
    const tableExists = handle.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'issue_reports'`).get();
    if (!tableExists) {
      digest.notes.push('issue_reports table does not exist yet; no issues exported');
      return;
    }
    if (mark) ensureIssueReportsSchema(handle);
    const tracked = hasColumn(handle, 'issue_reports', 'forwarded_at');
    const unforwarded = tracked ? 'AND forwarded_at IS NULL' : '';
    digest.openIssueCount = Number(
      (handle.prepare(`SELECT COUNT(*) AS n FROM issue_reports WHERE resolved_at IS NULL`).get() as { n: number }).n || 0,
    );
    digest.unforwardedIssueCount = Number(
      (handle.prepare(`SELECT COUNT(*) AS n FROM issue_reports WHERE resolved_at IS NULL ${unforwarded}`).get() as { n: number }).n || 0,
    );
    const rows = maxIssues > 0
      ? (handle
          .prepare(`SELECT * FROM issue_reports WHERE resolved_at IS NULL ${unforwarded} ORDER BY id ASC LIMIT ?`)
          .all(maxIssues) as IssueReportRow[])
      : [];
    digest.newIssues = rows.map(toIssueDigest);
    if (digest.unforwardedIssueCount > rows.length) {
      digest.notes.push(
        `issues truncated: showing ${rows.length} of ${digest.unforwardedIssueCount} unforwarded open reports (oldest first)`,
      );
    }
    if (mark && rows.length > 0) {
      const update = handle.prepare(`UPDATE issue_reports SET forwarded_at = ? WHERE id = ? AND forwarded_at IS NULL`);
      const stamp = now.toISOString();
      const markAll = handle.transaction((ids: number[]) => {
        let changed = 0;
        for (const id of ids) changed += update.run(stamp, id).changes;
        return changed;
      });
      digest.marked!.issues = markAll(rows.map((r) => r.id));
    }
  } catch (err) {
    digest.notes.push(`issue DB error: ${(err as Error)?.message || String(err)}`);
  } finally {
    try {
      handle?.close();
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------- stalls ---

function describeAction(entry: any): string {
  const parts = [String(entry?.kind || '?')];
  if (entry?.playerId) parts.push(String(entry.playerId));
  const args = entry?.args && typeof entry.args === 'object' ? entry.args : {};
  const argText = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  if (argText) parts.push(argText);
  if (entry?.step) parts.push(`@${String(entry.step)}`);
  return trimText(parts.join(' '), 160) || '?';
}

/**
 * The action window is rewritten after recovery, so keep only entries up to the
 * detection timestamp, collapse consecutive repeats ("... x7") and keep the tail.
 */
function summarizeRepeatedActions(window: any[], detectedAt: unknown): string[] {
  const cutoff = Date.parse(String(detectedAt || ''));
  const before = Number.isFinite(cutoff)
    ? window.filter((entry) => !(Date.parse(String(entry?.at || '')) > cutoff))
    : window;
  const runs: Array<{ text: string; count: number }> = [];
  for (const entry of before.length ? before : window) {
    const text = describeAction(entry);
    const last = runs[runs.length - 1];
    if (last && last.text === text) last.count += 1;
    else runs.push({ text, count: 1 });
  }
  return runs.slice(-STALL_ACTION_EXCERPT).map((r) => (r.count > 1 ? `${r.text} (x${r.count})` : r.text));
}

function toStallDigest(file: string, report: any): TriageStallDigest {
  const detection = report?.detection || {};
  const recovery = report?.recovery || {};
  const window: any[] = Array.isArray(report?.actionWindow) ? report.actionWindow : [];
  const stages: string[] = Array.isArray(recovery.stagesApplied)
    ? recovery.stagesApplied.map((s: any) => {
        const actions = Array.isArray(s?.actions) ? s.actions.join(', ') : '';
        const where = s?.phaseAfter || s?.stepAfter ? ` -> ${s?.phaseAfter ?? '?'}/${s?.stepAfter ?? '?'}` : '';
        return trimText(`stage ${s?.stage ?? '?'}: ${actions}${where}${s?.boardChanged ? ' (board changed)' : ''}`, 240) || '?';
      })
    : [];
  return {
    file,
    gameId: report?.gameId ?? null,
    timestamp: report?.timestamp ?? null,
    reason: trimText(detection.reason, 300),
    rule: detection.rule ?? null,
    turn: report?.turn ?? null,
    phase: report?.phase ?? null,
    step: report?.step ?? null,
    stuckSeat: detection.stuckSeat ?? null,
    recovery: {
      status: recovery.status ?? null,
      result: trimText(recovery.result, 300),
      gameAdvanced: typeof recovery.gameAdvanced === 'boolean' ? recovery.gameAdvanced : null,
      stages,
    },
    repeatedActions: summarizeRepeatedActions(window, report?.timestamp),
  };
}

function markStallFile(filePath: string, now: Date): boolean {
  const current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (current?.status !== 'new') return false;
  current.status = 'forwarded';
  current.forwardedAt = now.toISOString();
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return true;
}

function collectStalls(digest: TriageDigest, dir: string, maxStalls: number, mark: boolean, now: Date): void {
  if (!fs.existsSync(dir)) {
    digest.notes.push(`stall report folder not found (${dir}); no stalls exported`);
    return;
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')).sort();
  } catch (err) {
    digest.notes.push(`stall folder error: ${(err as Error)?.message || String(err)}`);
    return;
  }
  const fresh: Array<{ name: string; report: any }> = [];
  let inProgress = 0;
  let unreadable = 0;
  for (const name of names) {
    const filePath = path.join(dir, name);
    try {
      const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (report?.status !== 'new') continue;
      if (report?.recovery?.status === 'in_progress') {
        const ageMs = now.getTime() - fs.statSync(filePath).mtimeMs;
        if (ageMs < TRIAGE_STALE_IN_PROGRESS_MS) {
          inProgress += 1;
          continue;
        }
      }
      fresh.push({ name, report });
    } catch {
      unreadable += 1;
    }
  }
  digest.newStallCount = fresh.length;
  const picked = fresh.slice(0, maxStalls);
  digest.newStalls = picked.map(({ name, report }) => toStallDigest(name, report));
  if (fresh.length > picked.length) {
    digest.notes.push(`stalls truncated: showing ${picked.length} of ${fresh.length} new stall reports (oldest first)`);
  }
  if (inProgress) digest.notes.push(`${inProgress} stall report(s) still in recovery; left for the next run`);
  if (unreadable) digest.notes.push(`${unreadable} stall report file(s) could not be parsed; skipped`);
  if (mark) {
    for (const { name } of picked) {
      try {
        if (markStallFile(path.join(dir, name), now)) digest.marked!.stalls += 1;
      } catch (err) {
        digest.notes.push(`failed to mark ${name}: ${(err as Error)?.message || String(err)}`);
      }
    }
  }
}

// ------------------------------------------------------------------ main ---

export function buildTriageDigest(options: TriageExportOptions = {}): TriageDigest {
  const now = options.now ?? new Date();
  const mark = Boolean(options.mark);
  const digest: TriageDigest = {
    generatedAt: now.toISOString(),
    mode: mark ? 'mark' : 'dry-run',
    openIssueCount: 0,
    unforwardedIssueCount: 0,
    newStallCount: 0,
    newIssues: [],
    newStalls: [],
    ...(mark ? { marked: { issues: 0, stalls: 0 } } : {}),
    notes: [],
  };
  collectIssues(
    digest,
    options.issuesDbFile || resolveIssueReportsDbFile(),
    capCount(options.maxIssues, TRIAGE_DEFAULT_MAX_ISSUES),
    mark,
    now,
  );
  collectStalls(
    digest,
    options.stallDir || resolveGameStallReportDir(),
    capCount(options.maxStalls, TRIAGE_DEFAULT_MAX_STALLS),
    mark,
    now,
  );
  return digest;
}
