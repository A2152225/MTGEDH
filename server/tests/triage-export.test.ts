import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeIssueReportsDb,
  insertIssueReport,
  resolveIssueReport,
} from '../src/db/issueReports.js';
import { buildTriageDigest } from '../src/triage/triageExport.js';

let tmp: string;
let dbFile: string;
let stallDir: string;
const savedEnv = process.env.ISSUE_REPORTS_SQLITE_FILE;

function seedIssues(count: number): number[] {
  process.env.ISSUE_REPORTS_SQLITE_FILE = dbFile;
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(
      insertIssueReport({
        playerId: `p${i}`,
        playerName: `Player ${i}`,
        gameId: 'g1',
        cardName: `Card ${i}`,
        cardTypeLine: 'Creature — Bear',
        cardOracleText: 'x'.repeat(1000),
        cardZone: 'battlefield',
        category: 'rules',
        description: `Card ${i} did the wrong thing`,
        gameContext: { phase: 'combat', step: 'DECLARE_BLOCKERS', blob: 'y'.repeat(2000) },
      }),
    );
  }
  closeIssueReportsDb();
  return ids;
}

function writeStall(name: string, status: string, recoveryStatus = 'recovered'): string {
  const file = path.join(stallDir, name);
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      status,
      gameId: 'g1',
      timestamp: '2026-10-06T05:00:00.000Z',
      turn: 3,
      phase: 'precombatMain',
      step: 'MAIN1',
      detection: { rule: 'priorityPingPong', reason: '30 priority passes with no state change', stuckSeat: 'ai_1' },
      actionWindow: Array.from({ length: 20 }, (_, i) => ({
        kind: 'priorityPass',
        playerId: i % 2 ? 'ai_1' : 'ai_2',
        args: { by: i % 2 ? 'ai_1' : 'ai_2' },
        step: 'MAIN1',
      })),
      recovery: {
        status: recoveryStatus,
        result: 'advanced to combat/BEGIN_COMBAT',
        gameAdvanced: recoveryStatus === 'recovered',
        stagesApplied: [
          { stage: 1, actions: ['forcePass:ai_1'], boardChanged: false, phaseAfter: 'precombatMain', stepAfter: 'MAIN1' },
          { stage: 2, actions: ['advanceStep'], boardChanged: true, phaseAfter: 'combat', stepAfter: 'BEGIN_COMBAT' },
        ],
      },
    }),
  );
  return file;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgedh-triage-'));
  dbFile = path.join(tmp, 'issue-reports.sqlite');
  stallDir = path.join(tmp, 'stall-reports');
});

afterEach(() => {
  closeIssueReportsDb();
  if (savedEnv === undefined) delete process.env.ISSUE_REPORTS_SQLITE_FILE;
  else process.env.ISSUE_REPORTS_SQLITE_FILE = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('triage export', () => {
  it('returns an empty digest without creating anything when the DB and folder are missing', () => {
    const digest = buildTriageDigest({ issuesDbFile: dbFile, stallDir, mark: true });
    expect(digest.openIssueCount).toBe(0);
    expect(digest.newIssues).toEqual([]);
    expect(digest.newStalls).toEqual([]);
    expect(digest.notes.join('\n')).toMatch(/issue DB not found/);
    expect(digest.notes.join('\n')).toMatch(/stall report folder not found/);
    expect(fs.existsSync(dbFile)).toBe(false);
    expect(fs.existsSync(stallDir)).toBe(false);
  });

  it('dry run lists unforwarded open issues and new stalls without modifying anything', () => {
    const ids = seedIssues(3);
    process.env.ISSUE_REPORTS_SQLITE_FILE = dbFile;
    resolveIssueReport(ids[1], { note: 'fixed' });
    closeIssueReportsDb();
    fs.mkdirSync(stallDir, { recursive: true });
    const newFile = writeStall('2026-10-06T05-00-00-000Z-g1.json', 'new');
    writeStall('2026-10-06T04-00-00-000Z-g1.json', 'forwarded');
    writeStall('2026-10-06T06-00-00-000Z-g2.json', 'new', 'in_progress');
    const before = fs.readFileSync(newFile, 'utf8');

    const digest = buildTriageDigest({ issuesDbFile: dbFile, stallDir });
    expect(digest.mode).toBe('dry-run');
    expect(digest.openIssueCount).toBe(2);
    expect(digest.newIssues.map((i) => i.id)).toEqual([ids[0], ids[2]]);
    const issue = digest.newIssues[0];
    expect(issue.card_name).toBe('Card 0');
    expect(issue.player_name).toBe('Player 0');
    expect(issue.card_oracle_text!.length).toBeLessThanOrEqual(400);
    expect(issue.game_context!.length).toBeLessThanOrEqual(800);
    expect(issue.created_at).toBeTruthy();

    expect(digest.newStalls).toHaveLength(1);
    const stall = digest.newStalls[0];
    expect(stall.file).toBe('2026-10-06T05-00-00-000Z-g1.json');
    expect(stall.rule).toBe('priorityPingPong');
    expect(stall.recovery.gameAdvanced).toBe(true);
    expect(stall.recovery.stages[1]).toContain('combat/BEGIN_COMBAT');
    // 20 alternating passes collapse to the last 8 distinct runs
    expect(stall.repeatedActions).toHaveLength(8);
    expect(stall.repeatedActions[0]).toMatch(/^priorityPass ai_/);
    expect(digest.notes.join('\n')).toMatch(/still in recovery/);

    expect(fs.readFileSync(newFile, 'utf8')).toBe(before);
    const db = new Database(dbFile, { readonly: true });
    const forwarded = db.prepare('SELECT COUNT(*) AS n FROM issue_reports WHERE forwarded_at IS NOT NULL').get() as { n: number };
    db.close();
    expect(forwarded.n).toBe(0);
  });

  it('--mark forwards exactly the exported (capped) items and they are not exported again', () => {
    const ids = seedIssues(3);
    fs.mkdirSync(stallDir, { recursive: true });
    const a = writeStall('2026-10-06T05-00-00-000Z-g1.json', 'new');
    const b = writeStall('2026-10-06T05-10-00-000Z-g1.json', 'new');

    const first = buildTriageDigest({ issuesDbFile: dbFile, stallDir, mark: true, maxIssues: 2, maxStalls: 1 });
    expect(first.newIssues.map((i) => i.id)).toEqual([ids[0], ids[1]]);
    expect(first.newStalls.map((s) => s.file)).toEqual([path.basename(a)]);
    expect(first.marked).toEqual({ issues: 2, stalls: 1 });
    expect(first.notes.join('\n')).toMatch(/issues truncated: showing 2 of 3/);
    expect(first.notes.join('\n')).toMatch(/stalls truncated: showing 1 of 2/);
    const marked = JSON.parse(fs.readFileSync(a, 'utf8'));
    expect(marked.status).toBe('forwarded');
    expect(marked.forwardedAt).toBeTruthy();
    expect(marked.detection.rule).toBe('priorityPingPong');

    const second = buildTriageDigest({ issuesDbFile: dbFile, stallDir, mark: true });
    expect(second.newIssues.map((i) => i.id)).toEqual([ids[2]]);
    expect(second.newStalls.map((s) => s.file)).toEqual([path.basename(b)]);
    expect(second.openIssueCount).toBe(3);

    const third = buildTriageDigest({ issuesDbFile: dbFile, stallDir });
    expect(third.newIssues).toEqual([]);
    expect(third.newStalls).toEqual([]);

    // forwarding never resolves a report
    const db = new Database(dbFile, { readonly: true });
    const open = db.prepare('SELECT COUNT(*) AS n FROM issue_reports WHERE resolved_at IS NULL').get() as { n: number };
    db.close();
    expect(open.n).toBe(3);
  });

  it('handles an older DB without forwarded_at: dry run leaves the schema alone, --mark migrates it', () => {
    const db = new Database(dbFile);
    db.exec(`CREATE TABLE issue_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT,
      game_id TEXT NOT NULL, card_name TEXT NOT NULL, card_type_line TEXT, card_oracle_text TEXT,
      card_zone TEXT NOT NULL, game_context TEXT, category TEXT, description TEXT NOT NULL,
      resolved_at TEXT, resolved_by TEXT, resolution_notes TEXT)`);
    db.prepare(`INSERT INTO issue_reports (created_at, player_id, game_id, card_name, card_zone, description)
      VALUES ('2026-10-01T00:00:00.000Z', 'p1', 'g1', 'Old Card', 'hand', 'old report')`).run();
    db.close();
    const hasForwarded = () => {
      const h = new Database(dbFile, { readonly: true });
      const cols = (h.prepare('PRAGMA table_info(issue_reports)').all() as Array<{ name: string }>).map((c) => c.name);
      h.close();
      return cols.includes('forwarded_at');
    };

    const dry = buildTriageDigest({ issuesDbFile: dbFile, stallDir });
    expect(dry.newIssues.map((i) => i.card_name)).toEqual(['Old Card']);
    expect(dry.newIssues[0].created_at).toBe('2026-10-01T00:00:00.000Z');
    expect(hasForwarded()).toBe(false);

    const marked = buildTriageDigest({ issuesDbFile: dbFile, stallDir, mark: true });
    expect(marked.marked?.issues).toBe(1);
    expect(hasForwarded()).toBe(true);
    expect(buildTriageDigest({ issuesDbFile: dbFile, stallDir }).newIssues).toEqual([]);
  });
});
