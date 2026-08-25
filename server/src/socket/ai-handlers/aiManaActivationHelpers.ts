/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: 2-space-indented mana/payment/activation helpers that lived
 * between snapshotAIAbilityActivationState and didAIAbilityActivationProgress.
 *
 * Public entry symbols: resolveAIPaymentManaAbilityId,
 * selectAIManaRetentionActivationAction, selectAINonTapManaActivationAction,
 * getAINonTapManaActionAmount, chooseAIReturnToHandPermanentForManaAbility,
 * tryActivateAINonTapManaAbilityForSpellPaymentSimulation,
 * tryAIManaBatteryColorFixForSpellPaymentSimulation,
 * tryAIManaBatteryColorFixForSpellPayment.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { parseNumberFromText, parseSacrificeCost } from "../../../../shared/src/textUtils.js";
import { isPowerScaledGreenManaAbilityText } from "../../../../rules-engine/src/aiEngineManaPoolSupport.js";
import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import {
  getTotalManaFromPool,
  parseHandCostFromManaAbilityCost,
  parseManaCost,
  parseReturnToHandCostFromManaAbilityCost,
  type ParsedManaCost,
} from "../../state/modules/mana-check.js";
import {
  calculateManaProduction,
  consumeManaFromPool,
  getOrInitManaPool,
  getPermanentCounterAmount,
  parseRemoveCounterActivationCost,
  permanentHasManaBatteryCounterLoop,
  validateManaPayment,
} from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { COLOR_IDENTITY_MAP } from "./aiConstants.js";
import type {
  AIActivatedAbilityResolverCandidate,
  AIResolvedActivatedAbilityAction,
} from "./aiAbilityActivationTypes.js";
import { permanentHasLeaveBattlefieldExileReplacement } from "./aiDeckProfileHandlers.js";
import {
  chooseAIManaColorForActivation,
  getAIManaProductionOptions,
  hasCreatureSummoningSickness,
  hasManaAbility,
  scoreAISacrificePermanentForManaAbility,
} from "./aiManaCostHelpers.js";

function buildAIActivatedAbilityResolverCandidates(permanent: any): AIActivatedAbilityResolverCandidate[] {
  return getAIHandlerDeps().buildAIActivatedAbilityResolverCandidates(permanent);
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

function getPaymentSources(
  game: any,
  playerId: PlayerID,
  cost: { colors: Record<string, number>; generic: number },
) {
  return getAIHandlerDeps().getPaymentSources(game, playerId, cost);
}

function cloneAISpellPaymentSimulationGame(game: any): any {
  return getAIHandlerDeps().cloneAISpellPaymentSimulationGame(game);
}

function buildAISpellPaymentPlan(
  game: any,
  playerId: PlayerID,
  parsedCost: ReturnType<typeof parseManaCost>,
  excludePermanentIds: string[] = [],
) {
  return getAIHandlerDeps().buildAISpellPaymentPlan(game, playerId, parsedCost, excludePermanentIds);
}

function chooseAISacrificePermanentsForManaAbility(
  game: any,
  playerId: PlayerID,
  sourcePermanent: any,
  costSection: string,
  unavailablePermanentIds?: Set<string>,
): string[] {
  return getAIHandlerDeps().chooseAISacrificePermanentsForManaAbility(
    game,
    playerId,
    sourcePermanent,
    costSection,
    unavailablePermanentIds,
  );
}

function buildAIAvailableManaForSpellPayment(
  game: any,
  playerId: PlayerID,
  paymentSources: Array<{ sourceId: string; produceColor: string; abilityId?: string; count?: number; sacrificedPermanentIds?: string[] }>,
): Record<string, number> {
  return getAIHandlerDeps().buildAIAvailableManaForSpellPayment(game, playerId, paymentSources);
}

function getAINonTapManaAbilityCandidates(
  game: any,
  playerId: PlayerID,
  parsedCost: ReturnType<typeof parseManaCost>,
  excludedHandCardIds?: string[],
): Array<{ permanent: any; action: AIResolvedActivatedAbilityAction }> {
  return getAIHandlerDeps().getAINonTapManaAbilityCandidates(game, playerId, parsedCost, excludedHandCardIds);
}

  function isAIManaAbilityResolverCandidate(candidate: AIActivatedAbilityResolverCandidate): boolean {
    const effectText = String(candidate?.effect || candidate?.text || '');
    return /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(effectText) &&
      !/target/i.test(effectText);
  }

  function getAIManaAbilityCandidateColors(candidate: AIActivatedAbilityResolverCandidate): string[] {
    const effectText = String(candidate?.effect || candidate?.text || '');
    // Three Tree City / similar: "Choose a color. Add an amount of mana of that color..."
    if (
      /one mana of any color|any color of mana|mana of any one color|one mana of any type/i.test(effectText)
      || /choose a colou?r/i.test(effectText)
      || /mana of that colou?r/i.test(effectText)
    ) {
      return ['W', 'U', 'B', 'R', 'G'];
    }

    const manaSymbols = effectText.match(/\{([wubrgc])\}/gi) || [];
    return [...new Set(manaSymbols
      .map((token) => token.replace(/[{}]/g, '').toUpperCase())
      .filter((color) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color)))];
  }

export function resolveAIPaymentManaAbilityId(game: any, playerId: PlayerID, permanent: any, manaColor: string): string | undefined {
    const normalizedManaColor = String(manaColor || '').toUpperCase();
    const candidates = buildAIActivatedAbilityResolverCandidates(permanent).filter(isAIManaAbilityResolverCandidate);
    if (candidates.length === 0) {
      return undefined;
    }

    let bestCandidate: AIActivatedAbilityResolverCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const candidateColors = getAIManaAbilityCandidateColors(candidate);
      const normalizedText = String(candidate?.text || '').toLowerCase();
      const normalizedEffect = String(candidate?.effect || '').toLowerCase();
      const isAnyColorCandidate = /one mana of any color|any color of mana|mana of any one color|one mana of any type/i.test(normalizedEffect);

      let score = 0;
      if (normalizedManaColor) {
        if (candidateColors.includes(normalizedManaColor)) {
          score += 100;
        } else if (isAnyColorCandidate && normalizedManaColor !== 'C') {
          score += 80;
        } else {
          continue;
        }

        if (candidateColors.length === 1 && candidateColors[0] === normalizedManaColor) {
          score += 15;
        }
      }

      const producedAmount = Number(
        calculateManaProduction(game.state, permanent, String(playerId), normalizedManaColor, candidate.id).totalAmount || 0
      );
      if (producedAmount <= 0) {
        continue;
      }
      score += producedAmount * 25;

      if (!/pay\s+\d+\s+life/i.test(normalizedText)) {
        score += 4;
      } else {
        score -= 8;
      }

      if (/\bsacrifice\b/i.test(normalizedText)) {
        score -= 12;
      }

      if (!/\bor\b/i.test(normalizedEffect)) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestCandidate?.id || undefined;
  }

export function selectAIManaRetentionActivationAction(
    game: any,
    playerId: PlayerID,
    permanent: any,
    retainedColors: Set<string>,
    hasAllRetention: boolean,
    hasColorlessConversion: boolean,
  ): AIResolvedActivatedAbilityAction | null {
    const candidates = buildAIActivatedAbilityResolverCandidates(permanent).filter(isAIManaAbilityResolverCandidate);
    if (candidates.length === 0) {
      return null;
    }

    const retainedColorList = Array.from(retainedColors);
    let bestCandidate: AIActivatedAbilityResolverCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const candidateColors = getAIManaAbilityCandidateColors(candidate);
      if (candidateColors.length === 0) {
        continue;
      }

      const normalizedText = String(candidate?.text || '').toLowerCase();
      const normalizedEffect = String(candidate?.effect || '').toLowerCase();
      const canProduceRetainedColor = retainedColorList.some((color) => candidateColors.includes(color));
      const isAnyColorCandidate = /one mana of any color|any color of mana|mana of any one color|one mana of any type/i.test(normalizedEffect);

      let score = 0;

      if (retainedColorList.length > 0) {
        score += canProduceRetainedColor || isAnyColorCandidate ? 40 : -25;
      }

      if (hasAllRetention) {
        score += 10;
        if (candidateColors.length === 1 && candidateColors[0] === 'C') {
          score += 20;
        }
      }

      if (hasColorlessConversion && candidateColors.includes('C')) {
        score += 20;
      }

      if (candidateColors.length === 1) {
        score += 8;
      }

      if (!/pay\s+\d+\s+life/i.test(normalizedText)) {
        score += 4;
      } else {
        score -= 8;
      }

      if (!/\bor\b/i.test(normalizedEffect)) {
        score += 3;
      }

      const producedAmount = Number(
        calculateManaProduction(game.state, permanent, String(playerId), 'G', candidate.id).totalAmount || 0
      );
      if (producedAmount > 0) {
        score += producedAmount * 30;
      }
      if (isPowerScaledGreenManaAbilityText(normalizedEffect)) {
        score += 25;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      bestCandidate = candidates[0];
    }

    return {
      permanentId: String(permanent?.id || ''),
      cardName: String(permanent?.card?.name || ''),
      abilityId: String(bestCandidate?.id || ''),
      abilityText: String(bestCandidate?.text || ''),
    };
  }

  function getAINonTapManaResolverCandidates(
    game: any,
    playerId: PlayerID,
    permanent: any,
    excludedHandCardIds?: string[],
  ): AIActivatedAbilityResolverCandidate[] {
    return buildAIActivatedAbilityResolverCandidates(permanent)
      .filter(isAIManaAbilityResolverCandidate)
      .filter((candidate) => !/\{[^}]*\bT\b[^}]*\}/i.test(String(candidate?.text || '')))
      .filter((candidate) => {
        const costSection = String(candidate?.text || '').split(':')[0] || '';
        const removeCounterCost = parseRemoveCounterActivationCost(
          costSection,
          String(permanent?.card?.name || ''),
        );
        if (removeCounterCost) {
          if (!removeCounterCost.refersToSource) {
            return false;
          }
          if (getPermanentCounterAmount(permanent, removeCounterCost.counterType) < removeCounterCost.count) {
            return false;
          }
        }

        const playerLife = Number(game.state?.life?.[playerId] ?? 40);
        const totalLifeCost = [...costSection.matchAll(/pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+life/gi)].reduce(
          (sum, match) => sum + parseNumberFromText(String(match?.[1] || '0'), 0),
          0,
        );
        if (totalLifeCost > 0 && playerLife < totalLifeCost) {
          return false;
        }

        const handCost = parseHandCostFromManaAbilityCost(costSection);
        if (handCost && chooseAIHandCardsForNonTapManaAbilityCost(game, playerId, costSection, excludedHandCardIds).length < handCost.count) {
          return false;
        }

        const returnToHandCost = parseReturnToHandCostFromManaAbilityCost(costSection);
        if (returnToHandCost && !chooseAIReturnToHandPermanentForManaAbility(game, playerId, permanent, costSection)) {
          return false;
        }

        const sacrificeInfo = parseSacrificeCost(String(costSection || ''));
        if (!sacrificeInfo.requiresSacrifice || !sacrificeInfo.sacrificeType || sacrificeInfo.sacrificeType === 'self') {
          return true;
        }

        const requiredCount = Math.max(1, Number(sacrificeInfo.sacrificeCount || 1));
        return chooseAISacrificePermanentsForManaAbility(game, playerId, permanent, costSection).length >= requiredCount;
      });
  }

export function selectAINonTapManaActivationAction(
    game: any,
    playerId: PlayerID,
    permanent: any,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludedHandCardIds?: string[],
  ): AIResolvedActivatedAbilityAction | null {
    const candidates = getAINonTapManaResolverCandidates(game, playerId, permanent, excludedHandCardIds);

    if (candidates.length === 0) {
      return null;
    }

    const manaPool = getOrInitManaPool(game.state, String(playerId)) as any;
    const missingColors = Object.entries(parsedCost.colors || {}).flatMap(([color, amount]) => {
      const normalizedColor = String(color || '').toUpperCase();
      const requiredAmount = Number(amount || 0);
      const poolKey = COLOR_IDENTITY_MAP[normalizedColor] || 'colorless';
      const availableAmount = Number(manaPool?.[poolKey] || 0);
      return requiredAmount > availableAmount ? [normalizedColor] : [];
    });

    let bestCandidate: AIActivatedAbilityResolverCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const candidateColors = getAIManaAbilityCandidateColors(candidate);
      const normalizedText = String(candidate?.text || '').toLowerCase();
      const normalizedEffect = String(candidate?.effect || '').toLowerCase();
      const isAnyColorCandidate = /one mana of any color|any color of mana|mana of any one color|one mana of any type/i.test(normalizedEffect);

      let score = 0;

      if (missingColors.length > 0) {
        const satisfiesNeededColor = missingColors.some((color) => candidateColors.includes(color));
        const satisfiesNeededAnyColor = isAnyColorCandidate && missingColors.some((color) => color !== 'C');
        score += satisfiesNeededColor || satisfiesNeededAnyColor ? 60 : -40;

        if (missingColors.includes('C') && candidateColors.includes('C')) {
          score += 12;
        }
      }

      if (Number(parsedCost.generic || 0) > 0) {
        score += candidateColors.length > 0 ? 10 : 0;
        if (candidateColors.length === 1 && candidateColors[0] === 'C') {
          score += 4;
        }
      }

      if (!/pay\s+\d+\s+life/i.test(normalizedText)) {
        score += 4;
      } else {
        score -= 8;
      }

      if (!/\bdiscard\b/i.test(normalizedText)) {
        score += 2;
      } else {
        score -= 12;
      }

      if (!/\bexile\b.*\bhand\b/i.test(normalizedText)) {
        score += 1;
      } else {
        score -= 10;
      }

      if (!/\breturn\b.*\bhand\b/i.test(normalizedText)) {
        score += 1;
      } else {
        score -= 6;
      }

      if (!/\bor\b/i.test(normalizedEffect)) {
        score += 2;
      }

      const producedAmount = Number(
        calculateManaProduction(game.state, permanent, String(playerId), missingColors[0] || 'C', candidate.id).totalAmount || 0
      );
      if (producedAmount <= 0) {
        continue;
      }
      score += producedAmount * 20;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      return null;
    }

    return {
      permanentId: String(permanent?.id || ''),
      cardName: String(permanent?.card?.name || ''),
      abilityId: String(bestCandidate?.id || ''),
      abilityText: String(bestCandidate?.text || ''),
    };
  }

  function getAINonTapManaActionProduction(
    game: any,
    playerId: PlayerID,
    permanent: any,
    action: AIResolvedActivatedAbilityAction,
  ): { chosenManaColor: string; manaInfo: ReturnType<typeof calculateManaProduction> } {
    const candidates = getAINonTapManaResolverCandidates(game, playerId, permanent);
    const candidate = candidates.find((entry) => String(entry?.id || '') === String(action?.abilityId || '')) || null;
    const candidateColors = candidate ? getAIManaAbilityCandidateColors(candidate) : [];
    const producedColors = candidateColors.length > 0 ? candidateColors : getAIManaProductionOptions(game, playerId, permanent);
    const chosenManaColor = chooseAIManaColorForActivation(game, playerId, producedColors);
    const manaInfo = calculateManaProduction(game.state, permanent, String(playerId), chosenManaColor, action?.abilityId);

    return {
      chosenManaColor,
      manaInfo,
    };
  }

export function getAINonTapManaActionAmount(
    game: any,
    playerId: PlayerID,
    permanent: any,
    action: AIResolvedActivatedAbilityAction,
  ): number {
    return Number(getAINonTapManaActionProduction(game, playerId, permanent, action).manaInfo.totalAmount || 0);
  }

  function removeAISimulatedPermanent(game: any, permanentId: string): void {
    const targetId = String(permanentId || '');
    if (!targetId) {
      return;
    }

    movePermanentToGraveyard(game as any, targetId, true);
  }

  function matchesAIHandCostTypeRestriction(card: any, typeRestriction?: string): boolean {
    if (!typeRestriction) {
      return true;
    }

    const typeLine = String(card?.type_line || '').toLowerCase();
    switch (String(typeRestriction || '').toLowerCase()) {
      case 'creature':
      case 'artifact':
      case 'enchantment':
      case 'land':
      case 'instant':
      case 'sorcery':
      case 'planeswalker':
        return typeLine.includes(String(typeRestriction || '').toLowerCase());
      case 'nonland':
        return !typeLine.includes('land');
      case 'noncreature':
        return !typeLine.includes('creature');
      default:
        return false;
    }
  }

  function chooseAIHandCardsForNonTapManaAbilityCost(
    game: any,
    playerId: PlayerID,
    costSection: string,
    excludedHandCardIds?: string[],
  ): string[] {
    const handCost = parseHandCostFromManaAbilityCost(costSection);
    if (!handCost) {
      return [];
    }

    const hand = Array.isArray(game.state?.zones?.[playerId]?.hand)
      ? game.state.zones[playerId].hand
      : [];
    const excludedIds = new Set(
      (Array.isArray(excludedHandCardIds) ? excludedHandCardIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    const eligibleHand = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (cardId && excludedIds.has(cardId)) {
        return false;
      }
      return matchesAIHandCostTypeRestriction(card, handCost.typeRestriction);
    });
    if (eligibleHand.length < handCost.count) {
      return [];
    }

    return eligibleHand
      .map((card: any) => {
        const cmc = Number(card?.cmc || 0) || 0;
        const typeLine = String(card?.type_line || '').toLowerCase();
        let score = cmc;
        if (typeLine.includes('land')) {
          score -= 5;
        }
        return { card, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, handCost.count)
      .map((entry) => String(entry.card?.id || ''))
      .filter(Boolean);
  }

export function chooseAIReturnToHandPermanentForManaAbility(
    game: any,
    playerId: PlayerID,
    sourcePermanent: any,
    costSection: string,
  ): any | null {
    const returnToHandCost = parseReturnToHandCostFromManaAbilityCost(costSection);
    if (!returnToHandCost) {
      return null;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const candidates = battlefield
      .filter((permanent: any) => {
        if (!permanent || permanent.controller !== playerId) return false;
        if ((permanent as any)?.isCommander) return false;

        const permanentId = String(permanent?.id || '');
        const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
        if (returnToHandCost.mustBeOther && permanentId === String(sourcePermanent?.id || '')) {
          return false;
        }

        switch (String(returnToHandCost.type || '')) {
          case 'permanent':
            return true;
          case 'nonland permanent':
            return !typeLine.includes('land');
          default:
            return typeLine.includes(String(returnToHandCost.type || '').toLowerCase());
        }
      })
      .sort((left: any, right: any) =>
        (scoreAISacrificePermanentForManaAbility(game, playerId, left) + (permanentHasLeaveBattlefieldExileReplacement(left) ? 10000 : 0)) -
        (scoreAISacrificePermanentForManaAbility(game, playerId, right) + (permanentHasLeaveBattlefieldExileReplacement(right) ? 10000 : 0))
      );

    return candidates[0] || null;
  }

  function applyAISimulatedNonTapManaActivation(
    game: any,
    playerId: PlayerID,
    permanent: any,
    action: AIResolvedActivatedAbilityAction,
    excludedHandCardIds?: string[],
  ): boolean {
    const costSection = String(action?.abilityText || '').split(':')[0] || '';
    const lowerCost = costSection.toLowerCase();
    if (/\{[^}]*\bT\b[^}]*\}/i.test(costSection)) {
      return false;
    }

    const playerLife = Number(game.state?.life?.[playerId] ?? 40);
    const lifeCostMatches = [...lowerCost.matchAll(/pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+life/gi)];
    const totalLifeCost = lifeCostMatches.reduce(
      (sum, match) => sum + parseNumberFromText(String(match?.[1] || '0'), 0),
      0,
    );

    if (totalLifeCost > 0) {
      if (playerLife < totalLifeCost) {
        return false;
      }
      game.state.life = game.state.life || {};
      game.state.life[playerId] = playerLife - totalLifeCost;
    }

    const handCost = parseHandCostFromManaAbilityCost(costSection);
    if (handCost) {
      const zones = game.state?.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        return false;
      }

      const chosenHandCardIds = chooseAIHandCardsForNonTapManaAbilityCost(game, playerId, costSection, excludedHandCardIds);
      if (chosenHandCardIds.length < handCost.count) {
        return false;
      }

      zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
      zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
      const destinationZone = handCost.destination === 'exile' ? 'exile' : 'graveyard';

      for (const chosenHandCardId of chosenHandCardIds.slice(0, handCost.count)) {
        const handIndex = zones.hand.findIndex((card: any) => String(card?.id || '') === String(chosenHandCardId || ''));
        if (handIndex < 0) {
          return false;
        }

        const [movedCard] = zones.hand.splice(handIndex, 1);
        if (!movedCard) {
          return false;
        }

        movedCard.zone = destinationZone;
        zones[destinationZone].push(movedCard);
      }

      zones.handCount = zones.hand.length;
      zones.graveyardCount = zones.graveyard.length;
      zones.exileCount = zones.exile.length;
    }

    const sacrificeInfo = parseSacrificeCost(costSection);
    if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType === 'self') {
      removeAISimulatedPermanent(game, String(permanent?.id || ''));
    } else if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
      const sacrificedPermanentIds = chooseAISacrificePermanentsForManaAbility(game, playerId, permanent, costSection);
      const requiredCount = Math.max(1, Number(sacrificeInfo.sacrificeCount || 1));
      if (sacrificedPermanentIds.length < requiredCount) {
        return false;
      }
      for (const sacrificedPermanentId of sacrificedPermanentIds.slice(0, requiredCount)) {
        removeAISimulatedPermanent(game, String(sacrificedPermanentId || ''));
      }
    }

    const returnToHandCost = parseReturnToHandCostFromManaAbilityCost(costSection);
    if (returnToHandCost) {
      const returnedPermanent = chooseAIReturnToHandPermanentForManaAbility(game, playerId, permanent, costSection);
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const zones = game.state?.zones?.[playerId];
      if (!returnedPermanent || !zones) {
        return false;
      }

      const permanentIndex = battlefield.findIndex(
        (entry: any) => String(entry?.id || '') === String(returnedPermanent?.id || ''),
      );
      if (permanentIndex < 0) {
        return false;
      }

      const [removedPermanent] = battlefield.splice(permanentIndex, 1);
      if (!removedPermanent) {
        return false;
      }

      zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
      zones.hand.push({
        ...(removedPermanent.card || {}),
        zone: 'hand',
      });
      zones.handCount = zones.hand.length;
    }

    const livePermanent = (Array.isArray(game.state?.battlefield) ? game.state.battlefield : []).find(
      (entry: any) => String(entry?.id || '') === String(permanent?.id || ''),
    ) || permanent;
    const { chosenManaColor, manaInfo } = getAINonTapManaActionProduction(game, playerId, livePermanent, action);
    const manaPool = getOrInitManaPool(game.state, String(playerId)) as any;
    const primaryPoolKey = COLOR_IDENTITY_MAP[String(chosenManaColor || '').toUpperCase()] || 'colorless';
    const primaryAmount = Number(manaInfo.totalAmount || 0);

    if (primaryAmount > 0) {
      manaPool[primaryPoolKey] = Number(manaPool[primaryPoolKey] || 0) + primaryAmount;
    }

    for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
      const bonusPoolKey = COLOR_IDENTITY_MAP[String(bonus?.color || '').toUpperCase()] || 'colorless';
      const bonusAmount = Number(bonus?.amount || 0);
      if (bonusAmount > 0) {
        manaPool[bonusPoolKey] = Number(manaPool[bonusPoolKey] || 0) + bonusAmount;
      }
    }

    return primaryAmount > 0 || (Array.isArray(manaInfo.bonusMana) && manaInfo.bonusMana.some((bonus) => Number(bonus?.amount || 0) > 0));
  }

export function tryActivateAINonTapManaAbilityForSpellPaymentSimulation(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
    excludedHandCardIds?: string[],
  ): boolean {
    const candidates = getAINonTapManaAbilityCandidates(game, playerId, parsedCost, excludedHandCardIds);
    if (candidates.length === 0) {
      return false;
    }

    for (const candidate of candidates) {
      const permanentId = String(candidate.permanent?.id || '');
      if (!permanentId) continue;

      const manaPoolBefore = getOrInitManaPool(game.state, String(playerId)) as any;
      const totalBefore = getTotalManaFromPool(manaPoolBefore);
      const activated = applyAISimulatedNonTapManaActivation(game, playerId, candidate.permanent, candidate.action, excludedHandCardIds);
      if (!activated) {
        continue;
      }

      const manaPoolAfter = getOrInitManaPool(game.state, String(playerId)) as any;
      const totalAfter = getTotalManaFromPool(manaPoolAfter);
      if (totalAfter > totalBefore) {
        return true;
      }
    }

    return false;
  }

  function getAIManaBatteryChargeCandidate(permanent: any): {
    action: AIResolvedActivatedAbilityAction;
    chargeCost: ParsedManaCost;
    counterType: string;
    putCount: number;
    requiresTap: boolean;
  } | null {
    const battery = permanentHasManaBatteryCounterLoop(permanent);
    if (!battery.invests || !battery.paysOut || battery.counterTypes.length === 0) {
      return null;
    }

    const putCountMap: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };

    for (const candidate of buildAIActivatedAbilityResolverCandidates(permanent)) {
      // Charge lines put counters; they are not themselves mana abilities.
      if (isAIManaAbilityResolverCandidate(candidate)) continue;

      const costText = String(candidate?.text || '').split(':')[0] || '';
      const effectText = String(candidate?.effect || '').toLowerCase();
      const putMatch = effectText.match(
        /\bput\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^\s]+(?:\s+[^\s]+)?)\s+counters?\s+on\b/i,
      );
      if (!putMatch) continue;

      const putType = String(putMatch[2] || '').toLowerCase().split(/\s+/)[0];
      const counterType = battery.counterTypes.find((type) => {
        if (type === '+1/+1') return /\+1/.test(putType) || putType.includes('plus');
        return putType.includes(type) || type.includes(putType);
      });
      if (!counterType) continue;

      const manaSymbolText = (String(costText).match(/\{[^}]+\}/g) || [])
        .filter((symbol) => !/^\{[tq]\}$/i.test(symbol))
        .join('');
      if (!manaSymbolText) continue;

      const putCountWord = String(putMatch[1] || 'one').toLowerCase();
      const putCount = putCountMap[putCountWord] || Number.parseInt(putCountWord, 10) || 1;
      return {
        action: {
          permanentId: String(permanent?.id || ''),
          cardName: String(permanent?.card?.name || ''),
          abilityId: String(candidate?.id || ''),
          abilityText: String(candidate?.text || ''),
        },
        chargeCost: parseManaCost(manaSymbolText),
        counterType,
        putCount,
        requiresTap: /\{[^}]*\bT\b[^}]*\}/i.test(costText),
      };
    }

    return null;
  }

  function scoreAIManaSourceForBatteryChargeFloat(
    producedColors: string[],
    missingColors: Set<string>,
  ): number {
    let score = 0;
    for (const color of producedColors) {
      const normalized = String(color || '').toUpperCase();
      if (missingColors.has(normalized)) score -= 8;
      else if (normalized === 'C') score += 2;
      else score += 5;
    }
    return score;
  }

  function applyAISimulatedFloatManaIntoPoolForCharge(
    game: any,
    playerId: PlayerID,
    chargeCost: ParsedManaCost,
    excludePermanentIds: Set<string>,
    missingColors: Set<string>,
  ): boolean {
    const pool = getOrInitManaPool(game.state, String(playerId)) as any;
    if (!validateManaPayment(pool, chargeCost.colors || {}, Number(chargeCost.generic || 0))) {
      return true;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const sources = battlefield
      .filter((permanent: any) => {
        if (!permanent || permanent.controller !== playerId || permanent.tapped) return false;
        if (excludePermanentIds.has(String(permanent?.id || ''))) return false;
        if (hasCreatureSummoningSickness(permanent)) return false;
        if (!hasManaAbility(permanent.card)) return false;
        return getAIManaProductionOptions(game, playerId, permanent).length > 0;
      })
      .map((permanent: any) => {
        const producedColors = getAIManaProductionOptions(game, playerId, permanent);
        return {
          permanent,
          producedColors,
          score: scoreAIManaSourceForBatteryChargeFloat(producedColors, missingColors),
        };
      })
      .sort((left, right) => right.score - left.score);

    for (const source of sources) {
      if (!validateManaPayment(pool, chargeCost.colors || {}, Number(chargeCost.generic || 0))) {
        return true;
      }

      const preferredColor = [...source.producedColors].sort((left, right) => {
        const leftMissing = missingColors.has(String(left).toUpperCase()) ? 1 : 0;
        const rightMissing = missingColors.has(String(right).toUpperCase()) ? 1 : 0;
        return leftMissing - rightMissing;
      })[0] || 'C';
      const abilityId = resolveAIPaymentManaAbilityId(game, playerId, source.permanent, preferredColor);
      const manaInfo = calculateManaProduction(
        game.state,
        source.permanent,
        String(playerId),
        preferredColor,
        abilityId,
      );
      const amount = Number(manaInfo.totalAmount || 0);
      if (amount <= 0) continue;

      source.permanent.tapped = true;
      const poolKey = COLOR_IDENTITY_MAP[String(preferredColor || '').toUpperCase()] || 'colorless';
      pool[poolKey] = Number(pool[poolKey] || 0) + amount;
      for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
        const bonusKey = COLOR_IDENTITY_MAP[String(bonus?.color || '').toUpperCase()] || 'colorless';
        const bonusAmount = Number(bonus?.amount || 0);
        if (bonusAmount > 0) {
          pool[bonusKey] = Number(pool[bonusKey] || 0) + bonusAmount;
        }
      }
    }

    return !validateManaPayment(pool, chargeCost.colors || {}, Number(chargeCost.generic || 0));
  }

  function applyAISimulatedManaBatteryCharge(
    game: any,
    playerId: PlayerID,
    permanent: any,
    charge: NonNullable<ReturnType<typeof getAIManaBatteryChargeCandidate>>,
    missingColors: Set<string>,
  ): boolean {
    const livePermanent = (Array.isArray(game.state?.battlefield) ? game.state.battlefield : []).find(
      (entry: any) => String(entry?.id || '') === String(permanent?.id || ''),
    );
    if (!livePermanent) return false;
    if (charge.requiresTap && livePermanent.tapped) return false;

    const excludeIds = new Set<string>([String(livePermanent.id || '')]);
    if (!applyAISimulatedFloatManaIntoPoolForCharge(game, playerId, charge.chargeCost, excludeIds, missingColors)) {
      return false;
    }

    const pool = getOrInitManaPool(game.state, String(playerId)) as any;
    if (validateManaPayment(pool, charge.chargeCost.colors || {}, Number(charge.chargeCost.generic || 0))) {
      return false;
    }

    consumeManaFromPool(pool, charge.chargeCost.colors || {}, Number(charge.chargeCost.generic || 0));
    if (charge.requiresTap) {
      livePermanent.tapped = true;
    }

    livePermanent.counters = livePermanent.counters || {};
    const current = Number(livePermanent.counters[charge.counterType] || 0);
    livePermanent.counters[charge.counterType] = current + Math.max(1, charge.putCount);
    return true;
  }

  function getAIMissingSpellPaymentColors(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
  ): Set<string> {
    const paymentSources = getPaymentSources(game, playerId, {
      colors: { ...(parsedCost.colors || {}) },
      generic: Number(parsedCost.generic || 0),
    });
    const available = buildAIAvailableManaForSpellPayment(game, playerId, paymentSources);
    const missing = new Set<string>();
    for (const [color, needed] of Object.entries(parsedCost.colors || {})) {
      const normalized = String(color || '').toUpperCase();
      const poolKey = COLOR_IDENTITY_MAP[normalized] || 'colorless';
      if (Number(available[poolKey] || 0) < Number(needed || 0)) {
        missing.add(normalized);
      }
    }
    return missing;
  }

export function tryAIManaBatteryColorFixForSpellPaymentSimulation(
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
  ): boolean {
    if (buildAISpellPaymentPlan(game, playerId, parsedCost) !== null) {
      return false;
    }

    const missingColors = getAIMissingSpellPaymentColors(game, playerId, parsedCost);
    if (missingColors.size === 0) {
      return false;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      const charge = getAIManaBatteryChargeCandidate(permanent);
      if (!charge) continue;

      const simulatedGame = cloneAISpellPaymentSimulationGame(game);
      const simulatedPermanent = (Array.isArray(simulatedGame.state?.battlefield) ? simulatedGame.state.battlefield : [])
        .find((entry: any) => String(entry?.id || '') === String(permanent?.id || ''));
      if (!simulatedPermanent) continue;
      if (!applyAISimulatedManaBatteryCharge(simulatedGame, playerId, simulatedPermanent, charge, missingColors)) {
        continue;
      }
      if (buildAISpellPaymentPlan(simulatedGame, playerId, parsedCost) === null) {
        continue;
      }

      return applyAISimulatedManaBatteryCharge(game, playerId, permanent, charge, missingColors);
    }

    return false;
  }

export async function tryAIManaBatteryColorFixForSpellPayment(
    io: Server,
    gameId: string,
    game: any,
    playerId: PlayerID,
    parsedCost: ReturnType<typeof parseManaCost>,
  ): Promise<boolean> {
    const simulatedGame = cloneAISpellPaymentSimulationGame(game);
    if (!tryAIManaBatteryColorFixForSpellPaymentSimulation(simulatedGame, playerId, parsedCost)) {
      return false;
    }

    const missingColors = getAIMissingSpellPaymentColors(game, playerId, parsedCost);
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];

    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      const charge = getAIManaBatteryChargeCandidate(permanent);
      if (!charge) continue;

      const probe = cloneAISpellPaymentSimulationGame(game);
      const probePermanent = (Array.isArray(probe.state?.battlefield) ? probe.state.battlefield : [])
        .find((entry: any) => String(entry?.id || '') === String(permanent?.id || ''));
      if (!probePermanent) continue;
      if (!applyAISimulatedManaBatteryCharge(probe, playerId, probePermanent, charge, missingColors)) {
        continue;
      }
      if (buildAISpellPaymentPlan(probe, playerId, parsedCost) === null) {
        continue;
      }

      // Float surplus sources into the real pool until the charge cost is payable.
      const excludeIds = new Set<string>([String(permanent.id || '')]);
      const pool = getOrInitManaPool(game.state, String(playerId)) as any;
      const sources = battlefield
        .filter((entry: any) => {
          if (!entry || entry.controller !== playerId || entry.tapped) return false;
          if (excludeIds.has(String(entry?.id || ''))) return false;
          if (hasCreatureSummoningSickness(entry)) return false;
          if (!hasManaAbility(entry.card)) return false;
          return true;
        })
        .map((entry: any) => {
          const producedColors = getAIManaProductionOptions(game, playerId, entry);
          return {
            permanent: entry,
            producedColors,
            score: scoreAIManaSourceForBatteryChargeFloat(producedColors, missingColors),
          };
        })
        .sort((left, right) => right.score - left.score);

      for (const source of sources) {
        if (!validateManaPayment(pool, charge.chargeCost.colors || {}, Number(charge.chargeCost.generic || 0))) {
          break;
        }
        const preferredColor = [...source.producedColors].sort((left, right) => {
          const leftMissing = missingColors.has(String(left).toUpperCase()) ? 1 : 0;
          const rightMissing = missingColors.has(String(right).toUpperCase()) ? 1 : 0;
          return leftMissing - rightMissing;
        })[0] || 'C';
        const abilityId = resolveAIPaymentManaAbilityId(game, playerId, source.permanent, preferredColor);
        await executeAIActivateAbility(
          io,
          gameId,
          playerId,
          {
            permanentId: String(source.permanent.id || ''),
            cardName: String(source.permanent?.card?.name || ''),
            abilityId,
            abilityText: String(source.permanent?.card?.oracle_text || ''),
          },
          false,
        );
      }

      if (validateManaPayment(pool, charge.chargeCost.colors || {}, Number(charge.chargeCost.generic || 0))) {
        continue;
      }

      const charged = await executeAIActivateAbility(io, gameId, playerId, charge.action, false);
      if (charged) {
        return true;
      }
    }

    return false;
  }
