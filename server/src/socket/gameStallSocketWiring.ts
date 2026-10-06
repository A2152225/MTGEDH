/**
 * server/src/socket/gameStallSocketWiring.ts
 *
 * Socket-layer wiring for the game-stall detector/recovery in
 * state/modules/gameStall/. Supplies the io-bound recovery dependencies (the
 * same persisted paths normal play uses), the idle watchdog sweep, the manual
 * `forceAdvanceStall` socket action, and the CLI `force-advance` entry.
 *
 * Public entry symbols: installGameStallRecovery, registerGameStallHandlers,
 * forceAdvanceStalledGame, buildGameStallRecoveryDeps, stopGameStallWatchdogForTests.
 */

import path from 'node:path';
import type { Server, Socket } from 'socket.io';
import { GameManager } from '../GameManager.js';
import { games } from './socket.js';
import {
  aiActionsInProgress,
  aiEngine,
  clearScheduledAIAction,
  getAIActionKey,
  scheduleAIPriority,
} from './ai-handlers/aiScheduler.js';
import { isAIPlayer } from './ai-handlers/aiPlayerRegistry.js';
import { executePassPriority } from './ai-handlers/aiPriorityPassCombatExecutors.js';
import { AI_REACTION_DELAY_MS } from './ai-handlers/aiConstants.js';
import { advanceStepPersistingEvent } from './step-advance.js';
import { broadcastGame, getPlayerName, persistAndResolveTopOfStack } from './util.js';
import { runPostResolutionPermanentPromptChecks } from './game-actions.js';
import { ResolutionQueueManager } from '../state/resolution/ResolutionQueueManager.js';
import { isGameCreator } from '../db/index.js';
import { getGameStallConfig } from '../state/modules/gameStall/gameStallConfig.js';
import {
  checkGameStallIdle,
  registerGameStallRuntime,
  type GameStallDetection,
} from '../state/modules/gameStall/gameStallDetector.js';
import {
  requestManualGameStallRecovery,
  runGameStallRecovery,
  type GameStallRecoveryDeps,
  type GameStallRecoveryOutcome,
} from '../state/modules/gameStall/gameStallRecovery.js';
import { debug, debugWarn } from '../utils/debug.js';

let installedIo: Server | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function resolveGame(gameId: string): any {
  try {
    return GameManager.getGame(gameId) || games.get(gameId as any) || null;
  } catch {
    return games.get(gameId as any) || null;
  }
}

function isAiSeat(gameId: string, playerId: string): boolean {
  if (!playerId) return false;
  try {
    if (isAIPlayer(gameId, playerId as any)) return true;
  } catch {
    // ignore
  }
  const players: any[] = Array.isArray(resolveGame(gameId)?.state?.players) ? resolveGame(gameId).state.players : [];
  return players.some((p) => String(p?.id || '') === playerId && p?.isAI === true);
}

function lastAiDecision(playerId: string): any {
  try {
    const history = aiEngine.getDecisionHistory(playerId as any);
    return Array.isArray(history) && history.length ? history[history.length - 1] : null;
  } catch {
    return null;
  }
}

function describeAiAction(_gameId: string, playerId: string): string | undefined {
  const decision: any = lastAiDecision(playerId);
  if (!decision) return undefined;
  const action = decision.action || {};
  const key = action.cardId || action.card?.id || action.abilityId || action.spellId || action.permanentId || action.type || '';
  return `last=${String(decision.type || '')}${key ? `:${String(key)}` : ''}`;
}

function emitSystemChat(io: Server, gameId: string, message: string): void {
  try {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}_stall`,
      gameId,
      from: 'system',
      message,
      ts: Date.now(),
    } as any);
  } catch {
    // best-effort
  }
}

export function buildGameStallRecoveryDeps(io: Server, overrides: Partial<GameStallRecoveryDeps> = {}): GameStallRecoveryDeps {
  return {
    getGame: resolveGame,
    isAiSeat,
    getPlayerName: (game, playerId) => getPlayerName(game, playerId as any),
    cancelAiPendingAction: (gameId, playerId) => {
      const notes: string[] = [];
      clearScheduledAIAction(gameId, playerId as any);
      notes.push(`cleared scheduled AI action for ${playerId}`);
      const key = getAIActionKey(gameId, playerId as any);
      if (aiActionsInProgress.has(key)) {
        aiActionsInProgress.delete(key);
        notes.push(`released stuck in-progress AI action lock ${key}`);
      }
      return notes;
    },
    forcePassPriority: (gameId, playerId) =>
      executePassPriority(io, gameId, playerId as any, { allowActiveMainPhaseAutoAdvance: true }),
    resolveTopOfStack: (gameId) => {
      const game = resolveGame(gameId);
      if (!game) return false;
      const ok = persistAndResolveTopOfStack(game, gameId, { reason: 'stallRecovery' });
      if (ok) {
        try {
          runPostResolutionPermanentPromptChecks(io as any, game, gameId);
        } catch (err) {
          debugWarn(1, '[gameStall] post-resolution checks failed:', err);
        }
      }
      return ok;
    },
    advanceStep: (gameId, reason) => {
      const game = resolveGame(gameId);
      if (!game) return false;
      return advanceStepPersistingEvent(io as any, game, gameId, { reason });
    },
    cancelResolutionStep: (gameId, stepId) => Boolean(ResolutionQueueManager.cancelStep(gameId, stepId)),
    broadcast: (gameId) => {
      const game = resolveGame(gameId);
      if (game) broadcastGame(io as any, game, gameId);
    },
    emitSystemChat: (gameId, message) => emitSystemChat(io, gameId, message),
    kickAi: (gameId, playerId) => scheduleAIPriority(io as any, gameId, playerId as any, AI_REACTION_DELAY_MS),
    getLastAiDecision: (playerId) => lastAiDecision(playerId),
    ...overrides,
  };
}

function sweepIdleGames(): void {
  const ids = new Set<string>();
  try {
    for (const id of GameManager.listGameIds()) ids.add(String(id));
  } catch {
    // ignore
  }
  for (const id of games.keys()) ids.add(String(id));
  const now = Date.now();
  for (const gameId of ids) {
    const game = resolveGame(gameId);
    if (game) checkGameStallIdle(game, gameId, now);
  }
}

/** Called once from registerSocketHandlers(io). Idempotent. */
export function installGameStallRecovery(io: Server): void {
  installedIo = io;
  registerGameStallRuntime({
    resolveGame,
    isAiSeat,
    describeAiAction,
    onStall: (detection: GameStallDetection) => {
      void runGameStallRecovery(detection, buildGameStallRecoveryDeps(io), { admitted: true })
        .catch((err) => debugWarn(1, '[gameStall] recovery crashed:', err));
    },
  });
  if (!watchdogTimer && getGameStallConfig().enabled) {
    watchdogTimer = setInterval(() => {
      try {
        sweepIdleGames();
      } catch (err) {
        debugWarn(2, '[gameStall] idle sweep failed:', err);
      }
    }, Math.max(1_000, getGameStallConfig().idleWatchdogIntervalMs));
    (watchdogTimer as any)?.unref?.();
  }
  debug(2, '[gameStall] stall detector recovery installed');
}

export function stopGameStallWatchdogForTests(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

/** Manual escape hatch shared by the socket action and the CLI. */
export async function forceAdvanceStalledGame(gameId: string, requestedBy: string): Promise<GameStallRecoveryOutcome | null> {
  if (!installedIo) return null;
  if (!resolveGame(gameId)) return null;
  return requestManualGameStallRecovery(gameId, requestedBy, buildGameStallRecoveryDeps(installedIo));
}

function canForceAdvance(socket: Socket, game: any, gameId: string, playerId: string): boolean {
  if ((socket.data as any)?.accountIsAdmin === true) return true;
  try {
    if (isGameCreator(gameId, playerId)) return true;
  } catch {
    // ignore
  }
  if (game?._judgeRuntime?.judgeId && String(game._judgeRuntime.judgeId) === playerId) return true;
  // Solo-vs-AI games: the only live human seat acts as host.
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  const humans = players.filter((p) =>
    !(p?.spectator || p?.isSpectator || p?.hasLost || p?.eliminated || p?.conceded) && !isAiSeat(gameId, String(p?.id || '')));
  return humans.length === 1 && String(humans[0]?.id || '') === playerId;
}

/** Per-socket: `forceAdvanceStall { gameId }` -> `forceAdvanceStallResult`. */
export function registerGameStallHandlers(_io: Server, socket: Socket): void {
  socket.on('forceAdvanceStall', async (payload?: { gameId?: unknown }) => {
    const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
    const reply = (ok: boolean, message: string, extra: Record<string, unknown> = {}) => {
      try {
        socket.emit('forceAdvanceStallResult' as any, { gameId, ok, message, ...extra });
      } catch {
        // ignore
      }
    };
    try {
      if (!gameId) return reply(false, 'gameId required');
      if (((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        return reply(false, 'Not in game');
      }
      const playerId = String((socket.data as any)?.playerId || '');
      if (!playerId || (socket.data as any)?.spectator || (socket.data as any)?.isSpectator) {
        return reply(false, 'Not authorized');
      }
      const game = resolveGame(gameId);
      if (!game) return reply(false, 'Game not found');
      const seated = (Array.isArray(game.state?.players) ? game.state.players : []).some((p: any) => String(p?.id || '') === playerId);
      if (!seated || !canForceAdvance(socket, game, gameId, playerId)) {
        return reply(false, 'Only the game creator, judge, or an admin can force-advance');
      }
      const outcome = await forceAdvanceStalledGame(gameId, `player:${playerId}`);
      if (!outcome) return reply(false, 'Stall recovery is not available');
      reply(outcome.status === 'recovered', `Force-advance ${outcome.status}`, {
        status: outcome.status,
        gameAdvanced: outcome.gameAdvanced,
        reportFile: outcome.reportPath ? path.basename(outcome.reportPath) : null,
      });
    } catch (err) {
      reply(false, String((err as any)?.message ?? err));
    }
  });
}
