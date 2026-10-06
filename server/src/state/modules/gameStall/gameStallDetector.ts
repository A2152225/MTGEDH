/**
 * server/src/state/modules/gameStall/gameStallDetector.ts
 *
 * Per-game non-progress (stall) detector. Hook sites feed it observations:
 *  - priority passes and step advances (state/index.ts game wrapper),
 *  - AI actions / AI failures (socket/ai-handlers/aiScheduler.ts, aiPriorityHandlers.ts),
 *  - an idle watchdog sweep (socket/gameStallSocketWiring.ts).
 *
 * After each observation it compares the board fingerprint with the anchor
 * taken at the last real progress. Observations that leave the board unchanged
 * extend the current "no-progress run"; any fingerprint change resets it.
 * Rules (thresholds in gameStallConfig.ts):
 *  - priorityPingPong      N successful priority passes, board unchanged
 *  - repeatedAiFailure     same failed AI action signature K_fail times
 *  - repeatedAiAction      same AI action signature K times
 *  - repeatingActionCycle  a repeating sequence (period 2..P) that includes a
 *                          non-pass action, repeated R times
 *  - stepAdvanceNoop       nextStep() keeps returning without moving
 *  - aiIdleNoProgress      AI seat owns priority / a prompt, nothing happens
 * A rule only fires after the churn has lasted minStallDurationMs.
 *
 * Never runs during undo/restart replay (isReplaying / GameManager restoring),
 * during loop-shortcut batches, in pre-game, or after game over. Priority-pass
 * and step-advance churn is ignored while a human seat owns an open prompt
 * (only repeated AI *failures* can fire then, and recovery never cancels a
 * human prompt automatically).
 *
 * Runtime state lives in a module Map keyed by gameId (never in game.state, so
 * it is not serialized, fingerprinted, or restored by undo).
 *
 * Public entry symbols: observeGameStall, observeGameStallPriorityPass,
 * observeGameStallStepAdvance, observeGameStallAiActionById,
 * noteGameStallAiFailure, checkGameStallIdle, registerGameStallRuntime,
 * getGameStallRuntime, getGameStallTracker, resetGameStallTracker,
 * resetAllGameStallTrackersForTests, admitGameStallRecovery,
 * markGameStallRecoveryFinished, hasPendingHumanPrompt, isGameStallSuppressed.
 */

import { getGameStallConfig } from './gameStallConfig.js';
import {
  collectGameStallPendingPrompts,
  computeGameStallFingerprint,
  type GameStallFingerprint,
  type GameStallPendingPrompt,
} from './gameStallFingerprint.js';
import { isGameReplayLocked, isUndoProbeGameId } from '../../../gameRestoreState.js';
import { debugWarn, isLoopShortcutQuietLogs } from '../../../utils/debug.js';

export type GameStallObservationKind = 'priorityPass' | 'stepAdvance' | 'aiAction' | 'aiFailure' | 'manual';

export type GameStallRule =
  | 'priorityPingPong'
  | 'repeatedAiAction'
  | 'repeatedAiFailure'
  | 'repeatingActionCycle'
  | 'stepAdvanceNoop'
  | 'aiIdleNoProgress'
  | 'manual';

export interface GameStallObservation {
  kind: GameStallObservationKind;
  playerId?: string | null;
  args?: Record<string, unknown>;
  errorMessage?: string;
}

export interface GameStallActionEntry {
  at: string;
  kind: GameStallObservationKind;
  playerId: string | null;
  sig: string;
  args: Record<string, unknown>;
  phase: string;
  step: string;
  priority: string | null;
  boardFingerprint: string;
  progressed: boolean;
  counted: boolean;
  humanWaiting: boolean;
}

export interface GameStallAiError {
  playerId: string;
  at: string;
  context: string;
  message: string;
  stack?: string;
}

export interface GameStallDetection {
  gameId: string;
  rule: GameStallRule;
  reason: string;
  detectedAt: number;
  stuckSeat: string | null;
  counts: {
    observations: number;
    priorityPasses: number;
    stepAdvances: number;
    aiActions: number;
    aiFailures: number;
    topSignature?: string;
    topSignatureCount?: number;
  };
  thresholds: Record<string, number>;
  noProgressMs: number;
  fingerprint: GameStallFingerprint;
  cycle?: { period: number; repeats: number; sequence: string[] };
  manual?: { requestedBy: string };
}

export interface GameStallRuntime {
  resolveGame?: (gameId: string) => any;
  isAiSeat?: (gameId: string, playerId: string) => boolean;
  describeAiAction?: (gameId: string, playerId: string) => string | undefined;
  onStall?: (detection: GameStallDetection, game: any) => void;
}

interface GameStallRun {
  firstCountedAt: number;
  observations: number;
  priorityPasses: number;
  stepAdvances: number;
  aiActions: number;
  aiFailures: number;
  sigCounts: Map<string, number>;
  failSigCounts: Map<string, number>;
  sigs: string[];
}

export interface GameStallTracker {
  gameId: string;
  anchorBoard: string;
  anchorSince: number;
  lastObservationAt: number;
  run: GameStallRun;
  window: GameStallActionEntry[];
  pendingAiErrors: Map<string, GameStallAiError>;
  lastAiError: GameStallAiError | null;
  recovery: {
    inFlight: boolean;
    lastStartedAt: number;
    history: number[];
    suppressedDetections: number;
    lastSuppressedLogAt: number;
    lastDetection: GameStallDetection | null;
    lastReportPath: string | null;
  };
}

const trackers = new Map<string, GameStallTracker>();
let runtime: GameStallRuntime = {};

export function registerGameStallRuntime(next: GameStallRuntime): void {
  runtime = { ...runtime, ...next };
}

export function getGameStallRuntime(): GameStallRuntime {
  return runtime;
}

export function resetGameStallRuntimeForTests(): void {
  runtime = {};
}

function emptyRun(): GameStallRun {
  return {
    firstCountedAt: 0,
    observations: 0,
    priorityPasses: 0,
    stepAdvances: 0,
    aiActions: 0,
    aiFailures: 0,
    sigCounts: new Map(),
    failSigCounts: new Map(),
    sigs: [],
  };
}

export function getGameStallTracker(gameId: string): GameStallTracker | undefined {
  return trackers.get(String(gameId || ''));
}

function ensureTracker(gameId: string, boardFp: string, now: number): GameStallTracker {
  let tracker = trackers.get(gameId);
  if (tracker) {
    // Refresh LRU position.
    trackers.delete(gameId);
    trackers.set(gameId, tracker);
    return tracker;
  }
  tracker = {
    gameId,
    anchorBoard: boardFp,
    anchorSince: now,
    lastObservationAt: now,
    run: emptyRun(),
    window: [],
    pendingAiErrors: new Map(),
    lastAiError: null,
    recovery: {
      inFlight: false,
      lastStartedAt: 0,
      history: [],
      suppressedDetections: 0,
      lastSuppressedLogAt: 0,
      lastDetection: null,
      lastReportPath: null,
    },
  };
  trackers.set(gameId, tracker);
  const cap = Math.max(1, getGameStallConfig().maxTrackedGames);
  while (trackers.size > cap) {
    const oldest = trackers.keys().next().value;
    if (oldest === undefined) break;
    trackers.delete(oldest);
  }
  return tracker;
}

/** Forget the no-progress run (anchor = current board). Keeps window + recovery bookkeeping. */
export function resetGameStallTracker(gameId: string, game?: any): void {
  const tracker = trackers.get(String(gameId || ''));
  if (!tracker) return;
  const now = Date.now();
  if (game) {
    tracker.anchorBoard = computeGameStallFingerprint(game, gameId).board;
  }
  tracker.anchorSince = now;
  tracker.run = emptyRun();
}

export function resetAllGameStallTrackersForTests(): void {
  trackers.clear();
}

function isAiSeat(game: any, gameId: string, playerId: string): boolean {
  if (!playerId) return false;
  try {
    if (runtime.isAiSeat && runtime.isAiSeat(gameId, playerId)) return true;
  } catch {
    // ignore
  }
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  const player = players.find((p) => String(p?.id || '') === playerId);
  return Boolean(player && (player.isAI === true || player.ai === true));
}

function seatIsLiveHuman(game: any, gameId: string, playerId: string): boolean {
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  const player = players.find((p) => String(p?.id || '') === playerId);
  if (!player) return false;
  if (player.spectator || player.isSpectator) return false;
  if (player.hasLost || player.eliminated || player.conceded) return false;
  return !isAiSeat(game, gameId, playerId);
}

/**
 * Declare-blockers waits on a human defender without a Resolution Queue step
 * (the attacking AI keeps priority and simply waits). Mirrors the read-only
 * part of checkPendingInteractions' blocker_declaration rule.
 */
function hasPendingHumanBlockerDeclaration(game: any, gameId: string): boolean {
  const state = game?.state || {};
  const step = String(state.step || '').toUpperCase();
  if (!step.includes('BLOCKERS')) return false;
  const declared = Array.isArray(state.blockersDeclaredBy) ? state.blockersDeclaredBy.map(String) : [];
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || !perm.attacking) continue;
    const defender = String(perm.attacking || '').trim();
    if (defender && !declared.includes(defender) && seatIsLiveHuman(game, gameId, defender)) return true;
  }
  return false;
}

/**
 * True when the game is legitimately waiting on a human decision: a live human
 * seat owns an unresolved Resolution Queue prompt, or a human defender still
 * has to declare blockers.
 */
export function hasPendingHumanPrompt(game: any, gameId: string, prompts?: GameStallPendingPrompt[]): boolean {
  const list = prompts ?? collectGameStallPendingPrompts(game, gameId);
  if (list.some((prompt) => prompt.playerId && seatIsLiveHuman(game, gameId, prompt.playerId))) return true;
  return hasPendingHumanBlockerDeclaration(game, gameId);
}

function aiSeatExpectedToAct(game: any, playerId: string, prompts: GameStallPendingPrompt[]): boolean {
  const state = game?.state || {};
  if (String(state.priority ?? '') === playerId) return true;
  if (prompts.some((prompt) => prompt.playerId === playerId)) return true;
  const step = String(state.step || '').toUpperCase();
  return step === 'CLEANUP' && String(state.turnPlayer ?? '') === playerId;
}

/** Guards shared by every hook: replay/restore, loop batches, pre-game, game over. */
export function isGameStallSuppressed(game: any, gameId: string): boolean {
  const cfg = getGameStallConfig();
  if (!cfg.enabled) return true;
  const id = String(gameId || '').trim();
  if (!id || isUndoProbeGameId(id)) return true;
  if (!game || !game.state) return true;
  try {
    if (isGameReplayLocked(game, id)) return true;
    const ctx = game.ctx || game;
    if (ctx?.isReplaying) return true;
  } catch {
    return true;
  }
  if (isLoopShortcutQuietLogs()) return true;
  const state = game.state;
  const phase = String(state.phase || '').toLowerCase();
  if (!phase || phase === 'pre_game' || phase === 'pre-game' || phase === 'pregame') return true;
  if (state.gameOver || state.winner) return true;
  if (!Array.isArray(state.players) || state.players.length === 0) return true;
  return false;
}

function pushWindow(tracker: GameStallTracker, entry: GameStallActionEntry): void {
  const size = Math.max(1, getGameStallConfig().actionWindowSize);
  tracker.window.push(entry);
  if (tracker.window.length > size) tracker.window.splice(0, tracker.window.length - size);
}

function bump(map: Map<string, number>, key: string): number {
  const next = (map.get(key) || 0) + 1;
  map.set(key, next);
  return next;
}

function topEntry(map: Map<string, number>, filter?: (key: string) => boolean): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [key, count] of map) {
    if (filter && !filter(key)) continue;
    if (!best || count > best[1]) best = [key, count];
  }
  return best;
}

function playerFromSig(sig: string): string | null {
  // ai:<kind>:<playerId>:...  |  pass:<playerId>:...
  const parts = sig.split(':');
  if (parts[0] === 'ai' && parts[2]) return parts[2];
  if (parts[0] === 'pass' && parts[1]) return parts[1];
  return null;
}

function findCycle(sigs: string[]): { period: number; repeats: number; sequence: string[] } | null {
  const cfg = getGameStallConfig();
  const maxPeriod = Math.max(2, cfg.cycleMaxPeriod);
  for (let period = 2; period <= maxPeriod; period++) {
    const repeatsNeeded = Math.max(cfg.cycleMinRepeats, Math.ceil(cfg.cycleMinObservations / period));
    const span = period * repeatsNeeded;
    if (sigs.length < span) continue;
    const tail = sigs.slice(sigs.length - span);
    const unit = tail.slice(0, period);
    // Pure priority ping-pong is governed by priorityPingPong (N), not by the cycle rule.
    if (!unit.some((sig) => !sig.startsWith('pass:'))) continue;
    // A period-p cycle made of one repeated sig is the repeated-action rule's job.
    if (new Set(unit).size < 2) continue;
    let matches = true;
    for (let i = period; i < tail.length; i++) {
      if (tail[i] !== tail[i - period]) {
        matches = false;
        break;
      }
    }
    if (matches) return { period, repeats: repeatsNeeded, sequence: unit };
  }
  return null;
}

function thresholdsSnapshot(): Record<string, number> {
  const cfg = getGameStallConfig();
  return {
    noProgressPriorityPassThreshold: cfg.noProgressPriorityPassThreshold,
    repeatedAiActionThreshold: cfg.repeatedAiActionThreshold,
    repeatedAiFailureThreshold: cfg.repeatedAiFailureThreshold,
    stepAdvanceNoopThreshold: cfg.stepAdvanceNoopThreshold,
    cycleMaxPeriod: cfg.cycleMaxPeriod,
    cycleMinRepeats: cfg.cycleMinRepeats,
    cycleMinObservations: cfg.cycleMinObservations,
    minStallDurationMs: cfg.minStallDurationMs,
    aiIdleTimeoutMs: cfg.aiIdleTimeoutMs,
  };
}

function buildDetection(
  tracker: GameStallTracker,
  gameId: string,
  rule: GameStallRule,
  reason: string,
  stuckSeat: string | null,
  fingerprint: GameStallFingerprint,
  now: number,
  extra: Partial<GameStallDetection> = {},
): GameStallDetection {
  const run = tracker.run;
  const top = topEntry(run.failSigCounts) || topEntry(run.sigCounts, (key) => key.startsWith('ai:'));
  return {
    gameId,
    rule,
    reason,
    detectedAt: now,
    stuckSeat,
    counts: {
      observations: run.observations,
      priorityPasses: run.priorityPasses,
      stepAdvances: run.stepAdvances,
      aiActions: run.aiActions,
      aiFailures: run.aiFailures,
      topSignature: top?.[0],
      topSignatureCount: top?.[1],
    },
    thresholds: thresholdsSnapshot(),
    noProgressMs: Math.max(0, now - tracker.anchorSince),
    fingerprint,
    ...extra,
  };
}

function evaluateRules(
  tracker: GameStallTracker,
  game: any,
  gameId: string,
  fingerprint: GameStallFingerprint,
  now: number,
): GameStallDetection | null {
  const cfg = getGameStallConfig();
  const run = tracker.run;
  if (!run.firstCountedAt || now - run.firstCountedAt < cfg.minStallDurationMs) return null;

  const fail = topEntry(run.failSigCounts);
  if (fail && fail[1] >= cfg.repeatedAiFailureThreshold) {
    return buildDetection(tracker, gameId, 'repeatedAiFailure',
      `Same failed AI action repeated ${fail[1]}x with no state change (${fail[0]})`,
      playerFromSig(fail[0]), fingerprint, now);
  }
  const ai = topEntry(run.sigCounts, (key) => key.startsWith('ai:'));
  if (ai && ai[1] >= cfg.repeatedAiActionThreshold) {
    return buildDetection(tracker, gameId, 'repeatedAiAction',
      `Same AI action repeated ${ai[1]}x with no state change (${ai[0]})`,
      playerFromSig(ai[0]), fingerprint, now);
  }
  const cycle = findCycle(run.sigs);
  if (cycle) {
    const aiSig = cycle.sequence.find((sig) => sig.startsWith('ai:'));
    return buildDetection(tracker, gameId, 'repeatingActionCycle',
      `Action cycle of period ${cycle.period} repeated ${cycle.repeats}x with no state change`,
      (aiSig && playerFromSig(aiSig)) || fingerprint.priority, fingerprint, now, { cycle });
  }
  if (run.priorityPasses >= cfg.noProgressPriorityPassThreshold) {
    return buildDetection(tracker, gameId, 'priorityPingPong',
      `${run.priorityPasses} priority passes with no state change`,
      fingerprint.priority, fingerprint, now);
  }
  if (run.stepAdvances >= cfg.stepAdvanceNoopThreshold) {
    return buildDetection(tracker, gameId, 'stepAdvanceNoop',
      `${run.stepAdvances} step-advance attempts did not move the game`,
      fingerprint.priority || fingerprint.turnPlayer, fingerprint, now);
  }
  return null;
}

/**
 * Idempotency + rate limit gate. Returns ok=true and marks the recovery as
 * in-flight; callers must call markGameStallRecoveryFinished() when done.
 */
export function admitGameStallRecovery(
  gameId: string,
  game: any,
  options: { manual?: boolean; now?: number } = {},
): { ok: boolean; reason?: string } {
  const cfg = getGameStallConfig();
  const now = options.now ?? Date.now();
  const fp = computeGameStallFingerprint(game, gameId);
  const tracker = ensureTracker(gameId, fp.board, now);
  const rec = tracker.recovery;
  if (rec.inFlight) return { ok: false, reason: 'recovery_in_flight' };
  if (!options.manual) {
    if (rec.lastStartedAt && now - rec.lastStartedAt < cfg.recoveryCooldownMs) {
      return { ok: false, reason: 'cooldown' };
    }
    rec.history = rec.history.filter((at) => now - at < cfg.recoveryRateWindowMs);
    if (rec.history.length >= cfg.maxRecoveriesPerWindow) {
      return { ok: false, reason: 'rate_limited' };
    }
  }
  rec.inFlight = true;
  rec.lastStartedAt = now;
  rec.history.push(now);
  return { ok: true };
}

export function markGameStallRecoveryFinished(gameId: string, game?: any, reportPath?: string | null): void {
  const tracker = trackers.get(String(gameId || ''));
  if (!tracker) return;
  tracker.recovery.inFlight = false;
  if (reportPath !== undefined) tracker.recovery.lastReportPath = reportPath;
  resetGameStallTracker(gameId, game);
}

function dispatchDetection(tracker: GameStallTracker, game: any, detection: GameStallDetection): GameStallDetection | null {
  tracker.recovery.lastDetection = detection;
  const handler = runtime.onStall;
  if (!handler) {
    // No recovery wiring (unit tests, scripts): record + restart the run so we do not re-fire every call.
    debugWarn(1, `[gameStall] Stall detected in ${detection.gameId} (${detection.rule}) with no recovery handler registered`);
    tracker.run = emptyRun();
    return detection;
  }
  const admitted = admitGameStallRecovery(detection.gameId, game, { now: detection.detectedAt });
  if (!admitted.ok) {
    tracker.recovery.suppressedDetections += 1;
    const now = Date.now();
    if (now - tracker.recovery.lastSuppressedLogAt > 30_000) {
      tracker.recovery.lastSuppressedLogAt = now;
      debugWarn(1, `[gameStall] Stall in ${detection.gameId} (${detection.rule}) not recovered: ${admitted.reason}`);
    }
    return null;
  }
  setTimeout(() => {
    try {
      handler(detection, game);
    } catch (err) {
      debugWarn(1, '[gameStall] onStall handler threw:', err);
      markGameStallRecoveryFinished(detection.gameId, game);
    }
  }, 0);
  return detection;
}

function aiActionDetail(game: any, gameId: string, playerId: string, prompts: GameStallPendingPrompt[]): string {
  const own = prompts.find((prompt) => prompt.playerId === playerId);
  let detail = own ? `step=${own.type}#${own.id}` : (String(game?.state?.priority ?? '') === playerId ? 'prio' : 'other');
  try {
    const extra = runtime.describeAiAction?.(gameId, playerId);
    if (extra) detail += `|${extra}`;
  } catch {
    // ignore
  }
  return detail;
}

/**
 * Core observation entry. Returns the detection when a stall rule fires
 * (whether or not recovery was admitted), otherwise null.
 */
export function observeGameStall(game: any, gameId: string, observation: GameStallObservation): GameStallDetection | null {
  try {
    const id = String(gameId || '').trim();
    if (isGameStallSuppressed(game, id)) return null;
    const cfg = getGameStallConfig();
    const now = Date.now();
    const fingerprint = computeGameStallFingerprint(game, id);
    if (fingerprint.board === 'fingerprint_error') return null;
    const tracker = ensureTracker(id, fingerprint.board, now);
    tracker.lastObservationAt = now;

    const playerId = observation.playerId ? String(observation.playerId) : null;
    const args = observation.args || {};
    const prompts = collectGameStallPendingPrompts(game, id);
    const humanWaiting = hasPendingHumanPrompt(game, id, prompts);
    let kind = observation.kind;

    // AI failure bookkeeping (noteGameStallAiFailure stores the error for the next AI observation).
    let errorMessage = observation.errorMessage;
    if ((kind === 'aiAction' || kind === 'aiFailure') && playerId) {
      const pending = tracker.pendingAiErrors.get(playerId);
      if (pending) {
        tracker.pendingAiErrors.delete(playerId);
        errorMessage = errorMessage || pending.message;
        kind = 'aiFailure';
      }
      if (errorMessage) kind = 'aiFailure';
    }

    let sig: string;
    if (kind === 'priorityPass') {
      sig = `pass:${playerId ?? '?'}:${args.changed ? 'ok' : 'noop'}${args.resolvedNow ? ':R' : ''}${args.advanceStep ? ':A' : ''}`;
    } else if (kind === 'stepAdvance') {
      sig = `step:${String(args.fromPhase ?? '')}/${String(args.fromStep ?? '')}`;
    } else if (kind === 'aiAction' || kind === 'aiFailure') {
      sig = `ai:${String(args.aiKind ?? 'action')}:${playerId ?? '?'}:${kind === 'aiFailure' ? 'fail' : 'ok'}:${aiActionDetail(game, id, playerId || '', prompts)}`;
    } else {
      sig = `${kind}:${playerId ?? '?'}`;
    }

    const progressed = fingerprint.board !== tracker.anchorBoard;
    const entry: GameStallActionEntry = {
      at: new Date(now).toISOString(),
      kind,
      playerId,
      sig,
      args: errorMessage ? { ...args, error: errorMessage.slice(0, 300) } : { ...args },
      phase: fingerprint.phase,
      step: fingerprint.step,
      priority: fingerprint.priority,
      boardFingerprint: fingerprint.board,
      progressed,
      counted: false,
      humanWaiting,
    };

    if (progressed) {
      tracker.anchorBoard = fingerprint.board;
      tracker.anchorSince = now;
      tracker.run = emptyRun();
      pushWindow(tracker, entry);
      return null;
    }

    const run = tracker.run;
    let counted = false;
    if (kind === 'priorityPass') {
      if (args.changed === true && !humanWaiting) {
        run.priorityPasses += 1;
        counted = true;
      }
    } else if (kind === 'stepAdvance') {
      if (!humanWaiting) {
        run.stepAdvances += 1;
        counted = true;
      }
    } else if (kind === 'aiAction' || kind === 'aiFailure') {
      const expected = !!playerId && aiSeatExpectedToAct(game, playerId, prompts);
      if (expected && kind === 'aiFailure') {
        run.aiFailures += 1;
        bump(run.failSigCounts, sig);
        counted = true;
      }
      if (expected && !humanWaiting) {
        if (kind === 'aiAction') run.aiActions += 1;
        bump(run.sigCounts, sig);
        counted = true;
      }
    }

    entry.counted = counted;
    pushWindow(tracker, entry);
    if (!counted) return null;

    run.observations += 1;
    if (!run.firstCountedAt) run.firstCountedAt = now;
    run.sigs.push(sig);
    if (run.sigs.length > cfg.runSignatureCap) run.sigs.splice(0, run.sigs.length - cfg.runSignatureCap);

    const detection = evaluateRules(tracker, game, id, fingerprint, now);
    if (!detection) return null;
    return dispatchDetection(tracker, game, detection) ? detection : null;
  } catch (err) {
    debugWarn(2, '[gameStall] observe failed:', err);
    return null;
  }
}

/** Hook: called by the game wrapper after every passPriority(). Returns `result` unchanged. */
export function observeGameStallPriorityPass<T>(
  game: any,
  gameId: string,
  playerId: unknown,
  isAutoPass: unknown,
  result: T,
): T {
  const r: any = result || {};
  observeGameStall(game, gameId, {
    kind: 'priorityPass',
    playerId: playerId ? String(playerId) : null,
    args: {
      isAutoPass: isAutoPass === true,
      changed: r.changed === true,
      resolvedNow: r.resolvedNow === true,
      advanceStep: r.advanceStep === true,
    },
  });
  return result;
}

/** Hook: wraps nextStep() so the from/to step lands in the action window. */
export function observeGameStallStepAdvance<T>(game: any, gameId: string, advance: () => T): T {
  const state = game?.state || {};
  const fromPhase = String(state.phase ?? '');
  const fromStep = String(state.step ?? '');
  const result = advance();
  const after = game?.state || {};
  observeGameStall(game, gameId, {
    kind: 'stepAdvance',
    playerId: after.turnPlayer ? String(after.turnPlayer) : null,
    args: { fromPhase, fromStep, toPhase: String(after.phase ?? ''), toStep: String(after.step ?? '') },
  });
  return result;
}

/**
 * Hook: AI scheduler calls this after each AI action (or blocked attempt).
 * Resolves the game through the registered runtime (no-op without one).
 */
export function observeGameStallAiActionById(
  gameId: string,
  playerId: string,
  aiKind: string,
  error?: unknown,
  extraArgs?: Record<string, unknown>,
): void {
  try {
    const game = runtime.resolveGame?.(gameId);
    if (!game) return;
    const message = error ? String((error as any)?.message ?? error) : undefined;
    observeGameStall(game, gameId, {
      kind: message ? 'aiFailure' : 'aiAction',
      playerId,
      args: { aiKind, ...(extraArgs || {}) },
      errorMessage: message,
    });
  } catch {
    // never break the AI loop
  }
}

/** Hook: AI handlers' catch blocks record the error; the next AI observation becomes a failure. */
export function noteGameStallAiFailure(gameId: string, playerId: unknown, error: unknown, context: string): void {
  try {
    const id = String(gameId || '').trim();
    const pid = String(playerId || '').trim();
    if (!id || !pid || !getGameStallConfig().enabled) return;
    const record: GameStallAiError = {
      playerId: pid,
      at: new Date().toISOString(),
      context,
      message: String((error as any)?.message ?? error ?? 'unknown error').slice(0, 500),
      stack: typeof (error as any)?.stack === 'string' ? String((error as any).stack).split('\n').slice(0, 8).join('\n') : undefined,
    };
    let tracker = trackers.get(id);
    if (!tracker) {
      const game = runtime.resolveGame?.(id);
      const board = game ? computeGameStallFingerprint(game, id).board : '';
      tracker = ensureTracker(id, board, Date.now());
    }
    tracker.pendingAiErrors.set(pid, record);
    tracker.lastAiError = record;
  } catch {
    // ignore
  }
}

/**
 * Idle watchdog: an AI seat owns priority (or a prompt) and the board has not
 * moved for aiIdleTimeoutMs without any churn. Called by the socket layer's
 * periodic sweep. Never fires while a human prompt is open.
 */
export function checkGameStallIdle(game: any, gameId: string, now = Date.now()): GameStallDetection | null {
  try {
    const id = String(gameId || '').trim();
    if (isGameStallSuppressed(game, id)) return null;
    const cfg = getGameStallConfig();
    const fingerprint = computeGameStallFingerprint(game, id);
    if (fingerprint.board === 'fingerprint_error') return null;
    const tracker = ensureTracker(id, fingerprint.board, now);
    if (fingerprint.board !== tracker.anchorBoard) {
      tracker.anchorBoard = fingerprint.board;
      tracker.anchorSince = now;
      tracker.run = emptyRun();
      return null;
    }
    const prompts = collectGameStallPendingPrompts(game, id);
    if (hasPendingHumanPrompt(game, id, prompts)) return null;
    const state = game.state || {};
    const priority = state.priority ? String(state.priority) : '';
    let seat: string | null = null;
    if (priority && isAiSeat(game, id, priority)) seat = priority;
    if (!seat) {
      const aiPrompt = prompts.find((prompt) => prompt.playerId && isAiSeat(game, id, prompt.playerId));
      if (aiPrompt) seat = aiPrompt.playerId;
    }
    if (!seat) return null;
    if (now - tracker.anchorSince < cfg.aiIdleTimeoutMs) return null;
    const detection = buildDetection(tracker, id, 'aiIdleNoProgress',
      `AI seat ${seat} has held priority/prompt for ${Math.round((now - tracker.anchorSince) / 1000)}s with no state change`,
      seat, fingerprint, now);
    return dispatchDetection(tracker, game, detection) ? detection : null;
  } catch (err) {
    debugWarn(2, '[gameStall] idle check failed:', err);
    return null;
  }
}
