// server/src/state/modules/becomeAuraEndEffectAction.ts
// Special action: "You may pay {U} to end this effect." (Licids). The become_aura executor step
// (rules-engine oracleIRExecutorBattlefieldPhaseCombatAuraSteps.ts) records the cost on the permanent as
// `auraEndEffectCost`. Official rulings (Gliding Licid, 2013-04-15): paying the cost is a special action and
// can't be responded to, so it never uses the stack and is legal whenever the effect's controller has priority
// (the same window as casting an instant). Ending the effect turns the permanent back into a creature (its
// printed type line returns), unattaches it, and it regains the ability it lost.
// Replay: the persisted event records how the cost was paid (pool or tapped/sacrificed sources) and the
// payer's mana pool afterwards. Mana-producing events rebuild the pool during replay, so replay pays the
// cost again the same way and checks the resulting pool against the recorded one.
// Public: getBecomeAuraEndEffectActions, applyBecomeAuraEndEffect, endBecomeAuraEffect,
// BECOME_AURA_END_EFFECT_PREFIX, BECOME_AURA_END_EFFECT_EVENT.

import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import {
  canPayManaCostStringWithAvailableSources,
  consumeManaFromPool,
  getOrInitManaPool,
  payManaCostWithAvailableSources,
  resolveManaCostForPoolPayment,
} from '../../socket/util.js';

export const BECOME_AURA_END_EFFECT_PREFIX = 'become-aura-end-';
/** Socket event the client emits, and the persisted event type used for replay. */
export const BECOME_AURA_END_EFFECT_EVENT = 'endBecomeAuraEffect';

export type BecomeAuraEndEffectUnpayableReason = 'no_priority' | 'insufficient_mana';

export interface BecomeAuraEndEffectAction {
  playableId: string;
  permanentId: string;
  playerId: string;
  cardName: string;
  /** Mana cost string, e.g. "{U}". */
  cost: string;
  /** Permanent the Aura is currently attached to. */
  attachedTo: string;
  label: string;
  payable: boolean;
  unpayableReason?: BecomeAuraEndEffectUnpayableReason;
}

export type BecomeAuraEndEffectPaidFrom = 'pool' | 'sources';

/** How the cost was paid; persisted on the event so replay can pay it the same way. */
export interface BecomeAuraEndEffectPayment {
  paidFrom: BecomeAuraEndEffectPaidFrom;
  tappedPermanentIds: string[];
  sacrificedPermanentIds: string[];
  /** Payer's numeric mana pool after paying. */
  manaPoolAfter: Record<string, number>;
}

export type BecomeAuraEndEffectResult =
  | { applied: true; permanentId: string; cost: string; restoredTypeLine: string; detachedFrom: string; payment: BecomeAuraEndEffectPayment }
  | { applied: false; reason: string };

interface BecomeAuraCard {
  name?: unknown;
  type_line?: unknown;
  [key: string]: unknown;
}

interface BecomeAuraPermanent {
  id?: unknown;
  controller?: unknown;
  type_line?: unknown;
  attachedTo?: unknown;
  attachments?: unknown;
  auraEndEffectCost?: unknown;
  becameAuraFromTypeLine?: unknown;
  card?: BecomeAuraCard;
  [key: string]: unknown;
}

interface BecomeAuraState {
  battlefield?: unknown;
  priority?: unknown;
  priorityPlayerId?: unknown;
  waitingForMulligan?: unknown;
  phase?: unknown;
  manaPool?: unknown;
}

interface BecomeAuraGameContext {
  state: BecomeAuraState;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function battlefieldOf(state: BecomeAuraState | undefined): BecomeAuraPermanent[] {
  return Array.isArray(state?.battlefield) ? (state.battlefield as BecomeAuraPermanent[]) : [];
}

function endEffectCostOf(perm: BecomeAuraPermanent | undefined): string {
  return text(perm?.auraEndEffectCost);
}

function playerHasPriority(state: BecomeAuraState, playerId: string): boolean {
  const holder = state.priorityPlayerId ?? state.priority;
  return holder != null && text(holder) === playerId;
}

function canTakeInstantSpeedSpecialAction(state: BecomeAuraState, playerId: string): boolean {
  if (!playerHasPriority(state, playerId)) return false;
  if (state.waitingForMulligan === true) return false;
  return text(state.phase).toLowerCase() !== 'mulligan';
}

function readManaPool(state: BecomeAuraState, playerId: string): Record<string, number> | undefined {
  const pools = state.manaPool && typeof state.manaPool === 'object' ? (state.manaPool as Record<string, unknown>) : undefined;
  const pool = pools?.[playerId];
  return pool && typeof pool === 'object' ? (pool as Record<string, number>) : undefined;
}

function canAffordCost(state: BecomeAuraState, playerId: string, cost: string): boolean {
  try {
    // Read-only: listing actions for the view must not initialize a mana pool.
    const pool = readManaPool(state, playerId);
    if (pool && resolveManaCostForPoolPayment(pool, cost)?.ok === true) return true;
    return Boolean(canPayManaCostStringWithAvailableSources(state, playerId, cost));
  } catch (err) {
    reportHookFailure('becomeAuraEndEffect.canAfford', err, { playerId, extra: cost });
    return false;
  }
}

const POOL_COLOR_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

export function readNumericManaPool(state: BecomeAuraState, playerId: string): Record<string, number> {
  const pool = readManaPool(state, playerId);
  const snapshot: Record<string, number> = {};
  for (const key of POOL_COLOR_KEYS) snapshot[key] = Number(pool?.[key] ?? 0) || 0;
  return snapshot;
}

/** Pay the cost from the pool first, then from untapped sources; `method` forces one branch (replay). */
function payCost(
  state: BecomeAuraState,
  playerId: string,
  cost: string,
  method?: BecomeAuraEndEffectPaidFrom,
): BecomeAuraEndEffectPayment | null {
  const pool = getOrInitManaPool(state, playerId);
  if (method !== 'sources') {
    const resolved = resolveManaCostForPoolPayment(pool, cost);
    if (resolved?.ok === true) {
      consumeManaFromPool(pool, resolved.coloredCost || {}, resolved.genericCost || 0, '[becomeAuraEndEffect]');
      return { paidFrom: 'pool', tappedPermanentIds: [], sacrificedPermanentIds: [], manaPoolAfter: readNumericManaPool(state, playerId) };
    }
    if (method === 'pool') return null;
  }
  if (!canPayManaCostStringWithAvailableSources(state, playerId, cost)) return null;
  const paid = payManaCostWithAvailableSources(state, playerId, cost);
  if (!paid || paid.ok === false) return null;
  return {
    paidFrom: 'sources',
    tappedPermanentIds: [...(paid.tappedPermanents || [])],
    sacrificedPermanentIds: [...(paid.sacrificedPermanents || [])],
    manaPoolAfter: readNumericManaPool(state, playerId),
  };
}

function samePool(a: Record<string, number>, b: Record<string, number>): boolean {
  return POOL_COLOR_KEYS.every((key) => Number(a[key] ?? 0) === Number(b[key] ?? 0));
}

export function getBecomeAuraEndEffectActions(state: BecomeAuraState | undefined, playerId: string): BecomeAuraEndEffectAction[] {
  const pid = text(playerId);
  if (!pid || !state) return [];
  const timingOk = canTakeInstantSpeedSpecialAction(state, pid);
  const out: BecomeAuraEndEffectAction[] = [];
  for (const perm of battlefieldOf(state)) {
    const cost = endEffectCostOf(perm);
    const permanentId = text(perm?.id);
    if (!cost || !permanentId || text(perm.controller) !== pid) continue;
    const affordable = timingOk && canAffordCost(state, pid, cost);
    out.push({
      playableId: `${BECOME_AURA_END_EFFECT_PREFIX}${permanentId}`,
      permanentId,
      playerId: pid,
      cardName: text(perm.card?.name) || permanentId,
      cost,
      attachedTo: text(perm.attachedTo),
      label: `Pay ${cost}: end effect`,
      payable: affordable,
      ...(affordable ? {} : { unpayableReason: timingOk ? 'insufficient_mana' : 'no_priority' }),
    });
  }
  return out;
}

/** Undo the become_aura step on the permanent (no cost, no timing): shared by the live action and replay. */
export function endBecomeAuraEffect(state: BecomeAuraState, permanentId: string): { restoredTypeLine: string; detachedFrom: string } | null {
  const battlefield = battlefieldOf(state);
  const perm = battlefield.find((entry) => text(entry?.id) === permanentId);
  if (!perm || !endEffectCostOf(perm)) return null;

  const auraTypeLine = text(perm.card?.type_line ?? perm.type_line);
  const restoredTypeLine = text(perm.becameAuraFromTypeLine) || auraTypeLine.replace(/\s+Aura$/i, '').trim();
  const detachedFrom = text(perm.attachedTo);

  perm.card = { ...(perm.card || {}), type_line: restoredTypeLine };
  perm.type_line = restoredTypeLine;
  for (const key of ['attachedTo', 'isAura', 'enchantTarget', 'losesThisAbility', 'becameAuraFromTypeLine', 'auraEndEffectCost']) {
    delete perm[key];
  }

  const host = detachedFrom ? battlefield.find((entry) => text(entry?.id) === detachedFrom) : undefined;
  if (host && Array.isArray(host.attachments)) {
    host.attachments = (host.attachments as unknown[]).filter((id) => text(id) !== permanentId);
  }
  return { restoredTypeLine, detachedFrom };
}

export function applyBecomeAuraEndEffect(
  ctx: BecomeAuraGameContext,
  args: { playerId: string; permanentId: string; replay?: boolean; recordedPayment?: Partial<BecomeAuraEndEffectPayment> },
): BecomeAuraEndEffectResult {
  const playerId = text(args?.playerId);
  const permanentId = text(args?.permanentId);
  const state = ctx?.state;
  if (!state || !playerId || !permanentId) return { applied: false, reason: 'missing_ids' };

  const perm = battlefieldOf(state).find((entry) => text(entry?.id) === permanentId);
  const cost = endEffectCostOf(perm);
  if (!perm || !cost) return { applied: false, reason: 'no_end_effect_cost' };
  if (text(perm.controller) !== playerId) return { applied: false, reason: 'not_controller' };

  // Replay skips the timing check (it already passed live) but pays exactly as the live game did.
  if (!args.replay && !canTakeInstantSpeedSpecialAction(state, playerId)) return { applied: false, reason: 'no_priority' };
  const recorded = args.replay ? args.recordedPayment : undefined;
  const method = recorded?.paidFrom === 'pool' || recorded?.paidFrom === 'sources' ? recorded.paidFrom : undefined;
  let payment: BecomeAuraEndEffectPayment | null = null;
  try {
    payment = payCost(state, playerId, cost, method);
  } catch (err) {
    reportHookFailure('becomeAuraEndEffect.pay', err, { playerId, cardId: permanentId, extra: cost });
    return { applied: false, reason: 'mana_payment_failed' };
  }
  if (!payment) {
    if (!args.replay) return { applied: false, reason: 'insufficient_mana' };
    // The live game paid; a replay that cannot means the rebuilt state diverged. Keep the effect change
    // so later events still line up, and surface the divergence.
    reportHookFailure('becomeAuraEndEffect.replayPayment', new Error(`replay could not pay ${cost}`), { playerId, cardId: permanentId, extra: cost });
    payment = { paidFrom: method || 'pool', tappedPermanentIds: [], sacrificedPermanentIds: [], manaPoolAfter: readNumericManaPool(state, playerId) };
  } else if (recorded?.manaPoolAfter && !samePool(payment.manaPoolAfter, recorded.manaPoolAfter)) {
    reportHookFailure('becomeAuraEndEffect.replayPoolMismatch', new Error('replayed mana pool differs from the live game'), {
      playerId,
      cardId: permanentId,
      extra: JSON.stringify({ live: recorded.manaPoolAfter, replay: payment.manaPoolAfter }),
    });
  }

  const ended = endBecomeAuraEffect(state, permanentId);
  if (!ended) return { applied: false, reason: 'no_end_effect_cost' };
  return { applied: true, permanentId, cost, payment, ...ended };
}
