/**
 * Lightweight, throttled progress events for bulk identical-trigger resolution.
 * Emits "identicalTriggerBulkProgress" to the game room (no state broadcast):
 *   { gameId, runId, sourceName, done, total, phase: "start" | "progress" | "end", reason? }
 * Progress events are throttled to every PROGRESS_EVERY_INSTANCES instances or
 * PROGRESS_EVERY_MS milliseconds, whichever comes first.
 *
 * Public entry symbols: createIdenticalTriggerBulkProgress, IdenticalTriggerBulkStopReason,
 *   IDENTICAL_TRIGGER_BULK_PROGRESS_EVENT.
 */
import type { Server } from "socket.io";

export const IDENTICAL_TRIGGER_BULK_PROGRESS_EVENT = "identicalTriggerBulkProgress";
const PROGRESS_EVERY_INSTANCES = 10;
const PROGRESS_EVERY_MS = 250;

export type IdenticalTriggerBulkStopReason =
  | "complete"
  | "different_top"
  | "pending_choice"
  | "player_can_respond"
  | "busy"
  | "error";

export type IdenticalTriggerBulkProgressPayload = {
  gameId: string;
  runId: string;
  sourceName: string;
  done: number;
  total: number;
  phase: "start" | "progress" | "end";
  reason?: IdenticalTriggerBulkStopReason;
};

let runCounter = 0;

export function createIdenticalTriggerBulkProgress(
  io: Server | null,
  gameId: string,
  options: { sourceName: string; total: number; silent?: boolean; now?: () => number },
) {
  const now = options.now ?? Date.now;
  runCounter = (runCounter + 1) % 1_000_000;
  const runId = `${gameId}:${Date.now().toString(36)}:${runCounter}`;
  const silent = !io || Boolean(options.silent);
  let lastDone = -1;
  let lastAt = 0;
  let started = false;

  const emit = (phase: IdenticalTriggerBulkProgressPayload["phase"], done: number, reason?: IdenticalTriggerBulkStopReason) => {
    if (silent) return;
    const payload: IdenticalTriggerBulkProgressPayload = {
      gameId,
      runId,
      sourceName: options.sourceName || "Triggered ability",
      done: Math.max(0, Math.min(done, options.total)),
      total: options.total,
      phase,
      ...(reason ? { reason } : {}),
    };
    lastDone = done;
    lastAt = now();
    try {
      (io as Server).to(gameId).emit(IDENTICAL_TRIGGER_BULK_PROGRESS_EVENT as any, payload);
    } catch {
      /* progress is best-effort */
    }
  };

  return {
    runId,
    start(done: number) {
      started = true;
      emit("start", done);
    },
    update(done: number) {
      if (!started || done === lastDone) return;
      if (done - lastDone >= PROGRESS_EVERY_INSTANCES || now() - lastAt >= PROGRESS_EVERY_MS) emit("progress", done);
    },
    end(done: number, reason: IdenticalTriggerBulkStopReason) {
      if (!started) return;
      started = false;
      emit("end", done, reason);
    },
  };
}
