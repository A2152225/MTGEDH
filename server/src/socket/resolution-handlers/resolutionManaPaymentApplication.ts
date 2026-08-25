/**
 * socket/resolution-handlers/resolutionManaPaymentApplication.ts
 *
 * Origin parent: server/src/socket/resolution.ts.
 * Cluster moved: the mana-payment appliers used by every resolution payment prompt -
 * selection parsing, ward payment validate/apply, and the general selected-payment applier.
 * Public entry symbols: extractResolutionPaymentItems, validateWardManaPaymentSelection,
 * applyWardManaPaymentSelection, applySelectedManaPaymentForResolutionCost.
 *
 * Companion to socket/resolutionPaymentManaUtils.ts, which owns the smaller shared
 * pool/persistence helpers these appliers build on. Must not import resolution.ts.
 */

import { creatureHasHaste } from "../game-actions-handlers/gameActionsPermanentKeywordGrants.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import { resolveGroupedPermanentRef } from "../tokenGroupResolve.js";
import {
  MANA_POOL_KEY_BY_SYMBOL,
  addResolutionManaTotals,
  calculateResolutionManaPoolDelta,
  consumeExplicitSelectedResolutionMana,
  createEmptyResolutionManaTotals,
  getResolutionPaymentProducedManaTotals,
  getSupportedResolutionActivationManaCost,
  persistResolutionPaymentManaMutations,
  resolutionManaSourceSelfSacrifices,
  resolutionPaymentActivationCostHasUnsupportedAdditionalCosts,
  snapshotResolutionManaPool,
  type ResolutionManaPaymentPersistOptions,
  type ResolutionPaymentItem,
} from "../resolutionPaymentManaUtils.js";
import {
  buildManaTotalsIncludingEligibleRestricted,
  calculateManaProduction,
  canUseRestrictedMana,
  consumeManaFromPool,
  consumeManaFromPoolForPurpose,
  getFloatingPaymentPoolColorKey,
  getOrInitManaPool,
  parseManaCost,
  validateManaPayment,
  type RestrictedManaSpendPurpose,
} from "../util.js";

function getFloatingPaymentPoolKey(permanentId: string, mana: string, pool?: any): string | null {
  return getFloatingPaymentPoolColorKey(permanentId, mana, pool);
}

/** Normalize a resolution step response into the payment-source list the appliers expect. */
export function extractResolutionPaymentItems(rawSelections: any): ResolutionPaymentItem[] | undefined {
  const raw = Array.isArray(rawSelections?.payment)
    ? rawSelections.payment
    : (Array.isArray(rawSelections) ? rawSelections : undefined);
  if (!Array.isArray(raw)) return undefined;

  return raw
    .map((entry: any) => ({
      permanentId: String(entry?.permanentId || '').trim(),
      mana: String(entry?.mana || '').trim().toUpperCase(),
      abilityId: typeof entry?.abilityId === 'string' && entry.abilityId.trim()
        ? String(entry.abilityId).trim()
        : undefined,
      count: entry?.count != null ? Number(entry.count) : undefined,
      producedColors: Array.isArray(entry?.producedColors) // Updated producedColors mapping
        ? entry.producedColors
            .map((color: any) => String(color || '').trim().toUpperCase())
            .filter((color: string) => /^[WUBRGC]$/.test(color))
        : undefined, // End of producedColors mapping
    }))
    .filter((entry) => entry.permanentId && /^[WUBRGC]$/.test(entry.mana));
}

/** Dry-run a ward payment selection: no state mutation, returns the parsed ward cost on success. */
export function validateWardManaPaymentSelection(
  game: any,
  playerId: string,
  wardCost: string,
  payment: ResolutionPaymentItem[] | undefined
): { ok: true; parsedCost: ReturnType<typeof parseManaCost> } | { ok: false; code: string; message: string } {
  const parsedCost = parseManaCost(String(wardCost || ''));
  const pool = getOrInitManaPool(game.state, playerId) as any;
  const explicitPaymentSelected = Boolean(payment && payment.length > 0);
  const totalAvailable: Record<string, number> = explicitPaymentSelected
    ? createEmptyResolutionManaTotals()
    : snapshotResolutionManaPool(pool);
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const usedPermanentIds = new Set<string>();
  const selectedFloatingMana: Record<string, number> = createEmptyResolutionManaTotals();
  const activationSimulationPool = snapshotResolutionManaPool(pool);

  if (payment && payment.length > 0) {
    for (const { permanentId, mana, count, abilityId, producedColors } of payment) {
      const floatingPoolKey = getFloatingPaymentPoolKey(permanentId, mana);
      if (floatingPoolKey) {
        const amount = Math.max(1, Number(count || 1));
        selectedFloatingMana[floatingPoolKey] = (selectedFloatingMana[floatingPoolKey] || 0) + amount;
        totalAvailable[floatingPoolKey] = (totalAvailable[floatingPoolKey] || 0) + amount;
        continue;
      }

      const resolvedPermanentId = resolveGroupedPermanentRef(
        game,
        playerId as any,
        permanentId,
        { usedIds: usedPermanentIds },
      );
      if (!resolvedPermanentId) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield` };
      }
      if (usedPermanentIds.has(resolvedPermanentId)) {
        return { ok: false, code: 'INVALID_PAYMENT', message: 'A mana source can only be used once for ward payment.' };
      }
      usedPermanentIds.add(resolvedPermanentId);

      const permanent = battlefield.find((entry: any) => entry?.id === resolvedPermanentId && entry?.controller === playerId);
      if (!permanent) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield` };
      }
      if ((permanent as any).tapped) {
        return { ok: false, code: 'PAYMENT_SOURCE_TAPPED', message: `${(permanent as any).card?.name || 'Permanent'} is already tapped` };
      }

      const permCard = (permanent as any).card || {};
      const permTypeLine = String(permCard.type_line || '').toLowerCase();
      const permIsCreature = /\bcreature\b/.test(permTypeLine);
      const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
      if (permIsCreature && (permanent as any).summoningSickness && !hasHaste) {
        return {
          ok: false,
          code: 'SUMMONING_SICKNESS',
          message: `${permCard.name || 'Creature'} has summoning sickness and cannot use tap abilities this turn`,
        };
      }

      if (resolutionPaymentActivationCostHasUnsupportedAdditionalCosts(game, playerId, permanent, mana, abilityId)) {
        return {
          ok: false,
          code: 'INVALID_PAYMENT',
          message: `${permCard.name || 'Permanent'} requires an unsupported additional activation cost.`,
        };
      }

      const activationManaCost = getSupportedResolutionActivationManaCost(game, playerId, permanent, mana, abilityId);
      if (activationManaCost) {
        const activationValidationError = validateManaPayment(
          snapshotResolutionManaPool(activationSimulationPool),
          activationManaCost.colors,
          activationManaCost.generic,
        );
        if (activationValidationError) {
          return {
            ok: false,
            code: 'INSUFFICIENT_MANA',
            message: `${permCard.name || 'Permanent'} requires additional mana to activate. ${activationValidationError}`,
          };
        }

        consumeManaFromPool(
          activationSimulationPool,
          activationManaCost.colors,
          activationManaCost.generic,
          `[resolutionPaymentValidation:${permCard.name || permanentId}]`,
        );
      }

      const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
      const manaAmount = count != null ? Math.max(Number(count) || 0, Number(manaInfo.totalAmount || 0)) : Number(manaInfo.totalAmount || 0);
      const explicitProducedManaTotals = Array.isArray(producedColors) && producedColors.length > 0
        ? getResolutionPaymentProducedManaTotals(mana, manaAmount, producedColors)
        : undefined;
      const explicitProducedAmount = explicitProducedManaTotals
        ? Object.values(explicitProducedManaTotals).reduce((sum: number, value) => sum + (typeof value === 'number' ? value : 0), 0)
        : 0;
      const poolKey = MANA_POOL_KEY_BY_SYMBOL[mana];
      if ((!explicitProducedManaTotals && (!poolKey || manaAmount <= 0)) || (explicitProducedManaTotals && explicitProducedAmount <= 0)) {
        return { ok: false, code: 'INVALID_PAYMENT', message: `Invalid mana payment from ${(permanent as any).card?.name || 'source'}.` };
      }

      if (explicitProducedManaTotals) {
        addResolutionManaTotals(totalAvailable, explicitProducedManaTotals);
        addResolutionManaTotals(activationSimulationPool, explicitProducedManaTotals);
      } else {
        totalAvailable[poolKey] = (totalAvailable[poolKey] || 0) + manaAmount;
        activationSimulationPool[poolKey] = (activationSimulationPool[poolKey] || 0) + manaAmount;
        for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
          const bonusKey = MANA_POOL_KEY_BY_SYMBOL[String(bonus?.color || '').toUpperCase()];
          const bonusAmount = Number(bonus?.amount || 0);
          if (bonusKey && bonusAmount > 0 && (count == null || bonusKey !== poolKey)) {
            totalAvailable[bonusKey] = (totalAvailable[bonusKey] || 0) + bonusAmount;
            activationSimulationPool[bonusKey] = (activationSimulationPool[bonusKey] || 0) + bonusAmount;
          }
        }
      }
    }

    for (const [poolKey, amount] of Object.entries(selectedFloatingMana)) {
      if (Number(pool[poolKey] || 0) < Number(amount || 0)) {
        return { ok: false, code: 'INSUFFICIENT_MANA', message: `Not enough ${poolKey} mana selected from your pool.` };
      }
    }
  }

  const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
  if (validationError) {
    return { ok: false, code: 'INSUFFICIENT_MANA', message: validationError };
  }

  return { ok: true, parsedCost };
}


/** Apply a ward payment: taps/sacrifices the selected sources and consumes the ward cost. */
export function applyWardManaPaymentSelection(
  game: any,
  playerId: string,
  wardCost: string,
  payment: ResolutionPaymentItem[] | undefined,
  options?: ResolutionManaPaymentPersistOptions,
): {
  ok: true;
  tappedPermanents: string[];
  sacrificedPermanents: string[];
  paymentManaDelta?: Record<string, number>;
} | { ok: false; code: string; message: string } {
  const validation = validateWardManaPaymentSelection(game, playerId, wardCost, payment);
  if (!validation.ok) {
    return validation as { ok: false; code: string; message: string };
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const manaPool = getOrInitManaPool(game.state, playerId) as any;
  const manaPoolBeforePayment = snapshotResolutionManaPool((game.state as any)?.manaPool?.[playerId]);
  const selectedPaymentAvailableTotals: Record<string, number> = createEmptyResolutionManaTotals();
  const tappedPermanents: string[] = [];
  const sacrificedPermanents: string[] = [];
  const usedPermanentIds = new Set<string>();

  if (payment && payment.length > 0) {
    for (const { permanentId, mana, count, abilityId, producedColors } of payment) {
      const floatingPoolKey = getFloatingPaymentPoolKey(permanentId, mana);
      if (floatingPoolKey) {
        const amount = Math.max(1, Number(count || 1));
        selectedPaymentAvailableTotals[floatingPoolKey] = (selectedPaymentAvailableTotals[floatingPoolKey] || 0) + amount;
        continue;
      }

      const resolvedPermanentId = resolveGroupedPermanentRef(
        game,
        playerId as any,
        permanentId,
        { usedIds: usedPermanentIds },
      );
      if (!resolvedPermanentId) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield` };
      }
      if (usedPermanentIds.has(resolvedPermanentId)) {
        return { ok: false, code: 'INVALID_PAYMENT', message: 'A mana source can only be used once for ward payment.' };
      }
      usedPermanentIds.add(resolvedPermanentId);

      const permanent = battlefield.find((entry: any) => entry?.id === resolvedPermanentId && entry?.controller === playerId);
      if (!permanent) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield` };
      }

      const permCard = (permanent as any).card || {};
      const activationManaCost = getSupportedResolutionActivationManaCost(game, playerId, permanent, mana, abilityId);
      if (activationManaCost) {
        consumeManaFromPool(
          manaPool,
          activationManaCost.colors,
          activationManaCost.generic,
          `[wardPaymentActivation:${permCard.name || resolvedPermanentId}]`,
        );
      }

      if (resolutionManaSourceSelfSacrifices(game, playerId, permanent, mana, abilityId)) {
        sacrificedPermanents.push(String(resolvedPermanentId));
      } else {
        (permanent as any).tapped = true;
        tappedPermanents.push(String(resolvedPermanentId));
      }

      const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
      const producedAmount = count != null
        ? Math.max(Number(count) || 0, Number(manaInfo.totalAmount || 0))
        : Number(manaInfo.totalAmount || 0);
      const explicitProducedManaTotals = Array.isArray(producedColors) && producedColors.length > 0
        ? getResolutionPaymentProducedManaTotals(mana, producedAmount, producedColors)
        : undefined;
      const poolKey = MANA_POOL_KEY_BY_SYMBOL[mana];
      if (explicitProducedManaTotals) {
        addResolutionManaTotals(manaPool, explicitProducedManaTotals);
        addResolutionManaTotals(selectedPaymentAvailableTotals, explicitProducedManaTotals);
      } else if (poolKey && producedAmount > 0) {
        manaPool[poolKey] = (manaPool[poolKey] || 0) + producedAmount;
        selectedPaymentAvailableTotals[poolKey] = (selectedPaymentAvailableTotals[poolKey] || 0) + producedAmount;
      }

      for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
        if (explicitProducedManaTotals) {
          continue;
        }

        const bonusKey = MANA_POOL_KEY_BY_SYMBOL[String(bonus?.color || '').toUpperCase()];
        const bonusAmount = Number(bonus?.amount || 0);
        if (bonusKey && bonusAmount > 0 && (count == null || bonusKey !== poolKey)) {
          manaPool[bonusKey] = (manaPool[bonusKey] || 0) + bonusAmount;
          selectedPaymentAvailableTotals[bonusKey] = (selectedPaymentAvailableTotals[bonusKey] || 0) + bonusAmount;
        }
      }
    }

    if (sacrificedPermanents.length > 0) {
      for (const sacrificedPermanentId of sacrificedPermanents) {
        // Before sacrificing, snapshot the card data so we can track it in graveyard
        // for payment-evidence purposes (replay, ward-payment events, blackblade equip).
        // This is the mana-payment context: the permanent was self-sacrificed to pay mana,
        // so it briefly passes through the graveyard for tracking even if it's a token.
        const battlefieldBeforeSac = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const sacrificedPerm = battlefieldBeforeSac.find((p: any) => p?.id === sacrificedPermanentId);
        const sacrificedCard = sacrificedPerm ? ((sacrificedPerm as any).card || sacrificedPerm) : null;
        const sacrificedOwner = String((sacrificedPerm as any)?.owner || (sacrificedPerm as any)?.controller || playerId).trim();
        const isToken = !!(sacrificedPerm as any)?.isToken;
        sacrificePermanent(game as any, sacrificedPermanentId, playerId);
        // For tokens used as mana payment (Treasure, etc.): add them to graveyard briefly
        // for payment-evidence tracking even though tokens normally cease to exist.
        if (isToken && sacrificedCard && sacrificedOwner) {
          const zones = (game.state as any).zones = (game.state as any).zones || {};
          const pz = zones[sacrificedOwner] = zones[sacrificedOwner] || { graveyard: [], graveyardCount: 0 };
          pz.graveyard = Array.isArray(pz.graveyard) ? pz.graveyard : [];
          const cardData = typeof sacrificedCard === 'object' && sacrificedCard !== null ? sacrificedCard : null;
          if (cardData && !pz.graveyard.some((c: any) => String(c?.id || '') === sacrificedPermanentId)) {
            pz.graveyard.push({ ...(cardData as any), id: sacrificedPermanentId, zone: 'graveyard', isToken: true });
            pz.graveyardCount = pz.graveyard.length;
          }
        }
      }
    }

    const selectedConsumption = consumeExplicitSelectedResolutionMana(
      manaPool,
      selectedPaymentAvailableTotals,
      validation.parsedCost.colors,
      validation.parsedCost.generic,
      '[wardPayment]',
    );
    if ('error' in selectedConsumption) {
      return { ok: false, code: 'INSUFFICIENT_MANA', message: selectedConsumption.error };
    }
  } else {
    consumeManaFromPool(manaPool, validation.parsedCost.colors, validation.parsedCost.generic, '[wardPayment]');
  }

  const paymentManaDelta = calculateResolutionManaPoolDelta(
    manaPoolBeforePayment,
    (game.state as any)?.manaPool?.[playerId],
  );
  persistResolutionPaymentManaMutations(game, playerId, tappedPermanents, paymentManaDelta, options);

  return {
    ok: true,
    tappedPermanents,
    sacrificedPermanents,
    paymentManaDelta,
  };
}

export type ResolutionSelectedManaPaymentResult =
  | {
      ok: true;
      tappedPermanents: string[];
      sacrificedPermanents: string[];
      paymentManaDelta?: Record<string, number>;
    }
  | { ok: false; code: string; message: string };

/** Apply an arbitrary resolution-path mana cost from an explicit payment selection (or the pool). */
export function applySelectedManaPaymentForResolutionCost(
  game: any,
  playerId: string,
  manaCost: string,
  payment: ResolutionPaymentItem[] | undefined,
  purpose?: RestrictedManaSpendPurpose,
  options?: ResolutionManaPaymentPersistOptions,
): ResolutionSelectedManaPaymentResult {
  const parsedCost = parseManaCost(String(manaCost || ''));
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const manaPool = getOrInitManaPool(game.state, playerId) as any;
  const manaPoolBeforePayment = snapshotResolutionManaPool((game.state as any)?.manaPool?.[playerId]);
  const totalAvailable: Record<string, number> = payment && payment.length > 0
    ? createEmptyResolutionManaTotals()
    : (
      purpose
        ? buildManaTotalsIncludingEligibleRestricted(manaPool as any, purpose)
        : snapshotResolutionManaPool(manaPool)
    );
  const selectedFloatingMana: Record<string, number> = createEmptyResolutionManaTotals();
  const selectedPaymentAvailableTotals: Record<string, number> = createEmptyResolutionManaTotals();
  const usedPermanentIds = new Set<string>();
  const tappedPermanents: string[] = [];
  const sacrificedPermanents: string[] = [];
  const activationSimulationPool = snapshotResolutionManaPool(manaPool);

  // Resolved payment entries so group_token-… refs (same as cast payment) map to real battlefield ids.
  const resolvedPaymentEntries: Array<{
    permanentId: string;
    mana: string;
    count?: number;
    abilityId?: string;
    producedColors?: string[];
    floatingPoolKey?: string | null;
  }> = [];

  if (payment && payment.length > 0) {
    for (const { permanentId, mana, count, abilityId, producedColors } of payment) {
      const floatingPoolKey = getFloatingPaymentPoolKey(permanentId, mana);
      if (floatingPoolKey) {
        const amount = Math.max(1, Number(count || 1));
        selectedFloatingMana[floatingPoolKey] = (selectedFloatingMana[floatingPoolKey] || 0) + amount;
        totalAvailable[floatingPoolKey] = (totalAvailable[floatingPoolKey] || 0) + amount;
        resolvedPaymentEntries.push({ permanentId, mana, count, abilityId, producedColors, floatingPoolKey });
        continue;
      }

      const resolvedPermanentId = resolveGroupedPermanentRef(
        game,
        playerId as any,
        permanentId,
        { usedIds: usedPermanentIds },
      );
      if (!resolvedPermanentId) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield.` };
      }
      if (usedPermanentIds.has(resolvedPermanentId)) {
        return { ok: false, code: 'INVALID_PAYMENT', message: 'A mana source can only be used once.' };
      }
      usedPermanentIds.add(resolvedPermanentId);
      resolvedPaymentEntries.push({
        permanentId: resolvedPermanentId,
        mana,
        count,
        abilityId,
        producedColors,
        floatingPoolKey: null,
      });

      const permanent = battlefield.find((entry: any) => entry?.id === resolvedPermanentId && entry?.controller === playerId);
      if (!permanent) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield.` };
      }
      if ((permanent as any).tapped) {
        return { ok: false, code: 'PAYMENT_SOURCE_TAPPED', message: `${(permanent as any).card?.name || 'Permanent'} is already tapped.` };
      }
      if (resolutionPaymentActivationCostHasUnsupportedAdditionalCosts(game, playerId, permanent, mana, abilityId)) {
        return {
          ok: false,
          code: 'INVALID_PAYMENT',
          message: `${(permanent as any).card?.name || 'Permanent'} requires an unsupported additional activation cost.`,
        };
      }

      const permCard = (permanent as any).card || {};
      const permTypeLine = String(permCard.type_line || '').toLowerCase();
      const permIsCreature = /\bcreature\b/.test(permTypeLine);
      const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
      if (permIsCreature && (permanent as any).summoningSickness && !hasHaste) {
        return {
          ok: false,
          code: 'SUMMONING_SICKNESS',
          message: `${permCard.name || 'Creature'} has summoning sickness and cannot use tap abilities this turn.`,
        };
      }

      const activationManaCost = getSupportedResolutionActivationManaCost(game, playerId, permanent, mana, abilityId);
      if (activationManaCost) {
        const activationValidationError = validateManaPayment(
          snapshotResolutionManaPool(activationSimulationPool),
          activationManaCost.colors,
          activationManaCost.generic,
        );
        if (activationValidationError) {
          return {
            ok: false,
            code: 'INSUFFICIENT_MANA',
            message: `${permCard.name || 'Permanent'} requires additional mana to activate. ${activationValidationError}`,
          };
        }

        consumeManaFromPool(
          activationSimulationPool,
          activationManaCost.colors,
          activationManaCost.generic,
          `[resolutionPaymentValidation:${permCard.name || permanentId}]`,
        );
      }

      const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
      const producedAmount = count != null
        ? Math.max(Number(count) || 0, Number(manaInfo.totalAmount || 0))
        : Number(manaInfo.totalAmount || 0);
      const explicitProducedManaTotals = Array.isArray(producedColors) && producedColors.length > 0
        ? getResolutionPaymentProducedManaTotals(mana, producedAmount, producedColors)
        : undefined;
      const explicitProducedAmount = explicitProducedManaTotals
        ? Object.values(explicitProducedManaTotals).reduce((sum: number, value) => sum + (typeof value === 'number' ? value : 0), 0)
        : 0;
      const poolKey = MANA_POOL_KEY_BY_SYMBOL[mana];
      if ((!explicitProducedManaTotals && (!poolKey || producedAmount <= 0)) || (explicitProducedManaTotals && explicitProducedAmount <= 0)) {
        return { ok: false, code: 'INVALID_PAYMENT', message: `Invalid mana payment from ${permCard.name || 'source'}.` };
      }

      if (explicitProducedManaTotals) {
        addResolutionManaTotals(totalAvailable, explicitProducedManaTotals);
        addResolutionManaTotals(activationSimulationPool, explicitProducedManaTotals);
      } else {
        totalAvailable[poolKey] = (totalAvailable[poolKey] || 0) + producedAmount;
        activationSimulationPool[poolKey] = (activationSimulationPool[poolKey] || 0) + producedAmount;
        for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
          const bonusKey = MANA_POOL_KEY_BY_SYMBOL[String(bonus?.color || '').toUpperCase()];
          const bonusAmount = Number(bonus?.amount || 0);
          if (bonusKey && bonusAmount > 0 && (count == null || bonusKey !== poolKey)) {
            totalAvailable[bonusKey] = (totalAvailable[bonusKey] || 0) + bonusAmount;
            activationSimulationPool[bonusKey] = (activationSimulationPool[bonusKey] || 0) + bonusAmount;
          }
        }
      }
    }

    for (const [poolKey, amount] of Object.entries(selectedFloatingMana)) {
      const needed = Number(amount || 0);
      if (needed <= 0) continue;
      const regularAvailable = Number(manaPool[poolKey] || 0);
      let eligibleRestricted = 0;
      if (purpose && Array.isArray(manaPool.restricted)) {
        for (const entry of manaPool.restricted) {
          if (!entry || !canUseRestrictedMana(entry, purpose)) continue;
          if (String((entry as any).type || '') !== poolKey) continue;
          eligibleRestricted += Number(entry.amount || 0);
        }
      }
      if (regularAvailable + eligibleRestricted < needed) {
        return { ok: false, code: 'INSUFFICIENT_MANA', message: `Not enough ${poolKey} mana selected from your pool.` };
      }
    }
  }

  const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
  if (validationError) {
    return { ok: false, code: 'INSUFFICIENT_MANA', message: validationError };
  }

  if (resolvedPaymentEntries.length > 0) {
    for (const { permanentId, mana, count, abilityId, producedColors, floatingPoolKey } of resolvedPaymentEntries) {
      if (floatingPoolKey) {
        const amount = Math.max(1, Number(count || 1));
        selectedPaymentAvailableTotals[floatingPoolKey] = (selectedPaymentAvailableTotals[floatingPoolKey] || 0) + amount;
        continue;
      }

      const permanent = battlefield.find((entry: any) => entry?.id === permanentId && entry?.controller === playerId);
      if (!permanent) {
        return { ok: false, code: 'PAYMENT_SOURCE_NOT_FOUND', message: `Permanent ${permanentId} not found on battlefield.` };
      }

      const permCard = (permanent as any).card || {};
      const activationManaCost = getSupportedResolutionActivationManaCost(game, playerId, permanent, mana, abilityId);
      if (activationManaCost) {
        consumeManaFromPool(
          manaPool,
          activationManaCost.colors,
          activationManaCost.generic,
          `[resolutionPaymentActivation:${permCard.name || permanentId}]`,
        );
      }

      if (resolutionManaSourceSelfSacrifices(game, playerId, permanent, mana, abilityId)) {
        sacrificedPermanents.push(String(permanentId));
      } else {
        (permanent as any).tapped = true;
        tappedPermanents.push(String(permanentId));
      }

      const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
      const producedAmount = count != null
        ? Math.max(Number(count) || 0, Number(manaInfo.totalAmount || 0))
        : Number(manaInfo.totalAmount || 0);
      const explicitProducedManaTotals = Array.isArray(producedColors) && producedColors.length > 0
        ? getResolutionPaymentProducedManaTotals(mana, producedAmount, producedColors)
        : undefined;
      const poolKey = MANA_POOL_KEY_BY_SYMBOL[mana];
      if (explicitProducedManaTotals) {
        addResolutionManaTotals(manaPool, explicitProducedManaTotals);
        addResolutionManaTotals(selectedPaymentAvailableTotals, explicitProducedManaTotals);
      } else if (poolKey && producedAmount > 0) {
        manaPool[poolKey] = (manaPool[poolKey] || 0) + producedAmount;
        selectedPaymentAvailableTotals[poolKey] = (selectedPaymentAvailableTotals[poolKey] || 0) + producedAmount;
      }

      for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
        if (explicitProducedManaTotals) {
          continue;
        }

        const bonusKey = MANA_POOL_KEY_BY_SYMBOL[String(bonus?.color || '').toUpperCase()];
        const bonusAmount = Number(bonus?.amount || 0);
        if (bonusKey && bonusAmount > 0 && (count == null || bonusKey !== poolKey)) {
          manaPool[bonusKey] = (manaPool[bonusKey] || 0) + bonusAmount;
          selectedPaymentAvailableTotals[bonusKey] = (selectedPaymentAvailableTotals[bonusKey] || 0) + bonusAmount;
        }
      }
    }

    if (sacrificedPermanents.length > 0) {
      for (const sacrificedPermanentId of sacrificedPermanents) {
        const bfBeforeSac2 = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const sacPerm2 = bfBeforeSac2.find((p: any) => p?.id === sacrificedPermanentId);
        const sacCard2 = sacPerm2 ? ((sacPerm2 as any).card || sacPerm2) : null;
        const sacOwner2 = String((sacPerm2 as any)?.owner || (sacPerm2 as any)?.controller || playerId).trim();
        const isToken2 = !!(sacPerm2 as any)?.isToken;
        sacrificePermanent(game as any, sacrificedPermanentId, playerId);
        if (isToken2 && sacCard2 && sacOwner2) {
          const zones2 = (game.state as any).zones = (game.state as any).zones || {};
          const pz2 = zones2[sacOwner2] = zones2[sacOwner2] || { graveyard: [], graveyardCount: 0 };
          pz2.graveyard = Array.isArray(pz2.graveyard) ? pz2.graveyard : [];
          const cardData2 = typeof sacCard2 === 'object' && sacCard2 !== null ? sacCard2 : null;
          if (cardData2 && !pz2.graveyard.some((c: any) => String(c?.id || '') === sacrificedPermanentId)) {
            pz2.graveyard.push({ ...(cardData2 as any), id: sacrificedPermanentId, zone: 'graveyard', isToken: true });
            pz2.graveyardCount = pz2.graveyard.length;
          }
        }
      }
    }

    // Resolve hybrid cost symbols (e.g. {W/B}) into concrete colored requirements based on
    // which colors the player selected to pay with. Without this step hybrid pip costs would
    // be silently dropped when consuming from the selected payment totals.
    const hybridResolvedColors: Record<string, number> = { ...parsedCost.colors } as Record<string, number>;
    let hybridResolvedGeneric = parsedCost.generic;
    const hybridSelectionPool: Record<string, number> = { ...selectedPaymentAvailableTotals };
    const HYBRID_POOL_KEY: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' };
    const hybridList = Array.isArray(parsedCost.hybrids) ? parsedCost.hybrids : [];
    for (const hybrid of hybridList) {
      if (!Array.isArray(hybrid) || hybrid.length === 0) continue;
      let chosen: string | null = null;
      for (const option of hybrid) {
        const opt = String(option || '');
        if (opt.startsWith('GENERIC:') || opt.startsWith('LIFE:')) continue;
        const poolKey = HYBRID_POOL_KEY[opt];
        if (poolKey && Number(hybridSelectionPool[poolKey] || 0) > 0) {
          chosen = opt;
          hybridSelectionPool[poolKey] = Number(hybridSelectionPool[poolKey] || 0) - 1;
          break;
        }
      }
      if (chosen) {
        hybridResolvedColors[chosen] = (Number(hybridResolvedColors[chosen] || 0)) + 1;
        continue;
      }
      // Fallback: treat as generic if a generic option exists, else first color option.
      const genericOpt = hybrid.find((o) => String(o || '').startsWith('GENERIC:'));
      if (genericOpt) {
        const amount = Number(String(genericOpt).split(':')[1] || 0) || 0;
        hybridResolvedGeneric += amount;
      } else {
        const firstColor = hybrid.find((o) => HYBRID_POOL_KEY[String(o || '')]);
        if (firstColor) {
          hybridResolvedColors[firstColor] = (Number(hybridResolvedColors[firstColor] || 0)) + 1;
        }
      }
    }

    const selectedConsumption = consumeExplicitSelectedResolutionMana(
      manaPool,
      selectedPaymentAvailableTotals,
      hybridResolvedColors,
      hybridResolvedGeneric,
      '[resolutionSelectedPayment]',
      purpose,
    );
    if ('error' in selectedConsumption) {
      return { ok: false, code: 'INSUFFICIENT_MANA', message: selectedConsumption.error };
    }
  } else if (purpose) {
    consumeManaFromPoolForPurpose(
      manaPool,
      parsedCost.colors,
      parsedCost.generic,
      purpose,
      '[resolutionSelectedPayment]',
    );
  } else {
    consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic, '[resolutionSelectedPayment]');
  }

  const paymentManaDelta = calculateResolutionManaPoolDelta(
    manaPoolBeforePayment,
    (game.state as any)?.manaPool?.[playerId],
  );
  persistResolutionPaymentManaMutations(game, playerId, tappedPermanents, paymentManaDelta, options);

  return {
    ok: true,
    tappedPermanents,
    sacrificedPermanents,
    paymentManaDelta,
  };
}
