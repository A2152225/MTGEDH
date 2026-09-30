/**
 * Player-submitted "Report Issue" (card right-click menu) request shape, limits and validation.
 * Shared by the client modal (pre-submit validation) and the server handler (authoritative validation).
 */

export const ISSUE_DESCRIPTION_MAX = 2000;
export const ISSUE_CARD_NAME_MAX = 200;
export const ISSUE_ID_MAX = 100;
export const ISSUE_LOG_LINES_MAX = 20;
export const ISSUE_LOG_LINE_MAX = 300;

export const ISSUE_CATEGORIES = [
  'rules_wrong_outcome',
  'missing_effect',
  'ui_problem',
  'crash_error',
  'other',
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  rules_wrong_outcome: 'Rules / Wrong outcome',
  missing_effect: 'Missing effect',
  ui_problem: 'UI problem',
  crash_error: 'Crash / Error',
  other: 'Other',
};

export const ISSUE_ZONES = ['battlefield', 'hand', 'graveyard', 'exile', 'library', 'commander', 'stack'] as const;
export type IssueZone = (typeof ISSUE_ZONES)[number];

export interface IssueReportRequest {
  gameId: string;
  cardId: string;
  /** Battlefield permanent id when the card is a permanent (cardId is then the card's own id, if known). */
  permanentId?: string;
  cardName: string;
  zone: IssueZone;
  category?: IssueCategory;
  description: string;
  /** Last lines of the game log/chat the player sees (public information only). */
  recentLog?: string[];
}

export type IssueReportResult =
  | { ok: true; id: number }
  | { ok: false; code: string; error: string };

/** Strips control characters (keeps \n and \t), normalizes newlines, trims and length-caps. */
export function sanitizeIssueText(value: unknown, max: number, opts: { multiline?: boolean } = {}): string {
  if (typeof value !== 'string') return '';
  let text = value.replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  if (!opts.multiline) text = text.replace(/[\n\t]+/g, ' ');
  text = text.trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function isIssueCategory(value: unknown): value is IssueCategory {
  return typeof value === 'string' && (ISSUE_CATEGORIES as readonly string[]).includes(value);
}

export function isIssueZone(value: unknown): value is IssueZone {
  return typeof value === 'string' && (ISSUE_ZONES as readonly string[]).includes(value);
}

export type IssueReportValidation =
  | { ok: true; value: IssueReportRequest }
  | { ok: false; code: 'INVALID_PAYLOAD' | 'DESCRIPTION_REQUIRED' | 'DESCRIPTION_TOO_LONG'; error: string };

/** Validates and sanitizes an untrusted report payload. Never throws. */
export function validateIssueReportRequest(raw: unknown): IssueReportValidation {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'INVALID_PAYLOAD', error: 'Invalid report.' };
  }
  const p = raw as Record<string, unknown>;
  const gameId = sanitizeIssueText(p.gameId, ISSUE_ID_MAX);
  const cardId = sanitizeIssueText(p.cardId, ISSUE_ID_MAX);
  const cardName = sanitizeIssueText(p.cardName, ISSUE_CARD_NAME_MAX);
  if (!gameId || !isIssueZone(p.zone) || (!cardId && !cardName)) {
    return { ok: false, code: 'INVALID_PAYLOAD', error: 'Invalid report.' };
  }
  if (typeof p.description !== 'string') {
    return { ok: false, code: 'DESCRIPTION_REQUIRED', error: 'Please describe the issue.' };
  }
  const rawDescription = p.description.replace(/\r\n?/g, '\n').trim();
  if (rawDescription.length > ISSUE_DESCRIPTION_MAX * 2) {
    return { ok: false, code: 'DESCRIPTION_TOO_LONG', error: `Description is too long (max ${ISSUE_DESCRIPTION_MAX} characters).` };
  }
  const description = sanitizeIssueText(rawDescription, ISSUE_DESCRIPTION_MAX, { multiline: true });
  if (!description) {
    return { ok: false, code: 'DESCRIPTION_REQUIRED', error: 'Please describe the issue.' };
  }
  if (rawDescription.length > ISSUE_DESCRIPTION_MAX) {
    return { ok: false, code: 'DESCRIPTION_TOO_LONG', error: `Description is too long (max ${ISSUE_DESCRIPTION_MAX} characters).` };
  }
  const permanentId = sanitizeIssueText(p.permanentId, ISSUE_ID_MAX);
  const recentLog = Array.isArray(p.recentLog)
    ? p.recentLog
        .map((line) => sanitizeIssueText(line, ISSUE_LOG_LINE_MAX))
        .filter(Boolean)
        .slice(-ISSUE_LOG_LINES_MAX)
    : undefined;
  return {
    ok: true,
    value: {
      gameId,
      cardId,
      ...(permanentId ? { permanentId } : {}),
      cardName,
      zone: p.zone,
      category: isIssueCategory(p.category) ? p.category : undefined,
      description,
      ...(recentLog && recentLog.length ? { recentLog } : {}),
    },
  };
}