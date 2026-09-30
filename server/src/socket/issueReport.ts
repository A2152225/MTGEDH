/**
 * Socket handler for the card right-click "Report Issue" action.
 * Validates + sanitizes the payload, enforces membership and a per-player rate limit, snapshots only
 * what the reporter may see, and persists to the separate issue-reports SQLite database.
 */
import type { Server, Socket } from 'socket.io';
import { validateIssueReportRequest, type IssueReportRequest, type IssueReportResult } from '../../../shared/src/issueReport.js';
import { insertIssueReport } from '../db/issueReports.js';
import { debug, debugError } from '../utils/debug.js';
import { ensureGame, getPlayerName } from './util.js';
import { checkIssueReportRateLimit } from './issueReportRateLimit.js';
import { buildIssueCardSnapshot, buildIssueGameContext } from './issueReportSnapshot.js';
import { getServerBuildVersion } from './issueReportBuildVersion.js';

type Ack = ((result: IssueReportResult) => void) | undefined;

function reply(socket: Socket, ack: Ack, result: IssueReportResult): void {
  try {
    if (typeof ack === 'function') ack(result);
    else if (result.ok === false) socket.emit('error', { code: (result as any).code, message: (result as any).error } as any);
  } catch {
    // ignore
  }
}

/** Core logic, exported for tests. Returns the result instead of emitting. */
export function processIssueReport(
  socket: Pick<Socket, 'data' | 'rooms'>,
  raw: unknown,
  now: number = Date.now(),
): IssueReportResult {
  const validated = validateIssueReportRequest(raw);
  if (validated.ok === false) {
    const bad = validated as { code: string; error: string };
    return { ok: false, code: bad.code, error: bad.error };
  }
  const req = (validated as { value: IssueReportRequest }).value;

  const playerId = String((socket.data as any)?.playerId || '').trim();
  const socketGameId = (socket.data as any)?.gameId as string | undefined;
  const inRoom = !!(socket as any)?.rooms?.has?.(req.gameId);
  if (!playerId || !inRoom || (socketGameId && socketGameId !== req.gameId)) {
    return { ok: false, code: 'NOT_IN_GAME', error: 'You must be in the game to report an issue.' };
  }

  const limit = checkIssueReportRateLimit(playerId, now);
  if (limit.allowed === false) {
    const secs = Math.ceil((limit as { retryAfterMs: number }).retryAfterMs / 1000);
    return { ok: false, code: 'RATE_LIMITED', error: `Too many reports. Try again in ${secs}s.` };
  }

  const game = ensureGame(req.gameId);
  if (!game) return { ok: false, code: 'GAME_NOT_FOUND', error: 'Game not found.' };

  try {
    const card = buildIssueCardSnapshot(game, playerId, req);
    const id = insertIssueReport({
      playerId,
      playerName: getPlayerName(game, playerId),
      gameId: req.gameId,
      cardId: card.cardId,
      permanentId: card.permanentId,
      cardName: card.cardName,
      cardOracleId: card.oracleId,
      cardScryfallId: card.scryfallId,
      cardTypeLine: card.typeLine,
      cardOracleText: card.oracleText,
      cardZone: card.zone,
      cardController: card.controller,
      cardOwner: card.owner,
      cardState: card.state,
      gameContext: buildIssueGameContext(game, req),
      category: req.category ?? null,
      description: req.description,
      clientVersion: getServerBuildVersion(),
      now: new Date(now),
    });
    debug(1, `[IssueReport] #${id} from ${playerId} in ${req.gameId} about "${card.cardName}"`);
    return { ok: true, id };
  } catch (err) {
    debugError(1, '[IssueReport] failed to store report', err);
    return { ok: false, code: 'STORE_FAILED', error: 'Could not save the report. Please try again later.' };
  }
}

export function registerIssueReportHandlers(_io: Server, socket: Socket): void {
  socket.on('reportIssue', (payload: unknown, ack?: Ack) => {
    reply(socket, ack, processIssueReport(socket, payload));
  });
}