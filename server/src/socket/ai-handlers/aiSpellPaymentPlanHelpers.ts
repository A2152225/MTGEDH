/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: 2-space-indented spell-payment plan helpers that lived
 * after getPaymentSources (chooseAISacrificePermanentForManaAbility through
 * chooseAISpellPaymentSelections).
 *
 * Public entry symbols: chooseAISacrificePermanentForManaAbility,
 * chooseAISacrificePermanentsForManaAbility, buildAIAvailableManaForSpellPayment,
 * buildAISpellPaymentPlan, cloneAISpellPaymentSimulationGame,
 * canAIAssembleSpellPaymentPlan, chooseAssembleableSpellXValueFromStep,
 * getAINonTapManaAbilityCandidates, chooseAISpellPaymentSelections.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { parseSacrificeCost } from "../../../../shared/src/textUtils.js";
import { getTotalManaFromPool, parseManaCost } from "../../state/modules/mana-check.js";
import {
  applyChosenXToManaCost,
  chooseSpellXValueFromStep,
  findSpellCardForXSelection,
} from "../../state/modules/spellXCastUtils.js";
import {
  calculateManaProduction,
  consumeManaFromPool,
  getOrInitManaPool,
  validateManaPayment,
  type RestrictedManaSpendPurpose,
} from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { COLOR_IDENTITY_MAP } from "./aiConstants.js";
import type { AIResolvedActivatedAbilityAction } from "./aiAbilityActivationTypes.js";
import {
  hasManaAbility,
  scoreAISacrificePermanentForManaAbility,
} from "./aiManaCostHelpers.js";
import {
  getAINonTapManaActionAmount,
  selectAINonTapManaActivationAction,
  tryActivateAINonTapManaAbilityForSpellPaymentSimulation,
  tryAIManaBatteryColorFixForSpellPayment,
  tryAIManaBatteryColorFixForSpellPaymentSimulation,
} from "./aiManaActivationHelpers.js";

function getPaymentSources(
  game: any,
  playerId: PlayerID,
  cost: { colors: Record<string, number>; generic: number },
  options?: { restrictedSpendPurpose?: RestrictedManaSpendPurpose },
) {
  return getAIHandlerDeps().getPaymentSources(game, playerId, cost, options);
}

function buildAISpellRestrictedManaPurpose(card: any): RestrictedManaSpendPurpose | undefined {
  if (!card) return undefined;
  const typeLine = String(card?.type_line || '').toLowerCase();
  return {
    spellCard: card,
    ...(typeLine.includes('creature') ? { isCreature: true } : {}),
    ...(typeLine.includes('artifact') ? { isArtifact: true } : {}),
    ...(typeLine.includes('legendary') ? { isLegendary: true } : {}),
    ...((/\binstant\b/.test(typeLine) || /\bsorcery\b/.test(typeLine)) ? { isInstantOrSorcery: true } : {}),
  };
}

function resolveAISpellPaymentSpellCard(game: any, step: any): any {
  const effectId = String(step?.effectId || '').trim();
  const pendingCast = effectId ? (game?.state as any)?.pendingSpellCasts?.[effectId] : undefined;
  return pendingCast?.card
    || step?.spellCastContext?.card
    || step?.card
    || null;
}

async function executeAIActivateAbility(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  action: any,
  continueAfterResolution = true,
): Promise<boolean> {
  return getAIHandlerDeps().executeAIActivateAbility(io, gameId, playerId, action, continueAfterResolution);
}

export function chooseAISacrificePermanentForManaAbility(
    game: any,
    playerId: PlayerID,
    sourcePermanent: any,
    costSection: string,
  ): any | null {
    const chosenIds = chooseAISacrificePermanentsForManaAbility(game, playerId, sourcePermanent, costSection);
    if (chosenIds.length === 0) {
      return null;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    return battlefield.find((permanent: any) => String(permanent?.id || '') === String(chosenIds[0] || '')) || null;
  }

export function chooseAISacrificePermanentsForManaAbility(
    game: any,
    playerId: PlayerID,
    sourcePermanent: any,
    costSection: string,
    unavailablePermanentIds?: Set<string>,
  ): string[] {
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const sacrificeInfo = parseSacrificeCost(String(costSection || ''));
    if (!sacrificeInfo.requiresSacrifice || !sacrificeInfo.sacrificeType || sacrificeInfo.sacrificeType === 'self') {
      return [];
    }

    const blockedIds = unavailablePermanentIds || new Set<string>();
    const requiredCount = Math.max(1, Number(sacrificeInfo.sacrificeCount || 1));

    const candidates = battlefield
      .filter((permanent: any) => {
        if (!permanent || permanent.controller !== playerId) return false;
        if (blockedIds.has(String(permanent.id || ''))) return false;
        if ((permanent as any)?.isCommander) return false;

        const permanentId = String(permanent.id || '');
        const typeLine = String(permanent.card?.type_line || '').toLowerCase();
        const subtypeWords = typeLine
          .split(/[—-]/)
          .slice(1)
          .join(' ')
          .split(/[^a-z0-9']+/i)
          .map((part) => part.trim())
          .filter(Boolean);

        if (sacrificeInfo.mustBeOther && permanentId === String(sourcePermanent?.id || '')) {
          return false;
        }

        switch (sacrificeInfo.sacrificeType) {
          case 'creature':
            if (!typeLine.includes('creature')) return false;
            if (sacrificeInfo.creatureSubtype) {
              return subtypeWords.includes(String(sacrificeInfo.creatureSubtype || '').toLowerCase());
            }
            return true;
          case 'artifact':
            return typeLine.includes('artifact');
          case 'enchantment':
            return typeLine.includes('enchantment');
          case 'land':
            return typeLine.includes('land');
          case 'permanent':
            return true;
          case 'artifact_or_creature':
            return typeLine.includes('artifact') || typeLine.includes('creature');
          default:
            return false;
        }
      })
      .sort((left: any, right: any) =>
        scoreAISacrificePermanentForManaAbility(game, playerId, left) -
        scoreAISacrificePermanentForManaAbility(game, playerId, right)
      );

    if (candidates.length < requiredCount) {
      return [];
    }

    return candidates.slice(0, requiredCount).map((permanent: any) => String(permanent.id || '')).filter(Boolean);
  }

export function buildAIAvailableManaForSpellPayment(
    game: any,
    playerId: PlayerID,
    paymentSources: Array<{ sourceId: string; produceColor: string; abilityId?: string; count?: number; sacrificedPermanentIds?: string[] }>,
  ): Record<string, number> {
    const pool = getOrInitManaPool(game.state, String(playerId)) as any;
    const totalAvailable: Record<string, number> = {
      white: Number(pool.white || 0),
      blue: Number(pool.blue || 0),
      black: Number(pool.black || 0),
      red: Number(pool.red || 0),
      green: Number(pool.green || 0),
      colorless: Number(pool.colorless || 0),
    };
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];

    // Process free taps before invest-cost lines so activation costs can be paid from
    // mana floated earlier in the same batched payment (Three Tree City / Nykthos).
    const orderedSources = [...paymentSources].sort((left, right) => {
      const leftPermanent = battlefield.find((entry: any) => String(entry?.id || '') === String(left.sourceId || ''));
      const rightPermanent = battlefield.find((entry: any) => String(entry?.id || '') === String(right.sourceId || ''));
      const leftCost = String(calculateManaProduction(
        game.state,
        leftPermanent,
        String(playerId),
        left.produceColor,
        left.abilityId,
      )?.activationCost || '').trim();
      const rightCost = String(calculateManaProduction(
        game.state,
        rightPermanent,
        String(playerId),
        right.produceColor,
        right.abilityId,
      )?.activationCost || '').trim();
      return Number(Boolean(leftCost)) - Number(Boolean(rightCost));
    });

    for (const source of orderedSources) {
      const permanent = battlefield.find((entry: any) =>
        entry &&
        String(entry.id || '') === String(source.sourceId || '') &&
        entry.controller === playerId &&
        !entry.tapped
      );
      if (!permanent) continue;

      const manaInfo = calculateManaProduction(game.state, permanent, String(playerId), source.produceColor, source.abilityId);
      const activationCostText = String(manaInfo?.activationCost || '').trim();
      if (activationCostText) {
        const parsedActivation = parseManaCost(activationCostText);
        const hasManaActivation = Number(parsedActivation.generic || 0) > 0
          || Object.values(parsedActivation.colors || {}).some((value) => Number(value || 0) > 0);
        // `{T}` / `{Q}` are not mana costs — consuming them only spams logs and can
        // look like the AI is looping on Three Tree City / similar dual-ability lands.
        if (hasManaActivation) {
          if (validateManaPayment(totalAvailable, parsedActivation.colors, parsedActivation.generic)) {
            // Cannot pay this source's activation cost from floated mana — ignore it.
            continue;
          }
          consumeManaFromPool(
            totalAvailable,
            parsedActivation.colors,
            parsedActivation.generic,
            `[aiSpellPaymentActivation:${String(permanent?.card?.name || source.sourceId)}]`,
          );
        }
      }

      const poolKey = COLOR_IDENTITY_MAP[String(source.produceColor || '').toUpperCase()] || 'colorless';
      totalAvailable[poolKey] = Number(totalAvailable[poolKey] || 0) + Number(manaInfo.totalAmount || 0);

      for (const bonus of manaInfo.bonusMana || []) {
        const bonusKey = COLOR_IDENTITY_MAP[String(bonus?.color || '').toUpperCase()] || 'colorless';
        totalAvailable[bonusKey] = Number(totalAvailable[bonusKey] || 0) + Number(bonus?.amount || 0);
      }
    }

    return totalAvailable;
  }

  function canAIPaySpellCostWithPaymentSources(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    paymentSources: Array<{ sourceId: string; produceColor: string; abilityId?: string; count?: number; sacrificedPermanentIds?: string[] }>,
  ): boolean {
    const totalAvailable = buildAIAvailableManaForSpellPayment(game, playerId, paymentSources);
    return !validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
  }

export function buildAISpellPaymentPlan(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludePermanentIds: string[] = [],
    restrictedSpendPurpose?: RestrictedManaSpendPurpose,
  ): { payment: Array<{ permanentId: string; mana: string; count?: number; abilityId?: string }> } | null {
    const excluded = new Set(excludePermanentIds.map((id) => String(id || '').trim()).filter(Boolean));
    if (canAIPaySpellCostWithPaymentSources(game, playerId, parsedCost, [])) {
      return { payment: [] };
    }

    const paymentSources = getPaymentSources(game, playerId, {
      colors: { ...(parsedCost.colors || {}) },
      generic: Number(parsedCost.generic || 0),
    }, restrictedSpendPurpose ? { restrictedSpendPurpose } : undefined).filter((source) => !excluded.has(String(source.sourceId || '')));
    if (!canAIPaySpellCostWithPaymentSources(game, playerId, parsedCost, paymentSources)) {
      return null;
    }

    return {
      payment: paymentSources.map((source) => ({
        permanentId: String(source.sourceId),
        mana: String(source.produceColor).toUpperCase(),
        ...(source.count != null ? { count: Number(source.count) } : {}),
        ...(source.abilityId ? { abilityId: String(source.abilityId) } : {}),
        ...(source.sacrificedPermanentIds && source.sacrificedPermanentIds.length > 0
          ? { sacrificedPermanentIds: source.sacrificedPermanentIds.map((id) => String(id || '')) }
          : {}),
        ...(Array.isArray((source as any).producedColors) && (source as any).producedColors.length > 0
          ? { producedColors: (source as any).producedColors.map((color: string) => String(color || '').toUpperCase()) }
          : {}),
      })),
    };
  }

export function cloneAISpellPaymentSimulationGame(game: any): any {
    return {
      state: JSON.parse(JSON.stringify(game?.state || {})),
    };
  }

export function canAISimulateNonTapManaToPaySpell(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludedHandCardIds?: string[],
  ): boolean {
    if (getAINonTapManaAbilityCandidates(game, playerId, parsedCost, excludedHandCardIds).length > 0) {
      return true;
    }
    const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
    return battlefield.some((permanent: any) => {
      if (String(permanent?.controller || '') !== String(playerId)) return false;
      if (!hasManaAbility(permanent?.card)) return false;
      return /charge counter/i.test(String(permanent?.card?.oracle_text || ''));
    });
  }

export function chooseAssembleableSpellXValueFromStep(game: any, playerId: PlayerID, step: any): number {
    const chosenX = chooseSpellXValueFromStep(game, playerId, step);
    if (step?.spellCastXSelection !== true) return chosenX;

    const minValue = Number.isFinite(Number(step?.minValue))
      ? Math.max(0, Math.floor(Number(step.minValue)))
      : 0;
    const spellCard = findSpellCardForXSelection(game, playerId, step);
    const manaCost = String(spellCard?.manaCost || spellCard?.mana_cost || '').trim();
    if (!manaCost.includes('X')) return chosenX;

    const excludedHandCardIds = spellCard?.id ? [String(spellCard.id)] : undefined;
    for (let candidate = chosenX; candidate >= minValue; candidate -= 1) {
      const parsedCost = parseManaCost(applyChosenXToManaCost(manaCost, candidate));
      if (canAIAssembleSpellPaymentPlan(game, playerId, parsedCost, excludedHandCardIds, spellCard)) {
        return candidate;
      }
    }
    return minValue;
  }

  export function canAIAssembleSpellPaymentPlan(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludedHandCardIds?: string[],
    spellCard?: any,
  ): boolean {
    const purpose = buildAISpellRestrictedManaPurpose(spellCard);
    if (buildAISpellPaymentPlan(game, playerId, parsedCost, [], purpose) !== null) {
      return true;
    }

    // JSON-cloning the full game is only useful when a non-tap mana ability or
    // charge-counter battery might still produce the missing mana. Tap-land
    // mismatches (canPay yes, assemble no) must fail cheaply so listing does
    // not queue a 8–15s mana_payment_choice the AI will cancel.
    if (!canAISimulateNonTapManaToPaySpell(game, playerId, parsedCost, excludedHandCardIds)) {
      return false;
    }

    const simulatedGame = cloneAISpellPaymentSimulationGame(game);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const activated = tryActivateAINonTapManaAbilityForSpellPaymentSimulation(simulatedGame, playerId, parsedCost, excludedHandCardIds)
        || tryAIManaBatteryColorFixForSpellPaymentSimulation(simulatedGame, playerId, parsedCost);
      if (!activated) {
        break;
      }

      if (buildAISpellPaymentPlan(simulatedGame, playerId, parsedCost, [], purpose) !== null) {
        return true;
      }
    }

    return false;
  }

export function getAINonTapManaAbilityCandidates(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludedHandCardIds?: string[],
  ): Array<{ permanent: any; action: AIResolvedActivatedAbilityAction }> {
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];

    return battlefield
      .map((permanent: any) => {
        if (!permanent || permanent.controller !== playerId) return false;
        if (!hasManaAbility(permanent.card)) return false;

        const action = selectAINonTapManaActivationAction(game, playerId, permanent, parsedCost, excludedHandCardIds);
        if (!action) return null;
        return { permanent, action };
      })
      .filter((entry): entry is { permanent: any; action: AIResolvedActivatedAbilityAction } => Boolean(entry))
      .sort((left, right) => {
        const leftText = String(left.action?.abilityText || '').toLowerCase();
        const rightText = String(right.action?.abilityText || '').toLowerCase();
        const leftHasSacrifice = /\bsacrifice\b/i.test(leftText);
        const rightHasSacrifice = /\bsacrifice\b/i.test(rightText);
        if (leftHasSacrifice !== rightHasSacrifice) return leftHasSacrifice ? -1 : 1;

        const leftMana = getAINonTapManaActionAmount(game, playerId, left.permanent, left.action);
        const rightMana = getAINonTapManaActionAmount(game, playerId, right.permanent, right.action);
        return rightMana - leftMana;
      });
  }

  async function tryActivateAINonTapManaAbilityForSpellPayment(
    io: Server,
    gameId: string,
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludedHandCardIds?: string[],
  ): Promise<boolean> {
    const candidates = getAINonTapManaAbilityCandidates(game, playerId, parsedCost, excludedHandCardIds);
    if (candidates.length === 0) return false;

    for (const candidate of candidates) {
      const permanentId = String(candidate.permanent?.id || '');
      if (!permanentId) continue;

      const manaPoolBefore = getOrInitManaPool(game.state, String(playerId)) as any;
      const totalBefore = getTotalManaFromPool(manaPoolBefore);

      const activationAction = candidate.action || {
        cardName: String(candidate.permanent?.card?.name || 'Mana Ability'),
        permanentId,
        abilityText: String(candidate.permanent?.card?.oracle_text || ''),
      };

      await executeAIActivateAbility(
        io,
        gameId,
        playerId,
        activationAction,
        false,
      );

      const manaPoolAfter = getOrInitManaPool(game.state, String(playerId)) as any;
      const totalAfter = getTotalManaFromPool(manaPoolAfter);
      if (totalAfter > totalBefore) {
        return true;
      }
    }

    return false;
  }

  export async function chooseAISpellPaymentSelections(
    io: Server,
    gameId: string,
    game: any,
    playerId: PlayerID,
    step: any,
  ): Promise<{ payment: Array<{ permanentId: string; mana: string; count?: number; abilityId?: string }> } | null> {
    const manaCostText = String(step?.totalManaCost || step?.manaCost || '').trim();
    const parsedCost = parseManaCost(manaCostText);
    const needsMana = Number(parsedCost.generic || 0) > 0 || Object.values(parsedCost.colors || {}).some((value) => Number(value || 0) > 0);

    if (!needsMana) {
      return { payment: [] };
    }

    const excludedHandCardIds = Array.from(new Set(
      [String(step?.spellCastContext?.cardId || ''), String(step?.cardId || '')]
        .map((id) => id.trim())
        .filter(Boolean),
    ));
    const activatingPermanentId = step?.activationPaymentChoice === true
      ? String(step?.permanentId || step?.sourceId || '').trim()
      : '';
    const excludePermanentIds = activatingPermanentId ? [activatingPermanentId] : [];
    const restrictedSpendPurpose = buildAISpellRestrictedManaPurpose(resolveAISpellPaymentSpellCard(game, step));

    const buildPlan = () => buildAISpellPaymentPlan(game, playerId, parsedCost, excludePermanentIds, restrictedSpendPurpose);

    let plan = buildPlan();
    if (plan) return plan;

    // Tap-land / bounce mismatches must fail immediately. The battery-color-fix
    // loop JSON-clones the battlefield and can block the event loop for 30–50s.
    if (!canAISimulateNonTapManaToPaySpell(game, playerId, parsedCost, excludedHandCardIds)) {
      return null;
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      const activated = await tryActivateAINonTapManaAbilityForSpellPayment(io, gameId, game, playerId, parsedCost, excludedHandCardIds)
        || await tryAIManaBatteryColorFixForSpellPayment(io, gameId, game, playerId, parsedCost);
      if (!activated) break;

      plan = buildPlan();
      if (plan) return plan;

      if (canAIPaySpellCostWithPaymentSources(game, playerId, parsedCost, [])) {
        return { payment: [] };
      }
    }

    return null;
  }
