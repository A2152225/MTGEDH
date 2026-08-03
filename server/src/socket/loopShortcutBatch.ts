/**
 * Server-side Loop Shortcut batch: run a recorded sequence N times without
 * client round-trips. Handlers still append normal mutation events; broadcasts
 * are suppressed until the batch finishes.
 */
import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { ResolutionQueueManager } from '../state/resolution/index.js';
import { ensureGame, broadcastGame, emitToPlayer, getPlayerName } from './util.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import {
  buildResolutionResponsePayload,
  isLoopShortcutPhaseAdvanceEmit,
  matchesPromptFingerprint,
  sanitizeLoopShortcutItems,
  type LoopShortcutSequenceItem,
} from '../../../client/src/utils/loopShortcuts.js';
import {
  LOOP_SHORTCUT_MAX_ITERATIONS,
  beginSuppressEventAppend,
  captureLoopShortcutStatePatch,
  clampLoopShortcutIterations,
  diffLoopShortcutIterationDelta,
  endSuppressEventAppend,
  isLoopShortcutSelfSustaining,
  resolveLoopShortcutIterationBudget,
  snapshotLoopShortcutBoard,
  snapshotLoopShortcutResources,
  tryApplyLoopShortcutDeltaMultiply,
  type LoopShortcutBoardSnapshot,
  type LoopShortcutIterationDelta,
} from './loopShortcutSustain.js';
import { beginLoopShortcutQuietLogs, endLoopShortcutQuietLogs } from '../utils/debug.js';

const BATCHABLE_EVENTS = new Set([
  'activateBattlefieldAbility',
  'activateGraveyardAbility',
  'requestCastSpell',
  'castSpellFromHand',
  'completeCastSpell',
  'castCommander',
  'playLand',
  'submitResolutionResponse',
  'passPriority',
  'getMyNextResolutionStep',
]);

type HandlerMap = Record<string, (payload?: any) => any>;

export type LoopShortcutBatchResult = {
  ok: boolean;
  iterationsCompleted: number;
  requestedIterations: number;
  error?: string;
  stoppedAt?: { iteration: number; stepIndex: number; label?: string };
  selfSustaining?: boolean;
  compressed?: boolean;
  cappedForSustainability?: boolean;
};

function beginSuppressBroadcast(game: any): void {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return;
  state._suppressBroadcastCount = Math.max(0, Number(state._suppressBroadcastCount) || 0) + 1;
}

function endSuppressBroadcast(game: any): void {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return;
  const next = Math.max(0, (Number(state._suppressBroadcastCount) || 0) - 1);
  if (next <= 0) delete state._suppressBroadcastCount;
  else state._suppressBroadcastCount = next;
}

function setStackDrain(game: any, playerIds: string | string[], enabled: boolean): void {
  const stateAny = game?.state as any;
  if (!stateAny || typeof stateAny !== 'object') return;
  if (!stateAny.loopShortcutStackDrain || typeof stateAny.loopShortcutStackDrain !== 'object') {
    stateAny.loopShortcutStackDrain = {};
  }
  const ids = Array.isArray(playerIds) ? playerIds : [playerIds];
  for (const playerId of ids) {
    const id = String(playerId || '').trim();
    if (!id) continue;
    if (enabled) stateAny.loopShortcutStackDrain[id] = true;
    else delete stateAny.loopShortcutStackDrain[id];
  }
}

function buildViewForPlayer(game: any, playerId: string): any {
  try {
    if (typeof game?.viewFor === 'function') {
      return game.viewFor(playerId, false);
    }
  } catch {
    // fall through
  }
  return game?.state;
}

function getPendingStepsForPlayer(gameId: string, playerId: string): any[] {
  try {
    return ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any) || [];
  } catch {
    return [];
  }
}

function getNextPendingStep(gameId: string, playerId: string): any | null {
  const steps = getPendingStepsForPlayer(gameId, playerId);
  return steps.find((step: any) => String(step?.status || '') !== 'completed') || null;
}

function getAllPlayerIds(game: any): string[] {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  return players
    .map((player: any) => String(player?.id || '').trim())
    .filter(Boolean);
}

/**
 * Drain a non-empty stack synchronously for loop batches.
 * Passes for whoever holds priority (including AI/opponents) via game.passPriority —
 * never waits on AI reaction timers or the heavy socket passPriority handler.
 */
function drainNonEmptyStack(
  game: any,
  gameId: string,
  playerId: string,
  maxPasses = 400,
): void {
  for (let i = 0; i < maxPasses; i += 1) {
    const state = game.state as any;
    const stackLen = Array.isArray(state?.stack) ? state.stack.length : 0;
    if (stackLen <= 0) return;

    // Stop so the batch can answer the looping player's next recorded prompt.
    if (getPendingStepsForPlayer(gameId, playerId).some((s: any) => String(s?.status || '') !== 'completed')) {
      return;
    }

    const priorityHolder = String(state?.priority || '').trim();
    if (!priorityHolder) {
      if (typeof game.resolveTopOfStack === 'function') {
        try {
          game.resolveTopOfStack();
        } catch {
          return;
        }
      } else {
        return;
      }
      continue;
    }

    if (typeof game.passPriority !== 'function') return;

    let result: any = null;
    try {
      result = game.passPriority(priorityHolder, true);
    } catch {
      return;
    }

    const resolvedNow = Boolean(result && (result.resolvedNow ?? false));
    if (resolvedNow && typeof game.resolveTopOfStack === 'function') {
      try {
        game.resolveTopOfStack();
      } catch {
        // continue draining
      }
    }

    // If nothing changed, avoid a tight infinite loop.
    if (result && result.changed === false && !resolvedNow) {
      return;
    }
  }
}

function settleQuietBoard(
  game: any,
  gameId: string,
  playerId: string,
  maxRounds = 200,
): void {
  for (let round = 0; round < maxRounds; round += 1) {
    drainNonEmptyStack(game, gameId, playerId);

    const pending = getPendingStepsForPlayer(gameId, playerId).filter(
      (s: any) => String(s?.status || '') !== 'completed',
    );
    const stackLen = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack.length : 0;
    if (pending.length === 0 && stackLen === 0) return;

    // Prompts for the looping player — caller answers from the recorded sequence.
    if (pending.length > 0) return;

    // Stack remains but priority is missing/stuck — try one forced resolve.
    if (stackLen > 0 && typeof game.resolveTopOfStack === 'function') {
      try {
        game.resolveTopOfStack();
      } catch {
        return;
      }
    } else {
      return;
    }
  }
}

async function buildHandlerRegistry(
  io: Server,
  gameId: string,
  playerId: string,
): Promise<{
  handlers: HandlerMap;
  clearError: () => void;
  getLastError: () => { code?: string; message?: string } | null;
}> {
  const handlers: HandlerMap = {};
  let lastError: { code?: string; message?: string } | null = null;

  const stubSocket = {
    data: { playerId, gameId, spectator: false, isSpectator: false },
    rooms: new Set([gameId]),
    on: (event: string, handler: (payload?: any) => any) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      if (event === 'error') {
        lastError = {
          code: String(payload?.code || 'ERROR'),
          message: String(payload?.message || 'Action rejected'),
        };
      }
    },
  } as any;

  const { registerInteractionHandlers } = await import('./interaction.js');
  const { registerGameActions } = await import('./game-actions.js');
  const { registerResolutionHandlers } = await import('./resolution.js');
  const { registerCommanderHandlers } = await import('./commander.js');
  const { registerPriorityHandlers } = await import('./priority.js');

  registerInteractionHandlers(io, stubSocket);
  registerGameActions(io, stubSocket);
  registerResolutionHandlers(io, stubSocket);
  registerCommanderHandlers(io, stubSocket);
  registerPriorityHandlers(io, stubSocket);

  return {
    handlers,
    clearError: () => {
      lastError = null;
    },
    getLastError: () => lastError,
  };
}

async function answerMatchingPrompt(args: {
  handlers: HandlerMap;
  game: any;
  gameId: string;
  playerId: string;
  item: Extract<LoopShortcutSequenceItem, { kind: 'resolution_response' }>;
  clearError: () => void;
  getLastError: () => { code?: string; message?: string } | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const step = getNextPendingStep(args.gameId, args.playerId);
  if (!step) {
    return { ok: false, error: `No pending prompt for ${args.item.label}` };
  }
  if (!matchesPromptFingerprint(args.item.fingerprint, step)) {
    return {
      ok: false,
      error: `Unexpected prompt (${String(step?.type || '?')} / ${String(step?.sourceName || step?.cardName || '?')}) while waiting for ${args.item.label}`,
    };
  }

  const view = buildViewForPlayer(args.game, args.playerId);
  const built = buildResolutionResponsePayload(
    args.item.template,
    step,
    view,
    args.playerId,
  );
  if (built == null) {
    return { ok: false, error: `Could not rebind targets for ${args.item.label}` };
  }

  const submit = args.handlers.submitResolutionResponse;
  if (typeof submit !== 'function') {
    return { ok: false, error: 'submitResolutionResponse handler unavailable' };
  }

  args.clearError();
  await Promise.resolve(
    submit({
      gameId: args.gameId,
      stepId: step.id,
      selections: built.selections,
      cancelled: false,
    }),
  );
  const err = args.getLastError();
  if (err) {
    return { ok: false, error: err.message || 'Resolution response rejected' };
  }
  return { ok: true };
}

export async function executeLoopShortcutBatch(args: {
  io: Server;
  gameId: string;
  playerId: string;
  name?: string;
  items: LoopShortcutSequenceItem[];
  iterations: number;
  onProgress?: (info: {
    iteration: number;
    maxIterations: number;
    selfSustaining: boolean | null;
    message: string;
  }) => void;
}): Promise<LoopShortcutBatchResult> {
  const game = ensureGame(args.gameId);
  if (!game) {
    return {
      ok: false,
      iterationsCompleted: 0,
      requestedIterations: args.iterations,
      error: 'Game not found',
    };
  }

  const sanitized = sanitizeLoopShortcutItems(args.items || []);
  const items = sanitized.items;
  const requestedIterations = clampLoopShortcutIterations(args.iterations);
  if (items.length === 0) {
    return {
      ok: false,
      iterationsCompleted: 0,
      requestedIterations,
      error: 'Loop has no runnable steps',
    };
  }

  const registry = await buildHandlerRegistry(args.io, args.gameId, args.playerId);
  const handlers = registry.handlers;
  const clearError = registry.clearError;
  const getLastError = registry.getLastError;

  const compressEvents = requestedIterations > LOOP_SHORTCUT_MAX_ITERATIONS;
  let selfSustaining: boolean | null = null;
  let maxIterations = resolveLoopShortcutIterationBudget({
    requested: requestedIterations,
    selfSustaining,
  }).maxIterations;
  let cappedForSustainability = false;
  let compressed = false;

  const allPlayerIds = getAllPlayerIds(game);
  beginSuppressBroadcast(game);
  // Always skip per-action event spam during batch — write start/apply/end only.
  beginSuppressEventAppend(game);
  beginLoopShortcutQuietLogs();
  compressed = true;
  setStackDrain(game, allPlayerIds.length > 0 ? allPlayerIds : [args.playerId], true);

  let iterationsCompleted = 0;
  let stoppedAt: LoopShortcutBatchResult['stoppedAt'];
  let error: string | undefined;
  let afterFirstSnapshot: ReturnType<typeof snapshotLoopShortcutResources> | null = null;
  let afterFirstBoard: LoopShortcutBoardSnapshot | null = null;
  let iterationDelta: LoopShortcutIterationDelta | null = null;
  let deltaMultipliedBy = 0;
  let usedDeltaMultiply = false;

  try {
    try {
      appendEvent(args.gameId, (game as any).seq ?? 0, 'loopShortcutBatchStart', {
        playerId: args.playerId,
        name: args.name || 'Loop Shortcut',
        iterations: requestedIterations,
        stepCount: items.length,
        compressEvents,
      });
    } catch {
      // best-effort
    }

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      for (let stepIndex = 0; stepIndex < items.length; stepIndex += 1) {
        const item = items[stepIndex];
        if (!item) continue;

        if (isLoopShortcutPhaseAdvanceEmit(item)) {
          settleQuietBoard(game, args.gameId, args.playerId);
          continue;
        }

        if (item.kind === 'resolution_response') {
          settleQuietBoard(game, args.gameId, args.playerId);
          const answered = await answerMatchingPrompt({
            handlers,
            game,
            gameId: args.gameId,
            playerId: args.playerId,
            item,
            clearError,
            getLastError,
          });
          if (answered.ok === false) {
            error = answered.error;
            stoppedAt = { iteration, stepIndex, label: item.label };
            break;
          }
          settleQuietBoard(game, args.gameId, args.playerId);
          continue;
        }

        const eventName = String(item.event || '').trim();
        if (!BATCHABLE_EVENTS.has(eventName)) {
          error = `Unsupported loop event: ${eventName}`;
          stoppedAt = { iteration, stepIndex, label: item.label };
          break;
        }
        const handler = handlers[eventName];
        if (typeof handler !== 'function') {
          error = `Handler missing for ${eventName}`;
          stoppedAt = { iteration, stepIndex, label: item.label };
          break;
        }

        clearError();
        const payload = JSON.parse(JSON.stringify(item.payload || {}));
        payload.gameId = args.gameId;
        await Promise.resolve(handler(payload));
        const err = getLastError();
        if (err) {
          error = err.message || `${eventName} rejected`;
          stoppedAt = { iteration, stepIndex, label: item.label };
          break;
        }

        settleQuietBoard(game, args.gameId, args.playerId);
      }

      if (error) break;
      iterationsCompleted = iteration + 1;

      // Sustain + delta probe: compare steady-state (end of iter 1 → end of iter 2)
      // so kickstart spend on the first cycle does not fail sustain / skew deltas.
      if (iterationsCompleted === 1 && maxIterations >= 2) {
        afterFirstSnapshot = snapshotLoopShortcutResources(game.state, args.playerId);
        afterFirstBoard = snapshotLoopShortcutBoard(game.state, (game as any).libraries);
        args.onProgress?.({
          iteration: iterationsCompleted,
          maxIterations,
          selfSustaining: null,
          message: `Iteration 1 done — probing whether the loop is self-sustaining...`,
        });
      } else if (iterationsCompleted === 2 && afterFirstSnapshot && afterFirstBoard) {
        const afterSecond = snapshotLoopShortcutResources(game.state, args.playerId);
        const afterSecondBoard = snapshotLoopShortcutBoard(game.state, (game as any).libraries);
        selfSustaining = isLoopShortcutSelfSustaining(afterFirstSnapshot, afterSecond);
        const budget = resolveLoopShortcutIterationBudget({
          requested: requestedIterations,
          selfSustaining,
        });
        maxIterations = budget.maxIterations;
        if (!selfSustaining && requestedIterations > LOOP_SHORTCUT_MAX_ITERATIONS) {
          cappedForSustainability = true;
          args.onProgress?.({
            iteration: iterationsCompleted,
            maxIterations,
            selfSustaining,
            message: `Loop is not self-sustaining between iterations (resources decreased). Capping at ${LOOP_SHORTCUT_MAX_ITERATIONS}.`,
          });
        } else if (selfSustaining) {
          iterationDelta = diffLoopShortcutIterationDelta(afterFirstBoard, afterSecondBoard);
          const remaining = Math.max(0, maxIterations - iterationsCompleted);
          if (remaining > 0) {
            args.onProgress?.({
              iteration: iterationsCompleted,
              maxIterations,
              selfSustaining,
              message: `Self-sustaining loop confirmed. Applying ×${remaining} delta (mana/tokens) + fast mills...`,
            });
            const applied = tryApplyLoopShortcutDeltaMultiply({
              game,
              delta: iterationDelta,
              remainingIterations: remaining,
            });
            if (applied.ok) {
              usedDeltaMultiply = true;
              deltaMultipliedBy = remaining;
              iterationsCompleted = maxIterations;
              args.onProgress?.({
                iteration: iterationsCompleted,
                maxIterations,
                selfSustaining,
                message: `Applied ${remaining} remaining iteration(s) via delta multiply` +
                  (applied.milledTotal ? ` (${applied.milledTotal} card(s) milled).` : '.'),
              });
              break;
            }
            debugWarn(1, '[LoopShortcutBatch] delta multiply unsafe; falling back to physical', {
              reason: applied.reason,
            });
            args.onProgress?.({
              iteration: iterationsCompleted,
              maxIterations,
              selfSustaining,
              message: `Delta multiply unavailable (${applied.reason || 'unsafe'}). Continuing physical iterations...`,
            });
          } else {
            args.onProgress?.({
              iteration: iterationsCompleted,
              maxIterations,
              selfSustaining,
              message: `Self-sustaining loop confirmed. Batch complete.`,
            });
          }
        }
      } else if (iterationsCompleted % 5 === 0 || iterationsCompleted === maxIterations) {
        args.onProgress?.({
          iteration: iterationsCompleted,
          maxIterations,
          selfSustaining,
          message: `Batched ${iterationsCompleted}/${maxIterations} iteration(s)...`,
        });
      }
    }

    if (compressed) {
      try {
        const debugDelta = iterationDelta
          ? {
              floatingManaByPlayer: iterationDelta.floatingManaByPlayer,
              lifeByPlayer: iterationDelta.lifeByPlayer,
              millsByPlayer: iterationDelta.millsByPlayer,
              tokensByFingerprint: Object.fromEntries(
                Object.entries(iterationDelta.tokensByFingerprint || {}).map(([fp, entry]) => [
                  fp,
                  {
                    count: entry.count,
                    name: String(entry.prototype?.card?.name || entry.prototype?.name || ''),
                  },
                ]),
              ),
            }
          : undefined;
        appendEvent(args.gameId, (game as any).seq ?? 0, 'loopShortcutBatchApply', {
          playerId: args.playerId,
          name: args.name || 'Loop Shortcut',
          requestedIterations,
          iterationsCompleted,
          selfSustaining: selfSustaining === true,
          cappedForSustainability,
          usedDeltaMultiply,
          ...(usedDeltaMultiply && debugDelta
            ? {
                delta: debugDelta,
                multipliedBy: deltaMultipliedBy,
              }
            : {}),
          statePatch: captureLoopShortcutStatePatch(game.state),
        });
      } catch (err) {
        debugWarn(1, '[LoopShortcutBatch] failed to append compressed apply event', err);
      }
    }

    try {
      appendEvent(args.gameId, (game as any).seq ?? 0, 'loopShortcutBatchEnd', {
        playerId: args.playerId,
        name: args.name || 'Loop Shortcut',
        requestedIterations,
        iterationsCompleted,
        ok: !error,
        error,
        stoppedAt,
        selfSustaining: selfSustaining === true,
        compressed,
        cappedForSustainability,
      });
    } catch {
      // best-effort
    }
  } catch (err: any) {
    error = String(err?.message || err || 'Batch failed');
    debugError(1, '[LoopShortcutBatch] failed', err);
  } finally {
    setStackDrain(game, allPlayerIds.length > 0 ? allPlayerIds : [args.playerId], false);
    endLoopShortcutQuietLogs();
    endSuppressEventAppend(game);
    endSuppressBroadcast(game);
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(args.io, game, args.gameId, { forceStateReplace: true });
  }

  const effectiveRequested = cappedForSustainability
    ? Math.min(requestedIterations, LOOP_SHORTCUT_MAX_ITERATIONS)
    : requestedIterations;

  const result: LoopShortcutBatchResult = {
    ok: !error && iterationsCompleted === effectiveRequested,
    iterationsCompleted,
    requestedIterations,
    ...(error ? { error } : {}),
    ...(stoppedAt ? { stoppedAt } : {}),
    ...(selfSustaining != null ? { selfSustaining } : {}),
    ...(compressed ? { compressed: true } : {}),
    ...(cappedForSustainability ? { cappedForSustainability: true } : {}),
  };

  debug(1, '[LoopShortcutBatch] complete', {
    gameId: args.gameId,
    playerId: args.playerId,
    ...result,
  });

  return result;
}

export function registerLoopShortcutBatchHandler(
  io: Server,
  socket: any,
  helpers: {
    ensureInRoomAndSeated: (gameId: string) => { game: any; pid: string } | null;
  },
): void {
  socket.on(
    'executeLoopShortcutBatch',
    async (payload?: {
      gameId?: unknown;
      name?: unknown;
      items?: unknown;
      iterationCount?: unknown;
    }) => {
      const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
      const ctx = gameId ? helpers.ensureInRoomAndSeated(gameId) : null;
      if (!ctx) return;
      const { pid } = ctx;

      const items = Array.isArray(payload?.items) ? (payload!.items as LoopShortcutSequenceItem[]) : [];
      const iterationCount = clampLoopShortcutIterations(payload?.iterationCount);
      const name = String(payload?.name || 'Loop Shortcut').trim() || 'Loop Shortcut';

      emitToPlayer(io, pid, 'loopShortcutBatchProgress', {
        gameId,
        status: 'running',
        name,
        requestedIterations: iterationCount,
        message: `Batching ${iterationCount} iteration(s)...`,
      });

      const result = await executeLoopShortcutBatch({
        io,
        gameId,
        playerId: pid,
        name,
        items,
        iterations: iterationCount,
        onProgress: (info) => {
          emitToPlayer(io, pid, 'loopShortcutBatchProgress', {
            gameId,
            status: 'running',
            name,
            requestedIterations: iterationCount,
            iteration: info.iteration,
            maxIterations: info.maxIterations,
            selfSustaining: info.selfSustaining,
            message: info.message,
          });
        },
      });

      const resultMessage = (() => {
        if (result.ok) {
          if (result.compressed && result.selfSustaining) {
            return `Completed ${result.iterationsCompleted} self-sustaining iteration(s) of "${name}" (compressed for replay).`;
          }
          if (result.cappedForSustainability) {
            return `Completed ${result.iterationsCompleted} iteration(s) of "${name}" (capped at ${LOOP_SHORTCUT_MAX_ITERATIONS}; loop was not self-sustaining).`;
          }
          return `Completed ${result.iterationsCompleted} iteration(s) of "${name}".`;
        }
        return `Stopped after ${result.iterationsCompleted}/${result.requestedIterations}: ${result.error || 'unknown error'}`;
      })();

      emitToPlayer(io, pid, 'loopShortcutBatchResult', {
        gameId,
        name,
        ...result,
        message: resultMessage,
      });

      // Also notify table via chat-style game event visibility is already in appendEvent;
      // ping others with a light status.
      try {
        const game = ensureGame(gameId);
        if (game) {
          const players = Array.isArray((game.state as any)?.players) ? (game.state as any).players : [];
          for (const player of players) {
            const id = String(player?.id || '').trim();
            if (!id || id === pid) continue;
            emitToPlayer(io, id, 'loopShortcutBatchResult', {
              gameId,
              name,
              observer: true,
              proposerName: getPlayerName(game, pid),
              ...result,
              message: result.ok
                ? `${getPlayerName(game, pid)} finished ${result.iterationsCompleted}× "${name}".`
                : `${getPlayerName(game, pid)}'s loop stopped: ${result.error || 'error'}`,
            });
          }
        }
      } catch (err) {
        debugWarn(1, '[LoopShortcutBatch] notify observers failed', err);
      }
    },
  );
}
