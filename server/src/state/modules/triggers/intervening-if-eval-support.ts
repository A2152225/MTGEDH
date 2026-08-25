/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: intervening-if result symbols/types, refs helpers, day/night status
 * Public: UNMATCHED_INTERVENING_IF, FALLBACK_INTERVENING_IF, InterveningIfInternalResult,
 * InterveningIfEvaluation, InterveningIfRefs, getInterveningIfTargetCount,
 * getDefendingPlayerIdForInterveningIf, attachInterveningIfRefs, getDayNightStatusForInterveningIf,
 * getTriggeringStackItemForInterveningIf, InterveningIfPhaseArgs
 */

import type { GameContext } from "../context.js";

/**
 * Evaluates a subset of common intervening-if conditions.
 *
 * Returns:
 * - `true`  => condition recognized and satisfied
 * - `false` => condition recognized and NOT satisfied
 * - `null`  => condition recognized but cannot be evaluated from current tracked state
 */
const UNMATCHED_INTERVENING_IF = Symbol('intervening-if:unmatched');
const FALLBACK_INTERVENING_IF = Symbol('intervening-if:fallback');
type InterveningIfInternalResult =
  | boolean
  | null
  | typeof UNMATCHED_INTERVENING_IF
  | typeof FALLBACK_INTERVENING_IF;

export type InterveningIfEvaluation = {
  matched: boolean;
  value: boolean | null;
  fallback?: boolean;
};

export type InterveningIfRefs = {
  thatPlayerId?: string;
  referencedPlayerId?: string;
  theirPlayerId?: string;

  // Combat context (e.g., for "if you're the defending player" / "if defending player ...")
  defendingPlayerId?: string;

  // Event-group context for templates like "...of those creatures...".
  // For declare-attackers-trigger evaluation, this should be the list of attacker permanent ids involved in the event.
  thoseCreatureIds?: string[];

  // Optional context for clauses that refer to an activated ability/spell/stack item.
  // Example: "Whenever you activate an ability, if it isn't a mana ability, ..."
  activatedAbilityIsManaAbility?: boolean;
  triggeringStackItemId?: string;
  stackItem?: { type?: string; isManaAbility?: boolean; targets?: any[]; target?: any; targetId?: any };

  // Best-effort extensibility: many clause evaluators use optional per-event refs.
  // Keeping this permissive allows call sites to pass additional context without casts.
  [key: string]: unknown;
};

function getTargetCountFromStackItemLike(stackItem: any): number | null {
  if (!stackItem) return null;
  const targets = (stackItem as any).targets;
  if (Array.isArray(targets)) return targets.length;
  if ((stackItem as any).target != null) return 1;
  if ((stackItem as any).targetId != null) return 1;
  return null;
}

function getInterveningIfTargetCount(ctx: GameContext, refs?: InterveningIfRefs, sourcePermanent?: any): number | null {
  const fromRefs = getTargetCountFromStackItemLike(refs?.stackItem);
  if (typeof fromRefs === 'number') return fromRefs;

  const stackId =
    refs?.triggeringStackItemId ??
    (sourcePermanent as any)?.triggeringStackItemId ??
    (sourcePermanent as any)?.triggeringSpellStackItemId;

  if (!stackId) return null;
  const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
  const triggering = stack.find((it: any) => it && String(it.id) === String(stackId));
  return getTargetCountFromStackItemLike(triggering);
}

function getDefendingPlayerIdForInterveningIf(sourcePermanent: any, refs?: InterveningIfRefs): string | null {
  const fromRefs = refs?.defendingPlayerId ?? (sourcePermanent as any)?.defendingPlayerId;
  if (typeof fromRefs === 'string' && fromRefs) return String(fromRefs);

  // Many combat structures store the defending player as attacker.attacking.
  const fromAttacking = (sourcePermanent as any)?.attacking;
  if (typeof fromAttacking === 'string' && fromAttacking && !String(fromAttacking).startsWith('perm_')) return String(fromAttacking);

  return null;
}

function attachInterveningIfRefs(sourcePermanent: any, refs?: InterveningIfRefs): any {
  if (!refs) return sourcePermanent;

  const thatPlayerId = refs.thatPlayerId;
  const referencedPlayerId = refs.referencedPlayerId;
  const theirPlayerId = refs.theirPlayerId;
  const defendingPlayerId = refs.defendingPlayerId;

  if (!thatPlayerId && !referencedPlayerId && !theirPlayerId && !defendingPlayerId) return sourcePermanent;

  const existing = sourcePermanent || {};
  const next: any = { ...existing };

  if (next.thatPlayerId == null && thatPlayerId) next.thatPlayerId = thatPlayerId;
  if (next.referencedPlayerId == null && referencedPlayerId) next.referencedPlayerId = referencedPlayerId;
  if (next.theirPlayerId == null && theirPlayerId) next.theirPlayerId = theirPlayerId;
  if (next.defendingPlayerId == null && defendingPlayerId) next.defendingPlayerId = defendingPlayerId;

  return next;
}

type DayNightStatusForInterveningIf = 'day' | 'night' | 'neither';

function getDayNightStatusForInterveningIf(ctx: GameContext): DayNightStatusForInterveningIf | null {
  const stateAny = (ctx as any).state as any;

  // Prefer authoritative `state.dayNight` but support several legacy aliases / shapes.
  const candidates: unknown[] = [
    stateAny?.dayNight,
    stateAny?.day_night,
    stateAny?.dayNightState,
    stateAny?.dayNight?.state,
    stateAny?.dayNight?.value,
    stateAny?.dayNight?.current,
  ];

  for (const cand of candidates) {
    if (typeof cand !== 'string') continue;
    const v = String(cand).toLowerCase();
    if (v === 'day' || v === 'night') return v;
    if (v === 'neither' || v === 'none') return 'neither';
  }

  // Legacy boolean flags.
  const isDay = stateAny?.isDay;
  const isNight = stateAny?.isNight;
  if (typeof isDay === 'boolean' && typeof isNight === 'boolean') {
    if (isDay && !isNight) return 'day';
    if (!isDay && isNight) return 'night';
    if (!isDay && !isNight) return 'neither';
    return null;
  }

  // Best-effort inference from battlefield face text.
  // If the engine has correctly applied transforms, daybound should only appear during day,
  // and nightbound should only appear during night.
  const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];
  let sawDaybound = false;
  let sawNightbound = false;
  for (const perm of battlefield) {
    const oracle = String(perm?.card?.oracle_text || '').toLowerCase();
    if (!sawDaybound && oracle.includes('daybound')) sawDaybound = true;
    if (!sawNightbound && oracle.includes('nightbound')) sawNightbound = true;
    if (sawDaybound && sawNightbound) break;
  }
  if (sawDaybound && !sawNightbound) return 'day';
  if (sawNightbound && !sawDaybound) return 'night';

  return null;
}

function getTriggeringStackItemForInterveningIf(
  ctx: GameContext,
  sourcePermanent?: any,
  refs?: InterveningIfRefs,
): any | null {
  const fromRefs = (refs as any)?.stackItem;
  if (fromRefs) return fromRefs;

  const stackId =
    refs?.triggeringStackItemId ??
    (sourcePermanent as any)?.triggeringStackItemId ??
    (sourcePermanent as any)?.triggeringSpellStackItemId;
  if (!stackId) return null;
  const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
  return stack.find((it: any) => it && String(it.id) === String(stackId)) ?? null;
}


export {
  UNMATCHED_INTERVENING_IF,
  FALLBACK_INTERVENING_IF,
  getInterveningIfTargetCount,
  getDefendingPlayerIdForInterveningIf,
  attachInterveningIfRefs,
  getDayNightStatusForInterveningIf,
  getTriggeringStackItemForInterveningIf,
};
export type { InterveningIfInternalResult };

export type InterveningIfPhaseArgs = {
  ctx: GameContext;
  controllerId: string;
  clause: string;
  sourcePermanent: any;
  refs?: InterveningIfRefs;
  evaluateRest: (
    ctx: GameContext,
    controllerId: string,
    clauseText: string,
    sourcePermanent?: any,
    refs?: InterveningIfRefs,
  ) => InterveningIfInternalResult;
};
