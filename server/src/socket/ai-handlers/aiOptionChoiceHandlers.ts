/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: chooseAIOptionSelectionsForStep dispatcher over extracted
 * option-choice helpers.
 *
 * Public entry symbols: chooseAIOptionSelectionsForStep.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { cardAnalyzer } from "../../../../rules-engine/src/CardAnalyzer.js";
import { canAffordAttackCostPayment } from "../combat-handlers/attackCostPhyrexianPayment.js";
import { getAvailableMana, parseManaCost, canPayManaCostWithAvailableSources } from "../../state/modules/mana-check.js";
import { chooseAIReflexiveExileToOwnersGraveyardSelection } from "../aiReflexiveExileToOwnersGraveyardChoice.js";
import {
  calculateCardThemeAlignment,
  ensureAIDeckProfile,
  getAIBattlefield,
  getAIHand,
  getAIPlayerLife,
} from "./aiDeckProfileHandlers.js";
import {
  chooseAIAdministrativeConfirmSelection,
  chooseAICastFreePromptSelection,
  chooseAIDredgeDrawReplacementSelection,
  chooseAISkipDrawReplacementSelection,
  chooseAIExertChoiceSelection,
  chooseAIForbiddenOrchardTargetSelection,
  chooseAILandWouldEnterSacrificeSelection,
  chooseAIMdfcFaceSelection,
  chooseAIMiraclePromptSelection,
  chooseAIMoxDiamondSelection,
  chooseAIOpponentMayPaySelection,
  chooseAIPlayerForLookedAtCardsSelection,
  chooseAIRevealLandSelection,
  chooseAISpellAdditionalCostBlightOrPaySelection,
  chooseAISpellBottomRevealUntilNonlandSelection,
  chooseAIVentureOptionSelection,
  chooseAIZursWeirdingOpponentSelection,
} from "./aiChoicePromptHandlers.js";
import { chooseAIMayRevealHandWinIfOwnNamedSelection } from "./aiMayRevealHandWinChoiceHandlers.js";
import {
  chooseAIOptionalDiscardThenDrawSelection,
  chooseAIReflexiveFixedPaymentSelection,
  chooseAIReflexiveManaPaymentSelection,
  chooseAIReflexiveSacrificeSelection,
  chooseAISacrificeAnotherPermanentForBenefitSelection,
  scoreGenericChoiceOption,
  scoreProtectedObjectForWard,
} from "./aiZoneSearchChoiceHandlers.js";
import {
  chooseAIAttachEquipmentToPermanentChoiceSelection,
  chooseAIChooseDiscardPlanSelection,
  chooseAIChooseManaColorsSelection,
  chooseAIChoosePlayerForTwoPileSplitSelection,
  chooseAICopyRetargetSelection,
  chooseAIForceOfWillExileSelection,
  chooseAIGrantPlayableFromExileSelection,
  chooseAIKeywordCounterSelectionsForStep,
  chooseAILookedAtCardsDestinationSelection,
  chooseAIMoveChosenHandCardToLibrarySelection,
  chooseAIOptionalPaymentPromptSelection,
  chooseAIPayManaToLookAndChooseCardSelection,
  chooseAIPileFromSplitSelection,
  chooseAIPutFromHandSelectionsForStep,
  chooseAIReflexiveBoundGraveyardSelfExileSelection,
  chooseAIReflexiveConvertSelection,
  chooseAIReflexiveDiscardSelection,
  chooseAIReflexiveGraveyardExileSelection,
  chooseAIResolvedSpellCopySelection,
} from "./aiPileAndKeywordChoiceHandlers.js";
import { chooseAIPlayerChoiceId } from "./aiPlayerCardNameChoiceHandlers.js";
import { chooseAIBatch24OptionSelection } from "./aiBatch24OptionChoices.js";

/** Phyrexian attack-cost payment answers with an object (optionId + phyrexianChoices); everything else is string ids. */
export type AIOptionSelectionDecision = {
  selections: string[] | { optionId: string; phyrexianChoices: unknown };
  cancelled: boolean;
};

export function chooseAIOptionSelectionsForStep(
  game: any,
  playerId: PlayerID,
  step: any
): AIOptionSelectionDecision {
  const options = Array.isArray(step?.options) ? step.options : [];
  if (options.length === 0) {
    return { selections: [], cancelled: false };
  }

  const resolveOptionId = (option: any): string => String(option?.id || option?.value || option || '');

  if (step?.oracleIrMoveZoneDestinationChoice === true) {
    const battlefield = options.find((option: any) => resolveOptionId(option) === 'battlefield');
    return { selections: [resolveOptionId(battlefield || options[0])], cancelled: false };
  }

  if (step?.legendRuleChoice === true) {
    // Prefer the nontoken card when otherwise equivalent. Tokens cease to exist
    // after leaving the battlefield, while the real card remains recoverable.
    const preferred = options.find((option: any) => option?.isToken !== true) || options[0];
    return { selections: [resolveOptionId(preferred)], cancelled: false };
  }

  if (step?.mutateCastModeChoice === true) {
    const mutateOption = options.find((option: any) => resolveOptionId(option) === 'cast_mutate');
    const normalOption = options.find((option: any) => resolveOptionId(option) === 'cast_normal');
    const choiceId = mutateOption ? 'cast_mutate' : (normalOption ? 'cast_normal' : resolveOptionId(options[0]));
    return { selections: [choiceId], cancelled: false };
  }

  if (step?.mirrormindCrownTokenReplacementChoice === true) {
    const hasEquippedCreatureSnapshot = Boolean(step?.mirrormindCrownEquippedCreatureCard);
    const preferredChoice = hasEquippedCreatureSnapshot ? 'replace' : 'normal';
    const choiceId = options.some((option: any) => resolveOptionId(option) === preferredChoice)
      ? preferredChoice
      : resolveOptionId(options[0]);
    return { selections: [choiceId], cancelled: false };
  }

  if (step?.attackCostPayment === true) {
    const amount = Math.max(0, Math.floor(Number(step?.attackCostAmount || 0)));
    const attackers = Array.isArray(step?.attackers) ? step.attackers : [];
    const attackerIds = attackers
      .map((entry: any) => String(entry?.creatureId || entry?.attackerId || '').trim())
      .filter(Boolean);
    const phyrexianItems = Array.isArray(step?.attackCostPhyrexianItems) ? step.attackCostPhyrexianItems : [];
    const payChoice = options.some((option: any) => resolveOptionId(option) === 'pay_attack_cost') ? 'pay_attack_cost' : resolveOptionId(options[0]);
    const cancelChoice = options.some((option: any) => resolveOptionId(option) === 'cancel_attack') ? 'cancel_attack' : payChoice;
    const allMana = phyrexianItems.map((_: unknown, index: number) => ({ index, payWithLife: false }));
    const allLife = phyrexianItems.map((_: unknown, index: number) => ({ index, payWithLife: true }));
    const affordMana = canAffordAttackCostPayment(game.state, playerId, {
      generic: amount,
      items: phyrexianItems,
      excludedPermanentIds: attackerIds,
      choices: allMana,
    });
    const affordLife = !affordMana.ok
      ? canAffordAttackCostPayment(game.state, playerId, {
        generic: amount,
        items: phyrexianItems,
        excludedPermanentIds: attackerIds,
        choices: allLife,
      })
      : { ok: false };
    const canPay = affordMana.ok || affordLife.ok;
    if (!canPay) {
      return { selections: [cancelChoice], cancelled: false };
    }
    if (phyrexianItems.length === 0) {
      return { selections: [payChoice], cancelled: false };
    }
    return {
      selections: {
        optionId: payChoice,
        phyrexianChoices: affordMana.ok ? allMana : allLife,
      },
      cancelled: false,
    };
  }

  if (step?.commanderZoneChoice === true) {
    const commandChoice = options.some((option: any) => resolveOptionId(option) === 'command') ? 'command' : resolveOptionId(options[0]);
    return { selections: [commandChoice], cancelled: false };
  }

  const isOptionalTriggeredAbilityPrompt =
    step?.optionalTriggeredAbilityPrompt === true ||
    String(step?.effectProgramFamily || '').trim() === 'optional_triggered_ability' ||
    String(step?.effectProgram?.effectProgramFamily || '').trim() === 'optional_triggered_ability';

  if (isOptionalTriggeredAbilityPrompt) {
    const effectText = String(step?.effectText || step?.fullAbilityText || step?.description || '').toLowerCase();
    let shouldAccept = true;
    if (effectText.includes('draw')) {
      const libraryZone = (game.state as any)?.zones?.[playerId]?.library
        ?? (game.state as any)?.libraries?.[playerId]
        ?? [];
      const deckSize = Array.isArray(libraryZone) ? libraryZone.length : 0;
      if (deckSize <= 3) {
        shouldAccept = false;
      }
    }
    if (effectText.includes('sacrifice') || effectText.includes('discard')) {
      shouldAccept = false;
    }
    const choiceId = options.some((option: any) => resolveOptionId(option) === 'yes')
      ? (shouldAccept ? 'yes' : 'no')
      : resolveOptionId(options[shouldAccept ? 0 : Math.min(1, options.length - 1)]);
    return { selections: [choiceId], cancelled: !shouldAccept };
  }

  if (step?.reflexiveManaPaymentChoice === true) {
    return chooseAIReflexiveManaPaymentSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.reflexiveFixedPaymentChoice === true) {
    return chooseAIReflexiveFixedPaymentSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.sacrificeWhenYouDo === true && String(step?.sacrificeWhenYouDoStage || '') === 'ask') {
    return chooseAIReflexiveSacrificeSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.sacrificeAnotherPermanentForBenefitChoice === true && String(step?.sacrificeAnotherPermanentForBenefitStage || '') === 'ask') {
    return chooseAISacrificeAnotherPermanentForBenefitSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.optionalDiscardThenDrawChoice === true) {
    return chooseAIOptionalDiscardThenDrawSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.opponentMayPayChoice === true) {
    return chooseAIOpponentMayPaySelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.revealLandChoice === true) {
    return chooseAIRevealLandSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.landWouldEnterSacrificeChoice === true) {
    return chooseAILandWouldEnterSacrificeSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.moxDiamondChoice === true) {
    return chooseAIMoxDiamondSelection(game, playerId, options, resolveOptionId);
  }

  if (step?.miraclePrompt === true) {
    return chooseAIMiraclePromptSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.dredgeDrawReplacementChoice === true) {
    return chooseAIDredgeDrawReplacementSelection(game, playerId, step, options, resolveOptionId);
  }

  const batch24Selection = chooseAIBatch24OptionSelection(game, String(playerId), step, options, resolveOptionId);
  if (batch24Selection) return batch24Selection;

  if (step?.skipDrawReplacementChoice === true) {
    return chooseAISkipDrawReplacementSelection(options, resolveOptionId);
  }

  if (step?.opponentLibraryDrawReplacement === true) {
    return { selections: [resolveOptionId(options[0]) || String(options[0]?.id || '').trim()], cancelled: false };
  }

  if (step?.zursWeirdingOpponentChoice === true) {
    return chooseAIZursWeirdingOpponentSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.forbiddenOrchardTargetChoice === true) {
    return chooseAIForbiddenOrchardTargetSelection(game, playerId, options, resolveOptionId);
  }

  if (step?.choosePileFromSplitChoice === true) {
    return chooseAIPileFromSplitSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.grantPlayableFromExileChoice === true) {
    return chooseAIGrantPlayableFromExileSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.chooseLookedAtCardsDestinationChoice === true) {
    return chooseAILookedAtCardsDestinationSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.choosePlayerForLookedAtCardsChoice === true) {
    return chooseAIPlayerForLookedAtCardsSelection(game, playerId, options, resolveOptionId);
  }

  if (step?.spellAdditionalCostBlightOrPay === true) {
    return chooseAISpellAdditionalCostBlightOrPaySelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.ventureChooseDungeon === true || step?.ventureChooseRoom === true) {
    return chooseAIVentureOptionSelection(step, options, resolveOptionId);
  }

  if (step?.importWipeConfirm === true || step?.judgeConfirm === true) {
    return chooseAIAdministrativeConfirmSelection(options, resolveOptionId);
  }

  if (step?.exertChoice === true) {
    return chooseAIExertChoiceSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.roomDoorLockOrUnlock === true) {
    const roomPermanentId = String(step?.roomPermanentId || step?.sourceId || '').trim();
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const room = battlefield.find((permanent: any) => String(permanent?.id || '') === roomPermanentId);
    const preferUnlock = room?.doorLocked === true;
    const choiceId = preferUnlock
      ? (options.some((option: any) => resolveOptionId(option) === 'unlock') ? 'unlock' : resolveOptionId(options[0]))
      : (options.some((option: any) => resolveOptionId(option) === 'lock') ? 'lock' : resolveOptionId(options[0]));
    return { selections: [choiceId], cancelled: false };
  }

  if (step?.spellBeholdCastPrompt === true) {
    const skipId = options.some((option: any) => resolveOptionId(option) === 'skip')
      ? 'skip'
      : resolveOptionId(options[Math.max(0, options.length - 1)]);
    return { selections: skipId ? [skipId] : [], cancelled: false };
  }

  if (step?.mdfcFaceChoice === true) {
    return chooseAIMdfcFaceSelection(options, resolveOptionId);
  }

  if (step?.spellBottomRevealUntilNonlandChoice === true) {
    return chooseAISpellBottomRevealUntilNonlandSelection(game, playerId, step, options, resolveOptionId);
  }

  if (
    step?.castRevealedFromLibraryChoice === true ||
    step?.danceWithCalamityCastPrompt === true ||
    Boolean(step?.castFromExileCardId && step?.castFromExileCard) ||
    Boolean(step?.castFromGraveyardCardId && step?.castFromGraveyardCard) ||
    Boolean(step?.playFromGraveyardCardId && step?.playFromGraveyardCard)
  ) {
    return chooseAICastFreePromptSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.payManaToLookAndChooseCardChoice === true) {
    return chooseAIPayManaToLookAndChooseCardSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.chooseManaColorsChoice === true) {
    return chooseAIChooseManaColorsSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.moveChosenHandCardToLibraryChoice === true) {
    return chooseAIMoveChosenHandCardToLibrarySelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.attachEquipmentToPermanentChoice === true) {
    return chooseAIAttachEquipmentToPermanentChoiceSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.chooseDiscardPlanChoice === true) {
    return chooseAIChooseDiscardPlanSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.choosePlayerForTwoPileSplitChoice === true) {
    return chooseAIChoosePlayerForTwoPileSplitSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.forceOfWillExileChoice === true) {
    return chooseAIForceOfWillExileSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.resolvedSpellCopyChoice === true) {
    return chooseAIResolvedSpellCopySelection(step, options, resolveOptionId);
  }

  if (step?.retargetSpellCopy === true || step?.retargetAbilityCopy === true) {
    return chooseAICopyRetargetSelection(step, options, resolveOptionId);
  }

  if (step?.reflexiveDiscardWhenYouDo === true && String(step?.reflexiveDiscardWhenYouDoStage || '') === 'ask') {
    return chooseAIReflexiveDiscardSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.reflexiveGraveyardExileWhenYouDo === true && String(step?.reflexiveGraveyardExileWhenYouDoStage || '') === 'ask') {
    return chooseAIReflexiveGraveyardExileSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.reflexiveBoundGraveyardSelfExileWhenYouDo === true && String(step?.reflexiveBoundGraveyardSelfExileWhenYouDoStage || '') === 'ask') {
    return chooseAIReflexiveBoundGraveyardSelfExileSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.reflexiveExileToOwnersGraveyardWhenYouDo === true && String(step?.reflexiveExileToOwnersGraveyardWhenYouDoStage || '') === 'ask') {
    return chooseAIReflexiveExileToOwnersGraveyardSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.reflexiveConvertWhenYouDo === true) {
    return chooseAIReflexiveConvertSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.mayRevealHandWinIfOwnNamedChoice === true) {
    return chooseAIMayRevealHandWinIfOwnNamedSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.mayAbilityPrompt === true) {
    const effectText = String(step?.effectText || step?.description || '').toLowerCase();
    let shouldAccept = true;
    if (effectText.includes('draw')) {
      const libraryZone = (game.state as any)?.zones?.[playerId]?.library
        ?? (game.state as any)?.libraries?.[playerId]
        ?? [];
      const deckSize = Array.isArray(libraryZone) ? libraryZone.length : 0;
      if (deckSize <= 3) {
        shouldAccept = false;
      }
    }
    const choiceId = options.some((option: any) => resolveOptionId(option) === 'yes')
      ? (shouldAccept ? 'yes' : 'no')
      : resolveOptionId(options[shouldAccept ? 0 : Math.min(1, options.length - 1)]);
    return { selections: [choiceId], cancelled: !shouldAccept };
  }

  if (step?.shockLandChoice === true) {
    const payLifeAmount = Number(step?.payLifeAmount || 2);
    const currentLife = getAIPlayerLife(game, playerId);
    const isOwnTurn = game?.state?.turnPlayer === playerId;
    const phase = String(game?.state?.phase || '').toLowerCase();
    const hand = getAIHand(game, playerId);
    const wantUntapped = isOwnTurn && phase.includes('main') && hand.some((card: any) => String(card?.mana_cost || '').length > 0);
    const shouldPay = currentLife - payLifeAmount >= 10 && wantUntapped;
    return { selections: [shouldPay ? 'pay_2_life' : 'enter_tapped'], cancelled: false };
  }

  if (step?.optionalPaymentPrompt === true) {
    return chooseAIOptionalPaymentPromptSelection(game, playerId, step, options, resolveOptionId);
  }

  if (step?.wardPayment === true) {
    const paymentType = String(step?.wardPaymentType || '').trim().toLowerCase();
    const wardValue = scoreProtectedObjectForWard(game, playerId, step);
    if (paymentType === 'mana') {
      const wardCost = String(step?.wardCost || '');
      const parsed = parseManaCost(wardCost);
      const manaPool = getAvailableMana(game.state, playerId);
      const canPay = canPayManaCostWithAvailableSources(game.state, playerId, parsed);
      return { selections: [canPay ? 'pay_ward_cost' : 'decline_ward_cost'], cancelled: false };
    }
    if (paymentType === 'life') {
      const lifeAmount = Number(step?.wardLifeAmount || 0);
      const currentLife = getAIPlayerLife(game, playerId);
      const shouldPay = currentLife - lifeAmount >= (wardValue >= 60 ? 5 : 12);
      return { selections: [shouldPay ? 'pay_ward_cost' : 'decline_ward_cost'], cancelled: false };
    }
    if (paymentType === 'discard') {
      const discardCount = Number(step?.wardDiscardCount || 1);
      const hand = getAIHand(game, playerId);
      const shouldPay = hand.length >= discardCount && (hand.length - discardCount >= 2 || wardValue >= 60);
      return { selections: [shouldPay ? 'pay_ward_cost' : 'decline_ward_cost'], cancelled: false };
    }
    if (paymentType === 'sacrifice') {
      const sacCount = Number(step?.wardSacrificeCount || 1);
      const battlefield = getAIBattlefield(game, playerId);
      const expendable = battlefield.filter((perm: any) => {
        const analysis = cardAnalyzer.analyzeCard(perm);
        const theme = calculateCardThemeAlignment(perm.card || perm, ensureAIDeckProfile(game, playerId));
        return Boolean((perm as any).isToken) || (analysis.comboPotential <= 3 && theme <= 4);
      });
      const shouldPay = expendable.length >= sacCount && wardValue >= 55;
      return { selections: [shouldPay ? 'pay_ward_cost' : 'decline_ward_cost'], cancelled: false };
    }
  }

  if (step?.keywordCounterChoiceData) {
    return chooseAIKeywordCounterSelectionsForStep(game, playerId, step, options);
  }

  if (step?.putFromHandData) {
    return chooseAIPutFromHandSelectionsForStep(game, playerId, step, options);
  }

  if (step?.giftCastChoice === true) {
    const noneOptionId = options
      .map((option: any) => resolveOptionId(option))
      .find((id: string) => id === 'gift:none') || 'gift:none';
    const giftPlayerIds = options
      .map((option: any) => resolveOptionId(option))
      .filter((id: string) => id.startsWith('gift:') && id !== 'gift:none')
      .map((id: string) => id.slice('gift:'.length))
      .filter(Boolean);

    if (giftPlayerIds.length === 0) {
      return { selections: [noneOptionId], cancelled: false };
    }

    const fromZone = step?.giftFromZone === 'exile' || step?.giftFromZone === 'graveyard' ? step.giftFromZone : 'hand';
    const zones = (game?.state as any)?.zones?.[playerId];
    const sourceCards: any[] = fromZone === 'exile'
      ? (Array.isArray(zones?.exile) ? zones.exile : [])
      : fromZone === 'graveyard'
        ? (Array.isArray(zones?.graveyard) ? zones.graveyard : [])
        : (Array.isArray(zones?.hand) ? zones.hand : []);
    const cardId = String(step?.giftCardId || step?.sourceId || '').trim();
    const sourceCard = sourceCards.find((entry: any) => String(entry?.id || '') === cardId);
    const oracleText = String(sourceCard?.oracle_text || '').toLowerCase();

    let promiseScore = 0;
    if (oracleText.includes('if the gift was promised')) promiseScore += 10;
    if (oracleText.includes("if the gift wasn't promised") || oracleText.includes('if the gift was not promised')) promiseScore += 12;
    if (/(counter target spell|counter target|destroy|exile|draw seven|draw [a-z0-9]+ cards|search your library|create [^\n]*token)/i.test(oracleText)) promiseScore += 4;
    if (/(each other player|each opponent|opponents? (?:draw|create|gain|return|shuffle))/i.test(oracleText)) promiseScore += 6;

    if (promiseScore <= 0) {
      return { selections: [noneOptionId], cancelled: false };
    }

    const chosenPlayerId = chooseAIPlayerChoiceId(game, playerId, {
      players: giftPlayerIds.map((id: string) => ({ id })),
      opponentOnly: true,
    }) || giftPlayerIds[0];

    return {
      selections: [`gift:${chosenPlayerId}`],
      cancelled: false,
    };
  }

  if (step?.myriadChoice === true) {
    return {
      selections: options
        .map((option: any) => resolveOptionId(option))
        .filter(Boolean),
      cancelled: false,
    };
  }

  const minSelections = Math.max(1, Number(step?.minSelections ?? 1));
  const maxSelections = Math.max(minSelections, Number(step?.maxSelections ?? minSelections));
  const desired = Math.min(options.length, Math.max(minSelections, Math.min(maxSelections, 1)));

  const selections = [...options]
    .map((option: any) => ({ id: resolveOptionId(option), score: scoreGenericChoiceOption(step, option) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, desired)
    .map((entry) => entry.id)
    .filter(Boolean);

  return {
    selections,
    cancelled: selections.length === 1 && /^(?:no|decline|decline_ward_cost)$/i.test(selections[0]),
  };
}
