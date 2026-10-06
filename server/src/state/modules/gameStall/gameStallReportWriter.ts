/**
 * server/src/state/modules/gameStall/gameStallReportWriter.ts
 *
 * Builds and writes one JSON file per detected stall:
 *   <repo>/logs/stall-reports/<ISO timestamp>-<gameId>.json
 * (colons/dots in the timestamp are replaced with '-' so the name is valid on
 * Windows). The same path is rewritten when recovery finishes, so the file
 * always carries the final recovery outcome. `status: "new"` lets a forwarder
 * mark it "forwarded" later.
 *
 * Directory resolution: explicit dir arg > MTGEDH_STALL_REPORT_DIR >
 * (under vitest) os.tmpdir()/mtgedh-stall-reports > <repo>/logs/stall-reports.
 *
 * Public entry symbols: resolveGameStallReportDir, buildGameStallReportFileName,
 * buildGameStallReport, writeGameStallReport, GameStallReport,
 * GameStallRecoveryRecord, GameStallRecoveryStageRecord.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGameStallConfig } from './gameStallConfig.js';
import {
  collectGameStallPendingPrompts,
  collectLegacyPendingStateSummary,
  summarizeGameStallStack,
} from './gameStallFingerprint.js';
import type { GameStallAiError, GameStallDetection, GameStallTracker } from './gameStallDetector.js';
import { getRecentLogLines } from '../../../utils/recentLogBuffer.js';
import { debugWarn } from '../../../utils/debug.js';

export interface GameStallRecoveryStageRecord {
  stage: 1 | 2;
  at: string;
  actions: string[];
  boardChanged: boolean;
  phaseAfter: string;
  stepAfter: string;
  priorityAfter: string | null;
}

export interface GameStallPhaseSnapshot {
  turn: number | null;
  phase: string;
  step: string;
  priority: string | null;
  stackLength: number;
  boardFingerprint: string;
}

export interface GameStallRecoveryRecord {
  manual: boolean;
  requestedBy?: string;
  status: 'in_progress' | 'recovered' | 'not_advanced' | 'aborted' | 'skipped';
  result?: string;
  gameAdvanced: boolean;
  before: GameStallPhaseSnapshot;
  after?: GameStallPhaseSnapshot;
  stagesApplied: GameStallRecoveryStageRecord[];
  droppedStackItems: Array<Record<string, unknown>>;
  cancelledPrompts: Array<Record<string, unknown>>;
  finishedAt?: string;
}

export interface GameStallReport {
  schemaVersion: 1;
  status: 'new' | 'forwarded';
  gameId: string;
  timestamp: string;
  turn: number | null;
  phase: string;
  step: string;
  priorityPlayer: string | null;
  turnPlayer: string | null;
  seats: Array<Record<string, unknown>>;
  detection: {
    rule: string;
    reason: string;
    stuckSeat: string | null;
    counts: GameStallDetection['counts'];
    thresholds: Record<string, number>;
    noProgressMs: number;
    boardFingerprint: string;
    fullFingerprint: string;
    cycle?: GameStallDetection['cycle'];
    manual?: GameStallDetection['manual'];
  };
  actionWindow: GameStallTracker['window'];
  ai: {
    lastDecision: unknown;
    lastError: GameStallAiError | null;
  };
  pendingPrompts: {
    resolutionQueue: ReturnType<typeof collectGameStallPendingPrompts>;
    legacyPendingState: Record<string, number>;
    stepAdvanceBlocked: unknown;
  };
  stack: { length: number; items: Array<Record<string, unknown>> };
  recovery: GameStallRecoveryRecord;
  serverLog: string[];
}

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'server', 'src')) && fs.existsSync(path.join(dir, 'client'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === 'server' ? path.dirname(cwd) : cwd;
}

export function resolveGameStallReportDir(explicitDir?: string): string {
  if (explicitDir) return explicitDir;
  const envDir = String(process.env.MTGEDH_STALL_REPORT_DIR || '').trim();
  if (envDir) return envDir;
  if (process.env.VITEST) return path.join(os.tmpdir(), 'mtgedh-stall-reports');
  return path.join(findRepoRoot(), 'logs', 'stall-reports');
}

export function buildGameStallReportFileName(gameId: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
  const safeId = String(gameId || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  return `${stamp}-${safeId}.json`;
}

function seatsSummary(game: any, isAiSeat: (playerId: string) => boolean): Array<Record<string, unknown>> {
  const state = game?.state || {};
  const players: any[] = Array.isArray(state.players) ? state.players : [];
  return players.map((player) => {
    const id = String(player?.id || '');
    const ai = isAiSeat(id);
    return {
      id,
      name: player?.name ?? null,
      seat: player?.seat ?? null,
      kind: ai ? 'ai' : 'human',
      life: state.life?.[id] ?? player?.life ?? null,
      eliminated: Boolean(player?.hasLost || player?.eliminated || player?.conceded),
      spectator: Boolean(player?.spectator || player?.isSpectator),
    };
  });
}

function boundedClone(value: unknown, maxChars = 4000): unknown {
  try {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'function') return undefined;
      if (val instanceof Set) return [...val];
      if (val instanceof Map) return Object.fromEntries(val);
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[circular]';
        seen.add(val);
      }
      return val;
    });
    if (text === undefined) return null;
    if (text.length <= maxChars) return JSON.parse(text);
    return { truncated: true, preview: text.slice(0, maxChars) };
  } catch {
    return String(value).slice(0, maxChars);
  }
}

export function buildGameStallReport(params: {
  game: any;
  gameId: string;
  detection: GameStallDetection;
  tracker: GameStallTracker | undefined;
  recovery: GameStallRecoveryRecord;
  isAiSeat: (playerId: string) => boolean;
  lastAiDecision?: unknown;
}): GameStallReport {
  const { game, gameId, detection, tracker, recovery } = params;
  const state = game?.state || {};
  const fp = detection.fingerprint;
  const stack = summarizeGameStallStack(state);
  return {
    schemaVersion: 1,
    status: 'new',
    gameId,
    timestamp: new Date(detection.detectedAt).toISOString(),
    turn: fp.turn,
    phase: fp.phase,
    step: fp.step,
    priorityPlayer: fp.priority,
    turnPlayer: fp.turnPlayer,
    seats: seatsSummary(game, params.isAiSeat),
    detection: {
      rule: detection.rule,
      reason: detection.reason,
      stuckSeat: detection.stuckSeat,
      counts: detection.counts,
      thresholds: detection.thresholds,
      noProgressMs: detection.noProgressMs,
      boardFingerprint: fp.board,
      fullFingerprint: fp.full,
      cycle: detection.cycle,
      manual: detection.manual,
    },
    actionWindow: tracker ? tracker.window.slice(-getGameStallConfig().actionWindowSize) : [],
    ai: {
      lastDecision: boundedClone(params.lastAiDecision ?? null),
      lastError: tracker?.lastAiError ?? null,
    },
    pendingPrompts: {
      resolutionQueue: collectGameStallPendingPrompts(game, gameId),
      legacyPendingState: collectLegacyPendingStateSummary(state),
      stepAdvanceBlocked: boundedClone(state.stepAdvanceBlocked ?? null, 1000),
    },
    stack: { length: stack.length, items: stack },
    recovery,
    serverLog: getRecentLogLines(getGameStallConfig().reportLogLines, gameId),
  };
}

/** Write (or rewrite) the report. Returns the absolute path, or null on failure. */
export function writeGameStallReport(report: GameStallReport, options: { dir?: string; filePath?: string } = {}): string | null {
  try {
    const filePath = options.filePath
      || path.join(resolveGameStallReportDir(options.dir), buildGameStallReportFileName(report.gameId, Date.parse(report.timestamp) || Date.now()));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, filePath);
    return filePath;
  } catch (err) {
    debugWarn(1, '[gameStall] Failed to write stall report:', err);
    return null;
  }
}
