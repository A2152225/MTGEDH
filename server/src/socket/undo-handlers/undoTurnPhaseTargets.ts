// server/src/socket/undo-handlers/undoTurnPhaseTargets.ts
// Origin parent: server/src/socket/undo.ts
// Cluster moved: the "jump back to an earlier turn/phase/step" picker layer -
// seat/turn-order lookups, display round math, historical turn-player inference,
// target labels and dedupe keys, the contiguous-segment target list, and the
// resolver that turns a picked target back into an undo event count.
// Public entry symbols: UndoTurnPhaseTarget, listUndoTurnPhaseTargets,
//   resolveUndoToTurnPhaseCount, buildPlayerNameMap.
// undo.ts re-exports UndoTurnPhaseTarget and listUndoTurnPhaseTargets so the
// "./undo.js" import path keeps working.

import {
  boundaryHistoryHasKey,
  buildBoundaryHistoryFromPersistedMetadata,
  buildBoundaryHistoryFromReplay,
  buildUndoBoundaryPreview,
  getBoundaryKey,
  humanizeBoundaryToken,
  normalizePhaseToken,
  normalizeStepToken,
  phaseOrderRank,
  stepOrderRank,
} from "./undoBoundaryPlanning.js";
import type { BoundaryKind, PersistedEvent, UndoBoundaryPreview } from "./undoBoundaryPlanning.js";

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

  const liveKey = getBoundaryKey((game?.state || {}) as any, kind);
  let history = buildBoundaryHistoryFromPersistedMetadata(events, kind);
  let eventCount = events.length;
  if (!history || !boundaryHistoryHasKey(history, liveKey)) {
    const replayed = buildBoundaryHistoryFromReplay(events, game, kind);
    history = replayed.history;
    eventCount = replayed.eventCount;
  }
  if (!history.length) return [];

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

export function resolveUndoToTurnPhaseCount(
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

export function buildPlayerNameMap(game: any): Record<string, string> {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const playerNames: Record<string, string> = {};
  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    playerNames[playerId] = String(player?.name || playerId);
  }
  return playerNames;
}
