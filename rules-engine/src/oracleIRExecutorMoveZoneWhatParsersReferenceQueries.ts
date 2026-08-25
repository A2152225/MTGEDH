// Extracted from oracleIRExecutorMoveZoneStepHandlers.ts (applyMoveZoneStep prologue).
// Cluster: `step.what` selectors for contextual references, revealed/chosen/milled cards and per-player zones.
// Entry point: parseMoveZoneWhatReferenceQueries.
import type { OracleEffectStep } from './oracleIR';
import {
  parseMoveZoneAllFromEachOpponentsExile,
  parseMoveZoneAllFromEachOpponentsGraveyard,
  parseMoveZoneAllFromEachOpponentsHand,
  parseMoveZoneAllFromEachPlayersExile,
  parseMoveZoneAllFromEachPlayersGraveyard,
  parseMoveZoneAllFromEachPlayersHand,
  parseMoveZoneCountCardsFromEachPlayersHand,
  parseMoveZoneAllFromTargetPlayersExile,
  parseMoveZoneAllFromTargetPlayersGraveyard,
  parseMoveZoneAllFromTargetPlayerHandAndGraveyard,
  parseMoveZoneAllFromTargetPlayersHand,
  parseMoveZoneAllTypedCardsTargetPlayerOwns,
  parseMoveZoneAllFromTargetPlayersLibrary,
  parseMoveZoneTheCardFromYourGraveyard,
  parseMoveZoneUpToXLandsFromHandAndOrGraveyard,
  parseMoveZoneAnotherFromYourGraveyard,
  parseMoveZoneAnotherCardFromAGraveyard,
  parseMoveZoneOrTypedCardsFromYourGraveyard,
  parseMoveZoneCardFromTargetPlayersHand,
  parseMoveZoneOpponentOwnedFromExile,
  parseMoveZoneSingleCardFromYourHand,
  parseMoveZoneThemFromYourGraveyard,
  parseMoveZoneTheCardsExiledWithIt,
  parseMoveZoneAllCardsTheyExiledThisWay,
  parseMoveZoneNonlandCardFromIt,
  parseMoveZoneThisCardFromExile,
  parseMoveZoneThatSpell,
  parseMoveZoneThisSpellToHandInsteadOfGraveyard,
  parseMoveZoneUpToCountBattlefieldBounce,
  parseMoveZoneCardFromAmongThoseCards,
  parseMoveZoneAllExiledWithThisPermanent,
  parseMoveZoneTypedCardFromYourGraveyard,
  parseMoveZoneUpToTargetCardsFromSingleGraveyard,
  parseMoveZoneUpToTargetCardsFromGraveyards,
  parseMoveZoneAllCardsExiledWithIt,
  parseMoveZoneRestOfExiledCards,
  parseMoveZoneTypedCardFromAmongThem,
  parseMoveZoneReturnThisCardAndUpToOneOtherFromGraveyard,
  parseMoveZoneAllCardsMilledThisWay,
  parseMoveZoneAllCardsDiscardedThisWay,
  parseMoveZoneOpponentChoicePermanentToHand,
  parseMoveZoneAllAdventureCardsFromMilledCards,
  parseMoveZoneAllNonManaActivatedCreaturesFromMilledCards,
  parseMoveZoneCardFromChosenPile,
  parseMoveZoneAllCardsFromPileOfYourChoice,
  parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature,
  parseMoveZoneThoseLands,
  parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard,
  parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn,
  parseMoveZoneAdventureCardThatPlayerOwnsFromExile,
  parseMoveZoneAllExiledWithNamedSource,
  parseMoveZoneAllExiledCardsWithCounter,
  parseMoveZoneAnyNumberFromYourGraveyard,
  parseMoveZoneCountCardsExiledWithThisPermanent,
  parseMoveZoneShuffleSourceArtifactAndGraveyard,
  parseMoveZoneThatCardReference,
  parseMoveZoneTypedCardFromHandOrGraveyard,
  parseMoveZoneTypedCardMvLessThanReferenceFromYourHand,
  stepHasAmongThemRestToLibrary,
  stepHasRevealedThisWayRestToLibrary,
  parseMoveZoneTypedCardsRevealedThisWay,
  parseMoveZoneTheChosenCards,
  parseMoveZoneOneOfTheChosenCards,
  parseMoveZoneLastChosenCard,
  parseMoveZoneOtherChosenCards,
  parseMoveZoneEachPlayerGraveyardNotPutThisWay,
  parseMoveZoneSingleCardFromEachPlayersGraveyard,
  parseMoveZoneThisCreatureAndTargetYouControl,
  parseMoveZoneThisCreatureAndAnotherTargetCreature,
  parseMoveZoneThisPermanentAndAnotherTargetCreature,
  parseMoveZoneCardPutIntoGraveyardThisWay,
  parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay,
  parseMoveZoneThoseCardsNotPlayed,
  parseMoveZoneTheNonlandCard,
  parseMoveZoneExiledThisWayNotCast,
  parseMoveZoneReturnItAndSelfPermanent,
  parseMoveZoneCompoundExileItAndReturnAllFromYourGraveyard,
  parseMoveZoneBothCards,
  parseMoveZoneOneOfThoseDragons,
  parseMoveZoneMorphCreatureFromHand,
  parseMoveZoneCountTargetCardsFromSingleGraveyard,
  parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard,
  parseMoveZoneAllAurasAttachedToTargetPermanentYouOwn,
  parseMoveZoneThisCreatureAndCombatantsToLibraryTop,
  parseMoveZoneEachAttackingCreature,
  parseMoveZoneAllCreatureTokens,
  parseMoveZoneTargetCreatureOwnerLibraryChoice,
  parseMoveZoneThisCardAndNamedCardsFromYourGraveyard,
  parseMoveZoneThisCardAndTargetFromYourGraveyard,
  parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles,
  parseMoveZoneAnyNumberCardsTotalMvXFromYourGraveyard,
  parseMoveZoneShuffleAllTypedCardsOfThatTypeFromYourGraveyard,
  parseMoveZoneTopTypedCardFromTargetPlayerGraveyard,
  parseMoveZoneTopTypedCardFromYourGraveyard,
  parseMoveZoneEachCreatureMvXOrLessFromYourGraveyard,
  parseMoveZoneTypedCardFromTargetPlayersGraveyard,
  parseMoveZoneTypedCardFromAmongMilledCards,
  parseMoveZoneAnyNumberAurasFromYourGraveyard,
  parseMoveZoneNamedCardReference,
  parseMoveZoneAllFromYourLibrary,
  parseMoveZoneCountOfThemAtRandom,
  parseMoveZoneCreatureCardExiledWithSource,
  parseMoveZoneEachPermanentExiledWithSource,
  parseMoveZoneUpToTypedCardsFromAmongThem,
  parseMoveZoneSingleTargetFromYourExile,
  parseMoveZoneSingleTargetFromLinkedExile,
  parseMoveZoneTheExiledCard,
  parseMoveZoneTargetFaceUpExiledCard,
  parseMoveZoneAllFromLinkedExile,
  parseMoveZoneAllFromYourExile,
  parseMoveZoneThisPermanentAndTheExiledCard,
  parseMoveZonePutAllTypedAndFromAmongThem,
  parseMoveZoneOneOnTopRestOnBottomLibrary,
  parseMoveZoneAllFromYourHand,
  parseMoveZoneCreatureCardExiledThisWay,
  parseMoveZoneCompoundCountThemBfHandSplit,
  parseMoveZoneAnyNumberMountainsYouControlToHand,
  parseMoveZoneAnyNumberBasicLandSubtypeYouControlToHand,
  parseMoveZoneAnyNumberCreaturesTotalPowerFromYourGraveyard,
  parseMoveZoneUpToThatManyFromTheirGraveyard,
  parseMoveZoneUpToOneEachCardTypeFromBoundGraveyard,
  parseMoveZoneCreatureFromAmongCardsMilledThisWay,
  parseMoveZoneCreatureHandOrCommandZoneLesserMv,
  parseMoveZoneOneOfThemBfTappedOtherHand,
} from './oracleIRExecutorZoneOps';
import {
  getOneOfThemSplitKind,
  isOneOfThemReference,
  isOneOfThemToHandBounce,
  isTheOtherReference,
  isTheRestReference,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';

export function parseMoveZoneWhatReferenceQueries(step: Extract<OracleEffectStep, { kind: 'move_zone' }>) {
  const parsedAnyNumberCreaturesTotalPower = parseMoveZoneAnyNumberCreaturesTotalPowerFromYourGraveyard(step.what as any);
  const parsedUpToThatManyFromTheirGy = parseMoveZoneUpToThatManyFromTheirGraveyard(step.what as any);
  const parsedUpToOneEachCardTypeFromBoundGy = parseMoveZoneUpToOneEachCardTypeFromBoundGraveyard(step.what as any);
  const parsedCreatureFromCardsMilledThisWay = parseMoveZoneCreatureFromAmongCardsMilledThisWay(step.what as any);
  const parsedCreatureHandOrCommandLesserMv = parseMoveZoneCreatureHandOrCommandZoneLesserMv(step.what as any);
  const parsedOneOfThemBfTappedOtherHand = parseMoveZoneOneOfThemBfTappedOtherHand(step.what as any);
  const parsedOneOfThemToGraveyard =
    isOneOfThemReference(step.what as any) && step.to === 'graveyard';
  const parsedOneOfThemToBattlefield =
    isOneOfThemReference(step.what as any) && step.to === 'battlefield';
  const parsedAnotherFromGraveyard = parseMoveZoneAnotherFromYourGraveyard(step.what as any);
  const parsedAnotherCardFromGraveyard = parseMoveZoneAnotherCardFromAGraveyard(step.what as any);
  const parsedOrTypedCardsFromGraveyard = parseMoveZoneOrTypedCardsFromYourGraveyard(step.what as any);
  const parsedCardFromTargetPlayerHand = parseMoveZoneCardFromTargetPlayersHand(step.what as any);
  const parsedOpponentOwnedFromExile = parseMoveZoneOpponentOwnedFromExile(step.what as any);
  const parsedSingleCardFromHand = parseMoveZoneSingleCardFromYourHand(step.what as any);
  const parsedThemFromGraveyard = parseMoveZoneThemFromYourGraveyard(step.what as any);
  const parsedTheCardsExiledWithIt = parseMoveZoneTheCardsExiledWithIt(step.what as any);
  const parsedAllCardsTheyExiledThisWay = parseMoveZoneAllCardsTheyExiledThisWay(step.what as any);
  const parsedNonlandCardFromIt = parseMoveZoneNonlandCardFromIt(step.what as any);
  const parsedThisCardFromExile = parseMoveZoneThisCardFromExile(step.what as any);
  const parsedThatSpell = parseMoveZoneThatSpell(step.what as any);
  const parsedThisSpellBuybackToHand =
    parseMoveZoneThisSpellToHandInsteadOfGraveyard(step.what as any) ||
    parseMoveZoneThisSpellToHandInsteadOfGraveyard({ kind: 'raw', text: String(step.raw || ''), raw: String(step.raw || '') });
  const parsedUpToBattlefieldBounce = parseMoveZoneUpToCountBattlefieldBounce(step.what as any);
  const parsedCardFromAmongThoseCards = parseMoveZoneCardFromAmongThoseCards(step.what as any);
  const parsedAllExiledWithThisPermanent =
    parseMoveZoneAllExiledWithThisPermanent(step.what as any) ||
    (parseMoveZoneEachPermanentExiledWithSource(step.what as any) ? { cardType: 'permanent' as const } : null);
  const parsedCreatureCardExiledWithSource = parseMoveZoneCreatureCardExiledWithSource(step.what as any);
  const parsedCreatureCardExiledThisWay = parseMoveZoneCreatureCardExiledThisWay(step.what as any);
  const parsedAllFromLibrary = parseMoveZoneAllFromYourLibrary(step.what as any);
  const parsedCountOfThemAtRandom = parseMoveZoneCountOfThemAtRandom(step.what as any);
  const parsedUpToTypedCardsFromAmongThem = parseMoveZoneUpToTypedCardsFromAmongThem(step.what as any);
  const parsedPutAllTypedAndFromAmongThem =
    parseMoveZonePutAllTypedAndFromAmongThem(step.what as any) ||
    parseMoveZonePutAllTypedAndFromAmongThem({ kind: 'raw', text: String(step.raw || ''), raw: String(step.raw || '') });
  const parsedOneOnTopRestOnBottomLibrary =
    parseMoveZoneOneOnTopRestOnBottomLibrary(step.what as any) ||
    parseMoveZoneOneOnTopRestOnBottomLibrary({ kind: 'raw', text: String(step.raw || ''), raw: String(step.raw || '') });
  const parsedOneOfThemToHand =
    isOneOfThemReference(step.what as any) &&
    step.to === 'hand' &&
    !isOneOfThemToHandBounce(step) &&
    !getOneOfThemSplitKind(step);
  const parsedTypedCardFromYourGraveyard = parseMoveZoneTypedCardFromYourGraveyard(step.what as any);
  const parsedOneOfThemHandBounce = isOneOfThemToHandBounce(step);
  const parsedUpToFromSingleGraveyard = parseMoveZoneUpToTargetCardsFromSingleGraveyard(step.what as any);
  const parsedUpToFromGraveyards = parseMoveZoneUpToTargetCardsFromGraveyards(step.what as any);
  const parsedAllCardsExiledWithIt = parseMoveZoneAllCardsExiledWithIt(step.what as any);
  const parsedTheRestToGraveyard = isTheRestReference(step.what as any) && step.to === 'graveyard';
  const parsedTheRestToLibrary = isTheRestReference(step.what as any) && step.to === 'library';
  const parsedTheRestToHand = isTheRestReference(step.what as any) && step.to === 'hand';
  const parsedTheRestToBattlefield = isTheRestReference(step.what as any) && step.to === 'battlefield';
  const parsedTheOtherToHand = isTheOtherReference(step.what as any) && step.to === 'hand';
  const parsedTheOtherToLibrary =
    isTheOtherReference(step.what as any) &&
    (step.to === 'library' || /\bbottom of\b/i.test(String(step.toRaw || step.raw || '')));
  const parsedTheOtherToBattlefield = isTheOtherReference(step.what as any) && step.to === 'battlefield';
  const parsedRestOfExiledCards = parseMoveZoneRestOfExiledCards(step.what as any);
  const parsedTypedCardFromAmongThem =
    parseMoveZoneTypedCardFromAmongThem(step.what as any, step) ||
    parseMoveZoneCompoundCountThemBfHandSplit(step.what as any, step);
  const parsedAnyNumberMountainsYouControl = parseMoveZoneAnyNumberMountainsYouControlToHand(step.what as any);
  const parsedAnyNumberBasicLandSubtypeYouControl = parseMoveZoneAnyNumberBasicLandSubtypeYouControlToHand(step.what as any);
  const parsedReturnThisCardAndUpToOneOther = parseMoveZoneReturnThisCardAndUpToOneOtherFromGraveyard(step.what as any);
  const parsedRevealedThisWayRest =
    String((step.what as any)?.text || '')
      .trim()
      .toLowerCase() === "all cards revealed this way that weren't put onto the battlefield";
  const parsedAllCardsMilledThisWay = parseMoveZoneAllCardsMilledThisWay(step.what as any);
  const parsedAllCardsDiscardedThisWay = parseMoveZoneAllCardsDiscardedThisWay(step.what as any);
  const parsedOpponentChoicePermanentToHand = parseMoveZoneOpponentChoicePermanentToHand(
    step.what as any,
    step.raw
  );
  const parsedAllAdventureCardsFromMilledCards = parseMoveZoneAllAdventureCardsFromMilledCards(step.what as any);
  const parsedAllNonManaActivatedCreaturesFromMilledCards = parseMoveZoneAllNonManaActivatedCreaturesFromMilledCards(
    step.what as any
  );
  const parsedCardFromChosenPile = parseMoveZoneCardFromChosenPile(step.what as any);
  const parsedAllCardsFromPileOfYourChoice = parseMoveZoneAllCardsFromPileOfYourChoice(step.what as any);
  const parsedAllCreaturesBlockingOrBlockedByTargetCreature =
    parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature(step.what as any);
  const parsedThoseLands = parseMoveZoneThoseLands(step.what as any);
  const parsedOpponentChoiceFromTargetPlayerGy = parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard(
    step.what as any
  );
  const parsedCompoundBattlefieldAndGraveyardMassReturn = parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn(
    step.what as any
  );
  const parsedShuffleSourceArtifactAndGraveyard = parseMoveZoneShuffleSourceArtifactAndGraveyard(step.what as any);
  const parsedAllExiledWithNamedSource = parseMoveZoneAllExiledWithNamedSource(step.what as any);
  const parsedAllExiledCardsWithCounter = parseMoveZoneAllExiledCardsWithCounter(step.what as any);
  const parsedAnyNumberFromYourGraveyard = parseMoveZoneAnyNumberFromYourGraveyard(step.what as any);
  const parsedCountExiledWithSource = parseMoveZoneCountCardsExiledWithThisPermanent(step.what as any, step);
  const parsedThatCardReference = parseMoveZoneThatCardReference(step.what as any);
  const parsedThatCardToBattlefield =
    (parsedThatCardReference || /\bthat card\b/i.test(String((step.what as any)?.text || ''))) &&
    step.to === 'battlefield' &&
    !/\bonto the battlefield or into your hand\b/i.test(String(step.raw || ''));
  const parsedTypedCardFromHandOrGraveyard = parseMoveZoneTypedCardFromHandOrGraveyard(step.what as any, step.raw);
  const parsedAdventureCardThatPlayerOwnsFromExile = parseMoveZoneAdventureCardThatPlayerOwnsFromExile(step.what as any);
  const parsedMvLessThanReferenceFromHand = parseMoveZoneTypedCardMvLessThanReferenceFromYourHand(step.what as any);
  const parsedAmongThemRestToLibrary = parsedTypedCardFromAmongThem && stepHasAmongThemRestToLibrary(step);
  const parsedTypedCardsRevealedThisWay = parseMoveZoneTypedCardsRevealedThisWay(step.what as any);
  const parsedRevealedThisWayRestToLibrary =
    parsedTypedCardsRevealedThisWay && stepHasRevealedThisWayRestToLibrary(step);
  const parsedTheChosenCards = parseMoveZoneTheChosenCards(step.what as any);
  const parsedOneOfTheChosenCards = parseMoveZoneOneOfTheChosenCards(step.what as any);
  const parsedLastChosenCard = parseMoveZoneLastChosenCard(step.what as any);
  const parsedOtherChosenCards = parseMoveZoneOtherChosenCards(step.what as any);
  const parsedChosenCardsRestToLibrary = parsedTheChosenCards && stepHasRevealedThisWayRestToLibrary(step);
  const parsedEachPlayerGyNotPutThisWay = parseMoveZoneEachPlayerGraveyardNotPutThisWay(step.what as any);
  const parsedShuffleTypedCardsOfThatType = parseMoveZoneShuffleAllTypedCardsOfThatTypeFromYourGraveyard(step.what as any);
  const parsedTopTypedCardFromTargetPlayerGy = parseMoveZoneTopTypedCardFromTargetPlayerGraveyard(step.what as any);
  const parsedTopTypedCardFromYourGy = parseMoveZoneTopTypedCardFromYourGraveyard(step.what as any);
  const parsedEachCreatureMvXFromGy = parseMoveZoneEachCreatureMvXOrLessFromYourGraveyard(step.what as any);
  const parsedTypedCardFromTargetPlayerGy = parseMoveZoneTypedCardFromTargetPlayersGraveyard(step.what as any);
  const parsedTypedCardFromAmongMilledCards = parseMoveZoneTypedCardFromAmongMilledCards(step.what as any);
  const parsedAnyNumberAurasFromYourGy = parseMoveZoneAnyNumberAurasFromYourGraveyard(step.what as any);
  const parsedNamedCardReference = parseMoveZoneNamedCardReference(step.what as any);
  const parsedSingleTargetFromYourExile = parseMoveZoneSingleTargetFromYourExile(step.what as any);
  const parsedSingleTargetFromLinkedExile = parseMoveZoneSingleTargetFromLinkedExile(step.what as any);
  const parsedTheExiledCard = parseMoveZoneTheExiledCard(step.what as any);
  const parsedThisPermanentAndTheExiledCard = parseMoveZoneThisPermanentAndTheExiledCard(step.what as any);
  const parsedTargetFaceUpExiledCard = parseMoveZoneTargetFaceUpExiledCard(step.what as any);
  const parsedFromHand = parseMoveZoneAllFromYourHand(step.what as any);
  const parsedFromExile = parseMoveZoneAllFromYourExile(step.what as any);
  const parsedAllFromLinkedExile = parseMoveZoneAllFromLinkedExile(step.what as any);
  const parsedEachPlayersGy = parseMoveZoneAllFromEachPlayersGraveyard(step.what as any);
  const parsedSingleCardFromEachPlayersGy = parseMoveZoneSingleCardFromEachPlayersGraveyard(step.what as any);
  const parsedThisCreatureAndTargetYouControl = parseMoveZoneThisCreatureAndTargetYouControl(step.what as any);
  const parsedThisCreatureAndAnotherTargetCreature = parseMoveZoneThisCreatureAndAnotherTargetCreature(step.what as any);
  const parsedThisPermanentAndAnotherTargetCreature = parseMoveZoneThisPermanentAndAnotherTargetCreature(step.what as any);
  const parsedPutIntoGraveyardThisWay = parseMoveZoneCardPutIntoGraveyardThisWay(step.what as any, step.raw);
  const parsedUpToCreatureCardsPutIntoGraveyardsThisWay = parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay(
    step.what as any,
    step.raw
  );
  const parsedThoseCardsNotPlayed = parseMoveZoneThoseCardsNotPlayed(step.what as any);
  const parsedTheNonlandCard = parseMoveZoneTheNonlandCard(step.what as any);
  const parsedTheNonlandCardRestToLibrary =
    parsedTheNonlandCard && step.to === 'hand' && stepHasRevealedThisWayRestToLibrary(step);
  const parsedExiledThisWayNotCast = parseMoveZoneExiledThisWayNotCast(step.what as any, step);
  const parsedReturnItAndSelf = parseMoveZoneReturnItAndSelfPermanent(step.what as any);
  const parsedCompoundExileItAndReturnGy = parseMoveZoneCompoundExileItAndReturnAllFromYourGraveyard(step.raw);
  const parsedBothCards = parseMoveZoneBothCards(step.what as any);
  const parsedOneOfThoseDragons = parseMoveZoneOneOfThoseDragons(step.what as any);
  const parsedMorphCreatureFromHand = parseMoveZoneMorphCreatureFromHand(step.what as any);
  const parsedCountTargetFromSingleGraveyard = parseMoveZoneCountTargetCardsFromSingleGraveyard(step.what as any);
  const parsedThisPermanentAndUpToFromSingleGy = parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard(
    step.what as any
  );
  const parsedAurasAttachedToTargetPermanentYouOwn = parseMoveZoneAllAurasAttachedToTargetPermanentYouOwn(step.what as any);
  const parsedThisCreatureAndCombatantsToLibraryTop = parseMoveZoneThisCreatureAndCombatantsToLibraryTop(step.what as any);
  const parsedEachAttackingCreature = parseMoveZoneEachAttackingCreature(step.what as any);
  const parsedAllCreatureTokens = parseMoveZoneAllCreatureTokens(step.what as any);
  const parsedTargetCreatureOwnerLibraryChoice = parseMoveZoneTargetCreatureOwnerLibraryChoice(
    step.what as any,
    step.raw
  );
  const parsedThisCardAndNamedFromGy = parseMoveZoneThisCardAndNamedCardsFromYourGraveyard(step.what as any);
  const parsedThisCardAndTargetFromGy = parseMoveZoneThisCardAndTargetFromYourGraveyard(step.what as any);
  const parsedExileGySplitTwoPiles = parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles(step.what as any);
  const parsedAnyNumberCardsTotalMvXFromGy = parseMoveZoneAnyNumberCardsTotalMvXFromYourGraveyard(step.what as any);
  const parsedEachPlayersHand = parseMoveZoneAllFromEachPlayersHand(step.what as any);
  const parsedCountCardsFromEachPlayersHand = parseMoveZoneCountCardsFromEachPlayersHand(step.what as any);
  const parsedEachPlayersExile = parseMoveZoneAllFromEachPlayersExile(step.what as any);
  const parsedEachOpponentsGy = parseMoveZoneAllFromEachOpponentsGraveyard(step.what as any);
  const parsedEachOpponentsHand = parseMoveZoneAllFromEachOpponentsHand(step.what as any);
  const parsedEachOpponentsExile = parseMoveZoneAllFromEachOpponentsExile(step.what as any);
  const parsedTargetPlayerHand = parseMoveZoneAllFromTargetPlayersHand(step.what as any);
  const parsedAllTypedCardsTargetPlayerOwns = parseMoveZoneAllTypedCardsTargetPlayerOwns(step.what as any);
  const parsedTargetPlayerLibrary = parseMoveZoneAllFromTargetPlayersLibrary(step.what as any);
  const parsedTargetPlayerExile = parseMoveZoneAllFromTargetPlayersExile(step.what as any);
  const parsedTargetPlayerGy = parseMoveZoneAllFromTargetPlayersGraveyard(step.what as any);
  const parsedTargetPlayerHandAndGy = parseMoveZoneAllFromTargetPlayerHandAndGraveyard(step.what as any);
  const parsedTheCardFromYourGraveyard = parseMoveZoneTheCardFromYourGraveyard(step.what as any);
  const parsedUpToXLandsHandGy = parseMoveZoneUpToXLandsFromHandAndOrGraveyard(step.what as any);

  return {
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
  };
}

export type MoveZoneWhatReferenceQueries = ReturnType<typeof parseMoveZoneWhatReferenceQueries>;
