/**
 * AI decision trace sink.
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-4).
 * Public entry symbols: DecisionTrace, recordDecision, setAIDecisionTraceSink,
 * resetAIDecisionTrace.
 *
 * Off by default. AI_TRACE_FILE=<path> appends one JSON line per decision.
 * Tests can capture records with setAIDecisionTraceSink.
 * Tracing must not touch RNG, timers, or game state.
 */

import { appendFileSync } from 'node:fs';
import type { PlayerID } from '../../../../shared/src/types.js';

export interface DecisionTraceCandidate {
  kind: string;
  name?: string;
  score: number;
}

export interface DecisionTrace {
  v: 1;
  gameId: string;
  seq: number;
  turn: number;
  phase: string;
  step?: string;
  seat: PlayerID;
  kind: 'priority' | 'response' | 'attack' | 'block' | 'mulligan';
  candidates: DecisionTraceCandidate[];
  /** Index that made progress; null means pass / no progress. */
  chosen: number | null;
  note?: string;
  /** Elapsed ms for planners (Phase 2); optional. */
  ms?: number;
  /** Shadow / v1 comparison payload (Phase 1); optional. */
  shadow?: {
    brain: 'shadow' | 'v1';
    winProb: Record<string, number>;
    scores: Array<{
      v0Index: number;
      score: number;
      dropped: boolean;
      parts: Record<string, number>;
    }>;
  };
}

type DecisionTraceSink = (record: DecisionTrace) => void;

let seq = 0;
let sink: DecisionTraceSink | null = null;
let filePath: string | null = null;
let envChecked = false;

function ensureEnvSink(): void {
  if (envChecked) return;
  envChecked = true;
  const path = process.env.AI_TRACE_FILE;
  if (path && String(path).trim()) {
    filePath = String(path).trim();
  }
}

function defaultFileSink(record: DecisionTrace): void {
  if (!filePath) return;
  try {
    appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  } catch {
    // Tracing must never break a game.
  }
}

/** Install a custom sink (tests). Pass null to clear. */
export function setAIDecisionTraceSink(fn: DecisionTraceSink | null): void {
  sink = fn;
}

/** Reset sequence and sink state between tests / harness runs. */
export function resetAIDecisionTrace(): void {
  seq = 0;
  sink = null;
  filePath = null;
  envChecked = false;
}

/**
 * Record one decision. No-ops when no sink and AI_TRACE_FILE is unset.
 * Never throws into the decision loop.
 */
export function recordDecision(
  partial: Omit<DecisionTrace, 'v' | 'seq'> & { seq?: number },
): void {
  try {
    ensureEnvSink();
    if (!sink && !filePath) return;
    const record: DecisionTrace = {
      v: 1,
      seq: partial.seq ?? (++seq),
      gameId: partial.gameId,
      turn: partial.turn,
      phase: partial.phase,
      seat: partial.seat,
      kind: partial.kind,
      candidates: partial.candidates,
      chosen: partial.chosen,
    };
    if (partial.step != null && partial.step !== '') record.step = partial.step;
    if (partial.note != null) record.note = partial.note;
    if (partial.ms != null) record.ms = partial.ms;
    if (partial.shadow !== undefined) record.shadow = partial.shadow;
    if (sink) sink(record);
    else defaultFileSink(record);
  } catch {
    // ignore
  }
}

/** Summarize AIActionCandidate[] for a trace line (priority order as tried). */
export function candidatesFromAIActionList(candidates: readonly any[]): DecisionTraceCandidate[] {
  return (candidates || []).map((c) => {
    let name: string | undefined;
    if (c?.kind === 'cast_spell') {
      name = String(c.spell?.castCard?.name || c.spell?.card?.name || '') || undefined;
    } else if (c?.kind === 'cast_commander') {
      name = String(c.commander?.card?.name || '') || undefined;
    } else if (c?.kind === 'activate_ability') {
      name = String(c.ability?.action?.cardName || c.ability?.action?.permanentId || '') || undefined;
    } else if (c?.kind === 'play_land') {
      name = String(c.land?.card?.name || '') || undefined;
    }
    const entry: DecisionTraceCandidate = {
      kind: String(c?.kind || 'unknown'),
      score: Number(c?.priority) || 0,
    };
    if (name) entry.name = name;
    return entry;
  });
}

/** Common fields from a live game.state for a trace record. */
export function traceContextFromGame(
  game: any,
  gameId: string,
  seat: PlayerID,
): Pick<DecisionTrace, 'gameId' | 'turn' | 'phase' | 'step' | 'seat'> {
  const state = game?.state || {};
  const ctx: Pick<DecisionTrace, 'gameId' | 'turn' | 'phase' | 'step' | 'seat'> = {
    gameId: String(gameId),
    turn: Number(state.turnNumber ?? state.turn ?? 0) || 0,
    phase: String(state.phase || ''),
    seat,
  };
  if (state.step != null && state.step !== '') ctx.step = String(state.step);
  return ctx;
}
