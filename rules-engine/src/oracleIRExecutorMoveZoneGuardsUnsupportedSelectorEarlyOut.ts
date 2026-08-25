// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep all-selector unsupported early-out
// (if (!parsedFromGraveyard && ... && !bottomCardLibraryOwnerId) skip).
// Public entry symbol: tryApplyMoveZoneGuardsUnsupportedSelectorEarlyOut.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';

export function tryApplyMoveZoneGuardsUnsupportedSelectorEarlyOut(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const {
    step,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardIds,
    contextualBoundCardZone,
    sourceCardZone,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
  } = args;
  const {
    parsedFromGraveyard,
    parsedShuffleGyIntoLibrary,
    parsedYourGraveyardAndHand,
    parsedCountFromGraveyard,
    parsedTargetCountFromGraveyard,
    parsedCountCardsFromTargetPlayerHand,
    parsedAlternateCostColorFromHand,
    parsedSingleTargetFromAnyGraveyard,
    parsedSingleTargetFromTargetPlayerGraveyard,
    parsedSingleTargetFromReferencedPossessiveGraveyard,
    parsedSingleTargetFromReferencedPossessiveHand,
    parsedRandomCardFromReferencedPossessiveHand,
    parsedSingleTargetFromTargetPlayerHand,
    parsedSingleTargetFromTargetPlayerExile,
    parsedSingleTargetFromYourGraveyard,
    parsedRandomSingleFromYourGraveyard,
    parsedSameNamedFromYourGraveyard,
    parsedSingleTargetFromYourHand,
    parsedTypedCardFromYourHand,
    parsedTheCardsFromYourHand,
    parsedTheCardsFromTargetOpponentHand,
    parsedCardFromAGraveyard,
    parsedTargetCreatureGyAndBf,
    parsedThisArtifactAndAllGraveyards,
    parsedCountFromHand,
    parsedUpToTargetCountFromGraveyard,
    parsedUpToTargetCountFromHand,
    parsedUpToTargetCountFromTargetPlayerGraveyard,
    parsedMostVotesCards,
    parsedThatManyFromBottomOfLibrary,
    parsedThatManyFromTopOfLibrary,
    parsedThatManyFromTopOfLibraryFaceDown,
    parsedCardFromOutsideGame,
    parsedUpToFromOutsideGame,
    parsedOneOrMoreCreaturesFromGy,
    parsedOwnedNonlandPermanentYouOwn,
    parsedAllPermanentsYouOwn,
    parsedShuffleAnyNumberTargetFromTargetPlayerGy,
    parsedExileXTargetFromTargetPlayerGy,
    parsedForEachOpponentUpToOneNonlandBounce,
    parsedAnyNumberOpponentOwnedLandsFromExile,
    parsedCreatureFromOwnersGraveyardUnderOwner,
    parsedEnchantedCreatureAndAurasToHand,
    parsedExileXTargetCreatureCardsFromGraveyards,
    parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards,
    parsedSingleCardExiledWithIt,
    parsedDiscardedCardFromYourGy,
    parsedReturnThisVehicleToOwnersHand,
    parsedAnyNumberGyWithCardTypesAmong,
    parsedCloakCardFromHand,
    parsedUpToOneNoncreatureNonlandFromTargetPlayerGy,
    parsedMechtitanReturnExiledExceptSelf,
    parsedOneOfThemFromYourGraveyard,
    parsedExileItFromTheirGyWithStash,
    parsedOneOfThoseCardsWithThatNameToHand,
    parsedRandomFromEachOpponentGraveyard,
    parsedPutThatCardBfShuffleRestRevealed,
    parsedThemToOwnersGraveyard,
    parsedUpToOneOtherTargetCreatureBfOrGy,
    parsedAllOtherCardsRevealedThisWay,
    parsedTheRevealedCards,
    parsedAllOfThemWithThatName,
    parsedThatPile,
    parsedAllCreaturesOfThatColor,
    parsedTargetCreatureMilledThisTurn,
    parsedCountTargetBattlefieldBounce,
    parsedAllOtherTappedCreatures,
    parsedAllTappedCreatures,
    parsedHalfCreaturesTheyControl,
    parsedInstantOrSorceryGyOrFlashbackExile,
    parsedCompoundOpponentRandomExile,
    parsedUpToCountOfThem,
    parsedUpToThatManyInstantOrSorcery,
    parsedAnyNumberArtifactCreatureTotalMv,
    parsedUpToCountTotalMvFromYourGraveyard,
    parsedAnyNumberTargetNonlandTotalMv,
    parsedCreatureYouControl,
    parsedLesserMvThanDiedFromGy,
    parsedRandomCardFromTargetPlayerHand,
    parsedCompoundExileItAndEachPlayerReturnGyCreatures,
    parsedMassBattlefieldCreatureBounce,
    parsedAllColoredPermanentsToHand,
    parsedAllNoncreatureNonlandPermanentsToHand,
    parsedUnlessPaysManaFromStep,
    parsedAnyNumberFromYourHand,
    parsedAnyNumberCardsFromYourHand,
    parsedAnyNumberFromYourHandFaceDown,
    parsedAllCardsDestroyedThisWayFromYourGraveyard,
    parsedCompoundArtifactCreatureLandGyHandsExile,
    parsedAllCardsFromAllHandsAndGraveyards,
    parsedCreatureFromHandSharingTypeWithEachTappedThisWay,
    parsedEachCreatureThatDealtDamageThisTurn,
    parsedCountTypedCards,
    parsedCreatureYouDontControlLowestToughness,
    parsedThatManyCreatureCardsFromYourGraveyard,
    parsedEachCreatureExcludingListedTypes,
    parsedAllCardsFromAllOpponentsHandsAndGraveyards,
    parsedCreatureHandTotalPowerToughnessLte,
    parsedTargetNonlandSameNameMassExile,
    parsedUpToOneNonlandAmongThemRestLibraryBottom,
    parsedAllSpellsAndAbilitiesFromStackIncludingThis,
    parsedAnyNumberDistinctManaValuesFromYourGraveyard,
    parsedTotalMvCreaturesFromGraveyards,
    parsedCraftExiledCard,
    parsedUpToReferenceCountTargetPermanents,
    parsedTopCardsFromTargetPlayerLibrary,
    parsedAllCommandersCommandZoneGy,
    parsedAllCommandersFromCommandZone,
    parsedCommandZonePermanent,
    parsedMyraExileInstantSorcery,
    parsedSharesTypeFromAmongThem,
    parsedSingleCardRevealedThisWay,
    parsedContextualThemSplit,
    parsedAnyNumberThosePermanentCards,
    parsedThoseCreatureCards,
    parsedThemAntecedent,
    parsedReturnContextualThemToBattlefield,
    parsedUpToCreaturesExcludingTypeLineTerm,
    parsedSingleRevealedRestToGy,
    parsedShuffleSourceAndTarget,
    parsedUpToXFromAmongExiled,
    parsedAnyNumberSaddledToHand,
    parsedUpToXOtherBfOrGy,
    parsedEachOpponentCreatureToughnessX,
    parsedEachCreaturePowerOfChosenQuality,
    parsedTopLibraryFaceDownPerOpponent,
    parsedAllNamedThisPermanent,
    parsedCreatureExiledWithVehicle,
    parsedAnyNumberCyclingPermanents,
  } = args.zoneQueries;
  const {
    parsedAnyNumberCreaturesTotalPower,
    parsedUpToThatManyFromTheirGy,
    parsedUpToOneEachCardTypeFromBoundGy,
    parsedCreatureFromCardsMilledThisWay,
    parsedCreatureHandOrCommandLesserMv,
    parsedOneOfThemBfTappedOtherHand,
    parsedOneOfThemToGraveyard,
    parsedOneOfThemToBattlefield,
    parsedAnotherFromGraveyard,
    parsedAnotherCardFromGraveyard,
    parsedOrTypedCardsFromGraveyard,
    parsedCardFromTargetPlayerHand,
    parsedOpponentOwnedFromExile,
    parsedSingleCardFromHand,
    parsedThemFromGraveyard,
    parsedTheCardsExiledWithIt,
    parsedAllCardsTheyExiledThisWay,
    parsedNonlandCardFromIt,
    parsedThisCardFromExile,
    parsedThatSpell,
    parsedThisSpellBuybackToHand,
    parsedUpToBattlefieldBounce,
    parsedCardFromAmongThoseCards,
    parsedAllExiledWithThisPermanent,
    parsedCreatureCardExiledWithSource,
    parsedCreatureCardExiledThisWay,
    parsedAllFromLibrary,
    parsedCountOfThemAtRandom,
    parsedUpToTypedCardsFromAmongThem,
    parsedPutAllTypedAndFromAmongThem,
    parsedOneOnTopRestOnBottomLibrary,
    parsedOneOfThemToHand,
    parsedTypedCardFromYourGraveyard,
    parsedOneOfThemHandBounce,
    parsedUpToFromSingleGraveyard,
    parsedUpToFromGraveyards,
    parsedAllCardsExiledWithIt,
    parsedTheRestToGraveyard,
    parsedTheRestToLibrary,
    parsedTheRestToHand,
    parsedTheRestToBattlefield,
    parsedTheOtherToHand,
    parsedTheOtherToLibrary,
    parsedTheOtherToBattlefield,
    parsedRestOfExiledCards,
    parsedTypedCardFromAmongThem,
    parsedAnyNumberMountainsYouControl,
    parsedAnyNumberBasicLandSubtypeYouControl,
    parsedReturnThisCardAndUpToOneOther,
    parsedRevealedThisWayRest,
    parsedAllCardsMilledThisWay,
    parsedAllCardsDiscardedThisWay,
    parsedOpponentChoicePermanentToHand,
    parsedAllAdventureCardsFromMilledCards,
    parsedAllNonManaActivatedCreaturesFromMilledCards,
    parsedCardFromChosenPile,
    parsedAllCardsFromPileOfYourChoice,
    parsedAllCreaturesBlockingOrBlockedByTargetCreature,
    parsedThoseLands,
    parsedOpponentChoiceFromTargetPlayerGy,
    parsedCompoundBattlefieldAndGraveyardMassReturn,
    parsedShuffleSourceArtifactAndGraveyard,
    parsedAllExiledWithNamedSource,
    parsedAllExiledCardsWithCounter,
    parsedAnyNumberFromYourGraveyard,
    parsedCountExiledWithSource,
    parsedThatCardReference,
    parsedThatCardToBattlefield,
    parsedTypedCardFromHandOrGraveyard,
    parsedAdventureCardThatPlayerOwnsFromExile,
    parsedMvLessThanReferenceFromHand,
    parsedAmongThemRestToLibrary,
    parsedTypedCardsRevealedThisWay,
    parsedRevealedThisWayRestToLibrary,
    parsedTheChosenCards,
    parsedOneOfTheChosenCards,
    parsedLastChosenCard,
    parsedOtherChosenCards,
    parsedChosenCardsRestToLibrary,
    parsedEachPlayerGyNotPutThisWay,
    parsedShuffleTypedCardsOfThatType,
    parsedTopTypedCardFromTargetPlayerGy,
    parsedTopTypedCardFromYourGy,
    parsedEachCreatureMvXFromGy,
    parsedTypedCardFromTargetPlayerGy,
    parsedTypedCardFromAmongMilledCards,
    parsedAnyNumberAurasFromYourGy,
    parsedNamedCardReference,
    parsedSingleTargetFromYourExile,
    parsedSingleTargetFromLinkedExile,
    parsedTheExiledCard,
    parsedThisPermanentAndTheExiledCard,
    parsedTargetFaceUpExiledCard,
    parsedFromHand,
    parsedFromExile,
    parsedAllFromLinkedExile,
    parsedEachPlayersGy,
    parsedSingleCardFromEachPlayersGy,
    parsedThisCreatureAndTargetYouControl,
    parsedThisCreatureAndAnotherTargetCreature,
    parsedThisPermanentAndAnotherTargetCreature,
    parsedPutIntoGraveyardThisWay,
    parsedUpToCreatureCardsPutIntoGraveyardsThisWay,
    parsedThoseCardsNotPlayed,
    parsedTheNonlandCard,
    parsedTheNonlandCardRestToLibrary,
    parsedExiledThisWayNotCast,
    parsedReturnItAndSelf,
    parsedCompoundExileItAndReturnGy,
    parsedBothCards,
    parsedOneOfThoseDragons,
    parsedMorphCreatureFromHand,
    parsedCountTargetFromSingleGraveyard,
    parsedThisPermanentAndUpToFromSingleGy,
    parsedAurasAttachedToTargetPermanentYouOwn,
    parsedThisCreatureAndCombatantsToLibraryTop,
    parsedEachAttackingCreature,
    parsedAllCreatureTokens,
    parsedTargetCreatureOwnerLibraryChoice,
    parsedThisCardAndNamedFromGy,
    parsedThisCardAndTargetFromGy,
    parsedExileGySplitTwoPiles,
    parsedAnyNumberCardsTotalMvXFromGy,
    parsedEachPlayersHand,
    parsedCountCardsFromEachPlayersHand,
    parsedEachPlayersExile,
    parsedEachOpponentsGy,
    parsedEachOpponentsHand,
    parsedEachOpponentsExile,
    parsedTargetPlayerHand,
    parsedAllTypedCardsTargetPlayerOwns,
    parsedTargetPlayerLibrary,
    parsedTargetPlayerExile,
    parsedTargetPlayerGy,
    parsedTargetPlayerHandAndGy,
    parsedTheCardFromYourGraveyard,
    parsedUpToXLandsHandGy,
  } = args.referenceQueries;

  if (
    !parsedFromGraveyard &&
    !parsedShuffleSourceArtifactAndGraveyard &&
    !parsedShuffleGyIntoLibrary &&
    !parsedYourGraveyardAndHand &&
    !parsedCountFromGraveyard &&
    !parsedTargetCountFromGraveyard &&
    !parsedCountCardsFromTargetPlayerHand &&
    !parsedAlternateCostColorFromHand &&
    !parsedSingleTargetFromAnyGraveyard &&
    !parsedSingleTargetFromTargetPlayerGraveyard &&
    !parsedSingleTargetFromReferencedPossessiveGraveyard &&
    !parsedSingleTargetFromReferencedPossessiveHand &&
    !parsedRandomCardFromReferencedPossessiveHand &&
    !parsedSingleTargetFromTargetPlayerHand &&
    !parsedSingleTargetFromTargetPlayerExile &&
    !parsedSingleTargetFromYourGraveyard &&
    !parsedInstantOrSorceryGyOrFlashbackExile &&
    !parsedRandomSingleFromYourGraveyard &&
    !parsedSameNamedFromYourGraveyard &&
    !parsedSingleTargetFromYourHand &&
    !parsedTypedCardFromYourHand &&
    !parsedTheCardsFromYourHand &&
    !parsedTheCardsFromTargetOpponentHand &&
    !parsedCardFromAGraveyard &&
    !parsedTargetCreatureGyAndBf &&
    !parsedThisArtifactAndAllGraveyards &&
    !parsedCountFromHand &&
    !parsedUpToTargetCountFromGraveyard &&
    !parsedUpToTargetCountFromHand &&
    !parsedUpToTargetCountFromTargetPlayerGraveyard &&
    !parsedMostVotesCards &&
    !parsedThatManyFromBottomOfLibrary &&
    !parsedThatManyFromTopOfLibrary &&
    !parsedThatManyFromTopOfLibraryFaceDown &&
    !parsedCardFromOutsideGame &&
    !parsedUpToFromOutsideGame &&
    !parsedOneOrMoreCreaturesFromGy &&
    !parsedOwnedNonlandPermanentYouOwn &&
    !parsedShuffleAnyNumberTargetFromTargetPlayerGy &&
    !parsedExileXTargetFromTargetPlayerGy &&
    !parsedForEachOpponentUpToOneNonlandBounce &&
    !parsedAnyNumberOpponentOwnedLandsFromExile &&
    !parsedCreatureFromOwnersGraveyardUnderOwner &&
    !parsedEnchantedCreatureAndAurasToHand &&
    !parsedExileXTargetCreatureCardsFromGraveyards &&
    !parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards &&
    !parsedSingleCardExiledWithIt &&
    !parsedDiscardedCardFromYourGy &&
    !parsedReturnThisVehicleToOwnersHand &&
    !parsedAnyNumberGyWithCardTypesAmong &&
    !parsedCloakCardFromHand &&
    !parsedUpToOneNoncreatureNonlandFromTargetPlayerGy &&
    !parsedMechtitanReturnExiledExceptSelf &&
    !parsedOneOfThemFromYourGraveyard &&
    !parsedExileItFromTheirGyWithStash &&
    !parsedOneOfThoseCardsWithThatNameToHand &&
    !parsedRandomFromEachOpponentGraveyard &&
    !parsedPutThatCardBfShuffleRestRevealed &&
    !parsedThemToOwnersGraveyard &&
    !parsedUpToOneOtherTargetCreatureBfOrGy &&
    !parsedAllOtherCardsRevealedThisWay &&
    !parsedTheRevealedCards &&
    !parsedAllOfThemWithThatName &&
    !parsedThatPile &&
    !parsedAllCreaturesOfThatColor &&
    !parsedTargetCreatureMilledThisTurn &&
    !parsedCountTargetBattlefieldBounce &&
    !parsedAllOtherTappedCreatures &&
    !parsedAllTappedCreatures &&
    !parsedHalfCreaturesTheyControl &&
    !parsedCompoundOpponentRandomExile &&
    !parsedUpToCountOfThem &&
    !parsedUpToThatManyInstantOrSorcery &&
    !parsedAnyNumberArtifactCreatureTotalMv &&
    !parsedAnyNumberTargetNonlandTotalMv &&
    !parsedCreatureYouControl &&
    !parsedLesserMvThanDiedFromGy &&
    !parsedRandomCardFromTargetPlayerHand &&
    !parsedCompoundExileItAndEachPlayerReturnGyCreatures &&
    !parsedMassBattlefieldCreatureBounce &&
    !parsedAllColoredPermanentsToHand &&
    !parsedAllNoncreatureNonlandPermanentsToHand &&
    !parsedAnyNumberFromYourHand &&
    !parsedAnyNumberCardsFromYourHand &&
    !parsedAnyNumberFromYourHandFaceDown &&
    !parsedAllCardsDestroyedThisWayFromYourGraveyard &&
    !parsedCompoundArtifactCreatureLandGyHandsExile &&
    !parsedAllCardsFromAllHandsAndGraveyards &&
    !parsedCreatureFromHandSharingTypeWithEachTappedThisWay &&
    !parsedEachCreatureThatDealtDamageThisTurn &&
    !parsedCountTypedCards &&
    !parsedCreatureYouDontControlLowestToughness &&
    !parsedThatManyCreatureCardsFromYourGraveyard &&
    !parsedEachCreatureExcludingListedTypes &&
    !parsedAllCardsFromAllOpponentsHandsAndGraveyards &&
    !parsedCreatureHandTotalPowerToughnessLte &&
    !parsedTargetNonlandSameNameMassExile &&
    !parsedUpToOneNonlandAmongThemRestLibraryBottom &&
    !parsedAllSpellsAndAbilitiesFromStackIncludingThis &&
    !parsedAnyNumberDistinctManaValuesFromYourGraveyard &&
    !parsedTotalMvCreaturesFromGraveyards &&
    !parsedCraftExiledCard &&
    !parsedUpToReferenceCountTargetPermanents &&
    !parsedTopCardsFromTargetPlayerLibrary &&
    !parsedAllCommandersCommandZoneGy &&
    !parsedAllCommandersFromCommandZone &&
    !parsedCommandZonePermanent &&
    !parsedMyraExileInstantSorcery &&
    !parsedSharesTypeFromAmongThem &&
    !parsedSingleCardRevealedThisWay &&
    !parsedContextualThemSplit &&
    !parsedAnyNumberThosePermanentCards &&
    !parsedThoseCreatureCards &&
    !parsedAnyNumberMountainsYouControl &&
    !parsedAnyNumberBasicLandSubtypeYouControl &&
    !parsedThemAntecedent &&
    !parsedReturnContextualThemToBattlefield &&
    !parsedUpToCreaturesExcludingTypeLineTerm &&
    !parsedSingleRevealedRestToGy &&
    !parsedShuffleSourceAndTarget &&
    !parsedUpToXFromAmongExiled &&
    !parsedAnyNumberSaddledToHand &&
    !parsedUpToXOtherBfOrGy &&
    !parsedEachOpponentCreatureToughnessX &&
    !parsedEachCreaturePowerOfChosenQuality &&
    !parsedTopLibraryFaceDownPerOpponent &&
    !parsedAllNamedThisPermanent &&
    !parsedCreatureExiledWithVehicle &&
    !parsedAnyNumberCyclingPermanents &&
    !parsedAnyNumberCreaturesTotalPower &&
    !parsedUpToThatManyFromTheirGy &&
    !parsedUpToOneEachCardTypeFromBoundGy &&
    !parsedCreatureFromCardsMilledThisWay &&
    !parsedCreatureHandOrCommandLesserMv &&
    !parsedOneOfThemBfTappedOtherHand &&
    !parsedOneOfThemToGraveyard &&
    !parsedOneOfThemToBattlefield &&
    !parsedCountOfThemAtRandom &&
    !parsedAnotherFromGraveyard &&
    !parsedAnotherCardFromGraveyard &&
    !parsedOrTypedCardsFromGraveyard &&
    !parsedCardFromTargetPlayerHand &&
    !parsedOpponentOwnedFromExile &&
    !parsedSingleCardFromHand &&
    !parsedThemFromGraveyard &&
    !parsedTheCardsExiledWithIt &&
    !parsedAllCardsTheyExiledThisWay &&
    !parsedNonlandCardFromIt &&
    !parsedThisCardFromExile &&
    !parsedThatSpell &&
    !parsedThisSpellBuybackToHand &&
    !parsedUpToBattlefieldBounce &&
    !parsedCardFromAmongThoseCards &&
    !parsedAllExiledWithThisPermanent &&
    !parsedCreatureCardExiledWithSource &&
    !parsedCreatureCardExiledThisWay &&
    !parsedAllFromLibrary &&
    !parsedUpToTypedCardsFromAmongThem &&
    !parsedPutAllTypedAndFromAmongThem &&
    !parsedOneOnTopRestOnBottomLibrary &&
    !parsedOneOfThemToHand &&
    !parsedTypedCardFromYourGraveyard &&
    !parsedOneOfThemHandBounce &&
    !parsedUpToFromSingleGraveyard &&
    !parsedUpToFromGraveyards &&
    !parsedAllCardsExiledWithIt &&
    !parsedTheRestToGraveyard &&
    !parsedTheRestToLibrary &&
    !parsedRestOfExiledCards &&
    !parsedTypedCardFromAmongThem &&
    !parsedReturnThisCardAndUpToOneOther &&
    !parsedRevealedThisWayRest &&
    !parsedAllCardsMilledThisWay &&
    !parsedAllCardsDiscardedThisWay &&
    !parsedOpponentChoicePermanentToHand &&
    !parsedAllAdventureCardsFromMilledCards &&
    !parsedAllNonManaActivatedCreaturesFromMilledCards &&
    !parsedCardFromChosenPile &&
    !parsedAllCardsFromPileOfYourChoice &&
    !parsedAllCreaturesBlockingOrBlockedByTargetCreature &&
    !parsedThoseLands &&
    !parsedOpponentChoiceFromTargetPlayerGy &&
    !parsedCompoundBattlefieldAndGraveyardMassReturn &&
    !parsedShuffleSourceArtifactAndGraveyard &&
    !parsedAllExiledWithNamedSource &&
    !parsedAllExiledCardsWithCounter &&
    !parsedAnyNumberFromYourGraveyard &&
    !parsedCountExiledWithSource &&
    !parsedThatCardReference &&
    !parsedTypedCardFromHandOrGraveyard &&
    !parsedAdventureCardThatPlayerOwnsFromExile &&
    !parsedMvLessThanReferenceFromHand &&
    !parsedAmongThemRestToLibrary &&
    !parsedTypedCardsRevealedThisWay &&
    !parsedRevealedThisWayRestToLibrary &&
    !parsedTheChosenCards &&
    !parsedOneOfTheChosenCards &&
    !parsedLastChosenCard &&
    !parsedOtherChosenCards &&
    !parsedChosenCardsRestToLibrary &&
    !parsedEachPlayerGyNotPutThisWay &&
    !parsedShuffleTypedCardsOfThatType &&
    !parsedTopTypedCardFromTargetPlayerGy &&
    !parsedTypedCardFromTargetPlayerGy &&
    !parsedTypedCardFromAmongMilledCards &&
    !parsedAnyNumberAurasFromYourGy &&
    !parsedNamedCardReference &&
    !parsedSingleTargetFromYourExile &&
    !parsedSingleTargetFromLinkedExile &&
    !parsedTheExiledCard &&
    !parsedThisPermanentAndTheExiledCard &&
    !parsedTargetFaceUpExiledCard &&
    !parsedOneOfThemSplit &&
    !parsedOnePileSplit &&
    !parsedFromHand &&
    !parsedFromExile &&
    !parsedAllFromLinkedExile &&
    !parsedEachPlayersGy &&
    !parsedSingleCardFromEachPlayersGy &&
    !parsedThisCreatureAndTargetYouControl &&
    !parsedThisCreatureAndAnotherTargetCreature &&
    !parsedThisPermanentAndAnotherTargetCreature &&
    !parsedPutIntoGraveyardThisWay &&
    !parsedUpToCreatureCardsPutIntoGraveyardsThisWay &&
    !parsedThoseCardsNotPlayed &&
    !parsedTheNonlandCard &&
    !parsedTheNonlandCardRestToLibrary &&
    !parsedExiledThisWayNotCast &&
    !parsedReturnItAndSelf &&
    !parsedCompoundExileItAndReturnGy &&
    !parsedBothCards &&
    !parsedOneOfThoseDragons &&
    !parsedMorphCreatureFromHand &&
    !parsedCountTargetFromSingleGraveyard &&
    !parsedThisPermanentAndUpToFromSingleGy &&
    !parsedEachPlayersHand &&
    !parsedCountCardsFromEachPlayersHand &&
    !parsedEachPlayersExile &&
    !parsedEachOpponentsGy &&
    !parsedEachOpponentsHand &&
    !parsedEachOpponentsExile &&
    !parsedTargetPlayerHand &&
    !parsedAllTypedCardsTargetPlayerOwns &&
    !parsedTargetPlayerLibrary &&
    !parsedTargetPlayerExile &&
    !parsedTargetPlayerGy &&
    !parsedTargetPlayerHandAndGy &&
    !parsedTheCardFromYourGraveyard &&
    !parsedUpToXLandsHandGy &&
    !parsedTheRestToHand &&
    !parsedTheRestToBattlefield &&
    !parsedTheOtherToHand &&
    !parsedTheOtherToLibrary &&
    !parsedTheOtherToBattlefield &&
    !parsedThatCardToBattlefield &&
    !parsedTopTypedCardFromYourGy &&
    !parsedEachCreatureMvXFromGy &&
    !parsedAurasAttachedToTargetPermanentYouOwn &&
    !parsedThisCreatureAndCombatantsToLibraryTop &&
    !parsedEachAttackingCreature &&
    !parsedAllCreatureTokens &&
    !parsedTargetCreatureOwnerLibraryChoice &&
    !parsedThisCardAndNamedFromGy &&
    !parsedThisCardAndTargetFromGy &&
    !parsedExileGySplitTwoPiles &&
    !parsedAnyNumberCardsTotalMvXFromGy &&
    contextualBoundCardIds.length === 0 &&
    !contextualBoundCardZone &&
    !sourceCardZone &&
    !topCardLibraryOwnerId &&
    !bottomCardLibraryOwnerId
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }


  return undefined;
}
