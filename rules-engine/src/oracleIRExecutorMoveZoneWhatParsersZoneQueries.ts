// Extracted from oracleIRExecutorMoveZoneStepHandlers.ts (applyMoveZoneStep prologue).
// Cluster: `step.what` selectors for zone, target and count queries.
// Entry point: parseMoveZoneWhatZoneQueries.
import type { OracleEffectStep } from './oracleIR';
import {
  parseMoveZoneRandomSingleFromYourGraveyard,
  parseMoveZoneCountFromTargetPlayersGraveyard,
  parseMoveZoneCountCardsFromTargetPlayersHand,
  parseMoveZoneAlternateCostColorCardFromYourHand,
  parseMoveZoneSingleTargetFromAGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromReferencedPossessiveGraveyard,
  parseMoveZoneSingleTargetFromReferencedPossessiveHand,
  parseMoveZoneRandomCardFromReferencedPossessiveHand,
  parseMoveZoneSingleTargetFromTargetPlayersHand,
  parseMoveZoneSingleTargetFromTargetPlayersExile,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneSingleTypedCardFromYourGraveyard,
  parseMoveZoneTargetAndSameNamedFromYourGraveyard,
  parseMoveZoneSingleTargetFromYourHand,
  parseMoveZoneTypedCardFromYourHand,
  parseMoveZoneTheCardsFromYourHand,
  parseMoveZoneTheCardsFromTargetOpponentHand,
  parseMoveZoneCardFromAGraveyard,
  parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield,
  parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards,
  parseMoveZoneCountFromYourHand,
  parseMoveZoneUpToTargetCountFromYourGraveyard,
  parseMoveZoneUpToTargetCountFromYourHand,
  parseMoveZoneUpToTargetCountFromTargetPlayersGraveyard,
  parseMoveZoneAllOfThemWithThatName,
  parseMoveZoneAllPermanentsYouOwn,
  parseMoveZoneAnyNumberCardsFromYourHand,
  parseMoveZoneUpToCountCardsYouOwnFromOutsideGame,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary,
  parseMoveZoneYourGraveyardAndHand,
  parseMoveZoneCountFromYourGraveyard,
  parseMoveZoneMostVotesCards,
  parseMoveZoneThatManyCardsFromBottomOfLibrary,
  parseMoveZoneUpToOneOtherTargetCreatureBfOrGy,
  parseMoveZoneAllOtherCardsRevealedThisWay,
  parseMoveZoneTheRevealedCards,
  parseMoveZoneThatPile,
  parseMoveZoneAllCreaturesOfThatColor,
  parseMoveZoneTargetCreatureInGraveyardMilledThisTurn,
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneAllOtherTappedCreatures,
  parseMoveZoneAllTappedCreatures,
  parseMoveZoneHalfCreaturesTheyControlRoundedUp,
  parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile,
  parseMoveZoneCompoundOpponentLibraryTopRandomGyHandExile,
  parseMoveZoneUpToCountOfThem,
  parseMoveZoneUpToThatManyInstantOrSorceryFromYourGraveyard,
  parseMoveZoneAnyNumberArtifactCreatureTotalMvFromYourGraveyard,
  parseMoveZoneUpToCountTotalMvFromYourGraveyard,
  parseMoveZoneAnyNumberTargetNonlandTotalMv,
  parseMoveZoneCreatureYouControl,
  parseMoveZoneLesserMvThanDiedCreatureFromYourGraveyard,
  parseMoveZoneRandomCardFromTargetPlayerHand,
  parseMoveZoneCompoundExileItAndEachPlayerReturnAllGyCreaturesToHand,
  parseMoveZoneMassBattlefieldCreatureBounce,
  parseMoveZoneAllColoredPermanentsToHand,
  parseMoveZoneAllNoncreatureNonlandPermanentsToHand,
  parseMoveZoneUnlessPaysManaFromStepText,
  parseMoveZoneAnyNumberTypedFromYourHand,
  parseMoveZoneAnyNumberFromYourHandFaceDown,
  parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard,
  parseMoveZoneCompoundArtifactCreatureLandGyHandsExile,
  parseMoveZoneAllCardsFromAllHandsAndGraveyards,
  parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay,
  parseMoveZoneEachCreatureThatDealtDamageThisTurn,
  parseMoveZoneCountTypedCards,
  parseMoveZoneCreatureYouDontControlLowestToughness,
  parseMoveZoneThatManyCreatureCardsFromYourGraveyard,
  parseMoveZoneEachCreatureExcludingListedTypes,
  parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards,
  parseMoveZoneCreatureHandTotalPowerToughnessLte,
  parseMoveZoneTargetNonlandSameNameMassExile,
  parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom,
  parseMoveZoneAllSpellsAndAbilitiesFromStackIncludingThis,
  parseMoveZoneAnyNumberDistinctManaValuesFromYourGraveyard,
  parseMoveZoneAnyNumberTargetCreaturesTotalMvFromGraveyards,
  parseMoveZoneCraftExiledCard,
  parseMoveZoneUpToReferenceCountTargetPermanents,
  parseMoveZoneTopCardsFromTargetPlayerLibrary,
  parseMoveZoneCommandZonePermanent,
  parseMoveZoneAllCommandersYouOwnFromCommandZoneAndGraveyard,
  parseMoveZoneAllCommandersFromCommandZone,
  parseMoveZoneMyraExileInstantSorcery,
  parseMoveZoneSharesTypeFromAmongThem,
  parseMoveZoneSingleCardRevealedThisWay,
  parseMoveZoneAnyNumberThosePermanentCards,
  parseMoveZoneThoseCreatureCards,
  parseMoveZoneThemAntecedent,
  parseMoveZoneReturnContextualThemToBattlefield,
  parseMoveZoneUpToTargetCreaturesExcludingTypeLineTerm,
  parseMoveZoneShuffleSourceAndTargetIntoLibraries,
  parseMoveZoneUpToXFromAmongExiledWithThis,
  parseMoveZoneAnyNumberSaddledCreaturesToHand,
  parseMoveZoneUpToXOtherCreaturesBfOrGy,
  parseMoveZoneEachOpponentCreatureToughnessXOrLess,
  parseMoveZoneEachCreatureWithPowerOfChosenQuality,
  parseMoveZoneTopLibraryFaceDownPerOpponent,
  parseMoveZoneAllNamedThisPermanentFromYourGraveyard,
  parseMoveZoneCreatureExiledWithThisVehicle,
  parseMoveZoneAnyNumberCyclingPermanentsFromYourGraveyard,
  parseMoveZoneThatManyCardsFromTopOfLibrary,
  parseMoveZoneThatManyCardsFromTopOfLibraryFaceDown,
  parseMoveZoneCardFromOutsideGame,
  parseMoveZoneOneOrMoreCreaturesFromYourGraveyard,
  parseMoveZoneOwnedNonlandPermanentYouOwn,
  parseMoveZoneShuffleAnyNumberTargetCardsFromTargetPlayerGraveyard,
  parseMoveZoneExileXTargetCardsFromTargetPlayerGraveyard,
  parseMoveZoneForEachOpponentUpToOneNonlandBounce,
  parseMoveZoneAnyNumberOpponentOwnedLandsFromExile,
  parseMoveZoneCreatureFromOwnersGraveyardUnderOwner,
  parseMoveZoneEnchantedCreatureAndAurasToHand,
  parseMoveZoneExileXTargetCreatureCardsFromGraveyards,
  parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards,
  parseMoveZoneSingleCardExiledWithIt,
  parseMoveZoneDiscardedCardFromYourGraveyard,
  parseMoveZoneReturnThisVehicleToOwnersHand,
  parseMoveZoneAnyNumberGyWithCardTypesAmong,
  parseMoveZoneCloakCardFromHand,
  parseMoveZoneUpToOneNoncreatureNonlandFromTargetPlayerGraveyard,
  parseMoveZoneMechtitanReturnExiledExceptSelf,
  parseMoveZoneOneOfThemFromYourGraveyard,
  parseMoveZoneExileItFromTheirGraveyardWithStash,
  parseMoveZoneOneOfThoseCardsWithThatNameToHand,
  parseMoveZoneRandomFromEachOpponentGraveyard,
  parseMoveZonePutThatCardBfShuffleRestRevealed,
  parseMoveZoneThemToOwnersGraveyard,
} from './oracleIRExecutorZoneOps';
import { getContextualThemSplitKind } from './oracleIRExecutorMoveZoneContextualCardResolvers';

export function parseMoveZoneWhatZoneQueries(step: Extract<OracleEffectStep, { kind: 'move_zone' }>) {
  const parsedFromGraveyard = parseMoveZoneAllFromYourGraveyard(step.what as any);
  const parsedShuffleGyIntoLibrary =
    parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary(step.what as any) ||
    parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary({ kind: 'raw', text: String(step.raw || '') });
  const parsedYourGraveyardAndHand = parseMoveZoneYourGraveyardAndHand(step.what as any);
  const parsedCountFromGraveyard = parseMoveZoneCountFromYourGraveyard(step.what as any);
  const parsedTargetCountFromGraveyard = parseMoveZoneCountFromTargetPlayersGraveyard(step.what as any);
  const parsedCountCardsFromTargetPlayerHand = parseMoveZoneCountCardsFromTargetPlayersHand(step.what as any);
  const parsedAlternateCostColorFromHand = parseMoveZoneAlternateCostColorCardFromYourHand(step.what as any);
  const parsedSingleTargetFromAnyGraveyard = parseMoveZoneSingleTargetFromAGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerGraveyard = parseMoveZoneSingleTargetFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromReferencedPossessiveGraveyard =
    parseMoveZoneSingleTargetFromReferencedPossessiveGraveyard(step.what as any);
  const parsedSingleTargetFromReferencedPossessiveHand =
    parseMoveZoneSingleTargetFromReferencedPossessiveHand(step.what as any);
  const parsedRandomCardFromReferencedPossessiveHand =
    parseMoveZoneRandomCardFromReferencedPossessiveHand(step.what as any);
  const parsedSingleTargetFromTargetPlayerHand = parseMoveZoneSingleTargetFromTargetPlayersHand(step.what as any);
  const parsedSingleTargetFromTargetPlayerExile = parseMoveZoneSingleTargetFromTargetPlayersExile(step.what as any);
  const parsedSingleTargetFromYourGraveyard =
    parseMoveZoneSingleTargetFromYourGraveyard(step.what as any) ||
    parseMoveZoneSingleTargetFromYourGraveyard({ kind: 'raw', text: String(step.raw || ''), raw: String(step.raw || '') }) ||
    parseMoveZoneSingleTypedCardFromYourGraveyard(step.what as any) ||
    parseMoveZoneSingleTypedCardFromYourGraveyard({ kind: 'raw', text: String(step.raw || ''), raw: String(step.raw || '') });
  const parsedRandomSingleFromYourGraveyard = parseMoveZoneRandomSingleFromYourGraveyard(step.what as any, step.raw);
  const parsedSameNamedFromYourGraveyard = parseMoveZoneTargetAndSameNamedFromYourGraveyard(step.what as any);
  const parsedSingleTargetFromYourHand = parseMoveZoneSingleTargetFromYourHand(step.what as any);
  const parsedTypedCardFromYourHand = parseMoveZoneTypedCardFromYourHand(step.what as any);
  const parsedTheCardsFromYourHand = parseMoveZoneTheCardsFromYourHand(step.what as any);
  const parsedTheCardsFromTargetOpponentHand = parseMoveZoneTheCardsFromTargetOpponentHand(step.what as any);
  const parsedCardFromAGraveyard = parseMoveZoneCardFromAGraveyard(step.what as any);
  const parsedTargetCreatureGyAndBf =
    parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield(step.what as any);
  const parsedThisArtifactAndAllGraveyards = parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards(
    step.what as any
  );
  const parsedCountFromHand = parseMoveZoneCountFromYourHand(step.what as any);
  const parsedUpToTargetCountFromGraveyard = parseMoveZoneUpToTargetCountFromYourGraveyard(step.what as any);
  const parsedUpToTargetCountFromHand = parseMoveZoneUpToTargetCountFromYourHand(step.what as any);
  const parsedUpToTargetCountFromTargetPlayerGraveyard = parseMoveZoneUpToTargetCountFromTargetPlayersGraveyard(step.what as any);
  const parsedMostVotesCards = parseMoveZoneMostVotesCards(step.what as any);
  const parsedThatManyFromBottomOfLibrary = parseMoveZoneThatManyCardsFromBottomOfLibrary(step.what as any);
  const parsedThatManyFromTopOfLibrary = parseMoveZoneThatManyCardsFromTopOfLibrary(step.what as any);
  const parsedThatManyFromTopOfLibraryFaceDown = parseMoveZoneThatManyCardsFromTopOfLibraryFaceDown(step.what as any);
  const parsedCardFromOutsideGame = parseMoveZoneCardFromOutsideGame(step.what as any);
  const parsedUpToFromOutsideGame = parseMoveZoneUpToCountCardsYouOwnFromOutsideGame(step.what as any);
  const parsedOneOrMoreCreaturesFromGy = parseMoveZoneOneOrMoreCreaturesFromYourGraveyard(step.what as any);
  const parsedOwnedNonlandPermanentYouOwn = parseMoveZoneOwnedNonlandPermanentYouOwn(step.what as any);
  const parsedAllPermanentsYouOwn = parseMoveZoneAllPermanentsYouOwn(step.what as any);
  const parsedShuffleAnyNumberTargetFromTargetPlayerGy =
    parseMoveZoneShuffleAnyNumberTargetCardsFromTargetPlayerGraveyard(step.what as any);
  const parsedExileXTargetFromTargetPlayerGy =
    parseMoveZoneExileXTargetCardsFromTargetPlayerGraveyard(step.what as any);
  const parsedForEachOpponentUpToOneNonlandBounce = parseMoveZoneForEachOpponentUpToOneNonlandBounce(
    step.what as any,
    step.raw
  );
  const parsedAnyNumberOpponentOwnedLandsFromExile = parseMoveZoneAnyNumberOpponentOwnedLandsFromExile(step.what as any);
  const parsedCreatureFromOwnersGraveyardUnderOwner = parseMoveZoneCreatureFromOwnersGraveyardUnderOwner(step.what as any);
  const parsedEnchantedCreatureAndAurasToHand = parseMoveZoneEnchantedCreatureAndAurasToHand(step.what as any);
  const parsedExileXTargetCreatureCardsFromGraveyards = parseMoveZoneExileXTargetCreatureCardsFromGraveyards(
    step.what as any
  );
  const parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards =
    parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards(step.what as any);
  const parsedSingleCardExiledWithIt = parseMoveZoneSingleCardExiledWithIt(step.what as any);
  const parsedDiscardedCardFromYourGy = parseMoveZoneDiscardedCardFromYourGraveyard(step.what as any);
  const parsedReturnThisVehicleToOwnersHand = parseMoveZoneReturnThisVehicleToOwnersHand(step.what as any, step.raw);
  const parsedAnyNumberGyWithCardTypesAmong = parseMoveZoneAnyNumberGyWithCardTypesAmong(step.what as any);
  const parsedCloakCardFromHand = parseMoveZoneCloakCardFromHand(step.what as any, step.raw);
  const parsedUpToOneNoncreatureNonlandFromTargetPlayerGy =
    parseMoveZoneUpToOneNoncreatureNonlandFromTargetPlayerGraveyard(step.what as any);
  const parsedMechtitanReturnExiledExceptSelf = parseMoveZoneMechtitanReturnExiledExceptSelf(step.what as any);
  const parsedOneOfThemFromYourGraveyard = parseMoveZoneOneOfThemFromYourGraveyard(step.what as any);
  const parsedExileItFromTheirGyWithStash = parseMoveZoneExileItFromTheirGraveyardWithStash(step.what as any);
  const parsedOneOfThoseCardsWithThatNameToHand = parseMoveZoneOneOfThoseCardsWithThatNameToHand(step.what as any);
  const parsedRandomFromEachOpponentGraveyard = parseMoveZoneRandomFromEachOpponentGraveyard(step.what as any);
  const parsedPutThatCardBfShuffleRestRevealed = parseMoveZonePutThatCardBfShuffleRestRevealed(step.what as any);
  const parsedThemToOwnersGraveyard =
    parseMoveZoneThemToOwnersGraveyard(step.what as any) &&
    step.to === 'graveyard' &&
    /\bowner'?s graveyard\b/i.test(String(step.toRaw || step.raw || ''));
  const parsedUpToOneOtherTargetCreatureBfOrGy = parseMoveZoneUpToOneOtherTargetCreatureBfOrGy(step.what as any);
  const parsedAllOtherCardsRevealedThisWay = parseMoveZoneAllOtherCardsRevealedThisWay(step.what as any);
  const parsedTheRevealedCards = parseMoveZoneTheRevealedCards(step.what as any);
  const parsedAllOfThemWithThatName = parseMoveZoneAllOfThemWithThatName(step.what as any);
  const parsedThatPile = parseMoveZoneThatPile(step.what as any);
  const parsedAllCreaturesOfThatColor = parseMoveZoneAllCreaturesOfThatColor(step.what as any);
  const parsedTargetCreatureMilledThisTurn = parseMoveZoneTargetCreatureInGraveyardMilledThisTurn(step.what as any);
  const parsedCountTargetBattlefieldBounce = parseMoveZoneCountTargetBattlefieldBounce(step.what as any);
  const parsedAllOtherTappedCreatures = parseMoveZoneAllOtherTappedCreatures(step.what as any);
  const parsedAllTappedCreatures = parseMoveZoneAllTappedCreatures(step.what as any);
  const parsedHalfCreaturesTheyControl = parseMoveZoneHalfCreaturesTheyControlRoundedUp(step.what as any);
  const parsedInstantOrSorceryGyOrFlashbackExile =
    parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile(step.what as any) ||
    parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile({
      kind: 'raw',
      text: String(step.raw || ''),
      raw: String(step.raw || ''),
    });
  const parsedCompoundOpponentRandomExile = parseMoveZoneCompoundOpponentLibraryTopRandomGyHandExile(step.what as any);
  const parsedUpToCountOfThem = parseMoveZoneUpToCountOfThem(step.what as any);
  const parsedUpToThatManyInstantOrSorcery = parseMoveZoneUpToThatManyInstantOrSorceryFromYourGraveyard(step.what as any);
  const parsedAnyNumberArtifactCreatureTotalMv = parseMoveZoneAnyNumberArtifactCreatureTotalMvFromYourGraveyard(step.what as any);
  const parsedUpToCountTotalMvFromYourGraveyard = parseMoveZoneUpToCountTotalMvFromYourGraveyard(step.what as any);
  const parsedAnyNumberTargetNonlandTotalMv = parseMoveZoneAnyNumberTargetNonlandTotalMv(step.what as any);
  const parsedCreatureYouControl = parseMoveZoneCreatureYouControl(step.what as any);
  const parsedLesserMvThanDiedFromGy = parseMoveZoneLesserMvThanDiedCreatureFromYourGraveyard(step.what as any);
  const parsedRandomCardFromTargetPlayerHand = parseMoveZoneRandomCardFromTargetPlayerHand(step.what as any);
  const parsedCompoundExileItAndEachPlayerReturnGyCreatures =
    parseMoveZoneCompoundExileItAndEachPlayerReturnAllGyCreaturesToHand(step.raw);
  const parsedMassBattlefieldCreatureBounce = parseMoveZoneMassBattlefieldCreatureBounce(step.what as any);
  const parsedAllColoredPermanentsToHand = parseMoveZoneAllColoredPermanentsToHand(step.what as any);
  const parsedAllNoncreatureNonlandPermanentsToHand = parseMoveZoneAllNoncreatureNonlandPermanentsToHand(
    step.what as any
  );
  const parsedUnlessPaysManaFromStep = parseMoveZoneUnlessPaysManaFromStepText(step.raw, step.toRaw);
  const parsedAnyNumberFromYourHand = parseMoveZoneAnyNumberTypedFromYourHand(step.what as any);
  const parsedAnyNumberCardsFromYourHand = parseMoveZoneAnyNumberCardsFromYourHand(step.what as any);
  const parsedAnyNumberFromYourHandFaceDown = parseMoveZoneAnyNumberFromYourHandFaceDown(step.what as any);
  const parsedAllCardsDestroyedThisWayFromYourGraveyard = parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard(
    step.what as any
  );
  const parsedCompoundArtifactCreatureLandGyHandsExile = parseMoveZoneCompoundArtifactCreatureLandGyHandsExile(
    step.what as any
  );
  const parsedAllCardsFromAllHandsAndGraveyards = parseMoveZoneAllCardsFromAllHandsAndGraveyards(step.what as any);
  const parsedCreatureFromHandSharingTypeWithEachTappedThisWay =
    parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay(step.what as any);
  const parsedEachCreatureThatDealtDamageThisTurn = parseMoveZoneEachCreatureThatDealtDamageThisTurn(step.what as any);
  const parsedCountTypedCards = parseMoveZoneCountTypedCards(step.what as any);
  const parsedCreatureYouDontControlLowestToughness = parseMoveZoneCreatureYouDontControlLowestToughness(
    step.what as any
  );
  const parsedThatManyCreatureCardsFromYourGraveyard = parseMoveZoneThatManyCreatureCardsFromYourGraveyard(
    step.what as any
  );
  const parsedEachCreatureExcludingListedTypes = parseMoveZoneEachCreatureExcludingListedTypes(step.what as any);
  const parsedAllCardsFromAllOpponentsHandsAndGraveyards =
    parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards(step.what as any);
  const parsedCreatureHandTotalPowerToughnessLte = parseMoveZoneCreatureHandTotalPowerToughnessLte(step.what as any);
  const parsedTargetNonlandSameNameMassExile = parseMoveZoneTargetNonlandSameNameMassExile(step.what as any);
  const parsedUpToOneNonlandAmongThemRestLibraryBottom =
    parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom(step.what as any);
  const parsedAllSpellsAndAbilitiesFromStackIncludingThis =
    parseMoveZoneAllSpellsAndAbilitiesFromStackIncludingThis(step.what as any);
  const parsedAnyNumberDistinctManaValuesFromYourGraveyard =
    parseMoveZoneAnyNumberDistinctManaValuesFromYourGraveyard(step.what as any);
  const parsedTotalMvCreaturesFromGraveyards = parseMoveZoneAnyNumberTargetCreaturesTotalMvFromGraveyards(
    step.what as any
  );
  const parsedCraftExiledCard = parseMoveZoneCraftExiledCard(step.what as any);
  const parsedUpToReferenceCountTargetPermanents = parseMoveZoneUpToReferenceCountTargetPermanents(
    step.what as any
  );
  const parsedTopCardsFromTargetPlayerLibrary = parseMoveZoneTopCardsFromTargetPlayerLibrary(step.what as any);
  const parsedAllCommandersCommandZoneGy =
    parseMoveZoneAllCommandersYouOwnFromCommandZoneAndGraveyard(step.what as any);
  const parsedAllCommandersFromCommandZone = parseMoveZoneAllCommandersFromCommandZone(step.what as any);
  const parsedCommandZonePermanent = parseMoveZoneCommandZonePermanent(step.what as any, step.raw);
  const parsedMyraExileInstantSorcery = parseMoveZoneMyraExileInstantSorcery(step.what as any);
  const parsedSharesTypeFromAmongThem = parseMoveZoneSharesTypeFromAmongThem(step.what as any);
  const parsedSingleCardRevealedThisWay = parseMoveZoneSingleCardRevealedThisWay(step.what as any);
  const parsedContextualThemSplit = getContextualThemSplitKind(step);
  const parsedAnyNumberThosePermanentCards = parseMoveZoneAnyNumberThosePermanentCards(step.what as any);
  const parsedThoseCreatureCards = parseMoveZoneThoseCreatureCards(step.what as any);
  const parsedThemAntecedent = parseMoveZoneThemAntecedent(step.what as any);
  const parsedReturnContextualThemToBattlefield = parseMoveZoneReturnContextualThemToBattlefield(step.what as any);
  const parsedUpToCreaturesExcludingTypeLineTerm = parseMoveZoneUpToTargetCreaturesExcludingTypeLineTerm(
    step.what as any
  );
  const parsedSingleRevealedRestToGy =
    parsedSingleCardRevealedThisWay &&
    step.to === 'hand' &&
    /\brest\b/i.test(String(step.toRaw || '')) &&
    /\bgraveyard\b/i.test(String(step.toRaw || ''));
  const parsedShuffleSourceAndTarget = parseMoveZoneShuffleSourceAndTargetIntoLibraries(step.what as any);
  const parsedUpToXFromAmongExiled = parseMoveZoneUpToXFromAmongExiledWithThis(step.what as any);
  const parsedAnyNumberSaddledToHand = parseMoveZoneAnyNumberSaddledCreaturesToHand(step.what as any);
  const parsedUpToXOtherBfOrGy = parseMoveZoneUpToXOtherCreaturesBfOrGy(step.what as any);
  const parsedEachOpponentCreatureToughnessX = parseMoveZoneEachOpponentCreatureToughnessXOrLess(step.what as any);
  const parsedEachCreaturePowerOfChosenQuality = parseMoveZoneEachCreatureWithPowerOfChosenQuality(step.what as any);
  const parsedTopLibraryFaceDownPerOpponent = parseMoveZoneTopLibraryFaceDownPerOpponent(step.what as any);
  const parsedAllNamedThisPermanent = parseMoveZoneAllNamedThisPermanentFromYourGraveyard(step.what as any);
  const parsedCreatureExiledWithVehicle = parseMoveZoneCreatureExiledWithThisVehicle(step.what as any);
  const parsedAnyNumberCyclingPermanents = parseMoveZoneAnyNumberCyclingPermanentsFromYourGraveyard(step.what as any);

  return {
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
  };
}

export type MoveZoneWhatZoneQueries = ReturnType<typeof parseMoveZoneWhatZoneQueries>;
