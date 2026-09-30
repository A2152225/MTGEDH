/**
 * Player issue reports ("Report Issue" card right-click menu).
 *
 * Stored in a SEPARATE SQLite file from the game/event database so reports survive game deletion,
 * DB resets and test runs. Default: server/data/issue-reports.sqlite (gitignored via /server/data/).
 * Override with ISSUE_REPORTS_SQLITE_FILE (absolute, cwd-relative, or ':memory:').
 * The table is created automatically on first use (ensure-table step; additive column migration below).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dbDir, '../../..');
export const DEFAULT_ISSUE_REPORTS_DB_FILE = path.join(repoRoot, 'server', 'data', 'issue-reports.sqlite');

export type IssueReportRow = {
  id: number;
  created_at: string;
  created_at_local: string | null;
  player_id: string;
  player_name: string | null;
  game_id: string;
  card_id: string | null;
  permanent_id: string | null;
  card_name: string;
  card_oracle_id: string | null;
  card_scryfall_id: string | null;
  card_type_line: string | null;
  card_oracle_text: string | null;
  card_zone: string;
  card_controller: string | null;
  card_owner: string | null;
  card_state: string | null;
  game_context: string | null;
  category: string | null;
  description: string;
  client_version: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
};

export type NewIssueReport = {
  playerId: string;
  playerName?: string | null;
  gameId: string;
  cardId?: string | null;
  permanentId?: string | null;
  cardName: string;
  cardOracleId?: string | null;
  cardScryfallId?: string | null;
  cardTypeLine?: string | null;
  cardOracleText?: string | null;
  cardZone: string;
  cardController?: string | null;
  cardOwner?: string | null;
  cardState?: unknown;
  gameContext?: unknown;
  category?: string | null;
  description: string;
  clientVersion?: string | null;
  /** Injected for tests. */
  now?: Date;
};

export type IssueListFilter = 'open' | 'resolved' | 'all';

let db: Database.Database | null = null;
let openedFile: string | null = null;

export function resolveIssueReportsDbFile(): string {
  const configured = String(process.env.ISSUE_REPORTS_SQLITE_FILE || '').trim();
  if (!configured) return DEFAULT_ISSUE_REPORTS_DB_FILE;
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

const COLUMN_MIGRATIONS: Array<[string, string]> = [
  // Additive columns for databases created by an older version of this module.
  ['client_version', 'TEXT'],
  ['permanent_id', 'TEXT'],
  ['created_at_local', 'TEXT'],
];

function ensureSchema(handle: Database.Database): void {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS issue_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      created_at_local TEXT,
      player_id TEXT NOT NULL,
      player_name TEXT,
      game_id TEXT NOT NULL,
      card_id TEXT,
      permanent_id TEXT,
      card_name TEXT NOT NULL,
      card_oracle_id TEXT,
      card_scryfall_id TEXT,
      card_type_line TEXT,
      card_oracle_text TEXT,
      card_zone TEXT NOT NULL,
      card_controller TEXT,
      card_owner TEXT,
      card_state TEXT,
      game_context TEXT,
      category TEXT,
      description TEXT NOT NULL,
      client_version TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_issue_reports_resolved ON issue_reports(resolved_at);
    CREATE INDEX IF NOT EXISTS idx_issue_reports_card ON issue_reports(card_name);
    CREATE INDEX IF NOT EXISTS idx_issue_reports_game ON issue_reports(game_id);
  `);
  const existing = new Set(
    (handle.prepare(`PRAGMA table_info(issue_reports)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [name, type] of COLUMN_MIGRATIONS) {
    if (!existing.has(name)) handle.exec(`ALTER TABLE issue_reports ADD COLUMN ${name} ${type}`);
  }
}

export function getIssueReportsDb(): Database.Database {
  const file = resolveIssueReportsDbFile();
  if (db && openedFile === file) return db;
  closeIssueReportsDb();
  if (file !== ':memory:') {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const handle = new Database(file);
  if (file !== ':memory:') {
    handle.pragma('journal_mode = WAL');
    handle.pragma('synchronous = NORMAL');
  }
  ensureSchema(handle);
  db = handle;
  openedFile = file;
  return handle;
}

export function closeIssueReportsDb(): void {
  try {
    db?.close();
  } catch {
    // ignore
  }
  db = null;
  openedFile = null;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Inserts a report and returns its new id. */
export function insertIssueReport(report: NewIssueReport): number {
  const handle = getIssueReportsDb();
  const now = report.now ?? new Date();
  const result = handle
    .prepare(
      `INSERT INTO issue_reports (
        created_at, created_at_local, player_id, player_name, game_id, card_id, permanent_id, card_name,
        card_oracle_id, card_scryfall_id, card_type_line, card_oracle_text, card_zone, card_controller,
        card_owner, card_state, game_context, category, description, client_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      now.toISOString(),
      localIso(now),
      report.playerId,
      report.playerName ?? null,
      report.gameId,
      report.cardId ?? null,
      report.permanentId ?? null,
      report.cardName,
      report.cardOracleId ?? null,
      report.cardScryfallId ?? null,
      report.cardTypeLine ?? null,
      report.cardOracleText ?? null,
      report.cardZone,
      report.cardController ?? null,
      report.cardOwner ?? null,
      toJson(report.cardState),
      toJson(report.gameContext),
      report.category ?? null,
      report.description,
      report.clientVersion ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function getIssueReport(id: number): IssueReportRow | undefined {
  return getIssueReportsDb().prepare(`SELECT * FROM issue_reports WHERE id = ?`).get(id) as IssueReportRow | undefined;
}

export function listIssueReports(filter: IssueListFilter = 'open', limit = 500): IssueReportRow[] {
  const where =
    filter === 'open' ? 'WHERE resolved_at IS NULL' : filter === 'resolved' ? 'WHERE resolved_at IS NOT NULL' : '';
  const cap = Math.max(1, Math.min(100000, Math.floor(limit) || 500));
  return getIssueReportsDb()
    .prepare(`SELECT * FROM issue_reports ${where} ORDER BY id ASC LIMIT ?`)
    .all(cap) as IssueReportRow[];
}

export function countIssueReports(): { open: number; resolved: number } {
  const row = getIssueReportsDb()
    .prepare(
      `SELECT SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved FROM issue_reports`,
    )
    .get() as { open: number | null; resolved: number | null };
  return { open: row.open ?? 0, resolved: row.resolved ?? 0 };
}

/** Marks a report resolved. Returns false if it does not exist. Re-resolving updates note/by. */
export function resolveIssueReport(id: number, opts: { note?: string; by?: string; now?: Date } = {}): boolean {
  const now = opts.now ?? new Date();
  const result = getIssueReportsDb()
    .prepare(`UPDATE issue_reports SET resolved_at = ?, resolved_by = ?, resolution_notes = ? WHERE id = ?`)
    .run(now.toISOString(), opts.by ?? null, opts.note ?? null, id);
  return result.changes > 0;
}

/** Clears resolution fields (keeps the report). Returns false if it does not exist. */
export function reopenIssueReport(id: number): boolean {
  const result = getIssueReportsDb()
    .prepare(`UPDATE issue_reports SET resolved_at = NULL, resolved_by = NULL, resolution_notes = NULL WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}