/**
 * Planar die special action (CR 901.9): the active player may roll the planar die any time they
 * have priority in a main phase with an empty stack. The first roll each turn is free; each later
 * roll costs generic mana equal to the number of times they already took this action that turn.
 *
 * Origin: new module (the planar die effects themselves live in planarDie.ts / planechaseRuntime.ts).
 * Public: canTakePlanarDieAction, getPlanarDieActionCost, performPlanarDieSpecialAction,
 * applyPlanarDieRollSnapshot.
 *
 * Persistence (replay rule): `performPlanarDieSpecialAction` appends ONE `planarDieRoll` event that
 * carries the face, the generic cost paid and the per-turn counter. Replay restores the counter,
 * pays the same cost from the pool and records the roll history, but never re-rolls and never
 * re-applies the face: a planeswalk is saved by its own `planeswalk` snapshot event and chaos
 * triggers by their own `pushTriggeredAbility` events. The counter resets in nextTurn
 * (turnNextTurnStartOfTurn.ts).
 */
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import type { GameContext } from '../context.js';
import { resolveManaCostForPoolPayment } from '../../socket/util-handlers/manaPoolCostPayment.js';
import { consumeManaFromPool } from '../../socket/util-handlers/consumeManaFromPool.js';
import { getOrInitManaPool } from '../../socket/util-handlers/manaPoolStateOperations.js';
import { getActivePlaneCard } from './commandZoneAbilitySources.js';
import { isChaosPlanarDieFace } from './ichorPlanarDiceChoice.js';
import { pickPlanarDieFace, rollPlanarDie, type PlanarDieFace } from './planarDie.js';
import { isPlanechaseEnabled } from './planechaseRuntime.js';

// Plain optional fields rather than discriminated unions: the server compiles without
// strictNullChecks, where `!result.ok` does not narrow a union. `ok: true` always carries
// `cost` (and `face` / `actionsThisTurn` for an action); `ok: false` always carries `reason`.
export type PlanarDieEligibility = { ok: boolean; cost?: number; reason?: string };

export type PlanarDieActionResult = {
  ok: boolean;
  reason?: string;
  face?: PlanarDieFace;
  cost?: number;
  actionsThisTurn?: number;
};

const FACE_LABELS: Record<PlanarDieFace, string> = {
  chaos: 'chaos',
  planeswalk: 'the Planeswalker symbol',
  blank: 'a blank face',
};

/** Chat line for a successful roll. Shared by the socket handler and the AI action. */
export function planarDieRollAnnouncement(playerName: string, result: PlanarDieActionResult): string {
  const costNote = (result.cost ?? 0) > 0 ? ` (paid {${result.cost}})` : '';
  const face = result.face ? FACE_LABELS[result.face] : 'a face';
  return `${playerName} rolled the planar die${costNote}: ${face}.`;
}

/** How many times this player already took the roll action this turn. */
export function getPlanarDieActionCount(state: any, playerId: string): number {
  const raw = state?.planarDieSpecialActionsThisTurn?.[playerId];
  return Math.max(0, Math.floor(Number(raw) || 0));
}

/** Generic mana for the next roll: equal to the rolls already taken this turn (0 for the first). */
export function getPlanarDieActionCost(state: any, playerId: string): number {
  return getPlanarDieActionCount(state, playerId);
}

function holdsPriority(state: any, playerId: string): boolean {
  const holder = state?.priorityPlayerId ?? state?.priority ?? state?.playerWithPriority;
  // Unit-test states that never record a priority holder are allowed; live games always record one.
  return holder == null || String(holder) === playerId;
}

/** Can this player roll the planar die right now? Returns the generic cost, or why not. */
export function canTakePlanarDieAction(state: any, playerId: string): PlanarDieEligibility {
  const pid = String(playerId || '').trim();
  if (!state || !pid) return { ok: false, reason: 'No game or player.' };
  if (!isPlanechaseEnabled(state)) return { ok: false, reason: 'Planechase is not enabled for this game.' };
  const deck = Array.isArray(state.planarDeckFaceDown) ? state.planarDeckFaceDown : [];
  if (!getActivePlaneCard(state) && deck.length === 0) {
    return { ok: false, reason: 'There is no planar deck. Import a deck with planar cards first.' };
  }
  if (String(state.turnPlayer || state.activePlayer || '') !== pid) {
    return { ok: false, reason: 'Only the active player can roll the planar die.' };
  }
  const step = String(state.step || '').toUpperCase();
  if (step !== 'MAIN1' && step !== 'MAIN2') {
    return { ok: false, reason: 'The planar die can only be rolled during a main phase.' };
  }
  if (Array.isArray(state.stack) && state.stack.length > 0) {
    return { ok: false, reason: 'The stack must be empty to roll the planar die.' };
  }
  if (!holdsPriority(state, pid)) return { ok: false, reason: 'You need priority to roll the planar die.' };
  return { ok: true, cost: getPlanarDieActionCost(state, pid) };
}

/** Pay `amount` generic mana from the floating pool. Returns false (and spends nothing) if short. */
function payGenericFromPool(state: any, playerId: string, amount: number): boolean {
  if (amount <= 0) return true;
  const pool = getOrInitManaPool(state, playerId);
  const resolved: any = resolveManaCostForPoolPayment(pool, `{${amount}}`);
  if (!resolved?.ok) return false;
  consumeManaFromPool(pool, resolved.coloredCost || {}, resolved.genericCost || 0);
  return true;
}

function pushRollHistory(state: any, playerId: string, face: PlanarDieFace, ts: number): void {
  state.planarDieRollsThisTurn = Array.isArray(state.planarDieRollsThisTurn) ? state.planarDieRollsThisTurn : [];
  const chaos = isChaosPlanarDieFace(state, face);
  state.planarDieRollsThisTurn.push({ playerId, face, chaos, ts });
  state.lastPlanarDieRoll = { playerId, face, chaos };
}

/**
 * Take the roll action: check timing, pay the cost, save the event, then apply the face
 * (chaos ensues / planeswalk) through the normal planar die runtime.
 */
export function performPlanarDieSpecialAction(
  ctx: GameContext,
  playerId: string,
  options: { face?: PlanarDieFace; random?: () => number } = {},
): PlanarDieActionResult {
  const state = (ctx as any)?.state;
  const pid = String(playerId || '').trim();
  const eligibility = canTakePlanarDieAction(state, pid);
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  const cost = eligibility.cost ?? 0;
  if (!payGenericFromPool(state, pid, cost)) {
    return {
      ok: false,
      reason: `Rolling the planar die again this turn costs {${cost}}. Tap lands for mana first.`,
    };
  }

  const face = options.face ?? pickPlanarDieFace(options.random);
  state.planarDieSpecialActionsThisTurn = state.planarDieSpecialActionsThisTurn || {};
  const actionsThisTurn = getPlanarDieActionCount(state, pid) + 1;
  state.planarDieSpecialActionsThisTurn[pid] = actionsThisTurn;

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (gameId && !(ctx as any)?.isReplaying) {
    try {
      appendEvent(gameId, Number(state.seq ?? (ctx as any).seq?.value ?? 0), 'planarDieRoll', {
        playerId: pid,
        face,
        cost,
        actionsThisTurn,
      });
    } catch (err) {
      debugWarn(1, '[planarDieRoll] appendEvent failed:', err);
    }
  }

  rollPlanarDie(ctx, pid, face);
  try {
    (ctx as any).bumpSeq?.();
  } catch {
    /* best-effort */
  }
  return { ok: true, face, cost, actionsThisTurn };
}

/** Replay: restore the state change of a saved `planarDieRoll` without re-rolling or re-applying the face. */
export function applyPlanarDieRollSnapshot(state: any, event: Record<string, any>): void {
  const pid = String(event?.playerId || '').trim();
  const face = event?.face as PlanarDieFace;
  if (!state || !pid || (face !== 'chaos' && face !== 'planeswalk' && face !== 'blank')) return;
  if (!payGenericFromPool(state, pid, Math.max(0, Math.floor(Number(event.cost) || 0)))) {
    debugWarn(1, `[planarDieRoll] replay: could not pay {${event.cost}} for ${pid}`);
  }
  state.planarDieSpecialActionsThisTurn = state.planarDieSpecialActionsThisTurn || {};
  state.planarDieSpecialActionsThisTurn[pid] = Math.max(0, Math.floor(Number(event.actionsThisTurn) || 0));
  pushRollHistory(state, pid, face, Number(event.ts) || 0);
}
