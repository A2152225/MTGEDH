import { payCommittedActivationEnergy } from "./activationEnergyCost.js";
/**
 * socket/interaction-handlers/activationSelfSourceCost.ts
 *
 * CR 602.2b / 601.2c-h: an activated ability's targets are chosen before its costs are paid.
 * "Sacrifice this" / "Exile this" activation costs (Crypt Creeper, Shock Troops, Vial of
 * Dragonfire, Perpetual Timepiece, ...) used to move the source before TARGET_SELECTION was
 * queued, so the target continuation could no longer find its source (PERMANENT_NOT_FOUND).
 *
 * The activation path now records the self-source cost (and any deferred life payment) on the
 * queued target step; the continuation pays it once targets are locked in, snapshotting the
 * source's last known information for the resolving ability.
 *
 * Public entry symbols: SelfSourceCostKind, buildSelfSourceLastKnownSnapshot,
 * paySelfSourceActivationCost, payDeferredActivationLife, payDeferredStepActivationCosts,
 * sourceLastKnownFromCostStep.
 */

import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import { payLifeAmount } from "../../state/modules/batch97PayLife.js";
import { reportHookFailure } from "../../../../shared/src/hookFailureReporter.js";
import { getEffectivePower, getEffectiveToughness } from "../util.js";

export type SelfSourceCostKind = 'sacrifice' | 'exile';

// Flat shape: the server tsconfig is non-strict, so a discriminated `ok` union does not narrow.
export type SelfSourceCostResult = {
  ok: boolean;
  snapshot?: Record<string, any>;
  code?: string;
  message?: string;
};

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Last-known snapshot of a permanent leaving the battlefield to pay a cost. */
export function buildSelfSourceLastKnownSnapshot(game: any, perm: any): Record<string, any> {
  let power: number | null = null;
  let toughness: number | null = null;
  try {
    power = finiteOrNull(getEffectivePower(perm, game?.state));
    toughness = finiteOrNull(getEffectiveToughness(perm, game?.state));
  } catch (err) {
    reportHookFailure('activation.selfSourceCost.snapshot', err, { cardName: String(perm?.card?.name || ''), cardId: String(perm?.id || '') });
  }
  return {
    id: String(perm?.id || ''),
    name: String(perm?.card?.name || 'permanent'),
    controller: String(perm?.controller || ''),
    owner: String(perm?.owner || perm?.ownerId || perm?.controller || ''),
    typeLine: String(perm?.card?.type_line || '').toLowerCase(),
    power,
    effectivePower: power ?? undefined,
    toughness,
    manaValue: finiteOrNull(perm?.card?.cmc),
    colors: Array.isArray(perm?.card?.colors) ? [...perm.card.colors] : [],
    counters: perm?.counters && typeof perm.counters === 'object' ? { ...perm.counters } : undefined,
    isToken: perm?.isToken === true ? true : undefined,
    card: perm?.card && typeof perm.card === 'object' ? { ...perm.card } : undefined,
  };
}

function ensureTokenGraveyardSnapshot(game: any, ownerId: string, tokenCard: any): void {
  const zones = ((game.state as any).zones = (game.state as any).zones || {});
  const playerZones = (zones[ownerId] = zones[ownerId] || {
    hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0,
  });
  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
  const snapshotId = String(tokenCard?.id || '').trim();
  const snapshotName = String(tokenCard?.name || '').trim();
  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
    if (!card) return false;
    const cardId = String(card.id || '').trim();
    if (cardId && snapshotId) return cardId === snapshotId;
    return String(card.name || '').trim() === snapshotName;
  });
  if (!alreadyPresent) {
    (playerZones.graveyard as any[]).push(tokenCard);
    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
  }
}

/** Sacrifice or exile the ability's own source as an activation cost. */
export function paySelfSourceActivationCost(
  game: any,
  gameId: string,
  controllerId: string,
  permanentId: string,
  kind: SelfSourceCostKind,
  cardName: string,
): SelfSourceCostResult {
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const perm = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permanentId)) as any;
  if (!perm) {
    return { ok: false, code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' };
  }
  const snapshot = buildSelfSourceLastKnownSnapshot(game, perm);
  const tokenGraveyardSnapshot = kind === 'sacrifice' && perm.isToken && perm.card
    ? { ...(perm.card || {}), zone: 'graveyard' }
    : null;
  const graveyardOwnerId = String(perm.owner || perm.controller || controllerId || '').trim();
  if (kind === 'exile') {
    perm.leaveBattlefieldReplacementDestination = 'exile';
    if (perm.card && typeof perm.card === 'object') perm.card.leaveBattlefieldReplacementDestination = 'exile';
  }
  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;
  let moved = false;
  try {
    moved = Boolean(movePermanentToGraveyard(ctx, String(permanentId), true));
  } catch (err) {
    reportHookFailure('activation.selfSourceCost.move', err, { cardName, cardId: String(permanentId), gameId, playerId: controllerId });
    return {
      ok: false,
      code: kind === 'exile' ? 'EXILE_FAILED' : 'SACRIFICE_FAILED',
      message: `Failed to ${kind} ${cardName} as part of the activation cost.`,
    };
  }
  if (!moved) {
    return { ok: false, code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' };
  }
  if (tokenGraveyardSnapshot && graveyardOwnerId) {
    ensureTokenGraveyardSnapshot(game, graveyardOwnerId, tokenGraveyardSnapshot);
  }
  return { ok: true, snapshot };
}

/** Pay life deferred from activation (non-mana ability). Returns the amount paid. */
export function payDeferredActivationLife(game: any, gameId: string, controllerId: string, amount: number): number {
  const paidLife = Math.max(0, Math.floor(Number(amount || 0)));
  if (paidLife <= 0) return 0;
  try {
    const paid = payLifeAmount(game.state, String(controllerId), paidLife, {
      forSpellOrNonManaAbility: true,
      isManaAbility: false,
      skipReplacementOrder: true,
      ctx: { state: game.state, gameId, isReplaying: Boolean((game as any).isReplaying) },
    } as any);
    if ((paid as any)?.paid && !(paid as any)?.replaced) {
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(controllerId)] =
        Number((game.state as any).lifeLostThisTurn[String(controllerId)] || 0) + paidLife;
    }
  } catch (err) {
    reportHookFailure('activation.selfSourceCost.payLife', err, { gameId, playerId: controllerId });
  }
  return paidLife;
}

/**
 * Pay costs a battlefield-ability target step carried past target selection
 * (`deferredSelfSourceCost`, `deferredLifePaymentForCost`). Records the payment back onto the
 * step (sacrificedPermanentsForCost / lastSacrificedPermanents / exiledSelfForCost /
 * sourceLastKnown / lifePaidForCost) so the stack item and replay event pick it up.
 * Returns an error to emit, or null when everything was paid.
 */
export function payDeferredStepActivationCosts(
  game: any,
  gameId: string,
  controllerId: string,
  permanentId: string,
  stepAny: any,
  cardName: string,
): { code: string; message: string } | null {
  if (!stepAny || typeof stepAny !== 'object') return null;
  const kind = stepAny.deferredSelfSourceCost;
  const life = Math.max(0, Math.floor(Number(stepAny.deferredLifePaymentForCost || 0)));
  const energy = Math.max(0, Math.floor(Number(stepAny.deferredEnergyPaymentForCost || 0)));
  if (energy > 0 && Number((game.state as any)?.energy?.[controllerId] || 0) < energy) {
    return { code: 'INSUFFICIENT_ENERGY', message: `Cannot activate ${cardName}: need to pay ${energy} energy.` };
  }
  if (life > 0) {
    const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
    if (!Number.isFinite(currentLife) || currentLife < life) {
      return { code: 'INSUFFICIENT_LIFE', message: `Cannot activate ${cardName}: need to pay ${life} life.` };
    }
  }
  if (kind === 'sacrifice' || kind === 'exile') {
    const result = paySelfSourceActivationCost(game, gameId, controllerId, permanentId, kind, cardName);
    if (!result.ok) return { code: result.code, message: result.message };
    stepAny.sourceLastKnown = result.snapshot;
    if (kind === 'sacrifice') {
      const prior = Array.isArray(stepAny.sacrificedPermanentsForCost) ? stepAny.sacrificedPermanentsForCost : [];
      stepAny.sacrificedPermanentsForCost = Array.from(new Set([...prior.map((id: any) => String(id)), String(permanentId)]));
      const priorSnapshots = Array.isArray(stepAny.lastSacrificedPermanents) ? stepAny.lastSacrificedPermanents : [];
      stepAny.lastSacrificedPermanents = [...priorSnapshots, result.snapshot];
    } else {
      stepAny.exiledSelfForCost = String(permanentId);
    }
    delete stepAny.deferredSelfSourceCost;
  }
  if (life > 0) {
    const paid = payDeferredActivationLife(game, gameId, controllerId, life);
    stepAny.lifePaidForCost = Number(stepAny.lifePaidForCost || 0) + paid;
    delete stepAny.deferredLifePaymentForCost;
  }
  if (energy > 0) {
    stepAny.energyPaidForCost = Number(stepAny.energyPaidForCost || 0) + payCommittedActivationEnergy(game.state, controllerId, energy);
    delete stepAny.deferredEnergyPaymentForCost;
  }
  return null;
}

/**
 * The ability's own source may legally be the permanent sacrificed for a "Sacrifice a creature" style
 * cost (Siege-Gang Commander sacrificing itself). The ability still exists independently of its
 * source (CR 113.7a), so target continuations finish from the sacrifice snapshot.
 */
export function sourceLastKnownFromCostStep(stepAny: any, permanentId: string): Record<string, any> | undefined {
  const id = String(permanentId || '');
  if (!id || !stepAny) return undefined;
  const snapshots: any[] = Array.isArray(stepAny.lastSacrificedPermanents) ? stepAny.lastSacrificedPermanents : [];
  const snapshot = snapshots.find((entry: any) => String(entry?.id || '') === id);
  if (snapshot) return snapshot;
  const sacrificedIds: string[] = Array.isArray(stepAny.sacrificedPermanentsForCost)
    ? stepAny.sacrificedPermanentsForCost.map((entry: any) => String(entry))
    : [];
  if (sacrificedIds.includes(id)) return { id, controller: String(stepAny.playerId || '') };
  return undefined;
}
