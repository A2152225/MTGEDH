/**
 * Outcome sweep socket harness: a 2-seat table driven through the real socket handlers
 * (game actions, interaction, resolution), prompt answering via the AI resolution responder,
 * priority passing until the stack is empty, and error capture (debugError ring + console.error +
 * unhandled rejections).
 */
import { createGameIfNotExists, deleteGame, initDb } from '../../src/db/index.js';
import { registerGameActions } from '../../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../../src/socket/resolution.js';
import { games } from '../../src/socket/socket.js';
import { ensureGame } from '../../src/socket/util.js';
import '../../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import { getHookFailureCounts, getHookFailures } from '../../../shared/src/hookFailureReporter.js';
import { getRecentLogLines } from '../../src/utils/recentLogBuffer.js';
import { seedSweepBoard, SWEEP_P1, SWEEP_P2, type SweepCard } from './sweepBoard.js';
import { answerSweepStep } from './sweepResponder.js';
import { takeSweepSnapshot, type SweepSnapshot } from './sweepSnapshot.js';

export type SweepEmitted = { room?: string; event: string; payload: any };
export type SweepHandlers = Record<string, (...args: any[]) => any>;
export type SweepTable = {
  gameId: string;
  game: any;
  io: any;
  emitted: SweepEmitted[];
  handlers: Record<string, SweepHandlers>;
  /** Socket errors caused by a rejected AI-builder answer (retried with a human-style answer, not card failures). */
  responderRejects: Set<SweepEmitted>;
  /** stepId -> rejection code of the AI-builder answer, so the retry uses the human-style fallback. */
  rejectedSteps: Map<string, string>;
};

const consoleSink: string[] = [];
let captureInstalled = false;

function describeArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string' || typeof arg === 'number') return String(arg);
  return '';
}

/** Routes console.error into the sweep error sink (and silences engine chatter unless verbose). */
export function installSweepConsoleCapture(verbose = false): void {
  if (captureInstalled) return;
  captureInstalled = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    consoleSink.push(args.map(describeArg).filter(Boolean).join(' ').slice(0, 400) || 'console.error');
    if (verbose) originalError(...args);
  };
  if (!verbose) {
    console.warn = () => {};
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
  }
  process.on('unhandledRejection', (reason) => {
    consoleSink.push(`unhandledRejection: ${describeArg(reason) || String(reason)}`.slice(0, 400));
  });
  process.on('uncaughtException', (error) => {
    consoleSink.push(`uncaughtException: ${describeArg(error)}`.slice(0, 400));
  });
}

export type SweepErrorMark = { sink: number; at: number; hooks: number };

function hookFailureTotal(): number {
  return Object.values(getHookFailureCounts()).reduce((sum, count) => sum + count, 0);
}

export function markSweepErrors(): SweepErrorMark {
  return { sink: consoleSink.length, at: Date.now(), hooks: hookFailureTotal() };
}

/**
 * Hook failures (silent-throw tripwire, shared/src/hookFailureReporter.ts) recorded since the mark,
 * formatted like the reporter's own console line so both sources dedupe to one entry per tag.
 */
export function sweepHookFailuresSince(mark: SweepErrorMark): string[] {
  const fresh = hookFailureTotal() - mark.hooks;
  if (fresh <= 0) return [];
  return getHookFailures().slice(-fresh)
    .map((failure) => `[hook-failure] tag=${failure.tag}${failure.ctx?.cardName ? ` card=${failure.ctx.cardName}` : ''} ${failure.name}: ${failure.message}`.slice(0, 400));
}

/** Error lines since the mark: hook failures first, then console.error calls and debugError ring entries. */
export function sweepErrorsSince(mark: SweepErrorMark): string[] {
  const sinkLines = consoleSink.slice(mark.sink);
  const hookLines = [...sweepHookFailuresSince(mark), ...sinkLines.filter((line) => line.startsWith('[hook-failure]'))];
  const out = [
    ...hookLines.filter((line, index) => hookLines.findIndex((other) => hookFailureTag(other) === hookFailureTag(line)) === index),
    ...sinkLines.filter((line) => !line.startsWith('[hook-failure]')),
  ];
  for (const line of getRecentLogLines(1000)) {
    const space = line.indexOf(' ');
    if (space < 0 || !line.slice(space + 1).startsWith('[error] ') || line.includes('[hook-failure]')) continue;
    const at = Date.parse(line.slice(0, space));
    if (Number.isFinite(at) && at >= mark.at) out.push(line.slice(space + 9));
  }
  return [...new Set(out)];
}

/** Tag of a `[hook-failure] tag=...` line ('' for other lines). */
export function hookFailureTag(line: string): string {
  return /^\[hook-failure\] tag=(\S+)/.exec(String(line || ''))?.[1] || '';
}

function noopIo() {
  return { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any;
}

function mockIo(emitted: SweepEmitted[], sockets: any[]) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id, socket])) },
  } as any;
}

function mockSocket(playerId: string, gameId: string, emitted: SweepEmitted[]) {
  const handlers: SweepHandlers = {};
  const socket = {
    id: `${playerId}_sweep_socket`,
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: (...args: any[]) => any) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => emitted.push({ event, payload: { ...(payload || {}), __to: playerId } }),
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    join: () => {},
    leave: () => {},
  } as any;
  return { socket, handlers };
}

let harnessReady = false;

export async function initOutcomeSweepHarness(): Promise<void> {
  if (harnessReady) return;
  await initDb();
  initializePriorityResolutionHandler(noopIo());
  await sweepTick();
  harnessReady = true;
}

export async function sweepTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function closeSweepTable(gameId: string): void {
  try { ResolutionQueueManager.removeQueue(gameId); } catch { /* cleanup */ }
  games.delete(gameId as any);
  try { deleteGame(gameId); } catch { /* cleanup */ }
}

export function openSweepTable(gameId: string, card: SweepCard, options: { placeOnBattlefield?: boolean } = {}): SweepTable {
  closeSweepTable(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, SWEEP_P1);
  const game = ensureGame(gameId);
  if (!game) throw new Error(`ensureGame returned nothing for ${gameId}`);
  games.set(gameId as any, game as any);
  seedSweepBoard(game, card, options);
  const emitted: SweepEmitted[] = [];
  const seats = [SWEEP_P1, SWEEP_P2].map((pid) => ({ pid, ...mockSocket(pid, gameId, emitted) }));
  const io = mockIo(emitted, seats.map((seat) => seat.socket));
  const handlers: Record<string, SweepHandlers> = {};
  for (const seat of seats) {
    registerResolutionHandlers(io, seat.socket);
    registerGameActions(io, seat.socket);
    registerInteractionHandlers(io, seat.socket);
    handlers[seat.pid] = seat.handlers;
  }
  return { gameId, game, io, emitted, handlers, responderRejects: new Set(), rejectedSteps: new Map() };
}

const DONE_STATUSES = new Set(['completed', 'cancelled', 'timed_out']);

export function pendingSweepSteps(gameId: string): any[] {
  const steps = (ResolutionQueueManager.getQueue(gameId)?.steps || []) as any[];
  return steps.filter((step) => !DONE_STATUSES.has(String(step?.status || '').toLowerCase()));
}

function stackSignature(game: any): string {
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  return stack.map((item: any) => String(item?.id ?? '?')).join('|');
}

export type SweepSettle = {
  castPrompts: string[];
  resolvePrompts: string[];
  /** Snapshot taken the first time something sat on the stack with no prompt pending. */
  preResolve?: SweepSnapshot;
  stuck?: string;
  notes: string[];
  passErrors: Set<any>;
  passes: number;
};

/**
 * Answers prompts (first legal / AI choice) and passes priority until the stack and queue are empty.
 * Prompts answered before the first pass are cast-time (targets, costs, payment); later ones are
 * resolution-time.
 */
export async function settleSweepTable(table: SweepTable, maxIterations = 120): Promise<SweepSettle> {
  const result: SweepSettle = { castPrompts: [], resolvePrompts: [], notes: [], passErrors: new Set(), passes: 0 };
  const answered = new Map<string, number>();
  let noProgress = 0;
  let forced = 0;
  for (let i = 0; i < maxIterations; i++) {
    await sweepTick();
    const steps = pendingSweepSteps(table.gameId);
    if (steps.length > 0) {
      const step = steps[0];
      const count = (answered.get(String(step.id)) || 0) + 1;
      answered.set(String(step.id), count);
      if (count > 3) {
        result.stuck = `prompt_unanswerable:${String(step.type)}`;
        return result;
      }
      if (count === 1) (result.preResolve ? result.resolvePrompts : result.castPrompts).push(String(step.type));
      const path = await answerSweepStep(table, step, count);
      if (path === 'ai' && count > 1 && !result.notes.includes(`ai_fallback:${String(step.type)}`)) result.notes.push(`ai_fallback:${String(step.type)}`);
      if (path.startsWith('rejected:')) {
        const note = `ai_builder_rejected:${String(step.type)}:${path.slice('rejected:'.length)}`;
        if (!result.notes.includes(note)) result.notes.push(note);
      }
      if (path === 'human' && !result.notes.includes(`human_fallback:${String(step.type)}`)) result.notes.push(`human_fallback:${String(step.type)}`);
      continue;
    }
    if (stackSignature(table.game) === '') return result;
    if (!result.preResolve) result.preResolve = takeSweepSnapshot(table.game);
    const signature = stackSignature(table.game);
    const holder = String(table.game.state?.priority || SWEEP_P1);
    const handlers = table.handlers[holder] || table.handlers[SWEEP_P1];
    const mark = table.emitted.length;
    await handlers.passPriority({ gameId: table.gameId });
    result.passes += 1;
    for (const entry of table.emitted.slice(mark)) {
      if (entry.event === 'error') {
        result.passErrors.add(entry);
        const code = String(entry.payload?.code || entry.payload?.message || 'error');
        if (!result.notes.includes(`pass_error:${code}`)) result.notes.push(`pass_error:${code}`);
      }
    }
    await sweepTick();
    if (stackSignature(table.game) === signature && pendingSweepSteps(table.gameId).length === 0) {
      noProgress += 1;
      if (noProgress >= 4) {
        noProgress = 0;
        forced += 1;
        if (!result.notes.includes('forced_resolve')) result.notes.push('forced_resolve');
        if (forced > 6) {
          result.stuck = 'stack_not_resolving';
          return result;
        }
        table.game.resolveTopOfStack();
      }
    } else {
      noProgress = 0;
    }
  }
  result.stuck = pendingSweepSteps(table.gameId).length > 0 ? 'prompt_loop' : 'stack_loop';
  return result;
}
