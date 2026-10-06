import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeIssueReportsDb, getIssueReport, listIssueReports } from '../src/db/issueReports.js';
import { processIssueReport, registerIssueReportHandlers } from '../src/socket/issueReport.js';
import { resetIssueReportRateLimitForTests } from '../src/socket/issueReportRateLimit.js';
import { runIssuesCli, issuesToCsv } from '../src/db/issueReportsCli.js';
import { formatIssueSummary, summarizeCardState, summarizeGameContext, recentLogLines } from '../src/db/issueReportsCliFormat.js';
import { readFileSync } from 'node:fs';
import { games } from '../src/socket/socket.js';
import { ISSUE_DESCRIPTION_MAX } from '../../shared/src/issueReport.js';

process.env.ISSUE_REPORTS_SQLITE_FILE = ':memory:';

const gameId = 'issue_report_game';
const me = 'p1';
const opp = 'p2';

function fakeGame() {
  return {
    state: {
      players: [{ id: me, name: 'Robert' }, { id: opp, name: 'Opp' }],
      turnPlayer: me,
      priority: me,
      turnNumber: 4,
      phase: 'combat',
      step: 'declareAttackers',
      stack: [{ id: 's1', type: 'spell', controller: opp, card: { name: 'Counterspell' } }],
      battlefield: [
        {
          id: 'perm1', controller: me, owner: me, tapped: true, counters: { '+1/+1': 2 },
          basePower: 2, baseToughness: 2, attachments: ['aura1'], modifiers: [],
          card: { id: 'c1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2', oracle_id: 'or-1', scryfall_id: 'sf-1' },
        },
        { id: 'aura1', controller: me, owner: me, attachedTo: 'perm1', card: { id: 'c2', name: 'Pacifism', type_line: 'Enchantment — Aura' } },
      ],
      zones: {
        [me]: { hand: [{ id: 'h1', name: 'Giant Growth', type_line: 'Instant', oracle_text: '+3/+3' }], graveyard: [], exile: [] },
        [opp]: { hand: [{ id: 'oh1', name: 'SECRET OPP CARD', type_line: 'Instant', oracle_text: 'secret text' }], graveyard: [{ id: 'og1', name: 'Public Gy Card', type_line: 'Sorcery' }], exile: [] },
      },
    },
    libraries: new Map([[opp, [{ id: 'ol1', name: 'OPP LIBRARY CARD' }]], [me, [{ id: 'l1', name: 'My Top Card' }]]]),
  } as any;
}

function sock(playerId = me, inRoom = true) {
  return { data: { playerId, gameId }, rooms: new Set(inRoom ? [gameId] : []) } as any;
}

const base = { gameId, cardId: 'c1', permanentId: 'perm1', cardName: 'Grizzly Bears', zone: 'battlefield', description: 'It should not have tapped.' };

describe('reportIssue handler', () => {
  beforeEach(() => {
    resetIssueReportRateLimitForTests();
    closeIssueReportsDb();
    games.set(gameId as any, fakeGame());
  });
  afterAll(() => {
    games.delete(gameId as any);
    closeIssueReportsDb();
  });

  it('stores a battlefield report with card state and game context', () => {
    const res = processIssueReport(sock(), { ...base, category: 'missing_effect', recentLog: ['Robert cast Bears', 'x'.repeat(1000)] });
    expect(res.ok).toBe(true);
    const row = getIssueReport((res as any).id)!;
    expect(row.card_name).toBe('Grizzly Bears');
    expect(row.player_name).toBe('Robert');
    expect(row.card_oracle_id).toBe('or-1');
    expect(row.card_scryfall_id).toBe('sf-1');
    expect(row.card_type_line).toBe('Creature — Bear');
    expect(row.category).toBe('missing_effect');
    expect(row.resolved_at).toBeNull();
    expect(new Date(row.created_at).toISOString()).toBe(row.created_at);
    const st = JSON.parse(row.card_state!);
    expect(st.tapped).toBe(true);
    expect(st.counters).toEqual({ '+1/+1': 2 });
    expect(st.attachments).toEqual([{ id: 'aura1', name: 'Pacifism' }]);
    expect(typeof st.currentPower).toBe('number');
    const ctx = JSON.parse(row.game_context!);
    expect(ctx).toMatchObject({ turn: 4, phase: 'combat', step: 'declareAttackers', activePlayer: 'Robert', priorityHolder: 'Robert' });
    expect(ctx.stack[0]).toMatchObject({ name: 'Counterspell' });
    expect(ctx.recentLog).toHaveLength(2);
    expect(ctx.recentLog[1].length).toBeLessThanOrEqual(300);
  });

  it('validates description, zone, ids, length and control characters', () => {
    expect(processIssueReport(sock(), { ...base, description: '   ' })).toMatchObject({ ok: false, code: 'DESCRIPTION_REQUIRED' });
    expect(processIssueReport(sock(), { ...base, description: 5 })).toMatchObject({ ok: false, code: 'DESCRIPTION_REQUIRED' });
    expect(processIssueReport(sock(), { ...base, zone: 'nowhere' })).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(processIssueReport(sock(), null)).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(processIssueReport(sock(), { ...base, description: 'a'.repeat(ISSUE_DESCRIPTION_MAX + 1) })).toMatchObject({ ok: false, code: 'DESCRIPTION_TOO_LONG' });
    const ok = processIssueReport(sock(), { ...base, description: 'bad\u0000char\u202Etext', category: 'not-a-category' });
    expect(ok.ok).toBe(true);
    const row = getIssueReport((ok as any).id)!;
    expect(row.description).toBe('badchartext');
    expect(row.category).toBeNull();
    expect(listIssueReports('all')).toHaveLength(1);
  });

  it('rejects sockets that are not in the game', () => {
    expect(processIssueReport(sock(me, false), base)).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
    expect(processIssueReport({ data: {}, rooms: new Set([gameId]) } as any, base)).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
    expect(listIssueReports('all')).toHaveLength(0);
  });

  it('rate limits to 10 reports per minute per player', () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) expect(processIssueReport(sock(), base, t + i).ok).toBe(true);
    expect(processIssueReport(sock(), base, t + 11)).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    // a different player is unaffected; the window frees up after a minute
    expect(processIssueReport(sock(opp), { ...base, cardId: 'og1', permanentId: undefined, zone: 'graveyard' }, t + 12).ok).toBe(true);
    expect(processIssueReport(sock(), base, t + 61_000).ok).toBe(true);
  });

  it('never captures opponents\' hand or library cards', () => {
    const hand = processIssueReport(sock(), { gameId, cardId: 'oh1', cardName: 'SECRET OPP CARD', zone: 'hand', description: 'peek' });
    const lib = processIssueReport(sock(), { gameId, cardId: 'ol1', cardName: 'OPP LIBRARY CARD', zone: 'library', description: 'peek' });
    for (const r of [hand, lib]) {
      const row = getIssueReport((r as any).id)!;
      expect(row.card_oracle_text).toBeNull();
      expect(row.card_type_line).toBeNull();
      expect(row.card_state).toBeNull();
      expect(row.card_owner).toBeNull();
      expect(JSON.stringify(row)).not.toContain('secret text');
    }
    // own hand card and public opponent graveyard card are captured
    const own = getIssueReport((processIssueReport(sock(), { gameId, cardId: 'h1', cardName: 'Giant Growth', zone: 'hand', description: 'x' }) as any).id)!;
    expect(own.card_oracle_text).toBe('+3/+3');
    expect(own.card_owner).toBe(me);
    const gy = getIssueReport((processIssueReport(sock(), { gameId, cardId: 'og1', cardName: 'Public Gy Card', zone: 'graveyard', description: 'x' }) as any).id)!;
    expect(gy.card_owner).toBe(opp);
    expect(JSON.stringify(getIssueReport((hand as any).id))).not.toContain('OPP LIBRARY');
  });

  it('registers the reportIssue socket event and answers via ack', () => {
    const handlers: Record<string, Function> = {};
    const s = { ...sock(), on: (e: string, h: Function) => { handlers[e] = h; }, emit: () => {} } as any;
    registerIssueReportHandlers({} as any, s);
    let result: any;
    handlers.reportIssue({ ...base }, (r: any) => { result = r; });
    expect(result.ok).toBe(true);
    let bad: any;
    handlers.reportIssue({ ...base, description: '' }, (r: any) => { bad = r; });
    expect(bad.ok).toBe(false);
  });
});

describe('issues CLI', () => {
  beforeEach(() => {
    resetIssueReportRateLimitForTests();
    closeIssueReportsDb();
    games.set(gameId as any, fakeGame());
  });

  function run(...args: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = runIssuesCli(args, { out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('lists, shows, resolves, reopens and exports', () => {
    const id = (processIssueReport(sock(), { ...base, description: '=cmd|"x", multi\nline' }) as any).id;
    processIssueReport(sock(), { ...base, description: 'second' });

    expect(run('list').out).toContain(`#${id}`);
    expect(run('show', String(id)).out).toContain('Grizzly Bears');
    expect(run('show', '999').code).toBe(1);
    expect(run('show', 'abc').code).toBe(2);

    const r = run('resolve', String(id), '--note', 'fixed in abc123', '--by', 'Robert');
    expect(r.code).toBe(0);
    const row = getIssueReport(id)!;
    expect(row.resolved_at).not.toBeNull();
    expect(row.resolution_notes).toBe('fixed in abc123');
    expect(row.resolved_by).toBe('Robert');
    expect(run('list', '--open').out).not.toContain(`#${id}\t`);
    expect(run('list', '--all').out).toContain(`#${id}\t`);
    expect(run('list', '--resolved').out).toContain('resolved');
    expect(run('show', String(id)).out).toContain('fixed in abc123');

    expect(run('reopen', String(id)).code).toBe(0);
    expect(getIssueReport(id)!.resolved_at).toBeNull();
    expect(getIssueReport(id)!.resolution_notes).toBeNull();
    expect(run('resolve', '999').code).toBe(1);

    const csv = run('export', '--csv').out;
    expect(csv.split('\n')[0]).toContain('id,created_at');
    expect(csv).toContain("'=cmd|"); // formula injection neutralized
    expect(csv).toContain('"'); // quoting for commas/newlines
    expect(run('export').code).toBe(2);
    expect(run('bogus').code).toBe(2);
    expect(issuesToCsv([]).trim().split('\n')).toHaveLength(1);
  });

  it('friendly views: bare "issues"/all, open, closed and resolved (alias) show full per-report details', () => {
    const a = (processIssueReport(sock(), { ...base, description: 'first open one', category: 'missing_effect', recentLog: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] }) as any).id;
    const b = (processIssueReport(sock(), { ...base, description: 'second\nmultiline' }) as any).id;
    run('resolve', String(b), '--note', 'fixed it', '--by', 'Tester');

    const everything = run();
    expect(everything.code).toBe(0);
    expect(everything.out).toContain(`#${a}  [OPEN]`);
    expect(everything.out).toContain(`#${b}  [RESOLVED]`);
    expect(everything.out).toContain('2 reports shown. Totals: 1 open, 1 closed.');
    expect(run('all').out).toBe(everything.out);

    const open = run('open');
    expect(open.out).toContain(`#${a}  [OPEN]`);
    expect(open.out).not.toContain(`#${b}  [`);
    expect(open.out).toContain('Player:      Robert (p1)');
    expect(open.out).toContain(`Game:        ${gameId}`);
    expect(open.out).toContain('Card:        Grizzly Bears [battlefield] - Creature — Bear');
    expect(open.out).toContain('Category:    missing_effect');
    expect(open.out).toContain('Description: first open one');
    expect(open.out).toContain('Resolved:    no');
    expect(open.out).toContain('Card state:  P/T');
    expect(open.out).toContain('tapped');
    expect(open.out).toContain('+1/+1=2');
    expect(open.out).toContain('Game state:  turn 4; combat/declareAttackers');
    expect(open.out).toContain('Last 5 log lines:');
    expect(open.out).toContain('- l7');
    expect(open.out).not.toContain('- l2'); // only the last five

    const closed = run('closed');
    expect(closed.out).toContain(`#${b}  [RESOLVED]`);
    expect(closed.out).not.toContain(`#${a}  [`);
    expect(closed.out).toContain('Description: second / multiline');
    expect(closed.out).toContain('by Tester');
    expect(closed.out).toContain('Notes:       fixed it');
    expect(closed.out).toContain('1 closed report shown.');
    expect(run('resolved').out).toBe(closed.out);
  });

  it('friendly views report empty sets and keep the old subcommands working', () => {
    expect(run('open').out).toBe('No open issue reports.');
    expect(run('closed').out).toBe('No closed issue reports.');
    expect(run().out).toBe('No issue reports.');
    const id = (processIssueReport(sock(), { ...base }) as any).id;
    expect(run('list').out).toContain(`#${id}\t`);
    expect(run('show', String(id)).code).toBe(0);
    expect(run('path').code).toBe(0);
    expect(run('help').code).toBe(0);
    expect(run('help').out).toContain('npm run issues');
    expect(run('help').out).toContain('closed');
  });

  it('summaries tolerate missing or malformed JSON', () => {
    expect(summarizeCardState(null)).toMatch(/no card state/);
    expect(summarizeCardState('not json')).toMatch(/no card state/);
    expect(summarizeGameContext(null)).toMatch(/no game context/);
    expect(recentLogLines('{bad')).toEqual([]);
    expect(summarizeCardState(JSON.stringify({ currentPower: 4, currentToughness: 4, basePower: 2, baseToughness: 2, damageMarked: 3, tapped: false, counters: {}, attachedTo: { id: 'a', name: 'Pacifism' }, blocking: ['x'] })))
      .toBe('P/T 4/4 (base 2/2); damage 3; untapped; no counters; attached to Pacifism; blocking ["x"]');
    expect(summarizeGameContext(JSON.stringify({ turn: 9, phase: 'main', stack: ['Bolt'], priorityHolder: 'Bob' })))
      .toBe('turn 9; main; priority Bob; stack 1 (Bolt)');
    const row: any = { id: 7, created_at: 'utc', created_at_local: null, player_id: 'p', player_name: null, game_id: 'g', card_name: 'C', card_zone: 'hand', card_type_line: null, category: null, description: 'd', resolved_at: null, card_state: null, game_context: null };
    const text = formatIssueSummary(row);
    expect(text).toContain('#7  [OPEN]  utc');
    expect(text).toContain('Category:    (none)');
    expect(text).not.toContain('Last ');
  });

  it('root package.json exposes "npm run issues" and docs explain the PowerShell argument rules', () => {
    const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(root.scripts.issues).toBe('npm --workspace @mtgedh/server run issues --');
    const docs = readFileSync(new URL('../../docs/issue-reports.md', import.meta.url), 'utf8');
    expect(docs).toContain('npm run issues closed');
    expect(docs).toContain('npm run issues -- closed');
    expect(docs).toContain('PowerShell');
  });
});