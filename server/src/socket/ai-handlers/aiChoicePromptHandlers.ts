/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: AI option-choice prompt helpers for tax, reveal-land,
 * mox diamond, miracle, dredge, venture, exert, MDFC, and related prompts.
 *
 * Public entry symbols: chooseAIOpponentMayPaySelection, chooseAIRevealLandSelection,
 * chooseAILandWouldEnterSacrificeSelection, chooseAIMoxDiamondSelection,
 * chooseAIMiraclePromptSelection, chooseAIZursWeirdingOpponentSelection,
 * chooseAIDredgeDrawReplacementSelection, chooseAIForbiddenOrchardTargetSelection,
 * chooseAIPlayerForLookedAtCardsSelection, chooseAISpellAdditionalCostBlightOrPaySelection,
 * chooseAIVentureOptionSelection, chooseAIAdministrativeConfirmSelection,
 * chooseAIExertChoiceSelection, chooseAIMdfcFaceSelection,
 * chooseAISpellBottomRevealUntilNonlandSelection, chooseAICastFreePromptSelection,
 * getAIParsedManaCostAmount.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { getAvailableMana, getTotalManaFromPool, parseManaCost, canPayManaCostWithAvailableSources, type ParsedManaCost } from "../../state/modules/mana-check.js";
import { getOptionalPaymentValidationFailure } from "../optional-payment-prompts.js";
import { getMaxGenericManaAvailable } from "../util.js";
import { ensureAIDeckProfile, getAIHand, scoreCardForAIAcquisition } from "./aiDeckProfileHandlers.js";
import { getAILibraryCards } from "./aiPregameHandlers.js";
import { getPermanentCombatStats } from "./aiPermanentCombatStats.js";

export function getAIParsedManaCostAmount(parsed: ParsedManaCost): number {
  const colors = parsed?.colors || ({} as ParsedManaCost['colors']);
  const colored =
    Number(colors.W || 0)
    + Number(colors.U || 0)
    + Number(colors.B || 0)
    + Number(colors.R || 0)
    + Number(colors.G || 0)
    + Number(colors.C || 0);
  const hybrid = Array.isArray(parsed?.hybrid) ? parsed.hybrid.length : 0;
  return Math.max(0, Number(parsed?.generic || 0) + colored + hybrid);
}

function getAIHandSpellCmcCandidates(game: any, playerId: PlayerID): number[] {
  return getAIHand(game, playerId)
    .map((card: any) => {
      const typeLine = String(card?.type_line || '').toLowerCase();
      if (!typeLine || /\bland\b/.test(typeLine)) {
        return 0;
      }
      return Math.max(0, Number(card?.cmc ?? card?.mana_value ?? 0) || 0);
    })
    .filter((cmc) => cmc > 0);
}

/**
 * Decide whether paying an opponent tax (Rhystic / Tithe / Remora / etc.) is worth it.
 * Uses opportunity cost: keep mana when paying would lock out our best currently affordable
 * hand spell; otherwise deny opponent value when the tax is surplus / unused elsewhere.
 */
function shouldAIPayOpponentTax(
  game: any,
  playerId: PlayerID,
  manaCost: string,
  declineText: string,
): boolean {
  const parsedCost = parseManaCost(manaCost);
  const taxAmount = getAIParsedManaCostAmount(parsedCost);
  if (taxAmount <= 0) {
    return false;
  }

  let canPay = false;
  try {
    canPay = canPayManaCostWithAvailableSources(game.state, playerId, parsedCost);
  } catch {
    canPay = false;
  }
  if (!canPay) {
    return false;
  }

  let availableTotal = 0;
  try {
    availableTotal = getTotalManaFromPool(getAvailableMana(game.state, playerId));
  } catch {
    availableTotal = getMaxGenericManaAvailable(game.state, String(playerId));
  }
  const surplusAfterPay = availableTotal - taxAmount;
  if (surplusAfterPay < 0) {
    return false;
  }

  const spellCmcs = getAIHandSpellCmcCandidates(game, playerId);
  const bestAffordableNow = spellCmcs
    .filter((cmc) => cmc <= availableTotal)
    .reduce((best, cmc) => Math.max(best, cmc), 0);
  const canStillCastBest = bestAffordableNow === 0 || bestAffordableNow <= surplusAfterPay;

  // Paying would make our best currently castable spell unaffordable — keep the mana.
  if (bestAffordableNow > 0 && !canStillCastBest) {
    return false;
  }

  const declineIsDraw = /\bdraws?\b/i.test(declineText);
  const declineIsTreasure = /\btreasure\b/i.test(declineText);

  // No competing hand plays — mana isn't needed for a cast this window, so deny value.
  if (bestAffordableNow === 0) {
    if (declineIsDraw || declineIsTreasure) {
      return true;
    }
    return surplusAfterPay > 0;
  }

  // Still able to cast our best play after paying — deny the opposing benefit.
  if (declineIsDraw || declineIsTreasure) {
    return true;
  }
  return surplusAfterPay >= bestAffordableNow;
}

export function chooseAIOpponentMayPaySelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const payId = optionIds.find((id) => /^pay$/i.test(id)) || 'pay';
  const declineId = optionIds.find((id) => /^(?:decline|no|cancel|dont)$/i.test(id)) || 'decline';

  if (getOptionalPaymentValidationFailure(game, String(playerId), step, payId)) {
    return { selections: [declineId], cancelled: true };
  }

  const manaCost = String(step?.manaCost || step?.optionalPaymentManaCost || '').trim();
  if (!manaCost) {
    return { selections: [declineId], cancelled: true };
  }

  const sourceController = String(step?.sourceController || '').trim();
  const declineText = `${String(step?.declineEffect || '')} ${String(step?.triggerText || '')} ${String(step?.description || '')}`.toLowerCase();
  const declineBenefitsOpponent = (!sourceController || sourceController !== String(playerId))
    && /(draw|treasure|create|token|gain life|search|return .*battlefield|put .*counter|copy)/i.test(declineText);

  if (!declineBenefitsOpponent) {
    return { selections: [declineId], cancelled: true };
  }

  if (!shouldAIPayOpponentTax(game, playerId, manaCost, declineText)) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [payId], cancelled: false };
}

export function chooseAIRevealLandSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const declineId = optionIds.find((id) => /^decline_reveal$/i.test(id))
    || optionIds.find((id) => /^(?:decline|no|cancel|dont)$/i.test(id))
    || 'decline_reveal';
  const revealTypes = Array.isArray(step?.revealTypes)
    ? step.revealTypes.map((entry: any) => String(entry || '').trim()).filter(Boolean)
    : [];
  const hand = getAIHand(game, playerId);

  const matchingOption = optionIds
    .filter((id) => id !== declineId)
    .map((id) => hand.find((card: any) => String(card?.id || '') === id))
    .find((card: any) => {
      const typeLine = String(card?.type_line || '').toLowerCase();
      if (!typeLine.includes('land')) return false;
      if (revealTypes.length === 0) return true;
      return revealTypes.some((type) => new RegExp(`\\b${String(type).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(typeLine));
    });

  if (!matchingOption) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [String(matchingOption.id)], cancelled: false };
}

export function chooseAILandWouldEnterSacrificeSelection(
  game: any,
  _playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const offeredIds = new Set(options.map((option: any) => resolveOptionId(option)).filter(Boolean));
  const declineId = offeredIds.has('decline_land_would_enter') ? 'decline_land_would_enter' : 'decline_land_would_enter';
  const sacrificeCount = Number(step?.sacrificeCount ?? 2);
  const landCandidates = options
    .map((option: any) => resolveOptionId(option))
    .filter((id: string) => id && id !== declineId);

  if (landCandidates.length >= sacrificeCount) {
    return { selections: landCandidates.slice(0, sacrificeCount), cancelled: false };
  }

  return { selections: [declineId], cancelled: false };
}

export function chooseAIMoxDiamondSelection(
  game: any,
  playerId: PlayerID,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const offeredIds = new Set(options.map((option: any) => resolveOptionId(option)).filter(Boolean));
  const declineId = options
    .map((option: any) => resolveOptionId(option))
    .find((id: string) => id === 'decline_mox_diamond') || 'decline_mox_diamond';
  const profile = ensureAIDeckProfile(game, playerId);
  const landCandidates = getAIHand(game, playerId)
    .filter((card: any) => offeredIds.has(String(card?.id || '')))
    .filter((card: any) => /\bland\b/i.test(String(card?.type_line || '')))
    .map((card: any) => ({
      id: String(card?.id || ''),
      score: scoreCardForAIAcquisition(game, playerId, card, 'hand', profile),
    }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => left.score - right.score);

  const chosenId = landCandidates[0]?.id || '';
  return chosenId
    ? { selections: [chosenId], cancelled: false }
    : { selections: [declineId], cancelled: false };
}

export function chooseAIMiraclePromptSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const castId = optionIds.find((id) => id === 'cast_miracle') || 'cast_miracle';
  const declineId = optionIds.find((id) => id === 'decline') || optionIds.find((id) => /^(?:no|decline)$/i.test(id)) || 'decline';
  const cardId = String(step?.miracleCardId || step?.sourceId || '').trim();
  const card = getAIHand(game, playerId).find((entry: any) => String(entry?.id || '') === cardId);
  const miracleCost = String(step?.miracleCost || '').trim();

  if (!card || (card as any).isFirstDrawnThisTurn !== true || !miracleCost) {
    return { selections: [declineId], cancelled: true };
  }

  try {
    const canPay = canPayManaCostWithAvailableSources(game.state, playerId, parseManaCost(miracleCost));
    return canPay
      ? { selections: [castId], cancelled: false }
      : { selections: [declineId], cancelled: true };
  } catch {
    return { selections: [declineId], cancelled: true };
  }
}

function parseDredgeAmountFromCard(card: any): number {
  const match = String(card?.oracle_text || '').match(/\bdredge\s+(\d+)\b/i);
  const amount = match ? parseInt(match[1], 10) : 0;
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function chooseAIZursWeirdingOpponentSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const declineId = optionIds.find((id) => /^(?:decline|no|cancel)$/i.test(id)) || 'decline';
  const payId = optionIds.find((id) => /^pay(?:_2_life)?$/i.test(id));
  if (!payId) {
    return { selections: [declineId], cancelled: false };
  }

  const currentLife = Number(game?.state?.life?.[playerId] ?? game?.state?.startingLife ?? 40);
  if (currentLife < 2) {
    return { selections: [declineId], cancelled: false };
  }

  const drawingPlayerId = String(step?.drawingPlayerId || '').trim();
  const revealedName = String(step?.revealedCard?.name || '').trim().toLowerCase();
  const isOpponentDraw = drawingPlayerId && drawingPlayerId !== String(playerId);
  if (!isOpponentDraw) {
    return { selections: [declineId], cancelled: false };
  }

  const highValueHints = ['force of will', 'counterspell', 'cyclonic rift', 'sol ring', 'mana crypt', 'dockside', 'craterhoof', 'thassa'];
  const shouldPay = highValueHints.some((hint) => revealedName.includes(hint));
  return { selections: [shouldPay ? payId : declineId], cancelled: false };
}

export function chooseAIDredgeDrawReplacementSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const drawId = optionIds.find((id) => /^draw$/i.test(id))
    || optionIds.find((id) => /^(?:decline|no|cancel)$/i.test(id))
    || optionIds[0]
    || 'draw';
  const offeredDredgeIds = optionIds.filter((id) => /^dredge:/i.test(id));
  if (offeredDredgeIds.length === 0) {
    return { selections: [drawId], cancelled: false };
  }

  const graveyard = Array.isArray(game?.state?.zones?.[playerId]?.graveyard) ? game.state.zones[playerId].graveyard : [];
  const libraryCount = getAILibraryCards(game, playerId).length;
  const stepDredgeOptions = Array.isArray(step?.dredgeOptions) ? step.dredgeOptions : [];
  const profile = ensureAIDeckProfile(game, playerId);

  const ranked = offeredDredgeIds
    .map((id) => {
      const cardId = id.slice(id.indexOf(':') + 1).trim();
      const graveyardCard = graveyard.find((card: any) => String(card?.id || '') === cardId);
      if (!graveyardCard) return null;
      const configured = stepDredgeOptions.find((option: any) => String(option?.cardId || '') === cardId);
      const dredgeAmount = Math.max(0, Math.floor(Number(configured?.dredge || parseDredgeAmountFromCard(graveyardCard))));
      if (dredgeAmount <= 0 || libraryCount < dredgeAmount) return null;
      const remainingLibrary = libraryCount - dredgeAmount;
      if (remainingLibrary <= 1) return null;
      const score = scoreCardForAIAcquisition(game, playerId, graveyardCard, 'hand', profile) - dredgeAmount;
      return { id, score, dredgeAmount };
    })
    .filter((entry): entry is { id: string; score: number; dredgeAmount: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.dredgeAmount - right.dredgeAmount || left.id.localeCompare(right.id));

  const chosenId = ranked[0]?.id;
  return chosenId
    ? { selections: [chosenId], cancelled: false }
    : { selections: [drawId], cancelled: false };
}

export function chooseAISkipDrawReplacementSelection(
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const skipId = optionIds.find((id) => /^skip(?:_draw)?$/i.test(id));
  const drawId = optionIds.find((id) => /^draw$/i.test(id))
    || optionIds.find((id) => /^(?:decline|no|cancel)$/i.test(id))
    || optionIds[0]
    || 'draw';
  return { selections: [skipId || drawId], cancelled: false };
}

function scoreAIPlayerBoardDevelopment(game: any, candidateId: string): number {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const permanents = battlefield.filter((permanent: any) => String(permanent?.controller || '') === candidateId);
  const permanentScore = permanents.reduce((total: number, permanent: any) => {
    const card = permanent?.card || permanent;
    const typeLine = String(card?.type_line || '').toLowerCase();
    const combatStats = getPermanentCombatStats(permanent, game?.state);
    const power = Math.max(0, combatStats.power);
    const toughness = Math.max(0, combatStats.toughness);
    let score = 1;
    if (typeLine.includes('creature')) score += 8 + power * 2 + toughness;
    if (typeLine.includes('artifact') || typeLine.includes('enchantment') || typeLine.includes('planeswalker')) score += 3;
    return total + score;
  }, 0);

  const player = (Array.isArray(game?.state?.players) ? game.state.players : [])
    .find((entry: any) => String(entry?.id || '') === candidateId);
  const life = Number(game?.state?.life?.[candidateId] ?? player?.life ?? 40);
  const lifeScore = Number.isFinite(life) ? Math.max(0, life - 20) / 5 : 0;
  return permanentScore + lifeScore;
}

function chooseAILeastDevelopedOfferedOpponentSelection(
  game: any,
  playerId: PlayerID,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const candidates = optionIds.filter((id) => id !== String(playerId));
  if (candidates.length === 0) {
    return { selections: optionIds[0] ? [optionIds[0]] : [], cancelled: false };
  }

  const ranked = candidates
    .map((candidateId) => ({ id: candidateId, score: scoreAIPlayerBoardDevelopment(game, candidateId) }))
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));

  const chosenId = ranked[0]?.id || candidates[0] || '';
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIForbiddenOrchardTargetSelection(
  game: any,
  playerId: PlayerID,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  return chooseAILeastDevelopedOfferedOpponentSelection(game, playerId, options, resolveOptionId);
}

export function chooseAIPlayerForLookedAtCardsSelection(
  game: any,
  playerId: PlayerID,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  return chooseAILeastDevelopedOfferedOpponentSelection(game, playerId, options, resolveOptionId);
}

export function chooseAISpellAdditionalCostBlightOrPaySelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const blightId = optionIds.find((id) => id === 'blight_cost');
  const payId = optionIds.find((id) => id === 'pay_mana_cost');
  const controlledCreatures = (Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [])
    .filter((permanent: any) => String(permanent?.controller || '') === String(playerId))
    .filter((permanent: any) => String(permanent?.card?.type_line || '').toLowerCase().includes('creature'));
  const canBlight = controlledCreatures.length > 0;

  let canPay = false;
  const orPayCost = String(step?.spellAdditionalCostOrPay || '').trim();
  if (payId && orPayCost) {
    try {
      const effectId = String(step?.spellAdditionalCostEffectId || step?.sourceId || '').trim();
      const pendingCast = effectId ? game?.state?.pendingSpellCasts?.[effectId] : undefined;
      const baseCost = String(pendingCast?.manaCost || pendingCast?.card?.mana_cost || '').trim();
      const combinedCost = `${baseCost}${orPayCost}`;
      canPay = canPayManaCostWithAvailableSources(game.state, playerId, parseManaCost(combinedCost || orPayCost));
    } catch {
      canPay = false;
    }
  }

  if (payId && canPay) {
    return { selections: [payId], cancelled: false };
  }
  if (blightId && canBlight) {
    return { selections: [blightId], cancelled: false };
  }
  if (payId) {
    return { selections: [payId], cancelled: false };
  }

  return { selections: optionIds[0] ? [optionIds[0]] : [], cancelled: false };
}

function scoreAIVentureOption(option: any, id: string, step: any): number {
  const label = String(option?.label || option?.description || id || '').toLowerCase();
  if (step?.ventureChooseDungeon === true) {
    if (id === 'undercity') return 120;
    if (id === 'lost_mine') return 100;
    if (id === 'mad_mage') return 80;
    if (id === 'tomb') return 15;
  }

  let score = 0;
  if (/(draw three|cast one of them without paying)/i.test(label)) score += 80;
  if (/(reveal the top ten|onto the battlefield)/i.test(label)) score += 75;
  if (/(draw a card|draw)/i.test(label)) score += 45;
  if (/(search your library|basic land)/i.test(label)) score += 42;
  if (/(exile the top|you may play)/i.test(label)) score += 38;
  if (/treasure/i.test(label)) score += 34;
  if (/create .*token|create two|create a 4\/1|goblin|skeleton|atropal/i.test(label)) score += 30;
  if (/\+1\/\+1 counter|put two \+1\/\+1/i.test(label)) score += 24;
  if (/scry 3/i.test(label)) score += 22;
  if (/scry 2/i.test(label)) score += 18;
  if (/scry 1/i.test(label)) score += 12;
  if (/opponent loses|you gain/i.test(label)) score += 12;
  if (/target player loses/i.test(label)) score += 10;
  if (/goad/i.test(label)) score += 8;
  if (/can't attack|gets -4\/-0/i.test(label)) score += 6;
  if (/each player loses/i.test(label)) score -= 18;
  if (/discard/i.test(label)) score -= 22;
  if (/sacrifice/i.test(label)) score -= 32;

  return score;
}

export function chooseAIVentureOptionSelection(
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const ranked = options
    .map((option: any, index: number) => {
      const id = resolveOptionId(option);
      return id ? { id, index, score: scoreAIVentureOption(option, id, step) } : null;
    })
    .filter((entry): entry is { id: string; index: number; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.index - right.index || left.id.localeCompare(right.id));

  return { selections: ranked[0]?.id ? [ranked[0].id] : [], cancelled: false };
}

export function chooseAIAdministrativeConfirmSelection(
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const acceptId = optionIds.find((id) => /^(?:accept|approve|yes)$/i.test(id));
  const chosenId = acceptId || optionIds[0] || '';
  return { selections: chosenId ? [chosenId] : [], cancelled: false };
}

export function chooseAIExertChoiceSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const exertId = optionIds.find((id) => id === 'exert');
  const declineId = optionIds.find((id) => /^(?:normal|decline|no)$/i.test(id)) || optionIds[0] || '';
  const attackerId = String(step?.exertAttackerId || step?.permanentId || step?.sourceId || '').trim();
  const attacker = (Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [])
    .find((permanent: any) => String(permanent?.id || '') === attackerId);
  const canExert = Boolean(
    exertId &&
    attacker &&
    String(attacker?.controller || '') === String(playerId) &&
    attacker?.attacking &&
    attacker?.exertedThisTurn !== true
  );
  const chosenId = canExert ? exertId : declineId;
  return { selections: chosenId ? [chosenId] : [], cancelled: !canExert && /^(?:decline|no)$/i.test(chosenId) };
}

export function chooseAIMdfcFaceSelection(
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const ranked = options
    .map((option: any, index: number) => {
      const id = resolveOptionId(option);
      const text = `${String(option?.label || '')} ${String(option?.description || '')}`.toLowerCase();
      const numericId = Number(id);
      let score = 0;
      if (/\bland\b/.test(text)) score += 10;
      if (/add one mana of any color|add one mana/i.test(text)) score += 4;
      if (/enters? tapped|comes into play tapped/i.test(text)) score -= 4;
      return { id, index, numericId: Number.isFinite(numericId) ? numericId : 999, score };
    })
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => right.score - left.score || left.numericId - right.numericId || left.index - right.index);
  return { selections: ranked[0]?.id ? [ranked[0].id] : [], cancelled: false };
}

export function chooseAISpellBottomRevealUntilNonlandSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const yesId = optionIds.find((id) => /^(?:yes|use|accept)$/i.test(id)) || optionIds[0] || '';
  const noId = optionIds.find((id) => /^(?:no|decline|cancel)$/i.test(id)) || yesId;
  const controllerId = String(step?.revealFromLibraryPlayerId || playerId).trim() as PlayerID;
  const library = getAILibraryCards(game, controllerId);
  const hasNonland = library.some((card: any) => !String(card?.type_line || '').toLowerCase().includes('land'));
  const triggeringStackItemId = String(step?.triggeringStackItemId || '').trim();
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  const stackItemAvailable = !triggeringStackItemId || stack.some((item: any) => String(item?.id || '') === triggeringStackItemId);
  const shouldUse = hasNonland && stackItemAvailable;
  return { selections: [shouldUse ? yesId : noId].filter(Boolean), cancelled: !shouldUse && /^(?:no|decline|cancel)$/i.test(noId) };
}

export function chooseAICastFreePromptSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map((option: any) => resolveOptionId(option)).filter(Boolean);
  const castId = optionIds.find((id) => /^(?:cast|play)$/i.test(id));
  const declineId = optionIds.find((id) => /^(?:decline|no|cancel)$/i.test(id)) || optionIds[0] || '';
  const cardId = String(step?.castRevealedFromLibraryCard?.id || step?.castFromExileCardId || step?.castFromGraveyardCardId || step?.playFromGraveyardCardId || '').trim();
  let cardAvailable = Boolean(step?.castRevealedFromLibraryCard || step?.danceWithCalamityCastPrompt === true);

  if (!cardAvailable && cardId) {
    const zones = game?.state?.zones?.[playerId] || {};
    const zoneName = step?.castFromExileCardId ? 'exile' : 'graveyard';
    const zoneCards = Array.isArray(zones?.[zoneName]) ? zones[zoneName] : [];
    cardAvailable = zoneCards.some((card: any) => String(card?.id || '') === cardId);
  }

  const shouldCast = Boolean(castId && cardAvailable);
  const chosenId = shouldCast ? castId : declineId;
  return { selections: chosenId ? [chosenId] : [], cancelled: !shouldCast && /^(?:decline|no|cancel)$/i.test(chosenId) };
}
