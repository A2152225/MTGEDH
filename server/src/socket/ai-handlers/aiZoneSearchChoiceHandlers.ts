/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: library-search / graveyard / scry / hideaway / upkeep-sacrifice
 * AI choosers plus reflexive mana/sacrifice/discard-then-draw prompts.
 *
 * Public entry symbols: chooseAILibrarySearchCards, chooseAILibrarySearchResponse,
 * chooseAIGraveyardSelectionIds, chooseAIUpkeepSacrificeSelection,
 * chooseAIReturnControlledPermanentId, chooseAIHideawayCardId, chooseAIScrySelection,
 * scoreGenericChoiceOption, scoreProtectedObjectForWard,
 * chooseAIReflexiveManaPaymentSelection, chooseAIReflexiveFixedPaymentSelection,
 * chooseAIReflexiveSacrificeSelection, chooseAISacrificeAnotherPermanentForBenefitSelection,
 * chooseAIOptionalDiscardThenDrawSelection.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { cardAnalyzer, CardCategory } from "../../../../rules-engine/src/CardAnalyzer.js";
import {
  canPayManaCost,
  parseManaCost,
} from "../../state/modules/mana-check.js";
import {
  getAvailableReflexiveManaAmountFromPool,
  parseReflexivePaymentChoiceAmount,
  permanentMatchesReflexiveSacrificeType,
} from "../../state/modules/reflexive-triggers.js";
import { getOrInitManaPool } from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import {
  calculateCardThemeAlignment,
  ensureAIDeckProfile,
  getAIHand,
  permanentHasLeaveBattlefieldExileReplacement,
  rehydrateCardsById,
  scoreCardForAIAcquisition,
  scoreHostileGraveyardCardDisruption,
} from "./aiDeckProfileHandlers.js";
import { getPermanentCombatStats } from "./aiPermanentCombatStats.js";

export function chooseAILibrarySearchCards(
  game: any,
  playerId: PlayerID,
  availableCards: readonly any[],
  options?: {
    minSelections?: number;
    maxSelections?: number;
    destination?: string;
    maxTotalManaValue?: number;
  }
): string[] {
  const minSelections = Math.max(0, Number(options?.minSelections ?? 0));
  const maxSelections = Math.max(minSelections, Number(options?.maxSelections ?? 1));
  const profile = ensureAIDeckProfile(game, playerId);
  const destination = String(options?.destination || 'hand');
  const maxTotalManaValue = Number(options?.maxTotalManaValue);

  const scoredCards = [...availableCards]
    .map((card: any) => ({
      id: String(card?.id || ''),
      manaValue: Math.max(0, Number(card?.cmc || 0) || 0),
      score: scoreCardForAIAcquisition(game, playerId, card, destination, profile),
    }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => right.score - left.score || left.manaValue - right.manaValue);

  if (Number.isFinite(maxTotalManaValue) && maxTotalManaValue >= 0) {
    const selected: string[] = [];
    let runningTotal = 0;

    for (const entry of scoredCards) {
      if (selected.length >= maxSelections) break;
      if (runningTotal + entry.manaValue > maxTotalManaValue) continue;
      selected.push(entry.id);
      runningTotal += entry.manaValue;
    }

    if (selected.length >= minSelections) {
      return selected;
    }

    const cheapestRemaining = [...scoredCards].sort((left, right) => left.manaValue - right.manaValue || right.score - left.score);
    for (const entry of cheapestRemaining) {
      if (selected.length >= minSelections || selected.length >= maxSelections) break;
      if (selected.includes(entry.id)) continue;
      if (runningTotal + entry.manaValue > maxTotalManaValue) continue;
      selected.push(entry.id);
      runningTotal += entry.manaValue;
    }

    return selected;
  }

  const desiredSelection = maxSelections > 1
    ? Math.max(minSelections, Math.min(maxSelections, availableCards.length))
    : Math.max(minSelections, Math.min(maxSelections, availableCards.length > 0 ? 1 : 0));
  const numToSelect = Math.min(availableCards.length, desiredSelection);
  return scoredCards.slice(0, numToSelect).map((entry) => entry.id);
}

export function chooseAILibrarySearchResponse(
  game: any,
  playerId: PlayerID,
  availableCards: readonly any[],
  options?: {
    minSelections?: number;
    maxSelections?: number;
    destination?: string;
    maxTotalManaValue?: number;
    splitDestination?: boolean;
    toBattlefield?: number;
    toHand?: number | 'rest';
  },
): { selections: string[]; splitAssignments?: { toBattlefield: string[]; toHand: string[] } } {
  const minSelections = Math.max(0, Number(options?.minSelections ?? 0));
  const maxSelections = Math.max(minSelections, Number(options?.maxSelections ?? 1));
  const destination = String(options?.destination || 'hand');
  const isSplitDestination = options?.splitDestination === true || destination.toLowerCase() === 'split';
  const restToHand = options?.toHand === 'rest' || String(options?.toHand || '').toLowerCase() === 'rest';
  const toBattlefieldCount = Math.max(1, Number(options?.toBattlefield) || 1);
  const toHandCount = restToHand
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number.isFinite(Number(options?.toHand)) ? Number(options?.toHand) : (isSplitDestination ? 1 : 0));

  if (availableCards.length === 0) {
    return { selections: [] };
  }

  const splitCap = restToHand
    ? maxSelections
    : Math.max(minSelections, Math.min(maxSelections, toBattlefieldCount + (Number.isFinite(toHandCount) ? toHandCount : 0)));
  const desiredCount = isSplitDestination
    ? Math.min(maxSelections, availableCards.length, splitCap)
    : Math.max(minSelections, Math.min(maxSelections, availableCards.length > 0 ? 1 : 0));

  const selections = chooseAILibrarySearchCards(game, playerId, availableCards, {
    minSelections: isSplitDestination ? Math.min(desiredCount, minSelections) : minSelections,
    maxSelections: desiredCount,
    destination: isSplitDestination ? 'battlefield' : destination,
    maxTotalManaValue: options?.maxTotalManaValue,
  });

  if (!isSplitDestination || selections.length === 0) {
    return { selections };
  }

  const battlefieldIds = selections.slice(0, toBattlefieldCount);
  const handIds = selections.slice(toBattlefieldCount);
  return {
    selections,
    splitAssignments: {
      toBattlefield: battlefieldIds,
      toHand: handIds,
    },
  };
}

export function chooseAIGraveyardSelectionIds(
  game: any,
  playerId: PlayerID,
  step: any
): string[] {
  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  const minTargets = Math.max(0, Number(step?.minTargets ?? 0));
  const maxTargets = Math.max(minTargets, Number(step?.maxTargets ?? minTargets));
  const desired = Math.min(validTargets.length, Math.max(minTargets, Math.min(maxTargets, maxTargets || minTargets || 0)));
  if (desired <= 0 || validTargets.length === 0) {
    return [];
  }

  const targetPlayerId = String(step?.targetPlayerId || playerId);
  const graveyard = Array.isArray(game?.state?.zones?.[targetPlayerId]?.graveyard)
    ? game.state.zones[targetPlayerId].graveyard
    : [];
  const cards = rehydrateCardsById(graveyard, validTargets.map((card: any) => String(card?.id || '')));
  const profile = ensureAIDeckProfile(game, playerId);
  const destination = String(step?.destination || 'hand');
  const exileLike = destination === 'exile' || String(step?.purpose || '') === 'collectEvidence';
  const collectEvidenceMinManaValue = Math.max(0, Number(step?.collectEvidenceMinManaValue ?? 0));
  const targetsOwnGraveyard = String(targetPlayerId) === String(playerId);

  const scored = cards
    .map((card: any) => {
      const retentionScore = scoreCardForAIAcquisition(game, playerId, card, 'hand', profile);
      const manaValue = Number(card?.cmc || 0) || 0;
      return {
        id: String(card?.id || ''),
        manaValue,
        acquisitionScore: scoreCardForAIAcquisition(game, playerId, card, destination, profile),
        exileScore: retentionScore - manaValue * 2,
        hostileScore: scoreHostileGraveyardCardDisruption(card),
      };
    })
    .filter((entry) => Boolean(entry.id));

  if (exileLike && collectEvidenceMinManaValue > 0) {
    const selected: string[] = [];
    let totalManaValue = 0;
    for (const entry of [...scored].sort((left, right) => left.exileScore - right.exileScore || right.manaValue - left.manaValue)) {
      if (selected.length >= maxTargets) break;
      selected.push(entry.id);
      totalManaValue += entry.manaValue;
      if (totalManaValue >= collectEvidenceMinManaValue && selected.length >= minTargets) {
        break;
      }
    }
    return selected;
  }

  return [...scored]
    .sort((left, right) => {
      if (exileLike) {
        if (targetsOwnGraveyard) {
          return left.exileScore - right.exileScore || left.hostileScore - right.hostileScore;
        }
        return right.hostileScore - left.hostileScore || right.manaValue - left.manaValue;
      }
      return right.acquisitionScore - left.acquisitionScore;
    })
    .slice(0, desired)
    .map((entry) => entry.id);
}

export function chooseAIUpkeepSacrificeSelection(
  game: any,
  playerId: PlayerID,
  step: any,
): { type: 'creature' | 'source'; creatureId?: string } | [] {
  const { scoreAISacrificePermanentForManaAbility } = getAIHandlerDeps();
  const creatures = Array.isArray(step?.creatures) ? step.creatures : [];
  const allowSourceSacrifice = step?.allowSourceSacrifice !== false;
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];

  const scoredCandidates = creatures
    .map((candidate: any) => {
      const candidateId = String(candidate?.id || '').trim();
      if (!candidateId) return null;

      const permanent = battlefield.find((entry: any) => String(entry?.id || '') === candidateId);
      const fallbackPower = Number(candidate?.power || 0) || 0;
      const fallbackToughness = Number(candidate?.toughness || 0) || 0;
      const fallbackScore =
        ((candidate as any)?.isCommander ? 1000 : 0) +
        ((candidate as any)?.isToken ? -150 : 0) +
        fallbackPower + fallbackToughness;
      const combatStats = permanent ? getPermanentCombatStats(permanent) : { power: fallbackPower, toughness: fallbackToughness };

      return {
        id: candidateId,
        score: permanent
          ? scoreAISacrificePermanentForManaAbility(game, playerId, permanent)
          : fallbackScore,
        power: combatStats.power,
        toughness: combatStats.toughness,
      };
    })
    .filter((entry): entry is { id: string; score: number; power: number; toughness: number } => Boolean(entry));

  if (scoredCandidates.length > 0) {
    scoredCandidates.sort((left, right) => {
      const scoreDelta = left.score - right.score;
      if (scoreDelta !== 0) return scoreDelta;

      const statDelta = (left.power + left.toughness) - (right.power + right.toughness);
      if (statDelta !== 0) return statDelta;

      return left.id.localeCompare(right.id);
    });

    return {
      type: 'creature',
      creatureId: scoredCandidates[0].id,
    };
  }

  if (allowSourceSacrifice) {
    return { type: 'source' };
  }

  return [];
}

export function chooseAIReturnControlledPermanentId(
  game: any,
  playerId: PlayerID,
  step: any,
): string {
  const { scoreAISacrificePermanentForManaAbility } = getAIHandlerDeps();
  const options = Array.isArray(step?.returnControlledPermanentOptions) ? step.returnControlledPermanentOptions : [];
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const sourceId = String(step?.sourceId || '').trim();

  const scoredOptions = options
    .map((option: any) => {
      const permanentId = String(option?.permanentId || '').trim();
      if (!permanentId) return null;

      const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
      if (!permanent) {
        return {
          permanentId,
          score: 0,
        };
      }

      let score = scoreAISacrificePermanentForManaAbility(game, playerId, permanent);
      if (permanent.tapped) score -= 20;
      if (sourceId && permanentId === sourceId) score += 30;
      if (permanentHasLeaveBattlefieldExileReplacement(permanent) || option?.leaveBattlefieldReplacementDestination === 'exile') score += 10000;

      return { permanentId, score };
    })
    .filter((entry): entry is { permanentId: string; score: number } => Boolean(entry));

  scoredOptions.sort((left, right) => left.score - right.score || left.permanentId.localeCompare(right.permanentId));
  return scoredOptions[0]?.permanentId || '';
}

function scoreAIHideawayCandidate(game: any, playerId: PlayerID, card: any): number {
  if (!card || typeof card !== 'object') return Number.NEGATIVE_INFINITY;

  const typeLine = String(card?.type_line || '').toLowerCase();
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  const isLand = typeLine.includes('land');
  const isCreature = typeLine.includes('creature');
  const manaValue = Number(card?.cmc ?? 0) || 0;
  const power = Number(card?.power ?? 0) || 0;
  const toughness = Number(card?.toughness ?? 0) || 0;
  const analysis = cardAnalyzer.analyzeCard(card);

  let score = 0;
  score += isLand ? -60 : 30;
  score += manaValue * (isLand ? 2 : 12);
  score += calculateCardThemeAlignment(card, ensureAIDeckProfile(game, playerId));
  score += analysis.comboPotential * 3;
  if (analysis.categories.includes(CardCategory.DRAW)) score += 8;
  if (analysis.categories.includes(CardCategory.REMOVAL)) score += 10;
  if (analysis.categories.includes(CardCategory.TUTOR)) score += 12;
  if (analysis.categories.includes(CardCategory.FINISHER)) score += 14;
  if (isCreature) score += power + toughness;
  if (/take an extra turn|extra turn|extra combat/.test(oracleText)) score += 20;
  if (/destroy target|exile target|counter target/.test(oracleText)) score += 8;
  if (/draw [a-z0-9 ]*cards?/.test(oracleText)) score += 6;

  return score;
}

export function chooseAIHideawayCardId(
  game: any,
  playerId: PlayerID,
  step: any,
): string {
  const options = Array.isArray(step?.hideawayCards) ? step.hideawayCards : [];
  if (options.length === 0) return '';

  const library = Array.isArray(game?.libraries?.get?.(playerId))
    ? (game.libraries.get(playerId) as any[])
    : Array.isArray(game?.state?.zones?.[playerId]?.library)
      ? game.state.zones[playerId].library
      : [];

  const visibleTopCards = library.slice(0, options.length);
  const fullCardById = new Map(
    visibleTopCards
      .map((card: any) => [String(card?.id || '').trim(), card] as const)
      .filter(([cardId]) => Boolean(cardId)),
  );

  const scoredOptions = options
    .map((option: any) => {
      const cardId = String(option?.cardId || option?.id || '').trim();
      if (!cardId) return null;

      const fullCard = fullCardById.get(cardId) || option;
      return {
        cardId,
        score: scoreAIHideawayCandidate(game, playerId, fullCard),
      };
    })
    .filter((entry): entry is { cardId: string; score: number } => Boolean(entry));

  scoredOptions.sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId));
  return scoredOptions[0]?.cardId || '';
}

export function chooseAIScrySelection(
  game: any,
  playerId: PlayerID,
  step: any,
): { keepTopOrder: any[]; bottomOrder: any[] } {
  const cards = Array.isArray(step?.cards) ? step.cards : [];
  if (cards.length === 0) {
    return { keepTopOrder: [], bottomOrder: [] };
  }

  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const hand = Array.isArray(game?.state?.zones?.[playerId]?.hand) ? game.state.zones[playerId].hand : [];
  const controlledLands = battlefield.filter((perm: any) => {
    const typeLine = String(perm?.card?.type_line || '').toLowerCase();
    return String(perm?.controller || '') === String(playerId) && typeLine.includes('land');
  }).length;
  const landsInHand = hand.filter((card: any) => String(card?.type_line || '').toLowerCase().includes('land')).length;
  const landsNeeded = Math.max(0, 3 - (controlledLands + landsInHand));

  const lands: any[] = [];
  const nonlands: any[] = [];
  for (const card of cards) {
    const typeLine = String(card?.type_line || '').toLowerCase();
    if (typeLine.includes('land')) lands.push(card);
    else nonlands.push(card);
  }

  const keptLands = lands.slice(0, landsNeeded);
  const bottomLands = lands.slice(landsNeeded);
  const orderedNonlands = [...nonlands].sort((left: any, right: any) => {
    const leftScore = scoreAIHideawayCandidate(game, playerId, left);
    const rightScore = scoreAIHideawayCandidate(game, playerId, right);
    return rightScore - leftScore || String(left?.id || '').localeCompare(String(right?.id || ''));
  });

  const keepTopOrder = keptLands.length > 0
    ? [...keptLands, ...orderedNonlands]
    : orderedNonlands;

  return {
    keepTopOrder,
    bottomOrder: bottomLands,
  };
}

function getProtectedStackItem(game: any, step: any): any | null {
  const triggeredBy = String(step?.wardTriggeredBy || step?.sourceId || '').trim();
  if (!triggeredBy) return null;
  return (game?.state?.stack || []).find((entry: any) => String(entry?.id || '') === triggeredBy) || null;
}

export function scoreProtectedObjectForWard(game: any, playerId: PlayerID, step: any): number {
  const stackItem = getProtectedStackItem(game, step);
  const card = stackItem?.card;
  if (!card) return 40;

  let score = 40;
  const analysis = cardAnalyzer.analyzeCard(card);
  score += analysis.comboPotential * 4;
  if (analysis.categories.includes(CardCategory.TUTOR)) score += 12;
  if (analysis.categories.includes(CardCategory.REMOVAL)) score += 8;
  if (analysis.categories.includes(CardCategory.DRAW)) score += 6;
  if (analysis.categories.includes(CardCategory.FINISHER)) score += 8;
  score += calculateCardThemeAlignment(card, ensureAIDeckProfile(game, playerId));
  return score;
}

export function scoreGenericChoiceOption(step: any, option: any): number {
  const text = `${String(option?.label || '')} ${String(option?.description || '')} ${String(step?.description || '')}`.toLowerCase();
  let score = 0;
  if (/(draw|search|destroy|exile|counter|return .*battlefield|untap|treasure|create token|add counter)/i.test(text)) score += 12;
  if (/(gain life|scry|surveil)/i.test(text)) score += 4;
  if (/(opponent draws|each opponent draws|lose life|sacrifice|discard|countered|enters tapped|decline|no)/i.test(text)) score -= 8;
  if (/(yes|accept|pay)/i.test(text)) score += 2;
  return score;
}

export function chooseAIReflexiveManaPaymentSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel)$/i.test(id))
    || 'decline';
  const paymentUnit = String(step?.reflexiveManaPaymentUnit || 'mana').trim() || 'mana';
  const available = getAvailableReflexiveManaAmountFromPool(game?.state, String(playerId), paymentUnit as any);
  const stepMax = Math.max(0, Math.floor(Number(step?.reflexiveManaPaymentMaxAmount ?? available)));
  const maxLegalAmount = Math.min(available, stepMax > 0 ? stepMax : available);

  const payableOptions = optionIds
    .map((id) => ({ id, amount: parseReflexivePaymentChoiceAmount(id) }))
    .filter((entry) => entry.amount > 0 && entry.amount <= maxLegalAmount)
    .sort((left, right) => right.amount - left.amount);

  if (payableOptions.length === 0) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = `${String(step?.reflexiveManaPaymentFollowupText || '')} ${String(step?.reflexiveManaPaymentOriginalEffect || '')} ${String(step?.description || '')}`.toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|put .*counter|each opponent|target opponent|any target)/i.test(followupText);
  const looksSelfPunishing = /(you lose|you discard|you sacrifice|you mill|damage to you)/i.test(followupText);

  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [payableOptions[0].id], cancelled: false };
}

export function chooseAIReflexiveFixedPaymentSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const payId = optionIds.find((id) => /^pay$/i.test(id)) || 'pay';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel)$/i.test(id))
    || 'decline';

  const manaCost = String(step?.reflexiveFixedPaymentManaCost || '').trim();
  if (manaCost) {
    try {
      const pool = getOrInitManaPool(game.state, String(playerId)) as any;
      const parsedCost = parseManaCost(manaCost);
      if (!canPayManaCost(pool, parsedCost)) {
        return { selections: [declineId], cancelled: true };
      }
    } catch {
      return { selections: [declineId], cancelled: true };
    }
  }

  const lifeAmount = Math.max(0, Math.floor(Number(step?.reflexiveFixedPaymentLifeAmount || 0)));
  if (lifeAmount > 0) {
    const startingLife = Number(game?.state?.startingLife ?? 40);
    const currentLife = Number(game?.state?.life?.[playerId] ?? startingLife);
    if (!Number.isFinite(currentLife) || currentLife < lifeAmount || currentLife - lifeAmount <= 3) {
      return { selections: [declineId], cancelled: true };
    }
  }

  const followupText = `${String(step?.reflexiveFixedPaymentFollowupText || '')} ${String(step?.reflexiveFixedPaymentOriginalEffect || '')} ${String(step?.description || '')}`.toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|put .*counter|each opponent|target opponent|any target)/i.test(followupText);
  const looksSelfPunishing = /(you lose|you discard|you sacrifice|you mill|damage to you)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [payId], cancelled: false };
}

export function chooseAIReflexiveSacrificeSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const sacrificeId = optionIds.find((id) => /^(?:sacrifice|yes|pay)$/i.test(id)) || 'sacrifice';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel|dont)$/i.test(id))
    || 'decline';

  const controllerId = String(step?.sacrificeWhenYouDoController || playerId);
  const subtype = String(step?.sacrificeWhenYouDoSubtype || '').trim();
  const sourcePermanentId = String(step?.sacrificeWhenYouDoSourcePermanentId || step?.sourceId || '').trim() || undefined;
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const validSacrifices = battlefield.filter((permanent: any) => (
    permanentMatchesReflexiveSacrificeType(permanent, controllerId, subtype, sourcePermanentId)
  ));
  if (validSacrifices.length === 0) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = String(step?.sacrificeWhenYouDoFollowupDescription || step?.sacrificeWhenYouDoFollowupEffect || '').toLowerCase();
  const damage = Math.max(0, Math.floor(Number(step?.sacrificeWhenYouDoDamage || 0)));
  const lifeGain = Math.max(0, Math.floor(Number(step?.sacrificeWhenYouDoLifeGain || 0)));
  const looksBeneficial = damage > 0
    || lifeGain > 0
    || /(damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target|treasure|token)/i.test(followupText);
  const looksSelfPunishing = /(you lose|damage to you|you discard|you mill)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [sacrificeId], cancelled: false };
}

export function chooseAISacrificeAnotherPermanentForBenefitSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const sacrificeId = optionIds.find((id) => /^sac$/i.test(id))
    || optionIds.find((id) => /^(?:sacrifice|yes)$/i.test(id))
    || 'sac';
  const declineId = optionIds.find((id) => /^(?:dont|decline|no|cancel)$/i.test(id)) || 'dont';

  const controllerId = String(step?.sacrificeAnotherPermanentForBenefitController || playerId);
  const sourcePermanentId = String(step?.sacrificeAnotherPermanentForBenefitSourcePermanentId || step?.sourceId || '').trim();
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const validSacrifices = battlefield.filter((permanent: any) => (
    permanent
      && String(permanent?.controller || '') === controllerId
      && (!sourcePermanentId || String(permanent?.id || '') !== sourcePermanentId)
  ));
  if (validSacrifices.length === 0) {
    return { selections: [declineId], cancelled: true };
  }

  const lifeGain = Math.max(0, Math.floor(Number(step?.sacrificeAnotherPermanentForBenefitLifeGain || 0)));
  const drawCount = Math.max(0, Math.floor(Number(step?.sacrificeAnotherPermanentForBenefitDrawCount || 0)));
  if (lifeGain <= 0 && drawCount <= 0) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [sacrificeId], cancelled: false };
}

export function chooseAIOptionalDiscardThenDrawSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const { chooseCardsToDiscard } = getAIHandlerDeps();
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const discardId = optionIds.find((id) => /^discard$/i.test(id)) || 'discard';
  const declineId = optionIds.find((id) => /^(?:dont|decline|no|cancel)$/i.test(id)) || 'dont';

  const controllerId = String(step?.optionalDiscardThenDrawPlayerId || playerId);
  const hand = getAIHand(game, controllerId as PlayerID);
  if (hand.length === 0) {
    return { selections: [declineId], cancelled: true };
  }

  const baseDrawCount = Math.max(0, Math.floor(Number(step?.optionalDiscardThenDrawCount || 1)));
  const landRiderDrawCount = Math.max(0, Math.floor(Number(step?.optionalDiscardThenDrawCountIfDiscardedLand || 0)));
  const discardCardIds = chooseCardsToDiscard(game, controllerId as PlayerID, 1);
  const discardCard = hand.find((card: any) => String(card?.id || '') === String(discardCardIds[0] || '')) || hand[0];
  const willDiscardLand = String(discardCard?.type_line || '').toLowerCase().includes('land');
  const expectedDrawCount = baseDrawCount + (willDiscardLand ? landRiderDrawCount : 0);
  const zones = game?.state?.zones?.[controllerId] || {};
  const mappedLibrary = typeof game?.libraries?.get === 'function' ? game.libraries.get(controllerId) : undefined;
  const libraryCount = Array.isArray(mappedLibrary)
    ? mappedLibrary.length
    : Array.isArray(zones?.library)
      ? zones.library.length
      : Math.max(0, Math.floor(Number(zones?.libraryCount || 0)));

  if (expectedDrawCount > 0 && libraryCount < expectedDrawCount) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [discardId], cancelled: false };
}
