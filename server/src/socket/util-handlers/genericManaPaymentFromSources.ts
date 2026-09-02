// server/src/socket/util-handlers/genericManaPaymentFromSources.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: tap/sacrifice auto-payment of generic and string mana costs
//   from available mana sources (getMaxGenericManaAvailable,
//   payManaCostWithAvailableSources, refund).
// Public entry symbols: getMaxGenericManaAvailable,
//   payGenericManaWithAvailableSources, canPayManaCostStringWithAvailableSources,
//   payManaCostWithAvailableSources, refundGenericManaPayment,
//   AvailableSourceManaPaymentResult.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import { getManaAbilitiesForPermanent, getEffectiveBasicLandTypes } from "../../state/modules/mana-abilities.js";
import { MANA_COLOR_KEYS } from "./manaColorConstants.js";
import { getOrInitManaPool } from "./manaPoolStateOperations.js";
import { resolveActivatedAbilityLineById } from "./manaAbilityLineResolvers.js";
import { calculateManaProduction } from "./calculateManaProduction.js";
import { consumeManaFromPool } from "./consumeManaFromPool.js";
import { applyManaAbilityLifeEffectToState, resolveManaAbilityLifeEffect } from "../../state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js";
import {
  getPoolNumericSnapshot,
  validateAndConsumeManaCostFromPool,
} from "./manaPoolCostPayment.js";

  type GenericManaPaymentOptions = {
    excludedPermanentIds?: string[];
  };

  type GenericManaPaymentResult = {
    ok: boolean;
    error?: string;
    tappedPermanents: string[];
    sacrificedPermanents: string[];
    paymentManaDelta: Record<string, number>;
    consumed: Record<string, number>;
  };

  function escapeRegExp(value: string): string {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isSelfSacrificeManaSource(permanent: any): boolean {
    const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
    const cardName = String(permanent?.card?.name || '').trim().toLowerCase();
    if (!oracleText.includes('add')) return false;
    if (/\bsacrifice\s+this\b[^:]*:\s*add\b/i.test(oracleText)) return true;
    if (cardName && new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b[^:]*:\\s*add\\b`, 'i').test(oracleText)) {
      return true;
    }
    return false;
  }

  function isPureSelfSacrificeActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return false;

    const cardName = String(permanent?.card?.name || '').trim();
    let normalized = costText;
    for (const pattern of [
      /\bsacrifice\s+(?:this|~|it)\b[^,]*/gi,
      cardName ? new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b[^,]*`, 'gi') : null,
    ]) {
      if (!pattern) continue;
      normalized = normalized.replace(pattern, ' ');
    }

    return normalized.replace(/[\s,]+/g, ' ').trim().length === 0;
  }

  function hasSelfSacrificeActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return false;

    const cardName = String(permanent?.card?.name || '').trim();
    return [
      /\bsacrifice\s+(?:this|~|it)\b/i,
      cardName ? new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b`, 'i') : null,
    ].some((pattern) => Boolean(pattern && pattern.test(costText)));
  }

  function isTapAndOrSelfSacrificeActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return false;

    const cardName = String(permanent?.card?.name || '').trim();
    let normalized = costText;
    for (const pattern of [
      /\bsacrifice\s+(?:this|~|it)\b[^,]*/gi,
      cardName ? new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b[^,]*`, 'gi') : null,
    ]) {
      if (!pattern) continue;
      normalized = normalized.replace(pattern, ' ');
    }

    normalized = normalized
      .replace(/\{t\}/gi, ' ')
      .replace(/[\s,]+/g, ' ')
      .trim();

    return normalized.length === 0;
  }

  function supportsGenericAutoPaymentActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return true;
    if (isTapAndOrSelfSacrificeActivationCost(permanent, costText)) return true;

    const manaSymbols = costText.match(/\{[^}]+\}/g) || [];
    if (manaSymbols.some((symbol) => !/^\{t\}$/i.test(symbol))) {
      return false;
    }

    const stripped = costText
      .replace(/\{t\}/gi, ' ')
      .replace(/[\s,]+/g, ' ')
      .trim()
      .toLowerCase();

    return stripped.length === 0;
  }

  function getBestGenericAutoPaymentOption(
    gameState: any,
    permanent: any,
    playerId: string,
  ): { amount: number; sacrificesSelf: boolean } | null {
    let bestOption: { amount: number; sacrificesSelf: boolean } | null = null;
    const genericAbilityPrefix = String(permanent?.id || 'permanent');
    let sawExplicitManaAbility = false;
    for (let index = 0; index < 50; index += 1) {
      const resolvedLine = resolveActivatedAbilityLineById(permanent, `${genericAbilityPrefix}-ability-${index}`);
      if (!resolvedLine) break;

      if (!/\badd\b/i.test(String(resolvedLine.effectText || ''))) continue;
      sawExplicitManaAbility = true;
      if (!supportsGenericAutoPaymentActivationCost(permanent, resolvedLine.costText)) continue;

      const production = calculateManaProduction(
        gameState,
        permanent,
        playerId,
        undefined,
        `${genericAbilityPrefix}-ability-${index}`,
      );
      const amount = Number(production?.totalAmount || production?.baseAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!Array.isArray(production?.colors) || production.colors.length === 0) continue;

      const candidate = {
        amount: Math.max(1, amount),
        sacrificesSelf: hasSelfSacrificeActivationCost(permanent, resolvedLine.costText),
      };

      if (!bestOption || candidate.amount > bestOption.amount) {
        bestOption = candidate;
      }
    }

    if (sawExplicitManaAbility) return bestOption;

    let manaAbilities: any[] = [];
    try {
      manaAbilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
    } catch {
      manaAbilities = [];
    }

    for (const ability of manaAbilities) {
      if (!supportsGenericAutoPaymentActivationCost(permanent, ability?.cost)) continue;

      const production = calculateManaProduction(gameState, permanent, playerId, undefined, ability?.id);
      const amount = Number(production?.totalAmount || production?.baseAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!Array.isArray(production?.colors) || production.colors.length === 0) continue;

      const candidate = {
        amount: Math.max(1, amount),
        sacrificesSelf: hasSelfSacrificeActivationCost(permanent, ability?.cost)
          || (!ability?.cost && isSelfSacrificeManaSource(permanent)),
      };

      if (!bestOption || candidate.amount > bestOption.amount) {
        bestOption = candidate;
      }
    }

    if (bestOption) return bestOption;
    if (manaAbilities.length > 0) return null;

    const production = calculateManaProduction(gameState, permanent, playerId);
    const amount = Number(production?.totalAmount || production?.baseAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!supportsGenericAutoPaymentActivationCost(permanent, production?.activationCost)) return null;
    if (!Array.isArray(production?.colors) || production.colors.length === 0) return null;

    return {
      amount: Math.max(1, amount),
      sacrificesSelf: hasSelfSacrificeActivationCost(permanent, production?.activationCost)
        || (!production?.activationCost && isSelfSacrificeManaSource(permanent)),
    };
  }

  function recordTokenGraveyardSnapshot(gameState: any, ownerId: string, permanent: any): void {
    const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
      ? { ...(permanent.card || {}), zone: 'graveyard' }
      : null;
    if (!tokenGraveyardSnapshot || !ownerId) return;

    const zones = (gameState.zones = gameState.zones || {});
    const playerZones = (zones[ownerId] = zones[ownerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

    const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
      if (!card) return false;
      const cardId = String((card as any).id || '').trim();
      const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
      if (cardId && snapshotId) return cardId === snapshotId;
      return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
    });

    if (!alreadyPresent) {
      (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
      playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
    }
  }

  function getGenericAutoPaymentCandidates(
    gameState: any,
    playerId: string,
    excludedPermanentIds?: string[],
  ): Array<{ permanent: any; amount: number; sacrificesSelf: boolean }> {
    const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
    const excluded = new Set((excludedPermanentIds || []).map((id) => String(id)));

    return battlefield
      .filter((permanent: any) => {
        if (!permanent) return false;
        if (String(permanent.controller || '') !== String(playerId)) return false;
        if (permanent.tapped) return false;
        if (excluded.has(String(permanent.id || ''))) return false;

        const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
        const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
        const grantedBasicTypes = typeLine.includes('land')
          ? getEffectiveBasicLandTypes(gameState, permanent)
          : [];
        const hasExplicitManaAbility =
          /\{t\}(?:[,\s]*[^:]*)?:\s*add/i.test(oracleText) ||
          oracleText.includes('mana of any color') ||
          oracleText.includes('any color') ||
          typeLine.includes('plains') ||
          typeLine.includes('island') ||
          typeLine.includes('swamp') ||
          typeLine.includes('mountain') ||
          typeLine.includes('forest') ||
          grantedBasicTypes.length > 0;
        if (!hasExplicitManaAbility) return false;

        return !!getBestGenericAutoPaymentOption(gameState, permanent, playerId);
      })
      .map((permanent: any) => {
        const option = getBestGenericAutoPaymentOption(gameState, permanent, playerId);
        return {
          permanent,
          amount: Math.max(1, Number(option?.amount || 0)),
          sacrificesSelf: option?.sacrificesSelf === true,
        };
      })
      .sort((left, right) => {
        const leftType = String(left.permanent?.card?.type_line || '').toLowerCase();
        const rightType = String(right.permanent?.card?.type_line || '').toLowerCase();
        const leftIsLand = leftType.includes('land') ? 0 : 1;
        const rightIsLand = rightType.includes('land') ? 0 : 1;
        if (leftIsLand !== rightIsLand) return leftIsLand - rightIsLand;
        const leftIsConsumable = left.sacrificesSelf ? 1 : 0;
        const rightIsConsumable = right.sacrificesSelf ? 1 : 0;
        if (leftIsConsumable !== rightIsConsumable) return leftIsConsumable - rightIsConsumable;
        return left.amount - right.amount;
      });
  }

  export function getMaxGenericManaAvailable(
    gameState: any,
    playerId: string,
    options?: GenericManaPaymentOptions,
  ): number {
    const pool = getOrInitManaPool(gameState, playerId) as any;
    const floating =
      Number(pool?.white || 0) +
      Number(pool?.blue || 0) +
      Number(pool?.black || 0) +
      Number(pool?.red || 0) +
      Number(pool?.green || 0) +
      Number(pool?.colorless || 0);

    const sourceTotal = getGenericAutoPaymentCandidates(gameState, playerId, options?.excludedPermanentIds)
      .reduce((sum, entry) => sum + entry.amount, 0);

    return floating + sourceTotal;
  }

  export function payGenericManaWithAvailableSources(
    gameState: any,
    playerId: string,
    amount: number,
    options?: GenericManaPaymentOptions,
  ): GenericManaPaymentResult {
    const needed = Math.max(0, Math.floor(Number(amount) || 0));
    const emptyConsumed = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    if (needed <= 0) {
      return { ok: true, tappedPermanents: [], sacrificedPermanents: [], paymentManaDelta: {}, consumed: emptyConsumed };
    }

    const maxAvailable = getMaxGenericManaAvailable(gameState, playerId, options);
    if (maxAvailable < needed) {
      return {
        ok: false,
        error: `Insufficient mana. Missing ${needed - maxAvailable} generic mana.`,
        tappedPermanents: [],
        sacrificedPermanents: [],
        paymentManaDelta: {},
        consumed: emptyConsumed,
      };
    }

    const pool = getOrInitManaPool(gameState, playerId) as any;
    const beforePool = {
      white: Number(pool.white || 0),
      blue: Number(pool.blue || 0),
      black: Number(pool.black || 0),
      red: Number(pool.red || 0),
      green: Number(pool.green || 0),
      colorless: Number(pool.colorless || 0),
    };
    const tappedPermanents: string[] = [];
    const sacrificedPermanents: string[] = [];
    const floating = Object.values(beforePool).reduce((sum, value) => sum + Number(value || 0), 0);
    let manaNeeded = Math.max(0, needed - floating);

    if (manaNeeded > 0) {
      for (const entry of getGenericAutoPaymentCandidates(gameState, playerId, options?.excludedPermanentIds)) {
        if (manaNeeded <= 0) break;

        const permanent = entry.permanent;
        if (!permanent || permanent.tapped) continue;

        if (entry.sacrificesSelf) {
          const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
          const sacrificed = movePermanentToGraveyard({
            state: gameState,
            libraries: new Map(),
            bumpSeq: () => undefined,
            rng: Math.random,
            gameId: '',
          } as any, String(permanent.id || ''), true);
          if (!sacrificed) continue;
          recordTokenGraveyardSnapshot(gameState, graveyardOwnerId, permanent);
          sacrificedPermanents.push(String(permanent.id || ''));
        } else {
          permanent.tapped = true;
          tappedPermanents.push(String(permanent.id || ''));
        }

        pool.colorless = Number(pool.colorless || 0) + entry.amount;
        manaNeeded -= entry.amount;
        applyManaAbilityLifeEffectToState(
          gameState,
          playerId,
          resolveManaAbilityLifeEffect({
            card: permanent?.card,
            producesColoredMana: false,
          }),
        );
      }
    }

    const { consumed } = consumeManaFromPool(pool, {}, needed, `[genericPayment:${playerId}]`);
    const paymentManaDelta: Record<string, number> = {};
    for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
      const delta = Number(pool[key] || 0) - beforePool[key];
      if (delta !== 0) paymentManaDelta[key] = delta;
    }

    return {
      ok: true,
      tappedPermanents,
      sacrificedPermanents,
      paymentManaDelta,
      consumed,
    };
  }

  type AvailableSourceManaPaymentPlanEntry = {
    permanent: any;
    additions: Record<string, number>;
    sacrificesSelf: boolean;
  };

  export type AvailableSourceManaPaymentResult = GenericManaPaymentResult;

  function getAvailableSourceManaPaymentOptions(
    gameState: any,
    playerId: string,
    excludedPermanentIds?: string[],
  ): Array<{ permanent: any; options: Array<{ additions: Record<string, number>; sacrificesSelf: boolean }> }> {
    const candidates = getGenericAutoPaymentCandidates(gameState, playerId, excludedPermanentIds);
    const symbolToPoolKey: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
      C: 'colorless',
    };

    return candidates.flatMap((candidate) => {
      const production = calculateManaProduction(gameState, candidate.permanent, playerId);
      const amount = Math.max(1, Number(production?.totalAmount || production?.baseAmount || candidate.amount || 0));
      const colors = Array.from(new Set(
        (Array.isArray(production?.colors) ? production.colors : [])
          .map((color: any) => String(color || '').toUpperCase())
          .filter(Boolean),
      ));
      if (colors.length === 0) return [];

      const options: Array<{ additions: Record<string, number>; sacrificesSelf: boolean }> = [];
      const isChoice = production?.requiresColorChoice === true || colors.includes('ANY');
      if (isChoice) {
        const choices = colors.includes('ANY')
          ? ['W', 'U', 'B', 'R', 'G']
          : colors.filter((color) => symbolToPoolKey[color]);
        for (const color of choices) {
          const poolKey = symbolToPoolKey[color];
          if (!poolKey) continue;
          options.push({
            additions: { [poolKey]: amount },
            sacrificesSelf: candidate.sacrificesSelf,
          });
        }
      } else if (colors.length > 1) {
        const amountPerColor = Math.max(1, Math.floor(amount / colors.length));
        const additions: Record<string, number> = {};
        for (const color of colors) {
          const poolKey = symbolToPoolKey[color];
          if (poolKey) additions[poolKey] = amountPerColor;
        }
        if (Object.keys(additions).length > 0) {
          options.push({ additions, sacrificesSelf: candidate.sacrificesSelf });
        }
      } else {
        const poolKey = symbolToPoolKey[colors[0]];
        if (poolKey) {
          options.push({
            additions: { [poolKey]: amount },
            sacrificesSelf: candidate.sacrificesSelf,
          });
        }
      }

      return options.length > 0 ? [{ permanent: candidate.permanent, options }] : [];
    });
  }

  function findAvailableSourceManaPaymentPlan(
    gameState: any,
    playerId: string,
    manaCost: string,
    excludedPermanentIds?: string[],
  ): AvailableSourceManaPaymentPlanEntry[] | null {
    const startingPool = getPoolNumericSnapshot(getOrInitManaPool(gameState, playerId));
    if (validateAndConsumeManaCostFromPool({ ...startingPool }, manaCost).ok) {
      return [];
    }

    const sources = getAvailableSourceManaPaymentOptions(gameState, playerId, excludedPermanentIds);
    const memo = new Set<string>();

    const search = (
      sourceIndex: number,
      pool: Record<string, number>,
      plan: AvailableSourceManaPaymentPlanEntry[],
    ): AvailableSourceManaPaymentPlanEntry[] | null => {
      if (validateAndConsumeManaCostFromPool({ ...pool }, manaCost).ok) {
        return plan;
      }
      if (sourceIndex >= sources.length) return null;

      const signature = `${sourceIndex}|${MANA_COLOR_KEYS.map((key) => Number(pool[key] || 0)).join(',')}`;
      if (memo.has(signature)) return null;
      memo.add(signature);

      const source = sources[sourceIndex];
      for (const option of source.options) {
        const nextPool = { ...pool };
        for (const [poolKey, rawAmount] of Object.entries(option.additions)) {
          nextPool[poolKey] = Number(nextPool[poolKey] || 0) + Number(rawAmount || 0);
        }
        const found = search(sourceIndex + 1, nextPool, [
          ...plan,
          {
            permanent: source.permanent,
            additions: option.additions,
            sacrificesSelf: option.sacrificesSelf,
          },
        ]);
        if (found) return found;
      }

      return search(sourceIndex + 1, pool, plan);
    };

    return search(0, startingPool, []);
  }

  export function canPayManaCostStringWithAvailableSources(
    gameState: any,
    playerId: string,
    manaCost: string,
    options?: GenericManaPaymentOptions,
  ): boolean {
    return findAvailableSourceManaPaymentPlan(
      gameState,
      playerId,
      manaCost,
      options?.excludedPermanentIds,
    ) !== null;
  }

  export function payManaCostWithAvailableSources(
    gameState: any,
    playerId: string,
    manaCost: string,
    options?: GenericManaPaymentOptions,
  ): AvailableSourceManaPaymentResult {
    const pool = getOrInitManaPool(gameState, playerId) as any;
    const beforePool = getPoolNumericSnapshot(pool);
    const emptyConsumed = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    const plan = findAvailableSourceManaPaymentPlan(
      gameState,
      playerId,
      manaCost,
      options?.excludedPermanentIds,
    );
    if (!plan) {
      return {
        ok: false,
        error: `Insufficient available mana to pay ${manaCost}.`,
        tappedPermanents: [],
        sacrificedPermanents: [],
        paymentManaDelta: {},
        consumed: emptyConsumed,
      };
    }

    const tappedPermanents: string[] = [];
    const sacrificedPermanents: string[] = [];
    for (const entry of plan) {
      const permanent = entry.permanent;
      if (!permanent || permanent.tapped) continue;
      if (entry.sacrificesSelf) {
        const ownerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
        const sacrificed = movePermanentToGraveyard({
          state: gameState,
          libraries: new Map(),
          bumpSeq: () => undefined,
          rng: Math.random,
          gameId: '',
        } as any, String(permanent.id || ''), true);
        if (!sacrificed) continue;
        recordTokenGraveyardSnapshot(gameState, ownerId, permanent);
        sacrificedPermanents.push(String(permanent.id || ''));
      } else {
        permanent.tapped = true;
        tappedPermanents.push(String(permanent.id || ''));
      }
      for (const [poolKey, rawAmount] of Object.entries(entry.additions)) {
        pool[poolKey] = Number(pool[poolKey] || 0) + Number(rawAmount || 0);
      }
      const producesColoredMana = Object.entries(entry.additions || {}).some(
        ([poolKey, rawAmount]) => poolKey !== 'colorless' && Number(rawAmount || 0) > 0,
      );
      applyManaAbilityLifeEffectToState(
        gameState,
        playerId,
        resolveManaAbilityLifeEffect({
          card: permanent?.card,
          producesColoredMana,
        }),
      );
    }

    const paid = validateAndConsumeManaCostFromPool(pool, manaCost, {
      logPrefix: `[availableSourcePayment:${playerId}]`,
    });
    if (!paid.ok) {
      for (const permanentId of tappedPermanents) {
        const permanent = (Array.isArray(gameState?.battlefield) ? gameState.battlefield : [])
          .find((entry: any) => String(entry?.id || '') === permanentId);
        if (permanent) permanent.tapped = false;
      }
      for (const key of MANA_COLOR_KEYS) {
        pool[key] = Number(beforePool[key] || 0);
      }
      return {
        ok: false,
        error: (paid as any).error || `Unable to pay ${manaCost}.`,
        tappedPermanents: [],
        sacrificedPermanents,
        paymentManaDelta: {},
        consumed: emptyConsumed,
      };
    }

    const paymentManaDelta: Record<string, number> = {};
    for (const key of MANA_COLOR_KEYS) {
      const delta = Number(pool[key] || 0) - Number(beforePool[key] || 0);
      if (delta !== 0) paymentManaDelta[key] = delta;
    }
    return {
      ok: true,
      tappedPermanents,
      sacrificedPermanents,
      paymentManaDelta,
      consumed: paid.consumed,
    };
  }

  export function refundGenericManaPayment(
    gameState: any,
    playerId: string,
    payment: Pick<GenericManaPaymentResult, 'paymentManaDelta' | 'tappedPermanents'>,
  ): void {
    const pool = getOrInitManaPool(gameState, playerId) as any;
    for (const [poolKey, rawAmount] of Object.entries(payment.paymentManaDelta || {})) {
      const amount = Number(rawAmount || 0);
      if (!Number.isFinite(amount) || amount === 0) continue;
      pool[poolKey] = Number(pool[poolKey] || 0) - amount;
    }

    const tappedIds = new Set((payment.tappedPermanents || []).map((id) => String(id)).filter(Boolean));
    if (tappedIds.size === 0) return;

    const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent) continue;
      if (!tappedIds.has(String((permanent as any).id || ''))) continue;
      (permanent as any).tapped = false;
    }
  }
