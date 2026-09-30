/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: two-pile split, exile-grant, looked-at destination, mana-color,
 * Force of Will, copy/retarget, reflexive discard/exile/convert, keyword-counter,
 * and put-from-hand option choosers.
 *
 * Public entry symbols: chooseAIPileFromSplitSelection, chooseAIGrantPlayableFromExileSelection,
 * chooseAILookedAtCardsDestinationSelection, chooseAIPayManaToLookAndChooseCardSelection,
 * chooseAIChooseManaColorsSelection, chooseAIMoveChosenHandCardToLibrarySelection,
 * chooseAIAttachEquipmentToPermanentChoiceSelection, chooseAIChooseDiscardPlanSelection,
 * chooseAIChoosePlayerForTwoPileSplitSelection, chooseAIForceOfWillExileSelection,
 * chooseAIResolvedSpellCopySelection, chooseAICopyRetargetSelection,
 * chooseAIReflexiveDiscardSelection, chooseAIReflexiveGraveyardExileSelection,
 * chooseAIReflexiveBoundGraveyardSelfExileSelection, chooseAIReflexiveConvertSelection,
 * chooseAIOptionalPaymentPromptSelection, chooseAIKeywordCounterSelectionsForStep,
 * chooseAIPutFromHandSelectionsForStep.
 */
import { cardAnalyzer, CardCategory, SynergyArchetype } from "../../../../rules-engine/src/CardAnalyzer.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { getOptionalPaymentValidationFailure } from "../optional-payment-prompts.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import {
  calculateCardSynergyPressure,
  calculateCardThemeAlignment,
  ensureAIDeckProfile,
  getAIBattlefield,
  getAIHand,
  getAIPlayerLife,
  scoreCardForAIAcquisition,
} from "./aiDeckProfileHandlers.js";
import { getPermanentCombatStats, getPermanentKeywordSet } from "./aiPermanentCombatStats.js";
import { getAILibraryCards } from "./aiPregameHandlers.js";
import { scoreGenericChoiceOption } from "./aiZoneSearchChoiceHandlers.js";

export function chooseAIPileFromSplitSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const validChoices = optionIds.filter((id) => id === 'pileA' || id === 'pileB');
  if (validChoices.length === 0) {
    return { selections: optionIds[0] ? [optionIds[0]] : [], cancelled: false };
  }

  const profile = ensureAIDeckProfile(game, playerId);
  const items = Array.isArray(step?.choosePileFromSplitItems) ? step.choosePileFromSplitItems : [];
  const itemsById = new Map(items.map((item: any) => [String(item?.id || ''), item]));
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const battlefieldById = new Map(battlefield.map((permanent: any) => [String(permanent?.id || ''), permanent]));
  const pileA = Array.isArray(step?.choosePileFromSplitPileA) ? step.choosePileFromSplitPileA.map(String) : [];
  const pileB = Array.isArray(step?.choosePileFromSplitPileB) ? step.choosePileFromSplitPileB.map(String) : [];

  const scoreItem = (id: string) => {
    const permanent = battlefieldById.get(id) as any;
    if (permanent) {
      const card = permanent?.card || permanent;
      const manaValue = Math.max(0, Number(card?.cmc ?? card?.mana_value ?? 0) || 0);
      const typeLine = String(card?.type_line || '').toLowerCase();
      const oracleText = String(card?.oracle_text || '').toLowerCase();
      const pileStats = getPermanentCombatStats(permanent, game?.state);
      const power = Math.max(0, pileStats.power);
      const toughness = Math.max(0, pileStats.toughness);
      let score = 30 + manaValue * 2;
      if (typeLine.includes('creature')) score += power * 2 + toughness;
      if (typeLine.includes('artifact') || typeLine.includes('enchantment') || typeLine.includes('planeswalker')) score += 5;
      if (/(draw|destroy|exile|counter|create|token|search your library)/i.test(oracleText)) score += 10;
      if (permanent?.isToken === true) score -= 8;
      return score;
    }

    const item = itemsById.get(id);
    if (!item) return 0;
    const card = (item as any)?.card || item;
    return scoreCardForAIAcquisition(game, playerId, card, 'hand', profile);
  };
  const scorePile = (ids: string[]) => ids.reduce((total, id) => total + scoreItem(id), 0);
  const scoreA = scorePile(pileA);
  const scoreB = scorePile(pileB);
  const action = String(step?.choosePileFromSplitChosenAction || '').trim();

  const destinationWeight = (destination: string) => {
    const normalized = String(destination || '').toLowerCase();
    if (normalized === 'battlefield') return 1.2;
    if (normalized === 'hand') return 1;
    if (normalized === 'exile') return 0.25;
    if (normalized === 'library') return 0;
    if (normalized === 'graveyard') return -0.5;
    return 0;
  };

  const utilityForChoice = (choiceId: 'pileA' | 'pileB') => {
    const chosenScore = choiceId === 'pileA' ? scoreA : scoreB;
    const otherScore = choiceId === 'pileA' ? scoreB : scoreA;

    if (action === 'sacrifice_permanents') {
      const targetPlayerId = String(step?.choosePileFromSplitTargetPlayerId || playerId);
      return targetPlayerId === String(playerId) ? -chosenScore : chosenScore;
    }

    const movePlayerId = String(step?.choosePileFromSplitMovePlayerId || playerId);
    const ownerSign = movePlayerId === String(playerId) ? 1 : -1;
    const chosenDestination = String(step?.choosePileFromSplitChosenDestination || 'hand');
    const otherDestination = String(step?.choosePileFromSplitOtherDestination || 'library');
    return ownerSign * (
      destinationWeight(chosenDestination) * chosenScore + destinationWeight(otherDestination) * otherScore
    );
  };

  const ranked = validChoices
    .map((id) => ({ id, utility: utilityForChoice(id as 'pileA' | 'pileB') }))
    .sort((left, right) => right.utility - left.utility || left.id.localeCompare(right.id));
  return { selections: [ranked[0]?.id || validChoices[0]], cancelled: false };
}

export function chooseAIGrantPlayableFromExileSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const { findZoneCardById } = getAIHandlerDeps();
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const configuredCardIds = Array.isArray(step?.grantPlayableFromExileCardIds)
    ? step.grantPlayableFromExileCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];
  const allowedCardIds = new Set(configuredCardIds.length > 0 ? configuredCardIds : optionIds);
  const validOptionIds = optionIds.filter((id) => allowedCardIds.has(id));
  const profile = ensureAIDeckProfile(game, playerId);

  const ranked = validOptionIds
    .map((id) => {
      const found = findZoneCardById(game, id, ['exile']);
      if (!found?.card) return null;

      const card = found.card;
      const manaValue = Math.max(0, Number(card?.cmc ?? card?.mana_value ?? 0) || 0);
      const typeLine = String(card?.type_line || '').toLowerCase();
      const oracleText = String(card?.oracle_text || '').toLowerCase();
      let score = scoreCardForAIAcquisition(game, playerId, card, 'hand', profile);
      if (/(draw|destroy|exile|counter|create|treasure|token|return .*battlefield)/i.test(oracleText)) score += 8;
      if (typeLine.includes('land')) score += 2;

      return { id, score, manaValue };
    })
    .filter((entry): entry is { id: string; score: number; manaValue: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.manaValue - right.manaValue || left.id.localeCompare(right.id));

  const chosenId = ranked[0]?.id || validOptionIds[0] || optionIds[0] || '';
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAILookedAtCardsDestinationSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const configuredCardIds = Array.isArray(step?.chooseLookedAtCardsDestinationTopCardIds)
    ? step.chooseLookedAtCardsDestinationTopCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];
  const allowedCardIds = new Set(configuredCardIds.length > 0 ? configuredCardIds : optionIds);
  const candidateIds = optionIds.filter((id) => allowedCardIds.has(id));
  const fallbackIds = candidateIds.length > 0 ? candidateIds : configuredCardIds;
  const controllerId = String(step?.chooseLookedAtCardsDestinationController || playerId).trim() as PlayerID;
  const chosenZone = String(step?.chooseLookedAtCardsDestinationChosenZone || 'hand').trim().toLowerCase();
  const responderIsController = String(controllerId) === String(playerId);
  const chosenZoneBenefitsController = chosenZone === 'hand' || chosenZone === 'battlefield';
  const profile = ensureAIDeckProfile(game, controllerId);
  const controllerLibrary = getAILibraryCards(game, controllerId);

  const ranked = fallbackIds
    .map((id) => {
      const card = controllerLibrary.find((entry: any) => String(entry?.id || '') === id)
        || options.find((option: any) => resolveOptionId(option) === id)
        || { id };
      const typeLine = String(card?.type_line || '').toLowerCase();
      const oracleText = String(card?.oracle_text || '').toLowerCase();
      let score = scoreCardForAIAcquisition(game, controllerId, card, 'hand', profile);
      if (/(draw|destroy|exile|counter|create|treasure|token|return .*battlefield|search your library)/i.test(oracleText)) score += 8;
      if (typeLine.includes('land')) score += 2;
      const manaValue = Math.max(0, Number(card?.cmc ?? card?.mana_value ?? 0) || 0);
      return { id, score, manaValue };
    })
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => {
      const chooseHigherScore = responderIsController ? chosenZoneBenefitsController : !chosenZoneBenefitsController;
      const scoreDelta = chooseHigherScore ? right.score - left.score : left.score - right.score;
      return scoreDelta || left.manaValue - right.manaValue || left.id.localeCompare(right.id);
    });

  const chosenId = ranked[0]?.id || optionIds.find((id) => allowedCardIds.has(id)) || '';
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIPayManaToLookAndChooseCardSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const controllerId = String(step?.payManaToLookAndChooseCardController || playerId).trim() as PlayerID;
  const pool = game?.state?.manaPool?.[controllerId] || {};
  const availableMana = ['white', 'blue', 'black', 'red', 'green', 'colorless']
    .reduce((total, color) => total + Math.max(0, Number(pool[color] || 0) || 0), 0);
  const libraryCount = getAILibraryCards(game, controllerId).length;
  const maxUsefulAmount = Math.max(0, Math.min(availableMana, libraryCount));
  const numericOptions = options
    .map((option: any) => {
      const id = resolveOptionId(option);
      const amount = Math.max(0, Math.floor(Number(id)));
      return { id, amount };
    })
    .filter((entry) => entry.id && Number.isFinite(entry.amount));

  const chosen = numericOptions
    .filter((entry) => entry.amount <= maxUsefulAmount)
    .sort((left, right) => right.amount - left.amount || left.id.localeCompare(right.id))[0]
    || numericOptions.sort((left, right) => left.amount - right.amount || left.id.localeCompare(right.id))[0];

  return { selections: chosen?.id ? [chosen.id] : [], cancelled: false };
}

export function chooseAIChooseManaColorsSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const { chooseAIManaColorForActivation } = getAIHandlerDeps();
  const controllerId = String(step?.chooseManaColorsController || playerId).trim() as PlayerID;
  const colorIdByCode: Record<string, string> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
  };
  const offeredIds = new Set(options.map((option: any) => resolveOptionId(option)).filter(Boolean));
  const preferredCode = chooseAIManaColorForActivation(game, controllerId, ['W', 'U', 'B', 'R', 'G']);
  const preferredId = colorIdByCode[preferredCode] || 'white';
  const chosenId = offeredIds.has(preferredId)
    ? preferredId
    : ['white', 'blue', 'black', 'red', 'green'].find((color) => offeredIds.has(color)) || '';

  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIMoveChosenHandCardToLibrarySelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const controllerId = String(step?.moveChosenHandCardToLibraryController || playerId).trim() as PlayerID;
  const offeredIds = new Set(options.map((option: any) => resolveOptionId(option)).filter(Boolean));
  const profile = ensureAIDeckProfile(game, controllerId);
  const ranked = getAIHand(game, controllerId)
    .filter((card: any) => offeredIds.has(String(card?.id || '')))
    .map((card: any) => ({
      id: String(card?.id || ''),
      score: scoreCardForAIAcquisition(game, controllerId, card, 'hand', profile),
    }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));

  const chosenId = ranked[0]?.id || [...offeredIds][0] || '';
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIAttachEquipmentToPermanentChoiceSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const controllerId = String(step?.attachEquipmentToPermanentController || playerId).trim() as PlayerID;
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const attachId = optionIds.find((id) => /^attach$/i.test(id)) || optionIds.find((id) => /attach/i.test(id));
  const declineId = optionIds.find((id) => /^decline$/i.test(id)) || optionIds.find((id) => /decline|no/i.test(id));
  const hasEquipment = getAIBattlefield(game, controllerId).some((permanent: any) =>
    String(permanent?.card?.type_line || '').toLowerCase().includes('equipment')
  );
  const chosenId = hasEquipment ? (attachId || optionIds[0] || '') : (declineId || optionIds[0] || '');
  return { selections: chosenId ? [chosenId] : [], cancelled: Boolean(chosenId && declineId && chosenId === declineId) };
}

export function chooseAIChooseDiscardPlanSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const controllerId = String(step?.chooseDiscardPlanPlayerId || playerId).trim() as PlayerID;
  const preferredOptionId = String(step?.chooseDiscardPlanPreferredOptionId || 'preferred').trim();
  const preferredType = String(step?.chooseDiscardPlanPreferredType || '').trim().toLowerCase();
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const preferredOfferedId = optionIds.find((id) => id === preferredOptionId);
  const fallbackId = optionIds.find((id) => id !== preferredOptionId) || optionIds[0] || '';
  const hand = getAIHand(game, controllerId);
  const preferredHand = preferredType
    ? hand.filter((card: any) => String(card?.type_line || '').toLowerCase().includes(preferredType))
    : hand;
  const canUsePreferred = preferredHand.length > 0;
  const chosenId = canUsePreferred && preferredOfferedId ? preferredOfferedId : fallbackId;
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIChoosePlayerForTwoPileSplitSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const controllerId = String(step?.choosePlayerForTwoPileSplitController || playerId).trim();
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const offeredIds = new Set(optionIds);
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const opponentId = players
    .map((entry: any) => String(entry?.id || '').trim())
    .find((id: string) => id && id !== controllerId && offeredIds.has(id));
  const fallbackId = optionIds.find((id) => id !== controllerId) || optionIds[0] || '';
  const chosenId = opponentId || fallbackId;
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIForceOfWillExileSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const spellCardId = String(step?.forceSpellCardId || step?.sourceId || '').trim();
  const offeredIds = new Set(options.map((option: any) => resolveOptionId(option)).filter(Boolean));
  const profile = ensureAIDeckProfile(game, playerId);
  const blueCandidates = getAIHand(game, playerId)
    .filter((card: any) => offeredIds.has(String(card?.id || '')))
    .filter((card: any) => String(card?.id || '') !== spellCardId)
    .filter((card: any) => Array.isArray(card?.colors) && card.colors.includes('U'))
    .map((card: any) => ({
      id: String(card?.id || ''),
      score: scoreCardForAIAcquisition(game, playerId, card, 'hand', profile),
    }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => left.score - right.score);

  const chosenId = blueCandidates[0]?.id || '';
  return { selections: chosenId ? [chosenId] : [], cancelled: !chosenId };
}

export function chooseAIResolvedSpellCopySelection(
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const copyOption = options.find((option: any) => /copy/i.test(`${String(option?.label || '')} ${String(option?.description || '')}`));
  const yesId = optionIds.find((id) => id === 'yes') || (copyOption ? resolveOptionId(copyOption) : '');
  const noId = optionIds.find((id) => id === 'no')
    || optionIds.find((id) => /^(?:decline|cancel|dont|do_not_copy)$/i.test(id))
    || optionIds[1]
    || optionIds[0]
    || 'no';
  const copiedSpellSnapshot = step?.resolvedSpellCopySnapshot;
  const hasCopySnapshot = copiedSpellSnapshot && typeof copiedSpellSnapshot === 'object' && !Array.isArray(copiedSpellSnapshot);

  if (!hasCopySnapshot || !yesId) {
    return { selections: [noId], cancelled: true };
  }

  return { selections: [yesId], cancelled: false };
}

export function chooseAICopyRetargetSelection(
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const retargetOption = options.find((option: any) => /choose new targets?/i.test(`${String(option?.label || '')} ${String(option?.description || '')}`));
  const retargetId = optionIds.find((id) => id === 'retarget') || (retargetOption ? resolveOptionId(retargetOption) : '');
  const keepId = optionIds.find((id) => id === 'keep')
    || optionIds.find((id) => /^(?:no|decline|cancel)$/i.test(id))
    || optionIds[0]
    || 'keep';
  const validTargets = Array.isArray(step?.retargetSpellCopyValidTargets)
    ? step.retargetSpellCopyValidTargets
    : Array.isArray(step?.retargetAbilityCopyValidTargets)
      ? step.retargetAbilityCopyValidTargets
      : [];

  if (validTargets.length > 0 && retargetId) {
    return { selections: [retargetId], cancelled: false };
  }

  return { selections: [keepId], cancelled: false };
}

export function chooseAIReflexiveDiscardSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const discardId = optionIds.find((id) => /^(?:discard|yes|pay)$/i.test(id)) || 'discard';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel|dont)$/i.test(id))
    || 'decline';
  const discardCount = Math.max(1, Math.floor(Number(step?.reflexiveDiscardWhenYouDoCount || 1)));
  const hand = getAIHand(game, playerId);
  if (hand.length < discardCount) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = String(step?.reflexiveDiscardWhenYouDoFollowupDescription || '').toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target)/i.test(followupText);
  const looksSelfPunishing = /(you lose|damage to you|you sacrifice|you mill)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [discardId], cancelled: false };
}

export function chooseAIReflexiveGraveyardExileSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const exileId = optionIds.find((id) => /^(?:exile|yes|pay)$/i.test(id)) || 'exile';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel|dont)$/i.test(id))
    || 'decline';
  const exileCount = Math.max(1, Math.floor(Number(step?.reflexiveGraveyardExileWhenYouDoCount || 1)));
  const validTargets = Array.isArray(step?.reflexiveGraveyardExileWhenYouDoValidTargets)
    ? step.reflexiveGraveyardExileWhenYouDoValidTargets
    : [];
  const ownGraveyard = Array.isArray(game?.state?.zones?.[playerId]?.graveyard) ? game.state.zones[playerId].graveyard : [];
  const availableCount = validTargets.length > 0 ? validTargets.length : ownGraveyard.length;
  if (availableCount < exileCount) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = String(step?.reflexiveGraveyardExileWhenYouDoFollowupDescription || '').toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target)/i.test(followupText);
  const looksSelfPunishing = /(you lose|damage to you|you sacrifice|you discard|you mill)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [exileId], cancelled: false };
}

export function chooseAIReflexiveBoundGraveyardSelfExileSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const exileId = optionIds.find((id) => /^(?:exile|yes|pay)$/i.test(id)) || 'exile';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel|dont)$/i.test(id))
    || 'decline';
  const boundCardId = String(step?.reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardId || '').trim();
  const boundOwnerId = String(step?.reflexiveBoundGraveyardSelfExileWhenYouDoBoundOwnerId || playerId).trim();
  const graveyard = Array.isArray(game?.state?.zones?.[boundOwnerId]?.graveyard) ? game.state.zones[boundOwnerId].graveyard : [];
  if (!boundCardId || !graveyard.some((card: any) => card && String(card.id || '') === boundCardId)) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = String(step?.reflexiveBoundGraveyardSelfExileWhenYouDoFollowupDescription || '').toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target)/i.test(followupText);
  const looksSelfPunishing = /(you lose|damage to you|you sacrifice|you discard|you mill)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [exileId], cancelled: false };
}

export function chooseAIReflexiveConvertSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const convertId = optionIds.find((id) => /^(?:convert|yes|pay)$/i.test(id)) || 'convert';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel|dont)$/i.test(id))
    || 'decline';

  const sourcePermanentId = String(step?.reflexiveConvertWhenYouDoSourcePermanentId || step?.sourceId || '').trim();
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const sourcePermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === sourcePermanentId);
  const faces = Array.isArray(sourcePermanent?.card?.card_faces) ? sourcePermanent.card.card_faces : [];
  if (!sourcePermanent || faces.length < 2 || String(sourcePermanent?.controller || '') !== String(playerId)) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = String(step?.reflexiveConvertWhenYouDoFollowupDescription || step?.description || '').toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target|graveyard to (?:the )?battlefield)/i.test(followupText);
  const looksSelfPunishing = /(you lose|damage to you|you sacrifice|you discard|you mill)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [convertId], cancelled: false };
}

export function chooseAIOptionalPaymentPromptSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const configuredPayId = String(step?.optionalPaymentPayChoiceId || '').trim();
  const configuredDeclineId = String(step?.optionalPaymentDeclineChoiceId || '').trim();
  const payId = optionIds.find((id) => id === configuredPayId)
    || optionIds.find((id) => /^pay(?:_|$)/i.test(id))
    || configuredPayId
    || 'pay';
  const declineId = optionIds.find((id) => id === configuredDeclineId)
    || optionIds.find((id) => /^(?:decline|no|cancel|dont|do_not_pay)$/i.test(id))
    || configuredDeclineId
    || 'decline';

  const validationFailure = getOptionalPaymentValidationFailure(game, String(playerId), step, payId);
  if (validationFailure) {
    return { selections: [declineId], cancelled: true };
  }

  const validationKind = String(step?.optionalPaymentValidationKind || 'none').trim().toLowerCase();
  if (validationKind === 'life') {
    const lifeAmount = Math.max(0, Math.floor(Number(step?.optionalPaymentLifeAmount || step?.payLifeAmount || 0)));
    const currentLife = getAIPlayerLife(game, playerId);
    if (lifeAmount > 0 && currentLife - lifeAmount <= 3) {
      return { selections: [declineId], cancelled: true };
    }
  }

  const payOption = options.find((option: any) => resolveOptionId(option) === payId) || options[0];
  const declineOption = options.find((option: any) => resolveOptionId(option) === declineId);
  const scoringStep = {
    ...step,
    description: [
      step?.description,
      step?.effect,
      step?.triggerDescription,
      step?.payDescription,
    ].map((part) => String(part || '').trim()).filter(Boolean).join(' '),
  };
  const payScore = scoreGenericChoiceOption(scoringStep, payOption);
  const declineScore = declineOption ? scoreGenericChoiceOption(scoringStep, declineOption) : -8;
  const payText = `${String(payOption?.label || '')} ${String(payOption?.description || '')} ${String(scoringStep.description || '')}`.toLowerCase();
  const looksBeneficial = /(copy|damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target|treasure|token|to (?:the )?battlefield)/i.test(payText);
  const looksSelfPunishing = /(you lose|damage to you|you discard|you sacrifice|you mill)/i.test(payText);

  if (!looksSelfPunishing && (looksBeneficial || payScore > declineScore)) {
    return { selections: [payId], cancelled: false };
  }

  return { selections: [declineId], cancelled: true };
}


function normalizeKeywordChoice(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/_/g, ' ');
}

function scoreKeywordCounterChoiceOption(
  game: any,
  playerId: PlayerID,
  step: any,
  option: any,
): number {
  const optionId = String(option?.id || option?.value || option || '');
  const keyword = normalizeKeywordChoice(optionId || option?.label || '');
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const targetPermanentId = String(step?.keywordCounterChoiceData?.targetPermanentId || '');
  const targetPermanent = battlefield.find((perm: any) => String(perm?.id || '') === targetPermanentId);
  if (!targetPermanent) {
    return scoreGenericChoiceOption(step, option);
  }

  const existingKeywords = getPermanentKeywordSet(targetPermanent);
  if (!keyword || existingKeywords.has(keyword)) {
    return -1000;
  }

  const profile = ensureAIDeckProfile(game, playerId);
  const typeLine = String(targetPermanent?.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isCommander = Boolean((targetPermanent as any)?.isCommander);
  const { power, toughness } = getPermanentCombatStats(targetPermanent, game?.state);
  const offensiveWeight = power >= 4 ? 1 : 0;
  const opponents = battlefield.filter((perm: any) => perm?.controller !== playerId);
  const opposingFlyers = opponents.filter((perm: any) => {
    if (!String(perm?.card?.type_line || '').toLowerCase().includes('creature')) return false;
    const keywords = getPermanentKeywordSet(perm);
    const oracleText = String(perm?.card?.oracle_text || '').toLowerCase();
    return keywords.has('flying') || oracleText.includes('flying');
  }).length;

  let score = scoreGenericChoiceOption(step, option);

  switch (keyword) {
    case 'trample':
      score += isCreature ? 10 + (power >= 5 ? 10 : 4) : 0;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.VOLTRON)) score += 8;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.COUNTERS)) score += 4;
      break;
    case 'flying':
      score += isCreature ? 14 + (power >= 3 ? 5 : 0) : 0;
      if (isCommander) score += 4;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.VOLTRON)) score += 6;
      break;
    case 'double strike':
      score += isCreature ? 12 + power * 2 : 0;
      if (isCommander) score += 6;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.VOLTRON)) score += 8;
      break;
    case 'first strike':
      score += isCreature ? 8 + (power >= 3 ? 6 : 0) : 0;
      break;
    case 'lifelink':
      score += isCreature ? 8 + (power >= 4 ? 6 : 0) : 0;
      if (getAIPlayerLife(game, playerId) <= 18) score += 10;
      break;
    case 'vigilance':
      score += isCreature ? 7 + (power >= 3 ? 4 : 0) : 0;
      if (isCommander) score += 3;
      break;
    case 'reach':
      score += opposingFlyers > 0 ? 16 : 2;
      if (toughness >= 4) score += 2;
      break;
    case 'deathtouch':
      score += isCreature ? (power <= 3 ? 14 : 8) : 0;
      break;
    case 'menace':
      score += isCreature ? 8 + (offensiveWeight ? 5 : 0) : 0;
      break;
    case 'hexproof':
      score += 14;
      if (isCommander) score += 10;
      if (power + toughness >= 8) score += 6;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.VOLTRON)) score += 8;
      break;
    case 'indestructible':
      score += 13;
      if (isCommander) score += 8;
      if (power + toughness >= 8) score += 5;
      break;
    default:
      break;
  }

  return score;
}

export function chooseAIKeywordCounterSelectionsForStep(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
): { selections: string[]; cancelled: boolean } {
  const resolveOptionId = (option: any): string => String(option?.id || option?.value || option || '');
  const ranked = [...options]
    .map((option: any) => ({
      id: resolveOptionId(option),
      score: scoreKeywordCounterChoiceOption(game, playerId, step, option),
    }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0]?.id;
  return { selections: best ? [best] : [], cancelled: !best };
}

function scoreCardForAIPutFromHand(
  game: any,
  playerId: PlayerID,
  card: any,
  tappedAndAttacking: boolean,
): number {
  const profile = ensureAIDeckProfile(game, playerId);
  const analysis = cardAnalyzer.analyzeCard(card);
  const battlefield = getAIBattlefield(game, playerId);
  const hand = getAIHand(game, playerId);
  const typeLine = String(card?.type_line || '').toLowerCase();
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  const power = Number(card?.power || 0) || 0;
  const toughness = Number(card?.toughness || 0) || 0;
  const cmc = Number(card?.cmc || 0) || 0;

  let score = 20;
  score += calculateCardThemeAlignment(card, profile);
  score += calculateCardSynergyPressure(card, hand, battlefield, playerId, profile);
  score += analysis.comboPotential * 5;
  score += cmc;

  if (analysis.categories.includes(CardCategory.FINISHER)) score += 12;
  if (analysis.categories.includes(CardCategory.DRAW)) score += 8;
  if (analysis.categories.includes(CardCategory.REMOVAL)) score += 10;
  if (analysis.categories.includes(CardCategory.TUTOR)) score += 8;

  if (tappedAndAttacking) {
    score += power * 4;
    if (/(flying|trample|double strike|menace|can't be blocked|unblockable)/i.test(oracleText)) score += 10;
    if (/deathtouch/i.test(oracleText)) score += 5;
  } else {
    if (analysis.details.hasETBTrigger) score += 18;
    if (analysis.details.producesMana) score += 6;
    score += power + toughness;
  }

  if (!typeLine.includes('creature')) {
    score -= 100;
  }

  return score;
}

export function chooseAIPutFromHandSelectionsForStep(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
): { selections: string[]; cancelled: boolean } {
  const putFromHandData = step?.putFromHandData;
  const validCardIds = new Set(
    Array.isArray(putFromHandData?.validCardIds)
      ? putFromHandData.validCardIds.map((id: any) => String(id))
      : [],
  );
  const tappedAndAttacking = putFromHandData?.tappedAndAttacking === true;
  const hand = getAIHand(game, playerId);

  const ranked = hand
    .filter((card: any) => validCardIds.has(String(card?.id || '')))
    .map((card: any) => ({
      id: String(card?.id || ''),
      score: scoreCardForAIPutFromHand(game, playerId, card, tappedAndAttacking),
    }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0]?.id;
  if (best) {
    return { selections: [best], cancelled: false };
  }

  const declineOption = options.find((option: any) => String(option?.id || option?.value || option || '') === 'decline');
  if (declineOption) {
    return { selections: ['decline'], cancelled: true };
  }

  return { selections: [], cancelled: true };
}
