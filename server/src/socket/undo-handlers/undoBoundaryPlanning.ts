// server/src/socket/undo-handlers/undoBoundaryPlanning.ts
// Origin parent: server/src/socket/undo.ts
// Cluster moved: the boundary-detection and undo-planning layer - persisted event
// shapes, semantic action counting (IR mutation / prompt-only tail collapsing),
// phase/step token normalization and ordering, boundary keys and snapshots,
// boundary history construction (persisted metadata or replay probe), and the
// step/phase/previous-phase/turn smart undo counts.
// Public entry symbols: countSemanticActions, calculateSmartUndoCounts,
//   calculateBoundaryUndoCount, buildUndoBoundaryPreview, buildBoundaryHistoryFromPersistedMetadata,
//   buildBoundaryHistoryFromReplay, resolveBoundaryHistoryForUndo, boundaryHistoryHasKey, getBoundaryKey,
//   normalizePhaseToken, normalizeStepToken, phaseOrderRank, stepOrderRank,
//   humanizeBoundaryToken, snapshotBoundaryState, sliceEventsForBoundaryPlan.
// undo.ts re-exports countSemanticActions so the "./undo.js" import path keeps working.

import { transformDbEventsForReplay } from "../util.js";
import { createContext } from "../../state/context.js";
import { replay as replayOnContext } from "../../state/modules/applyEvent.js";
import { debugWarn } from "../../utils/debug.js";

export type PersistedEvent = {
  type: string;
  payload?: any;
  turnNumber?: number;
  phase?: string;
  step?: string;
};

export type BoundaryStateSnapshot = {
  turnNumber?: number;
  phase?: string;
  step?: string;
  turnPlayer?: string;
};

export type UndoBoundaryPreview = BoundaryStateSnapshot & {
  summary: string;
};

export type UndoBoundaryPlan = {
  count: number;
  boundaryState?: BoundaryStateSnapshot;
};

export type SmartUndoCounts = {
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

export function sliceEventsForBoundaryPlan(events: PersistedEvent[], plan: UndoBoundaryPlan | undefined): PersistedEvent[] {
  const count = Math.max(0, Number(plan?.count || 0));
  if (count <= 0 || events.length === 0) return [];
  return events.slice(Math.max(0, events.length - count));
}

export type BoundaryKind = 'step' | 'phase' | 'turn';

/** Higher = later in the turn (Ending > Postcombat > Combat > Precombat > Beginning). */
export function phaseOrderRank(phase: unknown): number {
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
export function stepOrderRank(step: unknown): number {
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
export function normalizePhaseToken(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!raw) return 'unknown';
  if (raw === 'pre_game' || raw === 'pregame') return 'pre_game';
  if (raw === 'main1' || raw === 'precombat_main' || raw === 'precombatmain') return 'precombatmain';
  if (raw === 'main2' || raw === 'postcombat_main' || raw === 'postcombatmain') return 'postcombatmain';
  if (raw === 'beginning' || raw === 'combat' || raw === 'ending') return raw;
  return raw.replace(/_/g, '');
}

/** Canonical step keys so beginCombat / BEGIN_COMBAT / begin_combat share one bucket. */
export function normalizeStepToken(value: unknown): string {
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
export function getBoundaryKey(stateAny: any, kind: BoundaryKind): string {
  const turnKey = getTurnBoundaryKey(stateAny);
  if (kind === 'turn') return turnKey;

  const phase = normalizePhaseToken(stateAny?.phase);
  const phaseKey = `${turnKey}|phase:${phase}`;
  if (kind === 'phase') return phaseKey;

  const step = normalizeStepToken(stateAny?.step);
  return `${phaseKey}|step:${step}`;
}

export function snapshotBoundaryState(stateAny: any): BoundaryStateSnapshot | undefined {
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

export function humanizeBoundaryToken(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildUndoBoundaryPreview(state: BoundaryStateSnapshot | undefined): UndoBoundaryPreview | undefined {
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

export type BoundaryHistoryEntry = {
  key: string;
  entryIndex: number;
  state?: BoundaryStateSnapshot;
};

/**
 * Scan events into contiguous boundary segments. Entry indices are stored per
 * history slot (not overwritten by key) so revisited phases (extra combat) and
 * turn/phase jump targets keep the correct chunk start after restart.
 */
export function buildBoundaryHistoryFromPersistedMetadata(
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
    // Ignore turn regressions: replayAsync yields let concurrent auto-pass/AI append
    // rows stamped with mid-restore turns. Those tails made history end on an old
    // boundary (e.g. turn 25) while live state was later (turn 30 MAIN1).
    if (
      typeof carriedState?.turnNumber === 'number' &&
      typeof rawState?.turnNumber === 'number' &&
      rawState.turnNumber < carriedState.turnNumber
    ) {
      continue;
    }
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

export function boundaryHistoryHasKey(history: BoundaryHistoryEntry[] | undefined, key: string): boolean {
  if (!history || !key) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.key === key) return true;
  }
  return false;
}

export function buildBoundaryHistoryFromReplay(
  events: PersistedEvent[],
  game: any,
  boundaryKind: BoundaryKind,
): { history: BoundaryHistoryEntry[]; eventCount: number } {
  const replayEvents = transformDbEventsForReplay(events as any);
  // Scratch id must stay distinct from the live table (`game_mt9pcfvk` vs
  // `undo_probe_game_mt9pcfvk`). ensureGame / resolution handlers ignore this prefix.
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

type UndoBoundaryHistoryCache = {
  eventCount: number;
  lastEventType: string;
  byKind: Partial<Record<BoundaryKind, BoundaryHistoryEntry[]>>;
};

const undoBoundaryProbeCache = new WeakMap<object, UndoBoundaryHistoryCache>();

function getCachedProbeHistory(
  game: any,
  eventCount: number,
  lastEventType: string,
  kind: BoundaryKind,
): BoundaryHistoryEntry[] | undefined {
  if (!game || typeof game !== 'object') return undefined;
  const cached = undoBoundaryProbeCache.get(game);
  if (!cached || cached.eventCount !== eventCount || cached.lastEventType !== lastEventType) {
    return undefined;
  }
  return cached.byKind[kind];
}

function setCachedProbeHistories(
  game: any,
  eventCount: number,
  lastEventType: string,
  byKind: Record<BoundaryKind, BoundaryHistoryEntry[]>,
): void {
  if (!game || typeof game !== 'object') return;
  undoBoundaryProbeCache.set(game, { eventCount, lastEventType, byKind });
}

function attachLiveBoundaryIfMissing(
  history: BoundaryHistoryEntry[],
  liveBoundaryKey: string,
  liveState: any,
  lastEventIndex: number,
): BoundaryHistoryEntry[] {
  if (!liveBoundaryKey || boundaryHistoryHasKey(history, liveBoundaryKey)) {
    return history;
  }
  return [
    ...history,
    {
      key: liveBoundaryKey,
      entryIndex: Math.max(0, lastEventIndex),
      state: snapshotBoundaryState(liveState),
    },
  ];
}

function probeAllBoundaryKinds(
  events: PersistedEvent[],
  game: any,
): Record<BoundaryKind, BoundaryHistoryEntry[]> {
  const replayEvents = transformDbEventsForReplay(events as any);
  const scratch = createContext(`undo_probe_${game?.gameId || 'game'}` as any);
  const kinds: BoundaryKind[] = ['step', 'phase', 'turn'];
  const histories = {} as Record<BoundaryKind, BoundaryHistoryEntry[]>;
  const previousKeys: Record<BoundaryKind, string> = {} as Record<BoundaryKind, string>;

  for (const kind of kinds) {
    const initialState = snapshotBoundaryState((scratch as any).state || {});
    previousKeys[kind] = getBoundaryKey((scratch as any).state || {}, kind);
    histories[kind] = [{
      key: previousKeys[kind],
      entryIndex: -1,
      state: initialState,
    }];
  }

  replayOnContext(scratch as any, replayEvents as any, (replayCtx, _event, index) => {
    for (const kind of kinds) {
      const nextKey = getBoundaryKey((replayCtx as any).state || {}, kind);
      if (nextKey !== previousKeys[kind]) {
        histories[kind].push({
          key: nextKey,
          entryIndex: index,
          state: snapshotBoundaryState((replayCtx as any).state || {}),
        });
        previousKeys[kind] = nextKey;
      }
    }
  });

  return histories;
}

/**
 * Prefer stamped event metadata (already stored on each persisted row). If
 * nextStep was recorded before apply, the live step can be one ahead of the
 * last stamp — attach live state instead of replaying the whole log. Probe
 * only when the log has no usable stamps, and cache that probe per game.
 */
export function resolveBoundaryHistoryForUndo(
  events: PersistedEvent[],
  game: any,
  kind: BoundaryKind,
): { history: BoundaryHistoryEntry[]; eventCount: number } {
  const eventCount = Array.isArray(events) ? events.length : 0;
  if (eventCount <= 0) {
    return { history: [], eventCount: 0 };
  }

  const liveState = (game?.state || {}) as any;
  const liveKey = getBoundaryKey(liveState, kind);
  const persisted = buildBoundaryHistoryFromPersistedMetadata(events, kind);
  if (persisted) {
    const history = liveKey
      ? attachLiveBoundaryIfMissing(persisted, liveKey, liveState, eventCount - 1)
      : persisted;
    return { history, eventCount };
  }

  const lastEventType = String(events[eventCount - 1]?.type || '');
  const cached = getCachedProbeHistory(game, eventCount, lastEventType, kind);
  if (cached) {
    return { history: cached, eventCount };
  }

  const probed = probeAllBoundaryKinds(events, game);
  const byKind = {} as Record<BoundaryKind, BoundaryHistoryEntry[]>;
  for (const probedKind of ['step', 'phase', 'turn'] as BoundaryKind[]) {
    const probedLiveKey = getBoundaryKey(liveState, probedKind);
    byKind[probedKind] = probedLiveKey
      ? attachLiveBoundaryIfMissing(probed[probedKind], probedLiveKey, liveState, eventCount - 1)
      : probed[probedKind];
  }
  setCachedProbeHistories(game, eventCount, lastEventType, byKind);
  return { history: byKind[kind], eventCount };
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

export function calculateBoundaryUndoCount(
  events: PersistedEvent[],
  game: any,
  boundaryKind: BoundaryKind,
  boundaryOffset = 0,
): UndoBoundaryPlan {
  if (events.length === 0) return { count: 0 };

  const currentState = (game?.state || {}) as any;
  const liveBoundaryKey = getBoundaryKey(currentState, boundaryKind);
  if (!liveBoundaryKey) return { count: 0 };

  const { history, eventCount } = resolveBoundaryHistoryForUndo(events, game, boundaryKind);
  return planFromBoundaryHistory(history, eventCount, liveBoundaryKey, boundaryOffset);
}

export function calculateSmartUndoCounts(game: any, events: PersistedEvent[]): SmartUndoCounts {
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
