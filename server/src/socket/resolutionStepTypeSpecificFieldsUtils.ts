/**
 * socket/resolutionStepTypeSpecificFieldsUtils.ts
 *
 * Maps a ResolutionStep to the type-specific fields sent to clients
 * (via sanitizeStepForClient). Extracted from resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
} from "../state/resolution/index.js";



const MANA_PAYMENT_CLIENT_FIELD_KEYS = [
  'permanentId',
  'cardId',
  'castSpellArgs',
  'cardName',
  'activationPaymentChoice',
  'activationPaymentContext',
  'confirmLabel',
  'wardPayment',
  'wardPaymentType',
  'wardCost',
  'wardPermanentId',
  'wardPermanentName',
  'wardPermanentController',
  'wardTriggeredBy',
  'spellPaymentRequired',
  'graveyardSpellCastManaPayment',
  'phyrexianManaChoice',
  'abilityText',
  'abilityId',
  'effectId',
  'targets',
  'targetsForCast',
  'totalManaCost',
  'manaCost',
  'genericCost',
  'phyrexianChoices',
  'playerLife',
  'imageUrl',
  'costAdjustment',
  'costReduction',
  'convokeOptions',
  'harmonizeOptions',
  'sneakOptions',
  'forcedAlternateCostId',
  'preferredAlternateCostId',
  'oracleText',
  'typeLine',
  'type_line',
  'extraAlternateCosts',
  'fromZone',
  'xValue',
  'castWithoutPayingManaCost',
  'lifeToPayForCost',
  'discardedCardIdsForCost',
  'exiledCardIdsFromHandForCost',
  'exiledCardIdsFromGraveyardForCost',
  'sacrificedPermanentIdsForCost',
  'title',
] as const;

export function copyDefinedStepFields(step: any, keys: readonly string[]): Record<string, any> {
  const fields: Record<string, any> = {};
  if (!step || typeof step !== 'object') return fields;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(step, key)) continue;
    const value = (step as any)[key];
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

export function getTypeSpecificFields(step: ResolutionStep): Record<string, any> {
  const fields: Record<string, any> = {};
  
  switch (step.type) {
    case ResolutionStepType.HAND_TO_BOTTOM:
      if ('hand' in step) fields.hand = (step as any).hand;
      if ('cardsToBottom' in step) fields.cardsToBottom = (step as any).cardsToBottom;
      if ('reason' in step) fields.reason = (step as any).reason;
      break;

    case ResolutionStepType.TARGET_SELECTION:
      if ('validTargets' in step) fields.validTargets = step.validTargets;
      if ('targetTypes' in step) fields.targetTypes = step.targetTypes;
      if ('minTargets' in step) fields.minTargets = step.minTargets;
      if ('maxTargets' in step) fields.maxTargets = step.maxTargets;
      if ('targetDescription' in step) fields.targetDescription = step.targetDescription;
      if ((step as any).crewAbility === true) {
        fields.crewAbility = true;
        if ((step as any).vehicleId != null) fields.vehicleId = (step as any).vehicleId;
        if ((step as any).crewPower != null) fields.crewPower = (step as any).crewPower;
      }
      break;

    case ResolutionStepType.COUNTER_TARGET:
      if ('validTargets' in step) fields.validTargets = (step as any).validTargets;
      if ('targetTypes' in step) fields.targetTypes = (step as any).targetTypes;
      if ('minTargets' in step) fields.minTargets = (step as any).minTargets;
      if ('maxTargets' in step) fields.maxTargets = (step as any).maxTargets;
      if ('targetDescription' in step) fields.targetDescription = (step as any).targetDescription;
      if ('counterType' in step) fields.counterType = (step as any).counterType;
      if ('targetController' in step) fields.targetController = (step as any).targetController;
      if ('oracleText' in step) fields.oracleText = (step as any).oracleText;
      if ('scalingText' in step) fields.scalingText = (step as any).scalingText;
      if ('title' in step) fields.title = (step as any).title;
      break;

    case ResolutionStepType.FIGHT_TARGET:
      if ('targetFilter' in step) fields.targetFilter = (step as any).targetFilter;
      if ('title' in step) fields.title = (step as any).title;
      break;

    case ResolutionStepType.TAP_UNTAP_TARGET:
      if ('action' in step) fields.action = (step as any).action;
      if ('targetFilter' in step) fields.targetFilter = (step as any).targetFilter;
      if ('targetCount' in step) fields.targetCount = (step as any).targetCount;
      if ('title' in step) fields.title = (step as any).title;
      break;

    case ResolutionStepType.COUNTER_MOVEMENT:
      if ('sourceFilter' in step) fields.sourceFilter = (step as any).sourceFilter;
      if ('targetFilter' in step) fields.targetFilter = (step as any).targetFilter;
      if ('title' in step) fields.title = (step as any).title;
      break;

    case ResolutionStepType.COUNTER_DISTRIBUTION:
      if ('counterType' in step) fields.counterType = (step as any).counterType;
      if ('totalAmount' in step) fields.totalAmount = (step as any).totalAmount;
      if ('minPerTarget' in step) fields.minPerTarget = (step as any).minPerTarget;
      if ('validTargets' in step) fields.validTargets = (step as any).validTargets;
      if ('message' in step) fields.message = (step as any).message;
      if ('title' in step) fields.title = (step as any).title;
      break;

    case ResolutionStepType.MANA_COLOR_SELECTION:
      if ('selectionKind' in step) fields.selectionKind = (step as any).selectionKind;
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('amount' in step) fields.amount = (step as any).amount;
      if ('totalAmount' in step) fields.totalAmount = (step as any).totalAmount;
      if ('allowedColors' in step) fields.allowedColors = (step as any).allowedColors;
      if ('availableColors' in step) fields.availableColors = (step as any).availableColors;
      if ('amountByColor' in step) fields.amountByColor = (step as any).amountByColor;
      if ('dynamicAmountSource' in step) fields.dynamicAmountSource = (step as any).dynamicAmountSource;
      if ('chosenCreatureType' in step) fields.chosenCreatureType = (step as any).chosenCreatureType;
      if ('manaMultiplier' in step) fields.manaMultiplier = (step as any).manaMultiplier;
      if ('manaRestriction' in step) fields.manaRestriction = (step as any).manaRestriction;
      if ('manaRestrictedTo' in step) fields.manaRestrictedTo = (step as any).manaRestrictedTo;
      if ('message' in step) fields.message = (step as any).message;
      if ('singleColor' in step) fields.singleColor = (step as any).singleColor;
      if ('isStorageCounter' in step) fields.isStorageCounter = (step as any).isStorageCounter;
      if ('counterType' in step) fields.counterType = (step as any).counterType;
      if ('removeCounterCount' in step) fields.removeCounterCount = (step as any).removeCounterCount;
      if ('abilityId' in step) fields.abilityId = (step as any).abilityId;
      if ('bulkTappedPermanentIds' in step) fields.bulkTappedPermanentIds = (step as any).bulkTappedPermanentIds;
      break;

    case ResolutionStepType.STATION_CREATURE_SELECTION:
      if ('station' in step) fields.station = (step as any).station;
      if ('creatures' in step) fields.creatures = (step as any).creatures;
      if ('tapForCountersSource' in step) fields.tapForCountersSource = (step as any).tapForCountersSource;
      if ('tapForCountersCreatures' in step) fields.tapForCountersCreatures = (step as any).tapForCountersCreatures;
      if ('title' in step) fields.title = (step as any).title;
      break;

    case ResolutionStepType.LIFE_PAYMENT:
      if ('cardId' in step) fields.cardId = (step as any).cardId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('currentLife' in step) fields.currentLife = (step as any).currentLife;
      if ('minPayment' in step) fields.minPayment = (step as any).minPayment;
      if ('maxPayment' in step) fields.maxPayment = (step as any).maxPayment;
      break;

    case ResolutionStepType.ADDITIONAL_COST_PAYMENT:
      if ('cardId' in step) fields.cardId = (step as any).cardId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('costType' in step) fields.costType = (step as any).costType;
      if ('amount' in step) fields.amount = (step as any).amount;
      if ('filter' in step) fields.filter = (step as any).filter;
      if ('counterType' in step) fields.counterType = (step as any).counterType;
      if ('title' in step) fields.title = (step as any).title;
      if ('imageUrl' in step) fields.imageUrl = (step as any).imageUrl;
      if ('availableCards' in step) fields.availableCards = (step as any).availableCards;
      if ('availableTargets' in step) fields.availableTargets = (step as any).availableTargets;
      if ('availableCounters' in step) fields.availableCounters = (step as any).availableCounters;
      break;

    case ResolutionStepType.SQUAD_COST_PAYMENT:
      if ('cardId' in step) fields.cardId = (step as any).cardId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('squadCost' in step) fields.squadCost = (step as any).squadCost;
      if ('imageUrl' in step) fields.imageUrl = (step as any).imageUrl;
      break;
      
    case ResolutionStepType.MODE_SELECTION:
      if ('modes' in step) fields.modes = step.modes;
      if ('minModes' in step) fields.minModes = step.minModes;
      if ('maxModes' in step) fields.maxModes = step.maxModes;
      if ('normalMinModes' in step) fields.normalMinModes = (step as any).normalMinModes;
      if ('normalMaxModes' in step) fields.normalMaxModes = (step as any).normalMaxModes;
      if ('entwineCost' in step) fields.entwineCost = (step as any).entwineCost;
      if ('allowDuplicates' in step) fields.allowDuplicates = step.allowDuplicates;
      if ('modeSelectionPurpose' in step) fields.modeSelectionPurpose = (step as any).modeSelectionPurpose;
      if ('pBudget' in step) fields.pBudget = (step as any).pBudget;
      if ('canRepeatModes' in step) fields.canRepeatModes = (step as any).canRepeatModes;
      break;
      
    case ResolutionStepType.DISCARD_SELECTION:
      if ('hand' in step) fields.hand = step.hand;
      if ('discardCount' in step) fields.discardCount = step.discardCount;
      if ('currentHandSize' in step) fields.currentHandSize = step.currentHandSize;
      if ('maxHandSize' in step) fields.maxHandSize = step.maxHandSize;
      if ('reason' in step) fields.reason = step.reason;
      break;
      
    case ResolutionStepType.TRIGGER_ORDER:
      if ('triggers' in step) fields.triggers = step.triggers;
      if ('requireAll' in step) fields.requireAll = step.requireAll;
      break;
      
    case ResolutionStepType.LIBRARY_SEARCH:
      if ('searchCriteria' in step) fields.searchCriteria = step.searchCriteria;
      if ('minSelections' in step) fields.minSelections = step.minSelections;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      if ('maxTotalManaValue' in step) fields.maxTotalManaValue = (step as any).maxTotalManaValue;
      if ('destination' in step) fields.destination = step.destination;
      if ('reveal' in step) fields.reveal = step.reveal;
      if ('shuffleAfter' in step) fields.shuffleAfter = step.shuffleAfter;
      if ('remainderDestination' in step) fields.remainderDestination = step.remainderDestination;
      if ('remainderRandomOrder' in step) fields.remainderRandomOrder = step.remainderRandomOrder;
      if ('availableCards' in step) fields.availableCards = step.availableCards;
      if ('nonSelectableCards' in step) fields.nonSelectableCards = step.nonSelectableCards;
      if ('contextValue' in step) fields.contextValue = step.contextValue;
      if ('entersTapped' in step) fields.entersTapped = step.entersTapped;
      if ('filter' in step) fields.filter = (step as any).filter;
      if ('targetPlayerId' in step) fields.targetPlayerId = (step as any).targetPlayerId;
      if ('splitDestination' in step) fields.splitDestination = (step as any).splitDestination;
      if ('toBattlefield' in step) fields.toBattlefield = (step as any).toBattlefield;
      if ('toHand' in step) fields.toHand = (step as any).toHand;
      if ('lifeLoss' in step) fields.lifeLoss = (step as any).lifeLoss;
      if ('attachSelectedEquipmentToPermanentId' in step) fields.attachSelectedEquipmentToPermanentId = (step as any).attachSelectedEquipmentToPermanentId;
      break;
    
    case ResolutionStepType.COLOR_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('spellId' in step) fields.spellId = (step as any).spellId;
      if ('colors' in step) fields.colors = (step as any).colors;
      break;

    case ResolutionStepType.MANA_PAYMENT_CHOICE:
      Object.assign(fields, copyDefinedStepFields(step, MANA_PAYMENT_CLIENT_FIELD_KEYS));
      break;

    case ResolutionStepType.MUTATE_TARGET_SELECTION:
      if ('effectId' in step) fields.effectId = (step as any).effectId;
      if ('cardId' in step) fields.cardId = (step as any).cardId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('mutateCost' in step) fields.mutateCost = (step as any).mutateCost;
      if ('imageUrl' in step) fields.imageUrl = (step as any).imageUrl;
      if ('validTargets' in step) fields.validTargets = (step as any).validTargets;
      break;

    case ResolutionStepType.GRAVEYARD_SELECTION:
      if ('effectId' in step) fields.effectId = (step as any).effectId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('title' in step) fields.title = (step as any).title;
      if ('targetPlayerId' in step) fields.targetPlayerId = (step as any).targetPlayerId;
      if ('filter' in step) fields.filter = (step as any).filter;
      if ('minTargets' in step) fields.minTargets = (step as any).minTargets;
      if ('maxTargets' in step) fields.maxTargets = (step as any).maxTargets;
      if ('destination' in step) fields.destination = (step as any).destination;
      if ('validTargets' in step) fields.validTargets = (step as any).validTargets;
      if ('imageUrl' in step) fields.imageUrl = (step as any).imageUrl;
      break;
    
    case ResolutionStepType.CREATURE_TYPE_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('reason' in step) fields.reason = (step as any).reason;
      if (Array.isArray((step as any).offeredCreatureTypes)) {
        fields.offeredCreatureTypes = (step as any).offeredCreatureTypes;
      }
      break;
    
    case ResolutionStepType.CARD_NAME_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('reason' in step) fields.reason = (step as any).reason;
      if ('restrictionText' in step) fields.restrictionText = (step as any).restrictionText;
      if ('candidateNames' in step) fields.candidateNames = (step as any).candidateNames;
      break;
    
    case ResolutionStepType.PLAYER_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('players' in step) fields.players = (step as any).players;
      if ('opponentOnly' in step) fields.opponentOnly = (step as any).opponentOnly;
      break;
      
    case ResolutionStepType.OPTION_CHOICE:
    case ResolutionStepType.MODAL_CHOICE:
      if ('options' in step) fields.options = step.options;
      if ('minSelections' in step) fields.minSelections = step.minSelections;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('effectText' in step) fields.effectText = (step as any).effectText;
      if ('fullAbilityText' in step) fields.fullAbilityText = (step as any).fullAbilityText;
      if ('effectKey' in step) fields.effectKey = (step as any).effectKey;
      if ('pendingCallbackId' in step) fields.pendingCallbackId = (step as any).pendingCallbackId;
      if ('mayAbilityPrompt' in step) fields.mayAbilityPrompt = (step as any).mayAbilityPrompt;
      if ('effectProgramPrompt' in step) fields.effectProgramPrompt = (step as any).effectProgramPrompt;
      if ('effectProgramFamily' in step) fields.effectProgramFamily = (step as any).effectProgramFamily;

      // Custom: Opponent-may-pay prompts (Smothering Tithe, Rhystic Study, etc.)
      if ((step as any)?.opponentMayPayChoice === true) {
        fields.opponentMayPayChoice = true;
        fields.promptId = (step as any).promptId;
        fields.sourceName = (step as any).sourceName;
        fields.sourceController = (step as any).sourceController;
        fields.decidingPlayer = (step as any).decidingPlayer;
        fields.manaCost = (step as any).manaCost;
        fields.declineEffect = (step as any).declineEffect;
        fields.triggerText = (step as any).triggerText;
        fields.availableMana = (step as any).availableMana;
      }

      // Custom: deck import wipe confirmations (Resolution Queue)
      if ((step as any)?.importWipeConfirm === true) {
        fields.importWipeConfirm = true;
        fields.kind = (step as any).kind;
        fields.confirmId = (step as any).confirmId;
        fields.initiator = (step as any).initiator;
        fields.deckName = (step as any).deckName;
        fields.resolvedCount = (step as any).resolvedCount;
        fields.expectedCount = (step as any).expectedCount;
        fields.voters = (step as any).voters;
      }

      // Custom: judge confirmations (Resolution Queue)
      if ((step as any)?.judgeConfirm === true) {
        fields.judgeConfirm = true;
        fields.kind = (step as any).kind;
        fields.confirmId = (step as any).confirmId;
        fields.initiator = (step as any).initiator;
        fields.voters = (step as any).voters;
        fields.responses = (step as any).responses;
      }

      if ((step as any)?.prisonersDilemmaChoice === true) {
        fields.prisonersDilemmaChoice = true;
        fields.secretChoice = (step as any).secretChoice;
        fields.prisonersDilemmaBatchId = (step as any).prisonersDilemmaBatchId;
        fields.prisonersDilemmaExpectedPlayerIds = (step as any).prisonersDilemmaExpectedPlayerIds;
        fields.prisonersDilemmaController = (step as any).prisonersDilemmaController;
        fields.prisonersDilemmaSourceId = (step as any).prisonersDilemmaSourceId;
        fields.prisonersDilemmaSourceName = (step as any).prisonersDilemmaSourceName;
      }

      if ((step as any)?.roomDoorLockOrUnlock === true) {
        fields.roomDoorLockOrUnlock = true;
        fields.roomPermanentId = (step as any).roomPermanentId;
      }

      if ((step as any)?.attackCostPayment === true) {
        fields.attackCostPayment = true;
        fields.attackCostAmount = (step as any).attackCostAmount;
        fields.attackCostBreakdown = (step as any).attackCostBreakdown;
        fields.attackCostPhyrexianChoices = (step as any).attackCostPhyrexianChoices;
        fields.attackers = (step as any).attackers;
      }

      if ((step as any)?.skipDrawReplacementChoice === true) {
        fields.skipDrawReplacementChoice = true;
        fields.exceptKeywords = (step as any).exceptKeywords;
        fields.remainingDrawCountAfterChoice = (step as any).remainingDrawCountAfterChoice;
        fields.skipDrawSourcePermanentId = (step as any).skipDrawSourcePermanentId;
        fields.skipDrawSourceName = (step as any).skipDrawSourceName;
      }

      if ((step as any)?.counterPlacementTrigger === true || (step as any)?.agitatorAntTrigger === true) {
        fields.counterPlacementTrigger = (step as any).counterPlacementTrigger === true;
        fields.agitatorAntTrigger = (step as any).agitatorAntTrigger === true;
        fields.availableCreatures = (step as any).availableCreatures;
        fields.effectType = (step as any).effectType;
        fields.conditionalEffect = (step as any).conditionalEffect;
        fields.sourceController = (step as any).sourceController;
        fields.triggerDescription = (step as any).triggerDescription;
      }
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      if ('cards' in step) fields.cards = step.cards;
      if ('variant' in step) fields.variant = step.variant;
      if ('cardCount' in step) fields.cardCount = step.cardCount;
      if ('drawAfter' in step) fields.drawAfter = step.drawAfter;
      if ('mayShuffleAfter' in step) fields.mayShuffleAfter = step.mayShuffleAfter;
      break;

    case ResolutionStepType.EXPLORE_DECISION:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('permanentName' in step) fields.permanentName = (step as any).permanentName;
      if ('revealedCard' in step) fields.revealedCard = (step as any).revealedCard;
      if ('isLand' in step) fields.isLand = (step as any).isLand;
      break;

    case ResolutionStepType.BATCH_EXPLORE_DECISION:
      if ('explores' in step) fields.explores = (step as any).explores;
      break;
      
    case ResolutionStepType.SCRY:
      if ('cards' in step) fields.cards = step.cards;
      if ('scryCount' in step) fields.scryCount = step.scryCount;
      break;
      
    case ResolutionStepType.SURVEIL:
      if ('cards' in step) fields.cards = step.cards;
      if ('surveilCount' in step) fields.surveilCount = step.surveilCount;
      break;

    case ResolutionStepType.BOTTOM_ORDER:
      if ('cards' in step) fields.cards = (step as any).cards;
      if ('shuffleAfter' in step) fields.shuffleAfter = (step as any).shuffleAfter;
      break;

    case ResolutionStepType.LIM_DULS_VAULT:
      if ('cards' in step) fields.cards = (step as any).cards;
      if ('effectId' in step) fields.effectId = (step as any).effectId;
      if ('currentLife' in step) fields.currentLife = (step as any).currentLife;
      if ('totalLifePaid' in step) fields.totalLifePaid = (step as any).totalLifePaid;
      break;

    case ResolutionStepType.DANCE_WITH_CALAMITY:
      if ('effectId' in step) fields.effectId = (step as any).effectId;
      if ('exiledCards' in step) fields.exiledCards = (step as any).exiledCards;
      if ('totalManaValue' in step) fields.totalManaValue = (step as any).totalManaValue;
      if ('canContinue' in step) fields.canContinue = (step as any).canContinue;
      break;

    case ResolutionStepType.DANCE_WITH_CALAMITY_CAST:
      if ('effectId' in step) fields.effectId = (step as any).effectId;
      if ('exiledCards' in step) fields.exiledCards = (step as any).exiledCards;
      if ('spellCards' in step) fields.spellCards = (step as any).spellCards;
      if ('totalManaValue' in step) fields.totalManaValue = (step as any).totalManaValue;
      break;
      
    case ResolutionStepType.PROLIFERATE:
      if ('proliferateId' in step) fields.proliferateId = step.proliferateId;
      if ('availableTargets' in step) fields.availableTargets = step.availableTargets;
      break;

    case ResolutionStepType.LIFE_REDISTRIBUTION:
      if ('redistributionId' in step) fields.redistributionId = step.redistributionId;
      if ('players' in step) fields.players = step.players;
      break;
      
    case ResolutionStepType.FATESEAL:
      if ('opponentId' in step) fields.opponentId = step.opponentId;
      if ('cards' in step) fields.cards = step.cards;
      if ('fatesealCount' in step) fields.fatesealCount = step.fatesealCount;
      break;
      
    case ResolutionStepType.CLASH:
      if ('revealedCard' in step) fields.revealedCard = step.revealedCard;
      if ('opponentId' in step) fields.opponentId = step.opponentId;
      break;
      
    case ResolutionStepType.VOTE:
      if ('voteId' in step) fields.voteId = step.voteId;
      if ('choices' in step) fields.choices = step.choices;
      if ('votesSubmitted' in step) fields.votesSubmitted = step.votesSubmitted;
      break;

    case ResolutionStepType.TWO_PILE_SPLIT:
      if ('items' in step) fields.items = (step as any).items;
      if ('minPerPile' in step) fields.minPerPile = (step as any).minPerPile;
      if ('pileCount' in step) fields.pileCount = (step as any).pileCount;
      break;
      
    case ResolutionStepType.KYNAIOS_CHOICE:
      if ('isController' in step) fields.isController = step.isController;
      if ('sourceController' in step) fields.sourceController = step.sourceController;
      if ('canPlayLand' in step) fields.canPlayLand = step.canPlayLand;
      if ('landsInHand' in step) fields.landsInHand = step.landsInHand;
      if ('options' in step) fields.options = step.options;
      if ('landPlayOrFallbackIsController' in step) fields.landPlayOrFallbackIsController = (step as any).landPlayOrFallbackIsController;
      if ('landPlayOrFallbackSourceController' in step) fields.landPlayOrFallbackSourceController = (step as any).landPlayOrFallbackSourceController;
      if ('landPlayOrFallbackCanPlayLand' in step) fields.landPlayOrFallbackCanPlayLand = (step as any).landPlayOrFallbackCanPlayLand;
      if ('landPlayOrFallbackLandsInHand' in step) fields.landPlayOrFallbackLandsInHand = (step as any).landPlayOrFallbackLandsInHand;
      if ('landPlayOrFallbackOptions' in step) fields.landPlayOrFallbackOptions = (step as any).landPlayOrFallbackOptions;
      break;
      
    case ResolutionStepType.JOIN_FORCES:
      if ('cardName' in step) fields.cardName = step.cardName;
      if ('effectDescription' in step) fields.effectDescription = step.effectDescription;
      if ('cardImageUrl' in step) fields.cardImageUrl = step.cardImageUrl;
      if ('initiator' in step) fields.initiator = step.initiator;
      if ('availableMana' in step) fields.availableMana = step.availableMana;
      if ('isInitiator' in step) fields.isInitiator = step.isInitiator;
      break;
      
    case ResolutionStepType.TEMPTING_OFFER:
      if ('cardName' in step) fields.cardName = step.cardName;
      if ('effectDescription' in step) fields.effectDescription = step.effectDescription;
      if ('cardImageUrl' in step) fields.cardImageUrl = step.cardImageUrl;
      if ('initiator' in step) fields.initiator = step.initiator;
      if ('isOpponent' in step) fields.isOpponent = step.isOpponent;
      break;
      
    case ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE:
      if ('returnControlledPermanentChoice' in step) fields.returnControlledPermanentChoice = (step as any).returnControlledPermanentChoice;
      if ('returnControlledPermanentSourceName' in step) fields.returnControlledPermanentSourceName = (step as any).returnControlledPermanentSourceName;
      if ('returnControlledPermanentDestination' in step) fields.returnControlledPermanentDestination = (step as any).returnControlledPermanentDestination;
      if ('returnControlledPermanentOptions' in step) fields.returnControlledPermanentOptions = (step as any).returnControlledPermanentOptions;
      if ('stackItemId' in step) fields.stackItemId = step.stackItemId;
      break;

    case ResolutionStepType.HIDEAWAY_CHOICE:
      if ('hideawayCards' in step) fields.hideawayCards = (step as any).hideawayCards;
      if ('hideawayCondition' in step) fields.hideawayCondition = (step as any).hideawayCondition;
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('stackItemId' in step) fields.stackItemId = (step as any).stackItemId;
      break;

    case ResolutionStepType.REPEATED_ZONE_DRAFT:
      if ('remainingCardIds' in step) fields.remainingCardIds = (step as any).remainingCardIds;
      if ('cards' in step) fields.cards = (step as any).cards;
      if ('chooserOrder' in step) fields.chooserOrder = (step as any).chooserOrder;
      if ('chooserIndex' in step) fields.chooserIndex = (step as any).chooserIndex;
      if ('entersTapped' in step) fields.entersTapped = (step as any).entersTapped;
      if ('destination' in step) fields.destination = (step as any).destination;
      break;

    case ResolutionStepType.RIOT_CHOICE:
    case ResolutionStepType.UNLEASH_CHOICE:
    case ResolutionStepType.FABRICATE_CHOICE:
    case ResolutionStepType.TRIBUTE_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('options' in step) fields.options = (step as any).options;
      if ('minSelections' in step) fields.minSelections = (step as any).minSelections;
      if ('maxSelections' in step) fields.maxSelections = (step as any).maxSelections;
      if ('value' in step) fields.value = (step as any).value;
      break;

    case ResolutionStepType.MENTOR_TARGET:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('targets' in step) fields.targets = (step as any).targets;
      if ('minSelections' in step) fields.minSelections = (step as any).minSelections;
      if ('maxSelections' in step) fields.maxSelections = (step as any).maxSelections;
      break;

    case ResolutionStepType.EXPLOIT_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('creatures' in step) fields.creatures = (step as any).creatures;
      if ('minSelections' in step) fields.minSelections = (step as any).minSelections;
      if ('maxSelections' in step) fields.maxSelections = (step as any).maxSelections;
      break;

    case ResolutionStepType.EXTORT_PAYMENT:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('manaCost' in step) fields.manaCost = (step as any).manaCost;
      if ('effectText' in step) fields.effectText = (step as any).effectText;
      if ('confirmLabel' in step) fields.confirmLabel = (step as any).confirmLabel;
      break;

    case ResolutionStepType.MODULAR_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('targets' in step) fields.targets = (step as any).targets;
      if ('minSelections' in step) fields.minSelections = (step as any).minSelections;
      if ('maxSelections' in step) fields.maxSelections = (step as any).maxSelections;
      if ('value' in step) fields.value = (step as any).value;
      break;

    case ResolutionStepType.SOULSHIFT_TARGET:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('spirits' in step) fields.spirits = (step as any).spirits;
      if ('minSelections' in step) fields.minSelections = (step as any).minSelections;
      if ('maxSelections' in step) fields.maxSelections = (step as any).maxSelections;
      if ('value' in step) fields.value = (step as any).value;
      break;

    case ResolutionStepType.HAUNT_TARGET:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('targets' in step) fields.targets = (step as any).targets;
      if ('minSelections' in step) fields.minSelections = (step as any).minSelections;
      if ('maxSelections' in step) fields.maxSelections = (step as any).maxSelections;
      if ('hauntCardId' in step) fields.hauntCardId = (step as any).hauntCardId;
      if ('ownerId' in step) fields.ownerId = (step as any).ownerId;
      break;
      
    case ResolutionStepType.CASCADE:
      if ('cascadeNumber' in step) fields.cascadeNumber = step.cascadeNumber;
      if ('totalCascades' in step) fields.totalCascades = step.totalCascades;
      if ('manaValue' in step) fields.manaValue = step.manaValue;
      if ('hitCard' in step) fields.hitCard = step.hitCard;
      if ('exiledCards' in step) fields.exiledCards = step.exiledCards;
      if ('effectId' in step) fields.effectId = step.effectId;
      break;
      
    case ResolutionStepType.DEVOUR_SELECTION:
      if ('devourValue' in step) fields.devourValue = step.devourValue;
      if ('creatureId' in step) fields.creatureId = step.creatureId;
      if ('creatureName' in step) fields.creatureName = step.creatureName;
      if ('availableCreatures' in step) fields.availableCreatures = step.availableCreatures;
      break;
      
    case ResolutionStepType.SUSPEND_CAST:
      if ('card' in step) fields.card = step.card;
      if ('suspendCost' in step) fields.suspendCost = step.suspendCost;
      if ('timeCounters' in step) fields.timeCounters = step.timeCounters;
      break;
      
    case ResolutionStepType.MORPH_TURN_FACE_UP:
      if ('permanentId' in step) fields.permanentId = step.permanentId;
      if ('morphCost' in step) fields.morphCost = step.morphCost;
      if ('actualCard' in step) fields.actualCard = step.actualCard;
      if ('canAfford' in step) fields.canAfford = step.canAfford;
      break;
      
    case ResolutionStepType.ACTIVATED_ABILITY:
      if ('permanentId' in step) fields.permanentId = step.permanentId;
      if ('permanentName' in step) fields.permanentName = step.permanentName;
      if ('abilityType' in step) fields.abilityType = step.abilityType;
      if ('abilityDescription' in step) fields.abilityDescription = step.abilityDescription;
      if ('targets' in step) fields.targets = step.targets;
      if ('xValue' in step) fields.xValue = step.xValue;
      if ('abilityData' in step) fields.abilityData = step.abilityData;
      break;
      
    case ResolutionStepType.UPKEEP_SACRIFICE:
      if ('hasCreatures' in step) fields.hasCreatures = step.hasCreatures;
      if ('creatures' in step) fields.creatures = step.creatures;
      if ('sourceToSacrifice' in step) fields.sourceToSacrifice = step.sourceToSacrifice;
      if ('alternativeSacrificeType' in step) fields.alternativeSacrificeType = step.alternativeSacrificeType;
      if ('allowSourceSacrifice' in step) fields.allowSourceSacrifice = (step as any).allowSourceSacrifice;
      break;
  }
  
  return fields;
}

/**
 * Handle the response to a completed resolution step
 * This executes the game logic based on the player's choice
 */
/**
 * After an Effect Program spell color choice completes, sync the chosen color onto the
 * stack item and resume stack resolution (legacy handleColorChoiceResponse parity).
 */
