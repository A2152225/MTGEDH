/**
 * server/src/state/modules/gameStall/gameStallRecovery.ts
 *
 * Escalating, idempotent, rate-limited recovery for a detected stall. No
 * server restart, no direct phase/step writes: every game-moving action goes
 * through the existing persisted paths supplied by the socket layer
 * (AI executePassPriority, persistAndResolveTopOfStack,
 * advanceStepPersistingEvent), so undo boundaries and the event log stay valid.
 *
 *  Stage 1  Cancel the stuck AI seat's pending action/prompt (scheduler timer,
 *           stuck in-progress lock, its open Resolution Queue steps, orphaned
 *           pendingSpellCasts) and force that seat to pass priority.
 *  (wait)   stage2DelayMs. Any board-fingerprint change => recovered.
 *  Stage 2  Cancel stale prompts (AI-owned, ownerless, or owned by seats that
 *           left; human prompts only on a manual force-advance), reset the
 *           passed-by set, then:
 *             - stack non-empty: resolve the top item through the normal path;
 *               only an orphaned/invalid top item that still will not resolve
 *               is dropped (logged + reported) as a last resort;
 *             - stack empty: advance via the normal nextStep path.
 *  Every run broadcasts a system chat line and writes a stall report.
 *
 * Public entry symbols: runGameStallRecovery, requestManualGameStallRecovery,
 * isOrphanedStackItem, GameStallRecoveryDeps, GameStallRecoveryOutcome.
 */

import { getGameStallConfig } from './gameStallConfig.js';
import {
  collectGameStallPendingPrompts,
  computeGameStallFingerprint,
  summarizeGameStallStack,
} from './gameStallFingerprint.js';
import {
  admitGameStallRecovery,
  getGameStallTracker,
  markGameStallRecoveryFinished,
  type GameStallDetection,
} from './gameStallDetector.js';
import {
  buildGameStallReport,
  buildGameStallReportFileName,
  resolveGameStallReportDir,
  writeGameStallReport,
  type GameStallPhaseSnapshot,
  type GameStallRecoveryRecord,
  type GameStallRecoveryStageRecord,
} from './gameStallReportWriter.js';
import { isGameReplayLocked } from '../../../gameRestoreState.js';
import { debugWarn } from '../../../utils/debug.js';
import path from 'node:path';

export interface GameStallRecoveryDeps {
  getGame(gameId: string): any;
  isAiSeat(gameId: string, playerId: string): boolean;
  getPlayerName?(game: any, playerId: string): string;
  /** Runtime-only AI cleanup (scheduled timers, stuck in-progress lock). Returns action notes. */
  cancelAiPendingAction?(gameId: string, playerId: string): string[];
  /** Normal persisted AI pass path (passPriority + resolve/advance + broadcast). */
  forcePassPriority(gameId: string, playerId: string): Promise<unknown> | unknown;
  /** Normal persisted resolve-top-of-stack path. */
  resolveTopOfStack(gameId: string): Promise<boolean> | boolean;
  /** Normal persisted step advance (advanceStepPersistingEvent). */
  advanceStep(gameId: string, reason: string): boolean;
  cancelResolutionStep(gameId: string, stepId: string): boolean;
  broadcast(gameId: string): void;
  emitSystemChat(gameId: string, message: string): void;
  kickAi?(gameId: string, playerId: string): void;
  getLastAiDecision?(playerId: string): unknown;
  wait?(ms: number): Promise<void>;
  reportDir?: string;
}

export interface GameStallRecoveryOutcome {
  status: GameStallRecoveryRecord['status'];
  gameAdvanced: boolean;
  reportPath: string | null;
  record: GameStallRecoveryRecord;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    (timer as any)?.unref?.();
  });
}

function snapshot(game: any, gameId: string): GameStallPhaseSnapshot {
  const fp = computeGameStallFingerprint(game, gameId);
  return {
    turn: fp.turn,
    phase: fp.phase,
    step: fp.step,
    priority: fp.priority,
    stackLength: fp.stackLength,
    boardFingerprint: fp.board,
  };
}

function stageRecord(stage: 1 | 2, game: any, gameId: string, actions: string[], beforeBoard: string): GameStallRecoveryStageRecord {
  const snap = snapshot(game, gameId);
  return {
    stage,
    at: new Date().toISOString(),
    actions,
    boardChanged: snap.boardFingerprint !== beforeBoard,
    phaseAfter: snap.phase,
    stepAfter: snap.step,
    priorityAfter: snap.priority,
  };
}

function playerName(deps: GameStallRecoveryDeps, game: any, playerId: string | null): string {
  if (!playerId) return 'unknown seat';
  try {
    const name = deps.getPlayerName?.(game, playerId);
    if (name) return name;
  } catch {
    // ignore
  }
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  return String(players.find((p) => String(p?.id || '') === playerId)?.name || playerId);
}

function seatIsLive(game: any, playerId: string): boolean {
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  const player = players.find((p) => String(p?.id || '') === playerId);
  if (!player) return false;
  return !(player.spectator || player.isSpectator || player.hasLost || player.eliminated || player.conceded);
}

function bumpSeq(game: any): void {
  try {
    if (typeof game?.bumpSeq === 'function') game.bumpSeq();
  } catch {
    // ignore
  }
}

/** A stack item that cannot be resolved by any handler: no id, no live controller, or no payload. */
export function isOrphanedStackItem(item: any, state: any): boolean {
  if (!item || typeof item !== 'object') return true;
  if (item.id === undefined || item.id === null || String(item.id) === '') return true;
  const controller = String(item.controller ?? item.playerId ?? '').trim();
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  if (!controller || !players.some((p) => String(p?.id || '') === controller)) return true;
  const hasPayload = Boolean(
    item.card || item.ability || item.description || item.effect || item.sourceName
    || item.name || item.text || item.oracleText || item.type || item.kind,
  );
  return !hasPayload;
}

function pickStuckSeat(game: any, gameId: string, detection: GameStallDetection, deps: GameStallRecoveryDeps): string | null {
  const state = game?.state || {};
  const candidates = [detection.stuckSeat, state.priority, ...collectGameStallPendingPrompts(game, gameId).map((p) => p.playerId)]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const ai = candidates.find((id) => deps.isAiSeat(gameId, id));
  return ai || candidates[0] || null;
}

function clearAiLegacyPending(game: any, seat: string): string[] {
  const notes: string[] = [];
  const state = game?.state || {};
  const pendingSpellCasts = state.pendingSpellCasts;
  if (pendingSpellCasts && typeof pendingSpellCasts === 'object') {
    for (const [effectId, cast] of Object.entries(pendingSpellCasts as Record<string, any>)) {
      if (String(cast?.playerId || '') !== seat) continue;
      delete (pendingSpellCasts as any)[effectId];
      notes.push(`cleared pendingSpellCasts[${effectId}] (${cast?.cardName || 'unknown card'})`);
    }
  }
  if (state._aiProcessingCleanup && state._aiProcessingCleanup[seat]) {
    delete state._aiProcessingCleanup[seat];
    notes.push('cleared _aiProcessingCleanup flag');
  }
  return notes;
}

function isLocked(game: any, gameId: string): boolean {
  try {
    return isGameReplayLocked(game, gameId);
  } catch {
    return true;
  }
}

async function runStage1(
  game: any,
  gameId: string,
  detection: GameStallDetection,
  deps: GameStallRecoveryDeps,
  record: GameStallRecoveryRecord,
): Promise<string[]> {
  const actions: string[] = [];
  const seat = pickStuckSeat(game, gameId, detection, deps);
  if (!seat || !deps.isAiSeat(gameId, seat)) {
    actions.push(`skipped: stuck seat ${seat ?? '(none)'} is not an AI seat (humans are never forced to act)`);
    return actions;
  }
  try {
    actions.push(...(deps.cancelAiPendingAction?.(gameId, seat) || []));
  } catch (err) {
    actions.push(`cancelAiPendingAction failed: ${String((err as any)?.message ?? err)}`);
  }
  for (const prompt of collectGameStallPendingPrompts(game, gameId)) {
    if (prompt.playerId !== seat) continue;
    if (deps.cancelResolutionStep(gameId, prompt.id)) {
      actions.push(`cancelled AI prompt ${prompt.type}#${prompt.id}`);
      record.cancelledPrompts.push({ stage: 1, ...prompt });
    }
  }
  actions.push(...clearAiLegacyPending(game, seat));
  const live = deps.getGame(gameId) || game;
  if (String(live?.state?.priority ?? '') === seat) {
    try {
      await deps.forcePassPriority(gameId, seat);
      actions.push(`forced ${seat} to pass priority`);
    } catch (err) {
      actions.push(`forced pass failed: ${String((err as any)?.message ?? err)}`);
    }
  } else {
    actions.push(`${seat} does not hold priority; no forced pass`);
  }
  deps.broadcast(gameId);
  deps.emitSystemChat(gameId, `Stall detected (${detection.rule}) — cleared ${playerName(deps, live, seat)}'s pending action and forced a priority pass.`);
  return actions;
}

async function runStage2(
  game: any,
  gameId: string,
  deps: GameStallRecoveryDeps,
  record: GameStallRecoveryRecord,
): Promise<{ actions: string[]; chat: string }> {
  const actions: string[] = [];
  const state = game.state;

  for (const prompt of collectGameStallPendingPrompts(game, gameId)) {
    const owner = prompt.playerId;
    const ownerIsHuman = !!owner && seatIsLive(game, owner) && !deps.isAiSeat(gameId, owner);
    if (ownerIsHuman && !record.manual) continue;
    if (deps.cancelResolutionStep(gameId, prompt.id)) {
      actions.push(`cancelled stale prompt ${prompt.type}#${prompt.id} (owner ${owner || 'none'})`);
      record.cancelledPrompts.push({ stage: 2, ...prompt });
    }
  }

  if (state.stepAdvanceBlocked) {
    delete state.stepAdvanceBlocked;
    actions.push('cleared stepAdvanceBlocked');
  }
  state.priorityPassedBy = new Set<string>();
  const turnPlayer = state.turnPlayer ? String(state.turnPlayer) : '';
  if ((state.priority === null || state.priority === undefined || state.priority === '') && turnPlayer) {
    state.priority = turnPlayer;
    actions.push(`restored missing priority to turn player ${turnPlayer}`);
  }

  const stack: any[] = Array.isArray(state.stack) ? state.stack : [];
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    const topId = top?.id ?? null;
    const lengthBefore = stack.length;
    let resolved = false;
    try {
      resolved = Boolean(await deps.resolveTopOfStack(gameId));
    } catch (err) {
      actions.push(`resolve top of stack threw: ${String((err as any)?.message ?? err)}`);
    }
    const live = deps.getGame(gameId) || game;
    const liveStack: any[] = Array.isArray(live.state?.stack) ? live.state.stack : [];
    const liveTop = liveStack[liveStack.length - 1];
    const unchanged = liveStack.length === lengthBefore && (liveTop?.id ?? null) === topId;
    actions.push(`resolve top of stack (${top?.card?.name || top?.name || topId || 'unknown'}): ${resolved ? 'ok' : 'refused'}${unchanged ? ', stack unchanged' : ''}`);
    if (unchanged && isOrphanedStackItem(liveTop, live.state)) {
      const dropped = summarizeGameStallStack({ stack: [liveTop] })[0] || {};
      liveStack.pop();
      bumpSeq(live);
      record.droppedStackItems.push(dropped);
      actions.push(`dropped orphaned stack item ${String(dropped.id ?? '(no id)')} (last resort)`);
      debugWarn(1, `[gameStall] Dropped orphaned stack item in ${gameId}:`, { gameId, item: dropped });
    }
    if (!live.state.priority && turnPlayer) live.state.priority = turnPlayer;
    deps.broadcast(gameId);
    return {
      actions,
      chat: unchanged
        ? `Stall detected — could not resolve the top of the stack automatically.`
        : `Stall detected — resolved the top of the stack (now ${live.state.phase}/${live.state.step}).`,
    };
  }

  if (turnPlayer) state.priority = turnPlayer;
  const from = `${state.phase}/${state.step}`;
  let advanced = false;
  try {
    advanced = deps.advanceStep(gameId, 'stallRecovery');
  } catch (err) {
    actions.push(`advanceStep threw: ${String((err as any)?.message ?? err)}`);
  }
  const live = deps.getGame(gameId) || game;
  const to = `${live.state.phase}/${live.state.step}`;
  actions.push(`advanceStep ${from} -> ${to} (${advanced && from !== to ? 'moved' : 'did not move'})`);
  deps.broadcast(gameId);
  const nextPriority = live.state.priority ? String(live.state.priority) : '';
  if (nextPriority && deps.isAiSeat(gameId, nextPriority)) {
    try {
      deps.kickAi?.(gameId, nextPriority);
      actions.push(`scheduled AI ${nextPriority}`);
    } catch {
      // ignore
    }
  }
  return {
    actions,
    chat: from !== to
      ? `Stall detected — advanced to ${to}.`
      : `Stall detected — could not advance from ${from} automatically.`,
  };
}

/**
 * Run the full recovery for a detection. The automatic path is admitted by the
 * detector before calling; pass `admitted: false` (manual path) to gate here.
 */
export async function runGameStallRecovery(
  detection: GameStallDetection,
  deps: GameStallRecoveryDeps,
  options: { admitted?: boolean; manual?: boolean; requestedBy?: string; stage2DelayMs?: number } = {},
): Promise<GameStallRecoveryOutcome> {
  const gameId = detection.gameId;
  let game = deps.getGame(gameId);
  const cfg = getGameStallConfig();
  const wait = deps.wait || defaultWait;
  const manual = options.manual === true;

  const emptyRecord = (status: GameStallRecoveryRecord['status'], result: string): GameStallRecoveryRecord => ({
    manual,
    requestedBy: options.requestedBy,
    status,
    result,
    gameAdvanced: false,
    before: game ? snapshot(game, gameId) : { turn: null, phase: '', step: '', priority: null, stackLength: 0, boardFingerprint: '' },
    stagesApplied: [],
    droppedStackItems: [],
    cancelledPrompts: [],
  });

  if (!game) {
    markGameStallRecoveryFinished(gameId);
    return { status: 'skipped', gameAdvanced: false, reportPath: null, record: emptyRecord('skipped', 'game not found') };
  }
  if (options.admitted === false) {
    const admitted = admitGameStallRecovery(gameId, game, { manual });
    if (!admitted.ok) {
      return { status: 'skipped', gameAdvanced: false, reportPath: null, record: emptyRecord('skipped', admitted.reason || 'not admitted') };
    }
  }

  const record = emptyRecord('in_progress', 'recovery started');
  const beforeBoard = record.before.boardFingerprint;
  const reportPath = path.join(resolveGameStallReportDir(deps.reportDir), buildGameStallReportFileName(gameId, detection.detectedAt));
  const isAi = (playerId: string) => {
    try {
      return deps.isAiSeat(gameId, playerId);
    } catch {
      return false;
    }
  };
  // Prompts/stack are captured once, at detection time, so the final rewrite still shows what was stuck.
  let detectionTimeSnapshot: Pick<ReturnType<typeof buildGameStallReport>, 'pendingPrompts' | 'stack'> | null = null;
  const writeReport = (): string | null => {
    const live = deps.getGame(gameId) || game;
    const lastDecisionSeat = detection.stuckSeat || live?.state?.priority;
    let lastAiDecision: unknown = null;
    try {
      lastAiDecision = lastDecisionSeat && isAi(String(lastDecisionSeat))
        ? { playerId: lastDecisionSeat, decision: deps.getLastAiDecision?.(String(lastDecisionSeat)) ?? null }
        : null;
    } catch {
      lastAiDecision = null;
    }
    const report = buildGameStallReport({
      game: live,
      gameId,
      detection,
      tracker: getGameStallTracker(gameId),
      recovery: record,
      isAiSeat: isAi,
      lastAiDecision,
    });
    if (!detectionTimeSnapshot) {
      detectionTimeSnapshot = { pendingPrompts: report.pendingPrompts, stack: report.stack };
    } else {
      report.pendingPrompts = detectionTimeSnapshot.pendingPrompts;
      report.stack = detectionTimeSnapshot.stack;
    }
    return writeGameStallReport(report, { filePath: reportPath });
  };

  debugWarn(1, `[gameStall] Stall detected in ${gameId}: ${detection.rule} — ${detection.reason}`, { gameId });
  let written = writeReport();

  try {
    if (isLocked(game, gameId)) {
      record.status = 'aborted';
      record.result = 'undo/restore replay in progress';
      return { status: record.status, gameAdvanced: false, reportPath: written, record };
    }

    // ---------------- Stage 1 ----------------
    const stage1Actions = await runStage1(game, gameId, detection, deps, record);
    game = deps.getGame(gameId) || game;
    record.stagesApplied.push(stageRecord(1, game, gameId, stage1Actions, beforeBoard));

    const delay = options.stage2DelayMs ?? cfg.stage2DelayMs;
    await wait(delay);
    game = deps.getGame(gameId);
    if (!game) {
      record.status = 'aborted';
      record.result = 'game disappeared during recovery window';
      return { status: record.status, gameAdvanced: false, reportPath: written, record };
    }
    if (isLocked(game, gameId)) {
      record.status = 'aborted';
      record.result = 'undo/restore replay started during recovery window';
      return { status: record.status, gameAdvanced: false, reportPath: written, record };
    }

    if (computeGameStallFingerprint(game, gameId).board !== beforeBoard) {
      record.status = 'recovered';
      record.result = 'stage 1 restored progress';
      record.gameAdvanced = true;
    } else {
      // ---------------- Stage 2 ----------------
      const stage2 = await runStage2(game, gameId, deps, record);
      game = deps.getGame(gameId) || game;
      record.stagesApplied.push(stageRecord(2, game, gameId, stage2.actions, beforeBoard));
      deps.emitSystemChat(gameId, stage2.chat);
      record.gameAdvanced = computeGameStallFingerprint(game, gameId).board !== beforeBoard;
      record.status = record.gameAdvanced ? 'recovered' : 'not_advanced';
      record.result = record.gameAdvanced ? 'stage 2 advanced the game' : 'stage 2 could not move the game';
    }
    return { status: record.status, gameAdvanced: record.gameAdvanced, reportPath: written, record };
  } catch (err) {
    record.status = 'aborted';
    record.result = `recovery threw: ${String((err as any)?.message ?? err)}`;
    debugWarn(1, '[gameStall] Recovery failed:', err);
    return { status: record.status, gameAdvanced: false, reportPath: written, record };
  } finally {
    const live = deps.getGame(gameId) || game;
    record.after = live ? snapshot(live, gameId) : undefined;
    record.finishedAt = new Date().toISOString();
    written = writeReport() || written;
    markGameStallRecoveryFinished(gameId, live, written);
    debugWarn(1, `[gameStall] Recovery for ${gameId} finished: ${record.status} (${record.result})${written ? ` report=${written}` : ''}`, { gameId });
  }
}

/** Manual escape hatch (socket `forceAdvanceStall`, CLI `force-advance`). */
export async function requestManualGameStallRecovery(
  gameId: string,
  requestedBy: string,
  deps: GameStallRecoveryDeps,
): Promise<GameStallRecoveryOutcome> {
  const game = deps.getGame(gameId);
  const tracker = getGameStallTracker(gameId);
  const fingerprint = computeGameStallFingerprint(game, gameId);
  const run = tracker?.run;
  const detection: GameStallDetection = {
    gameId,
    rule: 'manual',
    reason: `Manual force-advance requested by ${requestedBy}`,
    detectedAt: Date.now(),
    stuckSeat: fingerprint.priority,
    counts: {
      observations: run?.observations ?? 0,
      priorityPasses: run?.priorityPasses ?? 0,
      stepAdvances: run?.stepAdvances ?? 0,
      aiActions: run?.aiActions ?? 0,
      aiFailures: run?.aiFailures ?? 0,
    },
    thresholds: {},
    noProgressMs: tracker ? Math.max(0, Date.now() - tracker.anchorSince) : 0,
    fingerprint,
    manual: { requestedBy },
  };
  return runGameStallRecovery(detection, deps, {
    admitted: false,
    manual: true,
    requestedBy,
    stage2DelayMs: Math.min(getGameStallConfig().stage2DelayMs, 1_500),
  });
}
