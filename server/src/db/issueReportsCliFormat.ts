/**
 * Human-friendly multi-line summaries of issue reports for `issues`, `issues open`, `issues closed`.
 * Pure functions (no DB access) so they can be unit-tested; `show <id>` still prints the full JSON.
 */
import type { IssueReportRow } from './issueReports.js';

const RECENT_LOG_LINES = 5;

function parseJson(json: string | null): Record<string, any> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function clip(text: unknown, max: number): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '.' : flat;
}

function has(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

/** One line: tapped, P/T (vs base), damage, counters, attachments, combat role, granted abilities. */
export function summarizeCardState(json: string | null): string {
  const s = parseJson(json);
  if (!s) return '(no card state captured)';
  const parts: string[] = [];
  if (has(s.currentPower) || has(s.currentToughness)) {
    let pt = `P/T ${s.currentPower ?? '?'}/${s.currentToughness ?? '?'}`;
    if ((has(s.basePower) || has(s.baseToughness)) && (s.basePower !== s.currentPower || s.baseToughness !== s.currentToughness)) {
      pt += ` (base ${s.basePower ?? '?'}/${s.baseToughness ?? '?'})`;
    }
    parts.push(pt);
  }
  if (Number(s.damageMarked) > 0) parts.push(`damage ${s.damageMarked}`);
  parts.push(s.tapped ? 'tapped' : 'untapped');
  const counters = s.counters && typeof s.counters === 'object' ? Object.entries(s.counters) : [];
  parts.push(counters.length ? 'counters ' + counters.map(([k, v]) => `${k}=${v}`).join(', ') : 'no counters');
  if (has(s.loyalty)) parts.push(`loyalty ${s.loyalty}`);
  if (s.isToken) parts.push('token');
  if (s.summoningSickness) parts.push('summoning sick');
  if (s.phasedOut) parts.push('phased out');
  if (s.attachedTo) parts.push(`attached to ${s.attachedTo?.name ?? s.attachedTo?.id ?? s.attachedTo}`);
  if (Array.isArray(s.attachments) && s.attachments.length) {
    parts.push('attachments ' + s.attachments.map((a: any) => a?.name ?? a?.id ?? a).join(', '));
  }
  if (has(s.attacking)) parts.push(`attacking ${typeof s.attacking === 'object' ? JSON.stringify(s.attacking) : s.attacking}`);
  if (Array.isArray(s.blocking) ? s.blocking.length > 0 : has(s.blocking)) {
    parts.push(`blocking ${typeof s.blocking === 'object' ? JSON.stringify(s.blocking) : s.blocking}`);
  }
  if (Array.isArray(s.grantedAbilities) && s.grantedAbilities.length) parts.push('granted ' + s.grantedAbilities.join(', '));
  if (Array.isArray(s.modifiers) && s.modifiers.length) parts.push(`${s.modifiers.length} modifier(s)`);
  if (Array.isArray(s.temporaryEffects) && s.temporaryEffects.length) parts.push(`${s.temporaryEffects.length} temporary effect(s)`);
  return parts.join('; ');
}

/** One line: turn, phase/step, active player, priority, stack and board size. */
export function summarizeGameContext(json: string | null): string {
  const g = parseJson(json);
  if (!g) return '(no game context captured)';
  const parts: string[] = [];
  if (has(g.turn)) parts.push(`turn ${g.turn}`);
  if (has(g.phase) || has(g.step)) parts.push(`${g.phase ?? '?'}${has(g.step) ? '/' + g.step : ''}`);
  if (has(g.activePlayer)) parts.push(`active ${g.activePlayer}`);
  if (has(g.priorityHolder)) parts.push(`priority ${g.priorityHolder}`);
  const stack = Array.isArray(g.stack) ? g.stack : [];
  parts.push(
    stack.length
      ? `stack ${stack.length} (${stack.slice(0, 3).map((x: any) => clip(typeof x === 'string' ? x : x?.name ?? x?.card ?? x?.id ?? '?', 30)).join(', ')})`
      : 'stack empty',
  );
  if (has(g.battlefieldCount)) parts.push(`${g.battlefieldCount} permanents`);
  if (has(g.playerCount)) parts.push(`${g.playerCount} players`);
  return parts.join('; ');
}

export function recentLogLines(json: string | null, count = RECENT_LOG_LINES): string[] {
  const g = parseJson(json);
  const log = Array.isArray(g?.recentLog) ? (g!.recentLog as unknown[]) : [];
  return log.slice(-count).map((l) => clip(l, 160));
}

/** Multi-line, human-readable summary of one report (used by the friendly list commands). */
export function formatIssueSummary(row: IssueReportRow): string {
  const status = row.resolved_at ? 'RESOLVED' : 'OPEN';
  const lines = [
    `#${row.id}  [${status}]  ${row.created_at_local ?? row.created_at}`,
    `  Player:      ${row.player_name ?? row.player_id} (${row.player_id})`,
    `  Game:        ${row.game_id}`,
    `  Card:        ${row.card_name} [${row.card_zone}]${row.card_type_line ? ' - ' + row.card_type_line : ''}`,
    `  Category:    ${row.category ?? '(none)'}`,
    `  Description: ${row.description.replace(/\s*\n\s*/g, ' / ')}`,
    row.resolved_at
      ? `  Resolved:    ${row.resolved_at}${row.resolved_by ? ' by ' + row.resolved_by : ''}`
      : '  Resolved:    no',
  ];
  if (row.resolved_at) lines.push(`  Notes:       ${row.resolution_notes ?? '(none)'}`);
  lines.push(`  Card state:  ${summarizeCardState(row.card_state)}`);
  lines.push(`  Game state:  ${summarizeGameContext(row.game_context)}`);
  const log = recentLogLines(row.game_context);
  if (log.length) {
    lines.push(`  Last ${log.length} log line${log.length === 1 ? '' : 's'}:`);
    for (const l of log) lines.push(`    - ${l}`);
  }
  return lines.join('\n');
}