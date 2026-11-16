/**
 * Origin: aiPriorityHandlers.ts — main-phase activation/cast loop caps.
 * Cluster: per-step budgets so activate→schedule / cast→schedule cannot freeze
 * MAIN1/MAIN2 with climbing seq and no turn advance.
 * Also counts control-flow-changed cast attempts (target/modal/pending) — those
 * used to return without noting and never hit MAX_MAIN_ACTIONS (v2 stall spike).
 * Visit counter force-passes after too many priority wakes even when actions fail
 * to note (storm aftermath / planner churn).
 * Late-game (bf>24): skip ability enumeration, tighter action/visit caps, and an
 * 8s real wall-clock budget so one MAIN1 tick cannot burn 180s of exclusive AI time.
 * Public: mainPhaseWindowKey, mainPhaseActivationsTaken, noteMainPhaseActivation,
 *   mainPhaseActionsTaken, noteMainPhaseAction, noteMainPhasePriorityVisit,
 *   shouldForceMainPhasePass, allowMainPhaseActivation, allowMainPhaseSpellScan.
 */

const MAX_MAIN_ACTIVATIONS = 4;
/** Lands + casts + activations combined per seat/step. */
const MAX_MAIN_ACTIONS = 8;
/** Priority handler entries into the main-phase action loop per seat/step. */
const MAX_MAIN_PRIORITY_VISITS = 16;
/** Battlefield size above which ability scans are skipped and caps tighten. */
const LARGE_BOARD_BF = 24;
const LARGE_BOARD_MAX_ACTIONS = 3;
const LARGE_BOARD_MAX_VISITS = 4;
/** Real wall-clock spend in this seat/step before force-pass (hrtime, not fake Date). */
const MAX_MAIN_WALL_MS = 8_000;
/** Tighter wall on large boards — one MAIN1 tick was burning 180s of exclusive AI CPU. */
const LARGE_BOARD_MAX_WALL_MS = 3_000;

export function mainPhaseWindowKey(game: any, playerId: string): string {
  const state = game?.state as any;
  return `${playerId}:${Number(state?.turnNumber || 0)}:${String(state?.step || '')}`;
}

function countMap(game: any, field: string): Record<string, number> {
  const state = game.state as any;
  return (state[field] ||= {}) as Record<string, number>;
}

function battlefieldSize(game: any): number {
  return Array.isArray(game?.state?.battlefield) ? game.state.battlefield.length : 0;
}

function isLargeBoard(game: any): boolean {
  return battlefieldSize(game) > LARGE_BOARD_BF;
}

/** Real milliseconds — vitest fakes Date/setTimeout but not process.hrtime. */
function realNowMs(): number {
  if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
    return Number(process.hrtime.bigint() / 1_000_000n);
  }
  return Date.now();
}

export function mainPhaseActivationsTaken(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  return Number(countMap(game, '_aiMainPhaseActivationCount')[key] || 0);
}

export function noteMainPhaseActivation(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  const map = countMap(game, '_aiMainPhaseActivationCount');
  const next = Number(map[key] || 0) + 1;
  map[key] = next;
  noteMainPhaseAction(game, playerId);
  return next;
}

export function allowMainPhaseActivation(game: any, playerId: string): boolean {
  // Late boards: ability enumeration (findBestActivatedAbility × static pass) dominates
  // exclusive-AI wall time. Prefer casts/lands so MAIN1 can finish.
  if (isLargeBoard(game)) return false;
  return mainPhaseActivationsTaken(game, playerId) < MAX_MAIN_ACTIVATIONS;
}

/**
 * Full hand×canPlay spell scans on bf>24 regularly monopolize the exclusive AI lock
 * for tens of seconds (MAIN1 tick-timeout). Land + commander still run; hand spells
 * wait until the board thins or the next smaller window.
 */
export function allowMainPhaseSpellScan(game: any): boolean {
  return !isLargeBoard(game);
}

export function mainPhaseActionsTaken(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  return Number(countMap(game, '_aiMainPhaseActionCount')[key] || 0);
}

export function noteMainPhaseAction(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  const map = countMap(game, '_aiMainPhaseActionCount');
  const next = Number(map[key] || 0) + 1;
  map[key] = next;
  return next;
}

export function noteMainPhasePriorityVisit(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  const map = countMap(game, '_aiMainPhasePriorityVisitCount');
  const next = Number(map[key] || 0) + 1;
  map[key] = next;
  const wallMap = countMap(game, '_aiMainPhaseWallStartMs');
  if (!wallMap[key]) wallMap[key] = realNowMs();
  return next;
}

export function mainPhasePriorityVisits(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  return Number(countMap(game, '_aiMainPhasePriorityVisitCount')[key] || 0);
}

function mainPhaseWallElapsedMs(game: any, playerId: string): number {
  const key = mainPhaseWindowKey(game, playerId);
  const started = Number(countMap(game, '_aiMainPhaseWallStartMs')[key] || 0);
  if (!started) return 0;
  return Math.max(0, realNowMs() - started);
}

export function shouldForceMainPhasePass(game: any, playerId: string): boolean {
  const large = isLargeBoard(game);
  const actionCap = large ? LARGE_BOARD_MAX_ACTIONS : MAX_MAIN_ACTIONS;
  const visitCap = large ? LARGE_BOARD_MAX_VISITS : MAX_MAIN_PRIORITY_VISITS;
  const wallCap = large ? LARGE_BOARD_MAX_WALL_MS : MAX_MAIN_WALL_MS;
  return (
    mainPhaseActionsTaken(game, playerId) >= actionCap
    || mainPhasePriorityVisits(game, playerId) >= visitCap
    || mainPhaseWallElapsedMs(game, playerId) >= wallCap
  );
}
