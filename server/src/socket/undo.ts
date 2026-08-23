// server/src/socket/undo.ts
// Socket handlers for the undo system with player approval

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, transformDbEventsForReplay, clearScheduledHumanAutoPassForGame, suppressAutomationOnNextBroadcast, pauseHumanAutoPassUntilAction } from "./util";
import { getEvents, truncateEventsForUndo, getEventCount } from "../db";
import GameManager from "../GameManager.js";
import { reconcileCommandZoneZoneConsistency } from "../state/modules/commander.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { createInitialGameState } from "../state/gameState.js";
import { createContext } from "../state/context.js";
import { replay as replayOnContext } from "../state/modules/applyEvent.js";
import { ResolutionQueueManager } from "../state/resolution/ResolutionQueueManager.js";
import { clearScheduledAIActionsForGame, scheduleAIGameFlow } from "./ai.js";

/**
 * Undo request state
 */
interface UndoRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  description: string;
  undoScope?: 'step' | 'phase' | 'previousPhase' | 'turn';
  actionsToUndo: number;
  eventCountAtRequest: number;
  boundaryPreview?: UndoBoundaryPreview;
  createdAt: number;
  expiresAt: number;
  approvals: Record<string, boolean>; // playerId -> approved (true) or rejected (false)
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
}

// Store undo requests by gameId - with cleanup on request completion/expiration
const undoRequests = new Map<string, UndoRequest>();

export function clearUndoRequestsForGame(gameId: string): void {
  undoRequests.delete(gameId);
}

// Undo timeout in milliseconds (60 seconds)
const UNDO_TIMEOUT_MS = 60000;

type PersistedEvent = {
  type: string;
  payload?: any;
  turnNumber?: number;
  phase?: string;
  step?: string;
};

type BoundaryStateSnapshot = {
  turnNumber?: number;
  phase?: string;
  step?: string;
  turnPlayer?: string;
};

type UndoBoundaryPreview = BoundaryStateSnapshot & {
  summary: string;
};

type UndoBoundaryPlan = {
  count: number;
  boundaryState?: BoundaryStateSnapshot;
};

type SmartUndoCounts = {
  stepCount: number;
  phaseCount: number;
  previousPhaseCount: number;
  turnCount: number;
  semanticStepCount: number;
  semanticPhaseCount: number;
  previews: {
    step?: UndoBoundaryPreview;
    phase?: UndoBoundaryPreview;
    previousPhase?: UndoBoundaryPreview;
    turn?: UndoBoundaryPreview;
  };
};

const ORACLE_IR_MUTATION_TAIL_EVENT_TYPES = new Set([
  'assignTriggeredAbilityTargets',
  'goadPermanent',
  'battlefieldPermanentPatch',
  'changePermanentControl',
  'updateCounters',
  'executeEffect',
  'adjustLife',
  'mill',
  'drawCards',
  'discardEffect',
  'shuffleLibrary',
  'effectProgramZoneMove',
  'exilePermanent',
  'putCardFromHandOntoBattlefield',
]);

const PROMPT_ONLY_TAIL_EVENT_TYPES = new Set([
  'resolveTopOfStackPrompt',
  'targetSelectionWardPrompt',
  'targetSelectionTapUntapPrompt',
]);

function eventPayload(event: PersistedEvent): Record<string, unknown> {
  if (event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    return event.payload as Record<string, unknown>;
  }
  return event as Record<string, unknown>;
}

function isOracleIrMutationTailEvent(event: PersistedEvent): boolean {
  const type = String(event?.type || '').trim();
  if (!ORACLE_IR_MUTATION_TAIL_EVENT_TYPES.has(type)) return false;
  const payload = eventPayload(event);
  if (type === 'assignTriggeredAbilityTargets') return true;
  if (type === 'goadPermanent' || type === 'battlefieldPermanentPatch') return true;
  if (type === 'changePermanentControl') return payload.spellResolutionMutation === true;
  if (payload.oracleIrReplayMutation === true || payload.effectProgramMutation === true) return true;
  if (type === 'updateCounters' && payload.skipCounterModifications === true) return true;
  return false;
}

function isPromptOnlyTailEvent(event: PersistedEvent): boolean {
  return PROMPT_ONLY_TAIL_EVENT_TYPES.has(String(event?.type || '').trim());
}

/** Collapse IR mutation tails and prompt-only rows into their parent player action for display. */
export function countSemanticActions(events: readonly PersistedEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (!event?.type) continue;
    if (isOracleIrMutationTailEvent(event) || isPromptOnlyTailEvent(event)) continue;
    count += 1;
  }
  return count;
}

function sliceEventsForBoundaryPlan(events: PersistedEvent[], plan: UndoBoundaryPlan | undefined): PersistedEvent[] {
  const count = Math.max(0, Number(plan?.count || 0));
  if (count <= 0 || events.length === 0) return [];
  return events.slice(Math.max(0, events.length - count));
}

type BoundaryKind = 'step' | 'phase' | 'turn';

/** Higher = later in the turn (Ending > Postcombat > Combat > Precombat > Beginning). */
function phaseOrderRank(phase: unknown): number {
  const key = normalizePhaseToken(phase);
  switch (key) {
    case 'ending':
      return 50;
    case 'postcombatmain':
      return 40;
    case 'combat':
      return 30;
    case 'precombatmain':
      return 20;
    case 'beginning':
      return 10;
    case 'pre_game':
      return 0;
    default:
      return 15;
  }
}


/** Higher = later within the turn (Cleanup > End > Main2 > ... > Untap). */
function stepOrderRank(step: unknown): number {
  const key = normalizeStepToken(step);
  switch (key) {
    case 'CLEANUP':
      return 130;
    case 'END':
      return 120;
    case 'MAIN2':
      return 110;
    case 'END_COMBAT':
      return 100;
    case 'DAMAGE':
      return 90;
    case 'FIRST_STRIKE_DAMAGE':
      return 80;
    case 'DECLARE_BLOCKERS':
      return 70;
    case 'DECLARE_ATTACKERS':
      return 60;
    case 'BEGIN_COMBAT':
      return 50;
    case 'MAIN1':
      return 40;
    case 'DRAW':
      return 30;
    case 'UPKEEP':
      return 20;
    case 'UNTAP':
      return 10;
    case 'PRE_GAME':
      return 0;
    default:
      return 15;
  }
}
function normalizePhaseToken(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!raw) return 'unknown';
  if (raw === 'pre_game' || raw === 'pregame') return 'pre_game';
  if (raw === 'main1' || raw === 'precombat_main' || raw === 'precombatmain') return 'precombatmain';
  if (raw === 'main2' || raw === 'postcombat_main' || raw === 'postcombatmain') return 'postcombatmain';
  if (raw === 'beginning' || raw === 'combat' || raw === 'ending') return raw;
  return raw.replace(/_/g, '');
}

/** Canonical step keys so beginCombat / BEGIN_COMBAT / begin_combat share one bucket. */
function normalizeStepToken(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return 'UNKNOWN';
  const compact = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    UNTAP: 'UNTAP',
    UPKEEP: 'UPKEEP',
    DRAW: 'DRAW',
    MAIN: 'MAIN1',
    MAIN1: 'MAIN1',
    MAIN2: 'MAIN2',
    BEGINCOMBAT: 'BEGIN_COMBAT',
    BEGIN_COMBAT: 'BEGIN_COMBAT',
    DECLAREATTACKERS: 'DECLARE_ATTACKERS',
    DECLARE_ATTACKERS: 'DECLARE_ATTACKERS',
    DECLAREBLOCKERS: 'DECLARE_BLOCKERS',
    DECLARE_BLOCKERS: 'DECLARE_BLOCKERS',
    FIRSTSTRIKEDAMAGE: 'FIRST_STRIKE_DAMAGE',
    FIRST_STRIKE_DAMAGE: 'FIRST_STRIKE_DAMAGE',
    COMBATDAMAGE: 'DAMAGE',
    DAMAGE: 'DAMAGE',
    ENDCOMBAT: 'END_COMBAT',
    END_COMBAT: 'END_COMBAT',
    ENDSTEP: 'END',
    END_STEP: 'END',
    END: 'END',
    CLEANUP: 'CLEANUP',
    PREGAME: 'PRE_GAME',
    PRE_GAME: 'PRE_GAME',
  };
  const noUnderscore = compact.replace(/_/g, '');
  return aliases[compact] || aliases[noUnderscore] || compact;
}

function getTurnBoundaryKey(stateAny: any): string {
  const rawTurnNumber = Number((stateAny as any)?.turnNumber);
  if (Number.isFinite(rawTurnNumber) && rawTurnNumber > 0) {
    return `turn:${rawTurnNumber}`;
  }
  const rawTurn = Number((stateAny as any)?.turn);
  if (Number.isFinite(rawTurn) && rawTurn > 0) {
    return `turn:${rawTurn}`;
  }
  const phaseRaw = String(stateAny?.phase || '').toLowerCase();
  if (phaseRaw === 'pre_game' || phaseRaw === 'pre-game' || phaseRaw === '') {
    return 'turn:pre_game';
  }
  // No numeric turn yet â€” keep a distinct unknown bucket so we do not merge every
  // live turn into a single `turn:live` key (that made step/phase/turn counts match).
  return 'turn:unknown';
}

/**
 * Single canonical key per boundary kind. Previously returned multiple aliases
 * (`turn:N` plus `turn:live`), and live lookup preferred the alias that spanned
 * the whole game â€” collapsing smart-undo counts across scopes.
 *
 * Step/phase aliases are normalized so restart/restore (which may surface
 * BEGIN_COMBAT while older stamps used beginCombat) still share one chunk.
 */
function getBoundaryKey(stateAny: any, kind: BoundaryKind): string {
  const turnKey = getTurnBoundaryKey(stateAny);
  if (kind === 'turn') return turnKey;

  const phase = normalizePhaseToken(stateAny?.phase);
  const phaseKey = `${turnKey}|phase:${phase}`;
  if (kind === 'phase') return phaseKey;

  const step = normalizeStepToken(stateAny?.step);
  return `${phaseKey}|step:${step}`;
}

function snapshotBoundaryState(stateAny: any): BoundaryStateSnapshot | undefined {
  const rawTurnNumber = Number((stateAny as any)?.turnNumber ?? (stateAny as any)?.turn);
  const turnNumber = Number.isFinite(rawTurnNumber) && rawTurnNumber > 0 ? rawTurnNumber : undefined;
  const phase = typeof stateAny?.phase === 'undefined' ? undefined : String(stateAny.phase);
  const step = typeof stateAny?.step === 'undefined' ? undefined : String(stateAny.step);
  const turnPlayerRaw = (stateAny as any)?.turnPlayer ?? (stateAny as any)?.activePlayer;
  const turnPlayer = typeof turnPlayerRaw === 'undefined'
    ? undefined
    : (String(turnPlayerRaw || '').trim() || undefined);

  if (typeof turnNumber === 'undefined' && typeof phase === 'undefined' && typeof step === 'undefined') {
    return undefined;
  }

  return { turnNumber, phase, step, turnPlayer };
}

function humanizeBoundaryToken(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildUndoBoundaryPreview(state: BoundaryStateSnapshot | undefined): UndoBoundaryPreview | undefined {
  if (!state) return undefined;

  const summaryParts: string[] = [];
  if (typeof state.turnNumber === 'number') {
    summaryParts.push(`Turn ${state.turnNumber}`);
  }

  const phaseLabel = humanizeBoundaryToken(state.phase);
  const stepLabel = humanizeBoundaryToken(state.step);
  if (phaseLabel && stepLabel) {
    summaryParts.push(`${phaseLabel} / ${stepLabel}`);
  } else if (phaseLabel) {
    summaryParts.push(phaseLabel);
  } else if (stepLabel) {
    summaryParts.push(stepLabel);
  }

  return {
    ...state,
    summary: summaryParts.filter(Boolean).join(' | ') || 'Current game state',
  };
}

function getPersistedEventBoundaryState(event: PersistedEvent): any {
  return {
    turnNumber: event?.turnNumber,
    turn: event?.turnNumber,
    phase: event?.phase,
    step: event?.step,
  };
}

function eventHasAnyBoundaryMetadata(event: PersistedEvent): boolean {
  return Boolean(
    event && (
      typeof event.turnNumber !== 'undefined' ||
      typeof event.phase !== 'undefined' ||
      typeof event.step !== 'undefined'
    ),
  );
}

function hasPersistedBoundaryMetadata(events: PersistedEvent[]): boolean {
  // Prefer the fast metadata path whenever we have enough stamped events.
  // Requiring *every* row used to fail (and fall back to a slow/fragile probe)
  // whenever a single append missed stamping â€” which collapsed smart-undo counts.
  if (!Array.isArray(events) || events.length === 0) return false;
  let stamped = 0;
  for (const event of events) {
    if (eventHasAnyBoundaryMetadata(event)) stamped += 1;
  }
  if (stamped === 0) return false;
  if (stamped === events.length) return true;
  // Partial coverage is OK if a meaningful share of the log is stamped
  // (carry-forward fills gaps while scanning).
  return stamped >= Math.min(events.length, Math.max(3, Math.ceil(events.length * 0.25)));
}

function mergeBoundaryStateCarryForward(
  previous: BoundaryStateSnapshot | undefined,
  nextRaw: BoundaryStateSnapshot | undefined,
): BoundaryStateSnapshot | undefined {
  if (!previous && !nextRaw) return undefined;
  const merged: BoundaryStateSnapshot = {
    turnNumber: typeof nextRaw?.turnNumber === 'number' ? nextRaw.turnNumber : previous?.turnNumber,
    phase: typeof nextRaw?.phase !== 'undefined' ? nextRaw.phase : previous?.phase,
    step: typeof nextRaw?.step !== 'undefined' ? nextRaw.step : previous?.step,
    turnPlayer: typeof nextRaw?.turnPlayer !== 'undefined' && String(nextRaw.turnPlayer || '').trim()
      ? String(nextRaw.turnPlayer).trim()
      : previous?.turnPlayer,
  };
  if (
    typeof merged.turnNumber === 'undefined' &&
    typeof merged.phase === 'undefined' &&
    typeof merged.step === 'undefined'
  ) {
    return undefined;
  }
  return merged;
}

type BoundaryHistoryEntry = {
  key: string;
  entryIndex: number;
  state?: BoundaryStateSnapshot;
};

/**
 * Scan events into contiguous boundary segments. Entry indices are stored per
 * history slot (not overwritten by key) so revisited phases (extra combat) and
 * turn/phase jump targets keep the correct chunk start after restart.
 */
function buildBoundaryHistoryFromPersistedMetadata(
  events: PersistedEvent[],
  boundaryKind: BoundaryKind,
): BoundaryHistoryEntry[] | undefined {
  if (!hasPersistedBoundaryMetadata(events)) {
    return undefined;
  }

  const history: BoundaryHistoryEntry[] = [];
  let carriedState = snapshotBoundaryState({});
  let previousBoundaryKey = getBoundaryKey({}, boundaryKind);
  history.push({ key: previousBoundaryKey, entryIndex: -1, state: carriedState });

  for (let index = 0; index < events.length; index++) {
    const rawState = snapshotBoundaryState(getPersistedEventBoundaryState(events[index]));
    // Carry forward last known turn/phase/step across unstamped rows so a single
    // missing stamp cannot invent a bogus empty boundary and collapse scopes.
    carriedState = mergeBoundaryStateCarryForward(carriedState, rawState) || carriedState;
    const nextBoundaryKey = getBoundaryKey(carriedState || {}, boundaryKind);
    if (nextBoundaryKey !== previousBoundaryKey) {
      history.push({ key: nextBoundaryKey, entryIndex: index, state: carriedState });
    }
    previousBoundaryKey = nextBoundaryKey;
  }

  return history;
}

function buildBoundaryHistoryFromReplay(
  events: PersistedEvent[],
  game: any,
  boundaryKind: BoundaryKind,
): { history: BoundaryHistoryEntry[]; eventCount: number } {
  const replayEvents = transformDbEventsForReplay(events as any);
  const scratch = createContext(`undo_probe_${game?.gameId || 'game'}` as any);
  const history: BoundaryHistoryEntry[] = [];
  let previousBoundaryKey = getBoundaryKey((scratch as any).state || {}, boundaryKind);
  history.push({
    key: previousBoundaryKey,
    entryIndex: -1,
    state: snapshotBoundaryState((scratch as any).state || {}),
  });

  replayOnContext(scratch as any, replayEvents as any, (replayCtx, _event, index) => {
    const nextBoundaryKey = getBoundaryKey((replayCtx as any).state || {}, boundaryKind);
    const nextBoundaryState = snapshotBoundaryState((replayCtx as any).state || {});
    if (nextBoundaryKey !== previousBoundaryKey) {
      history.push({ key: nextBoundaryKey, entryIndex: index, state: nextBoundaryState });
    }
    previousBoundaryKey = nextBoundaryKey;
  });

  return { history, eventCount: replayEvents.length };
}

function planFromBoundaryHistory(
  history: BoundaryHistoryEntry[],
  eventCount: number,
  liveBoundaryKey: string,
  boundaryOffset: number,
): UndoBoundaryPlan {
  if (!history.length || eventCount <= 0) return { count: 0 };

  const lastKey = history[history.length - 1]?.key;
  let targetHistoryIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].key === liveBoundaryKey) {
      targetHistoryIndex = i;
      break;
    }
  }
  if (targetHistoryIndex < 0) {
    targetHistoryIndex = history.length - 1;
    if (liveBoundaryKey && liveBoundaryKey !== lastKey) {
      debugWarn(1, `[undo] Failed to locate boundary ${liveBoundaryKey}; using last stored boundary ${lastKey}`);
    }
  }

  const desiredHistoryIndex = targetHistoryIndex - boundaryOffset;
  if (desiredHistoryIndex < 0) {
    return { count: 0 };
  }

  const desired = history[desiredHistoryIndex];
  if (!desired) return { count: 0 };

  return {
    // entryIndex -1 (synthetic pre-log bucket) => undo whole log
    count: Math.max(0, eventCount - Math.max(0, desired.entryIndex)),
    boundaryState: desired.state,
  };
}

function calculateBoundaryUndoCount(
  events: PersistedEvent[],
  game: any,
  boundaryKind: BoundaryKind,
  boundaryOffset = 0,
): UndoBoundaryPlan {
  if (events.length === 0) return { count: 0 };

  const currentState = (game?.state || {}) as any;
  const liveBoundaryKey = getBoundaryKey(currentState, boundaryKind);
  if (!liveBoundaryKey) return { count: 0 };

  const persistedHistory = buildBoundaryHistoryFromPersistedMetadata(events, boundaryKind);
  if (persistedHistory) {
    return planFromBoundaryHistory(persistedHistory, events.length, liveBoundaryKey, boundaryOffset);
  }

  const { history, eventCount } = buildBoundaryHistoryFromReplay(events, game, boundaryKind);
  return planFromBoundaryHistory(history, eventCount, liveBoundaryKey, boundaryOffset);
}

function calculateSmartUndoCounts(game: any, events: PersistedEvent[]): SmartUndoCounts {
  if (!game || events.length === 0) {
    return {
      stepCount: 0,
      phaseCount: 0,
      previousPhaseCount: 0,
      turnCount: 0,
      semanticStepCount: 0,
      semanticPhaseCount: 0,
      previews: {},
    };
  }

  const stepPlan = calculateBoundaryUndoCount(events, game, 'step');
  const phasePlan = calculateBoundaryUndoCount(events, game, 'phase');
  const previousPhasePlan = calculateBoundaryUndoCount(events, game, 'phase', 1);
  const turnPlan = calculateBoundaryUndoCount(events, game, 'turn');

  const stepEvents = sliceEventsForBoundaryPlan(events, stepPlan);
  const phaseEvents = sliceEventsForBoundaryPlan(events, phasePlan);

  return {
    stepCount: stepPlan.count,
    phaseCount: phasePlan.count,
    previousPhaseCount: previousPhasePlan.count,
    turnCount: turnPlan.count,
    semanticStepCount: countSemanticActions(stepEvents),
    semanticPhaseCount: countSemanticActions(phaseEvents),
    previews: {
      step: buildUndoBoundaryPreview(stepPlan.boundaryState),
      phase: buildUndoBoundaryPreview(phasePlan.boundaryState),
      previousPhase: buildUndoBoundaryPreview(previousPhasePlan.boundaryState),
      turn: buildUndoBoundaryPreview(turnPlan.boundaryState),
    },
  };
}

export type UndoTurnPhaseTarget = {
  turnNumber?: number;
  phase: string;
  step?: string;
  turnPlayer?: string;
  turnPlayerName?: string;
  round?: number;
  label: string;
  eventsToUndo: number;
  entryIndex: number;
};

function getTurnOrderPlayerIds(game: any): string[] {
  const state = game?.state || {};
  if (Array.isArray(state.turnOrder) && state.turnOrder.length > 0) {
    return state.turnOrder.map((id: unknown) => String(id || '').trim()).filter(Boolean);
  }
  const players = Array.isArray(state.players) ? state.players : [];
  return players
    .filter((p: any) => !p?.isSpectator)
    .map((p: any) => String(p?.id || p?.playerId || '').trim())
    .filter(Boolean);
}

function getPlayerCountForRound(game: any): number {
  const turnOrder = getTurnOrderPlayerIds(game);
  if (turnOrder.length > 0) return turnOrder.length;
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const seated = players.filter((p: any) => !p?.isSpectator);
  if (seated.length > 0) return seated.length;
  return Math.max(1, players.length || 1);
}

/** Display-only multiplayer round from cumulative turn number. */
function computeDisplayRound(turnNumber: number | undefined, playerCount: number): number | undefined {
  if (typeof turnNumber !== 'number' || turnNumber <= 0) return undefined;
  const n = Math.max(1, Number(playerCount) || 1);
  return Math.floor((turnNumber - 1) / n) + 1;
}

/** Resolve who was active on a historical turn (snapshot first, else seat-order inference). */
function resolveTurnPlayerId(
  game: any,
  turnNumber: number | undefined,
  snapshotTurnPlayer?: string,
): string | undefined {
  const fromSnap = String(snapshotTurnPlayer || '').trim();
  if (fromSnap) return fromSnap;
  if (typeof turnNumber !== 'number' || turnNumber <= 0) return undefined;

  const state = game?.state || {};
  const liveTurnRaw = Number(state.turnNumber ?? state.turn);
  const liveTurn = Number.isFinite(liveTurnRaw) && liveTurnRaw > 0 ? liveTurnRaw : undefined;
  const livePlayer = String(state.turnPlayer || state.activePlayer || '').trim();
  const turnOrder = getTurnOrderPlayerIds(game);
  if (!turnOrder.length) {
    return liveTurn === turnNumber && livePlayer ? livePlayer : undefined;
  }

  if (liveTurn && livePlayer) {
    const liveIdx = turnOrder.indexOf(livePlayer);
    if (liveIdx >= 0) {
      const delta = turnNumber - liveTurn;
      const idx = ((liveIdx + delta) % turnOrder.length + turnOrder.length) % turnOrder.length;
      return turnOrder[idx];
    }
  }

  const idx = ((turnNumber - 1) % turnOrder.length + turnOrder.length) % turnOrder.length;
  return turnOrder[idx];
}

function buildTurnPhaseTargetLabel(opts: {
  turnNumber?: number;
  round?: number;
  phase: string;
  step?: string;
  turnPlayerName?: string;
}): string {
  const parts: string[] = [];
  if (typeof opts.turnNumber === 'number') {
    parts.push(`Turn ${opts.turnNumber}`);
  }
  if (typeof opts.round === 'number' && opts.round > 0) {
    parts.push(`Round ${opts.round}`);
  }
  const name = String(opts.turnPlayerName || '').trim();
  if (name) parts.push(name);

  const phaseLabel = humanizeBoundaryToken(opts.phase);
  const stepLabel = humanizeBoundaryToken(opts.step);
  if (phaseLabel && stepLabel) {
    // Prefer distinct step name when it adds info (e.g. Declare Attackers under Combat).
    const phaseNorm = phaseLabel.toLowerCase().replace(/\s+/g, '');
    const stepNorm = stepLabel.toLowerCase().replace(/\s+/g, '');
    const stepIsGenericMain = stepNorm === 'main' || stepNorm === 'main1' || stepNorm === 'main2';
    if (stepIsGenericMain || stepNorm === phaseNorm || phaseNorm.includes(stepNorm) || stepNorm.includes(phaseNorm)) {
      parts.push(phaseLabel);
    } else {
      parts.push(`${phaseLabel} / ${stepLabel}`);
    }
  } else if (phaseLabel) {
    parts.push(phaseLabel);
  } else if (stepLabel) {
    parts.push(stepLabel);
  }

  return parts.filter(Boolean).join(' | ') || 'Earlier game state';
}

function undoTargetDedupeKey(target: {
  turnNumber?: number;
  phase: string;
  step?: string;
}): string {
  const turn = typeof target.turnNumber === 'number' && target.turnNumber > 0 ? String(target.turnNumber) : '?';
  const phase = normalizePhaseToken(target.phase);
  const step = typeof target.step === 'undefined' || String(target.step || '').trim() === ''
    ? ''
    : normalizeStepToken(target.step);
  return `${turn}|${phase}|${step}`;
}

/**
 * Contiguous phase (or step) segments earlier than "now", for jump-undo pickers.
 * eventsToUndo = how many trailing DB events to truncate to land at that segment start.
 * Defaults to step-level targets for the last full round of turns; older history is phase-only.
 * Dedupes by (turn, phase, step) keeping the earliest boundary (largest eventsToUndo) so
 * revisited/flickered segments do not double-list.
 * Round / turn-player name are display-only fields on the label.
 */
export function listUndoTurnPhaseTargets(
  game: any,
  events: PersistedEvent[],
  opts?: { includeSteps?: boolean; limit?: number },
): UndoTurnPhaseTarget[] {
  if (!game || !Array.isArray(events) || events.length === 0) return [];

  // Menu prefers step boundaries; callers may pass includeSteps:false for phase-only.
  const includeSteps = opts?.includeSteps !== false;
  const limit = Math.max(1, Math.min(200, Number(opts?.limit || 200)));
  const kind: BoundaryKind = includeSteps ? 'step' : 'phase';
  const playerNames = buildPlayerNameMap(game);
  const playerCount = getPlayerCountForRound(game);
  const liveTurnNumber = typeof (game?.state as any)?.turnNumber === 'number' && (game.state as any).turnNumber > 0
    ? Number((game.state as any).turnNumber)
    : undefined;
  // Keep step detail for the current round of seats; older than that -> phase rows only.
  const recentStepMinTurn = typeof liveTurnNumber === 'number'
    ? liveTurnNumber - playerCount + 1
    : undefined;

  let history = buildBoundaryHistoryFromPersistedMetadata(events, kind);
  let eventCount = events.length;
  if (!history) {
    const replayed = buildBoundaryHistoryFromReplay(events, game, kind);
    history = replayed.history;
    eventCount = replayed.eventCount;
  }
  if (!history.length) return [];

  const liveKey = getBoundaryKey((game?.state || {}) as any, kind);
  let currentIndex = history.length - 1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].key === liveKey) {
      currentIndex = i;
      break;
    }
  }

  const targetsByKey = new Map<string, UndoTurnPhaseTarget>();
  // Skip the synthetic pre-log bucket and the current segment.
  for (let i = currentIndex - 1; i >= 0; i--) {
    const entry = history[i];
    if (!entry || entry.entryIndex < 0) continue;
    const state = entry.state || {};
    const phase = String(state.phase || '').trim();
    if (!phase) continue;
    const turnNumber = typeof state.turnNumber === 'number' && state.turnNumber > 0
      ? state.turnNumber
      : undefined;
    // Steps only for the last full round of turns; older history is phase-only.
    const useStepForEntry = includeSteps && (
      recentStepMinTurn === undefined
      || typeof turnNumber !== 'number'
      || turnNumber >= recentStepMinTurn
    );
    const step = useStepForEntry
      ? (typeof state.step === 'undefined' ? undefined : String(state.step))
      : undefined;
    const eventsToUndo = Math.max(0, eventCount - Math.max(0, entry.entryIndex));
    if (eventsToUndo <= 0) continue;

    const turnPlayerId = resolveTurnPlayerId(game, turnNumber, state.turnPlayer);
    const turnPlayerName = turnPlayerId
      ? (playerNames[turnPlayerId] || turnPlayerId)
      : undefined;
    const round = computeDisplayRound(turnNumber, playerCount);
    const candidate: UndoTurnPhaseTarget = {
      turnNumber,
      phase,
      step,
      turnPlayer: turnPlayerId,
      turnPlayerName,
      round,
      label: buildTurnPhaseTargetLabel({ turnNumber, round, phase, step, turnPlayerName }),
      eventsToUndo,
      entryIndex: entry.entryIndex,
    };

    const key = undoTargetDedupeKey(candidate);
    const existing = targetsByKey.get(key);
    // Keep earliest/most useful boundary for returning to segment start (larger eventsToUndo).
    if (!existing || candidate.eventsToUndo > existing.eventsToUndo) {
      targetsByKey.set(key, candidate);
    }
  }

  const targets = Array.from(targetsByKey.values());

  // Newest turn first, then later phases/steps within that turn.
  // Tie-break: fewer events to undo = closer to now.
  targets.sort((a, b) => {
    const turnDiff = (b.turnNumber ?? -1) - (a.turnNumber ?? -1);
    if (turnDiff !== 0) return turnDiff;
    const phaseDiff = phaseOrderRank(b.phase) - phaseOrderRank(a.phase);
    if (phaseDiff !== 0) return phaseDiff;
    if (a.step || b.step) {
      const stepDiff = stepOrderRank(b.step) - stepOrderRank(a.step);
      if (stepDiff !== 0) return stepDiff;
    }
    return a.eventsToUndo - b.eventsToUndo;
  });

  return targets.slice(0, limit);
}

function resolveUndoToTurnPhaseCount(
  game: any,
  events: PersistedEvent[],
  target: { turnNumber?: number; phase?: string; step?: string },
): { actionsToUndo: number; preview?: UndoBoundaryPreview } {
  const phase = String(target?.phase || '').trim();
  if (!phase) return { actionsToUndo: 0 };

  const includeSteps = typeof target?.step !== 'undefined' && String(target.step || '').trim() !== '';
  const targets = listUndoTurnPhaseTargets(game, events, { includeSteps, limit: 200 });
  const wantTurn = typeof target.turnNumber === 'number' && target.turnNumber > 0 ? target.turnNumber : undefined;
  const wantPhase = normalizePhaseToken(phase);
  const wantStep = includeSteps ? normalizeStepToken(target.step) : undefined;

  const match = targets.find((entry) => {
    if (wantTurn !== undefined && entry.turnNumber !== wantTurn) return false;
    if (normalizePhaseToken(entry.phase) !== wantPhase) return false;
    if (wantStep && normalizeStepToken(entry.step) !== wantStep) return false;
    return true;
  });

  if (!match) return { actionsToUndo: 0 };
  return {
    actionsToUndo: match.eventsToUndo,
    preview: buildUndoBoundaryPreview({
      turnNumber: match.turnNumber,
      phase: match.phase,
      step: match.step,
    }),
  };
}

function buildPlayerNameMap(game: any): Record<string, string> {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const playerNames: Record<string, string> = {};
  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    playerNames[playerId] = String(player?.name || playerId);
  }
  return playerNames;
}

/**
 * Generate unique undo request ID using crypto if available
 */
function generateUndoId(): string {
  // Use crypto.randomUUID() if available for better uniqueness
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `undo_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
    }
  } catch {
    // Fallback to Math.random()
  }
  return `undo_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Clean up old expired requests to prevent memory leaks
 */
function cleanupExpiredRequests(): void {
  const now = Date.now();
  for (const [gameId, request] of undoRequests.entries()) {
    if (request.status !== 'pending' || now > request.expiresAt + 60000) {
      // Remove requests that are not pending or have been expired for over a minute
      undoRequests.delete(gameId);
    }
  }
}

function cancelPendingUndoRequest(io: Server, gameId: string, reason: string): void {
  const request = undoRequests.get(gameId);
  if (!request || request.status !== 'pending') {
    return;
  }

  request.status = 'cancelled';
  undoRequests.delete(gameId);

  io.to(gameId).emit('undoCancelled', {
    gameId,
    undoId: request.id,
    reason,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `Undo request cancelled: ${reason}.`,
    ts: Date.now(),
  });
}

/**
 * Get all non-spectator player IDs from a game
 */
function getPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isSpectator)
    .map((p: any) => p.id);
}

/**
 * Get all AI player IDs from a game
 */
function getAIPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isSpectator && p.isAI)
    .map((p: any) => p.id);
}

/**
 * Get all human (non-AI) player IDs from a game
 */
function getHumanPlayerIds(game: any): string[] {
  const players = game.state?.players || [];
  return players
    .filter((p: any) => p && !p.spectator && !p.isSpectator && !p.isAI)
    .map((p: any) => p.id);
}

/**
 * Check if a player is an AI player
 */
function isAIPlayer(game: any, playerId: string): boolean {
  const players = game.state?.players || [];
  const player = players.find((p: any) => p && p.id === playerId);
  return player?.isAI === true;
}

/**
 * Check if all players have approved
 */
function checkAllApproved(request: UndoRequest, playerIds: string[]): boolean {
  return playerIds.every(id => request.approvals[id] === true);
}

/**
 * Check if any player has rejected
 */
function checkAnyRejected(request: UndoRequest): boolean {
  return Object.values(request.approvals).some(v => v === false);
}

/**
 * Perform the actual undo by:
 * 1. Getting the current event count
 * 2. Calculating how many events to keep
 * 3. Truncating the event log in the database
 * 4. Resetting the existing game state (preserving socket/participant mappings)
 * 5. Replaying the remaining events on the SAME game context
 * 
 * IMPORTANT: We use the existing game's reset + replay methods rather than creating
 * a fresh game. This ensures:
 * - The RNG state is properly reset and re-seeded from the rngSeed event
 * - Libraries (card arrays) are properly rebuilt from deckImportResolved events
 * - Socket/participant mappings are preserved (joinedBySocket, participantsList, etc.)
 * - Life/poison/experience counters are properly restored
 * - All internal context state matches what was replayed
 * 
 * Returns true on success, false on failure
 */
function performUndo(gameId: string, actionsToUndo: number, eventCountOverride?: number): { success: boolean; error?: string } {
  try {
    clearScheduledHumanAutoPassForGame(gameId);
    clearScheduledAIActionsForGame(gameId);

    // Get current event count
    let eventCount: number;
    if (typeof eventCountOverride === 'number' && Number.isFinite(eventCountOverride) && eventCountOverride >= 0) {
      eventCount = Math.floor(eventCountOverride);
    } else {
      try {
        eventCount = getEventCount(gameId);
      } catch (e) {
        debugWarn(1, `[undo] Failed to get event count for game ${gameId}:`, e);
        return { success: false, error: "Database not available" };
      }
    }
    
    if (eventCount === 0) {
      return { success: false, error: "No actions to undo" };
    }
    
    // Calculate how many events to keep
    const eventsToKeep = Math.max(0, eventCount - actionsToUndo);
    
    debug(2, `[undo] Performing undo for game ${gameId}: keeping ${eventsToKeep} of ${eventCount} events`);
    
    // Truncate the event log in the database
    try {
      truncateEventsForUndo(gameId, eventsToKeep);
    } catch (e) {
      debugError(1, `[undo] Failed to truncate events for game ${gameId}:`, e);
      return { success: false, error: "Failed to truncate event log" };
    }
    
    // Get the remaining events
    let remainingEvents: any[];
    try {
      remainingEvents = getEvents(gameId);
    } catch (e) {
      debugWarn(1, `[undo] Failed to get events after truncation:`, e);
      remainingEvents = [];
    }
    
    // Get the existing game - we'll reset and replay on the SAME game context
    // This preserves socket mappings and internal state references
    const existingGame = GameManager.getGame(gameId);
    
    if (!existingGame) {
      debugError(1, `[undo] Game ${gameId} not found in GameManager`);
      return { success: false, error: "Game not found" };
    }
    
    // Save participant mappings before reset (in case reset clears them)
    let savedParticipants: Array<{ socketId: string; playerId: string; spectator: boolean }> = [];
    try {
      if (typeof existingGame.participants === 'function') {
        savedParticipants = existingGame.participants().map((p: any) => ({
          socketId: p.socketId,
          playerId: p.playerId,
          spectator: !!(p.spectator || p.isSpectator),
        }));
      }
    } catch (e) {
      debugWarn(1, '[undo] Failed to save participants:', e);
    }
    
    // Reset the game state while preserving player roster
    // This clears libraries, zones, battlefield, stack, counters, etc.
    // but keeps the player list so replay can work with existing player IDs
    if (typeof existingGame.reset === 'function') {
      try {
        existingGame.reset(true); // preservePlayers = true
        debug(2, `[undo] Reset game state for ${gameId}`);
      } catch (resetErr) {
        debugError(1, `[undo] Reset failed for game ${gameId}:`, resetErr);
        return { success: false, error: "Failed to reset game state" };
      }
    } else {
      debugError(1, `[undo] Game ${gameId} does not have reset method`);
      return { success: false, error: "Game does not support reset" };
    }
    
    // Replay the remaining events on the SAME game context
    // This rebuilds all state including:
    // - RNG seed and state (from rngSeed event)
    // - Libraries (from deckImportResolved events)
    // - Shuffled order (from shuffleLibrary events)  
    // - Hand contents (from drawCards events)
    // - Mulligan results (from mulligan events)
    // - All other game actions
    if (remainingEvents.length > 0 && typeof existingGame.replay === 'function') {
      // Transform events from DB format to replay format using shared utility
      const replayEvents = transformDbEventsForReplay(remainingEvents);
      
      try {
        existingGame.replay(replayEvents);
        debug(2, `[undo] Replayed ${replayEvents.length} events for game ${gameId}`);
      } catch (replayErr) {
        debugError(1, `[undo] Replay failed for game ${gameId}:`, replayErr);
        return { success: false, error: "Failed to replay events" };
      }
    } else if (remainingEvents.length === 0) {
      debug(2, `[undo] No events to replay for game ${gameId} (undid all actions)`);
    }
    
    // Restore participant socket mappings if they were lost during reset
    // This ensures connected clients stay connected after undo
    try {
      if (savedParticipants.length > 0 && typeof existingGame.join === 'function') {
        // Check if participants were preserved
        const currentParticipants = typeof existingGame.participants === 'function' 
          ? existingGame.participants() 
          : [];
        
        // If participants were lost during reset, try to restore them
        if (currentParticipants.length === 0 && savedParticipants.length > 0) {
          debug(2, `[undo] Restoring ${savedParticipants.length} participant(s) for game ${gameId}`);
          for (const p of savedParticipants) {
            if (p.socketId && p.playerId) {
              try {
                existingGame.join(p.socketId, p.playerId, p.spectator, p.playerId);
              } catch (joinErr) {
                debugWarn(1, `[undo] Failed to restore participant ${p.playerId}:`, joinErr);
              }
            }
          }
        }
      }
    } catch (e) {
      debugWarn(1, '[undo] Failed to restore participants:', e);
    }
    
    try {
      const purged = reconcileCommandZoneZoneConsistency((existingGame as any)?.state);
      if (purged.removedBattlefield || purged.removedStack) {
        debugWarn(1, `[undo] Reconciled command-zone/BF ghosts for ${gameId}`, purged);
      }
    } catch (reconcileErr) {
      debugWarn(1, `[undo] reconcileCommandZoneZoneConsistency failed for ${gameId}:`, reconcileErr);
    }

    // Bump seq to trigger UI updates
    if (typeof existingGame.bumpSeq === 'function') {
      existingGame.bumpSeq();
    }

    try {
      const stateAny = (existingGame.state as any) || {};
      const turnPlayer = String(stateAny.turnPlayer || '').trim();
      const phase = String(stateAny.phase || '').toLowerCase();
      const step = String(stateAny.step || '').toUpperCase();
      const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);

      if (turnPlayer) {
        pauseHumanAutoPassUntilAction(existingGame as any, turnPlayer);
      }

      if (
        turnPlayer &&
        !pendingSummary.hasPending &&
        phase !== 'pre_game' &&
        phase !== 'pre-game' &&
        !['UNTAP', 'CLEANUP'].includes(step)
      ) {
        stateAny.priority = turnPlayer;
      }
    } catch (priorityErr) {
      debugWarn(1, `[undo] Failed to restore priority/autopass pause for game ${gameId}:`, priorityErr);
    }

    suppressAutomationOnNextBroadcast(existingGame as any);

    void import('./ai.js').then((aiModule) => {
      if (typeof aiModule.rehydrateAIGameRuntime === 'function') {
        aiModule.rehydrateAIGameRuntime(gameId, { refreshDeckProfiles: true });
      }
    }).catch((err) => {
      debugWarn(1, `[undo] Failed to rehydrate AI runtime for game ${gameId}:`, err);
    });
    
    return { success: true };
  } catch (err: any) {
    debugError(1, `[undo] performUndo failed for game ${gameId}:`, err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}

function emitUndoCountsUpdate(io: Server, gameId: string, game: any): void {
  try {
    const eventCount = getEventCount(gameId);
    const events = getEvents(gameId);
    const { stepCount, phaseCount, previousPhaseCount, turnCount, semanticStepCount, semanticPhaseCount, previews } = calculateSmartUndoCounts(game, events);

    io.to(gameId).emit('undoCountUpdate', {
      gameId,
      eventCount,
    });

    io.to(gameId).emit('smartUndoCountsUpdate', {
      gameId,
      stepCount,
      phaseCount,
      previousPhaseCount,
      turnCount,
      semanticStepCount,
      semanticPhaseCount,
      previews,
      totalCount: events.length,
    });
  } catch (err) {
    debugWarn(1, `[undo] Failed to emit updated undo counts for game ${gameId}:`, err);
  }
}

export function resumePregameAIFlowAfterUndo(io: Server, gameId: string, game: any): void {
  try {
    const phase = String((game?.state as any)?.phase || '').toLowerCase();
    if (phase !== 'pre_game' && phase !== 'pre-game' && phase !== '') {
      return;
    }

    const players = Array.isArray(game?.state?.players) ? game.state.players : [];
    for (const player of players) {
      if (!player || player.isAI !== true || player.spectator || player.isSpectator) continue;
      scheduleAIGameFlow(io, gameId, String(player.id) as any, 0);
    }
  } catch (err) {
    debugWarn(1, `[undo] Failed to resume pre-game AI flow for game ${gameId}:`, err);
  }
}

export function registerUndoHandlers(io: Server, socket: Socket) {
  const getUndoRequesterContext = (gameId: string) => {
    const playerId = socket.data.playerId;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);

    const socketGameId = (socket.data as any)?.gameId;
    if (socketGameId && socketGameId !== gameId) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    if (!socket.rooms.has(gameId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    const game = ensureGame(gameId);
    if (!game || !playerId) return null;

    if (socketIsSpectator) {
      socket.emit("error", {
        code: "SPECTATOR_CANNOT_UNDO",
        message: "Spectators cannot request undos",
      });
      return null;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
    if (!seated) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    if (seated.isSpectator || seated.spectator) {
      socket.emit("error", {
        code: "SPECTATOR_CANNOT_UNDO",
        message: "Spectators cannot request undos",
      });
      return null;
    }

    const playerIds = getPlayerIds(game);
    if (!playerIds.includes(playerId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    return { game, playerId, playerIds };
  };

  const ensureInGameRoomForRead = (gameId: string): boolean => {
    const socketGameId = (socket.data as any)?.gameId;
    if (socketGameId && socketGameId !== gameId) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return false;
    }

    if (!socket.rooms.has(gameId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return false;
    }

    return true;
  };

  const normalizeActionsToUndo = (gameId: string, raw: unknown): number | null => {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return null;
    const actionsToUndo = Math.floor(num);
    if (actionsToUndo < 1) return null;

    try {
      const eventCount = getEventCount(gameId);
      if (eventCount > 0) {
        return Math.min(actionsToUndo, eventCount);
      }
    } catch {
      // ignore; undo may fail later if DB is unavailable
    }

    return actionsToUndo;
  };

  const handleRequestUndo = (
    gameId: string,
    rawActionsToUndo: unknown,
    description?: string,
    undoScope?: 'step' | 'phase' | 'previousPhase' | 'turn',
    boundaryPreview?: UndoBoundaryPreview,
  ) => {
    // Clean up expired requests periodically
    cleanupExpiredRequests();

    const ctx = getUndoRequesterContext(gameId);
    if (!ctx) return;

    const actionsToUndo = normalizeActionsToUndo(gameId, rawActionsToUndo);
    if (!actionsToUndo) {
      socket.emit("error", {
        code: "INVALID_UNDO_COUNT",
        message: "Invalid undo count",
      });
      return;
    }

    const { game, playerId, playerIds } = ctx;
    const eventCountAtRequest = getEventCount(gameId);

    // Check if there's already a pending undo request
    const existingRequest = undoRequests.get(gameId);
    if (existingRequest && existingRequest.status === 'pending') {
      socket.emit("error", {
        code: "UNDO_PENDING",
        message: "There is already a pending undo request",
      });
      return;
    }

    const aiPlayerIds = getAIPlayerIds(game);

    // If single player, auto-approve and perform undo immediately
    if (playerIds.length === 1) {
      const undoResult = performUndo(gameId, actionsToUndo);

      if (undoResult.success) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}).`,
          ts: Date.now(),
        });

        socket.emit("undoComplete", { gameId, success: true });
        emitUndoCountsUpdate(io, gameId, game);
        broadcastGame(io, game, gameId, { forceStateReplace: true });
        resumePregameAIFlowAfterUndo(io, gameId, game);
      } else {
        socket.emit("error", {
          code: "UNDO_FAILED",
          message: undoResult.error || "Failed to perform undo",
        });
      }
      return;
    }

    // Build initial approvals: requester auto-approves, AI players auto-approve
    const initialApprovals: Record<string, boolean> = { [playerId]: true };
    for (const aiId of aiPlayerIds) {
      if (aiId !== playerId) initialApprovals[aiId] = true;
    }

    const request: UndoRequest = {
      id: generateUndoId(),
      requesterId: playerId,
      requesterName: getPlayerName(game, playerId),
      description: description || `Undo ${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}`,
      undoScope,
      actionsToUndo,
      eventCountAtRequest,
      boundaryPreview,
      createdAt: Date.now(),
      expiresAt: Date.now() + UNDO_TIMEOUT_MS,
      approvals: initialApprovals,
      status: 'pending',
    };
    const playerNames = buildPlayerNameMap(game);

    // If all approvals are already satisfied, perform immediately.
    if (checkAllApproved(request, playerIds)) {
      request.status = 'approved';
      const undoResult = performUndo(gameId, actionsToUndo);

      if (undoResult.success) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} used undo (${actionsToUndo} action${actionsToUndo > 1 ? 's' : ''}). AI opponents auto-approved.`,
          ts: Date.now(),
        });

        socket.emit("undoComplete", { gameId, success: true });
        emitUndoCountsUpdate(io, gameId, game);
        broadcastGame(io, game, gameId, { forceStateReplace: true });
        resumePregameAIFlowAfterUndo(io, gameId, game);
      } else {
        socket.emit("error", {
          code: "UNDO_FAILED",
          message: undoResult.error || "Failed to perform undo",
        });
      }
      return;
    }

    undoRequests.set(gameId, request);

    io.to(gameId).emit("undoRequest", {
      gameId,
      undoId: request.id,
      requesterId: playerId,
      requesterName: request.requesterName,
      description: request.description,
      undoScope: request.undoScope,
      actionsToUndo,
      boundaryPreview: request.boundaryPreview,
      expiresAt: request.expiresAt,
      approvals: request.approvals,
      playerIds,
      playerNames,
    });

    const aiApprovalMessage = aiPlayerIds.length > 0
      ? ` AI opponents auto-approved. Waiting for human players.`
      : ` All players must approve.`;

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${request.requesterName} requested an undo.${aiApprovalMessage}`,
      ts: Date.now(),
    });

    setTimeout(() => {
      const currentRequest = undoRequests.get(gameId);
      if (currentRequest && currentRequest.id === request.id && currentRequest.status === 'pending') {
        currentRequest.status = 'expired';

        io.to(gameId).emit("undoCancelled", {
          gameId,
          undoId: request.id,
          reason: "Request timed out",
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Undo request expired (not all players responded in time).`,
          ts: Date.now(),
        });
      }
    }, UNDO_TIMEOUT_MS);
  };

  // Request an undo
  socket.on("requestUndo", (payload?: { gameId?: unknown; actionsToUndo?: unknown }) => {
    const gameId = payload?.gameId;
    const actionsToUndo = payload?.actionsToUndo ?? 1;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      handleRequestUndo(gameId, actionsToUndo);

    } catch (err: any) {
      debugError(1, `requestUndo error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "UNDO_REQUEST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Respond to an undo request
  socket.on("respondUndo", (payload?: { gameId?: unknown; undoId?: unknown; approved?: unknown }) => {
    const gameId = payload?.gameId;
    const undoId = payload?.undoId;
    const approved = payload?.approved;

    try {
      if (!gameId || typeof gameId !== 'string' || typeof undoId !== 'string' || typeof approved !== 'boolean') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid undo response payload.' });
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if (socketGameId && socketGameId !== gameId) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      if (!socket.rooms.has(gameId)) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check if player is not a spectator
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (socketIsSpectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_RESPOND",
          message: "Spectators cannot respond to undo requests",
        });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      if (!seated) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      if (seated.isSpectator || seated.spectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_RESPOND",
          message: "Spectators cannot respond to undo requests",
        });
        return;
      }

      const playerIds = getPlayerIds(game);
      if (!playerIds.includes(playerId)) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      const request = undoRequests.get(gameId);
      if (!request || request.id !== undoId) {
        socket.emit("error", {
          code: "INVALID_UNDO_REQUEST",
          message: "Invalid or expired undo request",
        });
        return;
      }

      if (request.status !== 'pending') {
        socket.emit("error", {
          code: "UNDO_NOT_PENDING",
          message: "Undo request is no longer pending",
        });
        return;
      }

      // Record the response
      request.approvals[playerId] = approved;
      const playerName = getPlayerName(game, playerId);

      // Check if rejected
      if (!approved) {
        request.status = 'rejected';

        io.to(gameId).emit("undoCancelled", {
          gameId,
          undoId: request.id,
          reason: `${playerName} declined the undo request`,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Undo request declined by ${playerName}.`,
          ts: Date.now(),
        });

        return;
      }

      // Notify of approval
      io.to(gameId).emit("undoUpdate", {
        gameId,
        undoId: request.id,
        approvals: request.approvals,
        playerIds,
      });

      // Check if all approved
      if (checkAllApproved(request, playerIds)) {
        request.status = 'approved';

        // Actually perform the undo by replaying events
        const undoResult = performUndo(gameId, request.actionsToUndo, request.eventCountAtRequest);

        if (undoResult.success) {
          io.to(gameId).emit("undoConfirmed", {
            gameId,
            undoId: request.id,
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Undo approved by all players! ${request.description} undone.`,
            ts: Date.now(),
          });

          emitUndoCountsUpdate(io, gameId, game);
          broadcastGame(io, game, gameId, { forceStateReplace: true });
          resumePregameAIFlowAfterUndo(io, gameId, game);
        } else {
          io.to(gameId).emit("undoCancelled", {
            gameId,
            undoId: request.id,
            reason: undoResult.error || "Failed to perform undo",
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Undo failed: ${undoResult.error || "Unknown error"}`,
            ts: Date.now(),
          });
        }
      } else {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${playerName} approved the undo request.`,
          ts: Date.now(),
        });
      }
    } catch (err: any) {
      debugError(1, `respondUndo error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "UNDO_RESPONSE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  socket.on('disconnect', () => {
    const gameId = typeof (socket.data as any)?.gameId === 'string' ? String((socket.data as any).gameId) : '';
    const playerId = typeof (socket.data as any)?.playerId === 'string' ? String((socket.data as any).playerId) : '';
    if (!gameId || !playerId) {
      return;
    }

    const request = undoRequests.get(gameId);
    if (!request || request.status !== 'pending') {
      return;
    }

    cancelPendingUndoRequest(io, gameId, `${playerId} disconnected while the undo request was pending`);
  });

  // Cancel an undo request (by the requester)
  socket.on("cancelUndo", (payload?: { gameId?: unknown; undoId?: unknown }) => {
    const gameId = payload?.gameId;
    const undoId = payload?.undoId;
    try {
      if (!gameId || typeof gameId !== 'string' || typeof undoId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid cancel undo payload.' });
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if (socketGameId && socketGameId !== gameId) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      if (!socket.rooms.has(gameId)) {
        socket.emit("error", { code: "NOT_IN_GAME", message: "You are not in this game" });
        return;
      }

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (socketIsSpectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_CANCEL",
          message: "Spectators cannot cancel undo requests",
        });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      if (!seated) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      if (seated.isSpectator || seated.spectator) {
        socket.emit("error", {
          code: "SPECTATOR_CANNOT_CANCEL",
          message: "Spectators cannot cancel undo requests",
        });
        return;
      }

      const playerIds = getPlayerIds(game);
      if (!playerIds.includes(playerId)) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "You are not in this game",
        });
        return;
      }

      const request = undoRequests.get(gameId);
      if (!request || request.id !== undoId) {
        return;
      }

      // Only requester can cancel
      if (request.requesterId !== playerId) {
        socket.emit("error", {
          code: "NOT_REQUESTER",
          message: "Only the requester can cancel an undo request",
        });
        return;
      }

      if (request.status !== 'pending') {
        return;
      }

      request.status = 'cancelled';

      io.to(gameId).emit("undoCancelled", {
        gameId,
        undoId: request.id,
        reason: "Cancelled by requester",
      });

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${request.requesterName} cancelled their undo request.`,
        ts: Date.now(),
      });
    } catch (err: any) {
      debugError(1, `cancelUndo error for game ${gameId}:`, err);
    }
  });

  // Get available undo count (number of events that can be undone)
  socket.on("getUndoCount", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let eventCount = 0;
      try {
        eventCount = getEventCount(gameId);
      } catch (e) {
        debugWarn(1, `[getUndoCount] Failed to get event count for game ${gameId}:`, e);
      }

      socket.emit("undoCountUpdate", {
        gameId,
        eventCount,
      });
    } catch (err: any) {
      debugError(1, `getUndoCount error for game ${gameId}:`, err);
    }
  });

  // Get smart undo counts (step, phase, previous phase, turn)
  socket.on("getSmartUndoCounts", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[getSmartUndoCounts] Failed to get events for game ${gameId}:`, e);
      }

      const { stepCount, phaseCount, previousPhaseCount, turnCount, semanticStepCount, semanticPhaseCount, previews } = calculateSmartUndoCounts(game, events);

      socket.emit("smartUndoCountsUpdate", {
        gameId,
        stepCount,
        phaseCount,
        previousPhaseCount,
        turnCount,
        semanticStepCount,
        semanticPhaseCount,
        previews,
        totalCount: events.length,
      });
    } catch (err: any) {
      debugError(1, `getSmartUndoCounts error for game ${gameId}:`, err);
    }
  });

  // Request undo to step (convenience wrapper)
  socket.on("requestUndoToStep", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToStep] Failed to get events:`, e);
        return;
      }

      const { stepCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo current step', 'step', previews.step);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToStep error for game ${gameId}:`, err);
    }
  });

  // Request undo to phase (convenience wrapper)
  socket.on("requestUndoToPhase", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToPhase] Failed to get events:`, e);
        return;
      }

      const { phaseCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo current phase', 'phase', previews.phase);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToPhase error for game ${gameId}:`, err);
    }
  });

  // Request undo to previous phase (convenience wrapper)
  socket.on("requestUndoToPreviousPhase", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToPreviousPhase] Failed to get events:`, e);
        return;
      }

      const { previousPhaseCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo to previous phase', 'previousPhase', previews.previousPhase);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToPreviousPhase error for game ${gameId}:`, err);
    }
  });

  // Request undo to turn (convenience wrapper)
  socket.on("requestUndoToTurn", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      let events: Array<{ type: string; payload?: any }> = [];
      try {
        events = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[requestUndoToTurn] Failed to get events:`, e);
        return;
      }

      const { turnCount: actionsToUndo, previews } = calculateSmartUndoCounts(ctx.game, events);
      if (actionsToUndo > 0) {
        handleRequestUndo(gameId, actionsToUndo, 'Undo current turn', 'turn', previews.turn);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToTurn error for game ${gameId}:`, err);
    }
  });
  socket.on("getUndoTurnPhaseTargets", (payload?: { gameId?: unknown; includeSteps?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (!ensureInGameRoomForRead(gameId)) return;
      const game = ensureGame(gameId);
      if (!game) return;

      let events: PersistedEvent[] = [];
      try {
        events = getEvents(gameId) as PersistedEvent[];
      } catch (e) {
        debugWarn(1, `[getUndoTurnPhaseTargets] Failed to get events for game ${gameId}:`, e);
      }

      const includeSteps = payload?.includeSteps !== false;
      const targets = listUndoTurnPhaseTargets(game, events, { includeSteps, limit: 200 });
      socket.emit("undoTurnPhaseTargetsUpdate", {
        gameId,
        targets,
      });
    } catch (err: any) {
      debugError(1, `getUndoTurnPhaseTargets error for game ${gameId}:`, err);
    }
  });

  socket.on("requestUndoToTurnPhase", (payload?: {
    gameId?: unknown;
    turnNumber?: unknown;
    phase?: unknown;
    step?: unknown;
  }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing gameId.' });
        return;
      }
      const ctx = getUndoRequesterContext(gameId);
      if (!ctx) return;

      const phase = typeof payload?.phase === 'string' ? payload.phase.trim() : '';
      if (!phase) {
        socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Missing phase.' });
        return;
      }
      const turnNumberRaw = Number(payload?.turnNumber);
      const turnNumber = Number.isFinite(turnNumberRaw) && turnNumberRaw > 0 ? turnNumberRaw : undefined;
      const step = typeof payload?.step === 'string' && payload.step.trim() ? payload.step.trim() : undefined;

      let events: PersistedEvent[] = [];
      try {
        events = getEvents(gameId) as PersistedEvent[];
      } catch (e) {
        debugWarn(1, `[requestUndoToTurnPhase] Failed to get events:`, e);
        return;
      }

      const { actionsToUndo, preview } = resolveUndoToTurnPhaseCount(ctx.game, events, {
        turnNumber,
        phase,
        step,
      });
      if (actionsToUndo > 0) {
        const label = preview?.summary
          ? `Undo to ${preview.summary}`
          : `Undo to turn ${turnNumber ?? '?'} / ${phase}`;
        handleRequestUndo(gameId, actionsToUndo, label, undefined, preview);
      }
    } catch (err: any) {
      debugError(1, `requestUndoToTurnPhase error for game ${gameId}:`, err);
    }
  });

}

