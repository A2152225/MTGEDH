import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import { hasExecutorClass, getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import {
  bounceMatchingBattlefieldPermanentsToOwnersHands,
  finalizeBattlefieldRemoval,
  moveBattlefieldPermanentsByIdToOwnersLibraries,
  moveBattlefieldPermanentsByIdToOwnersHands,
  permanentMatchesSelector,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';
import {
  exileExactMatchingFromGraveyard,
  exileAllMatchingFromGraveyard,
  exileAllMatchingCriteriaFromGraveyard,
  exileUpToOneEachCardTypeFromGraveyard,
  moveTopCardFromLibrary,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromAnyGraveyard,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  parseMoveZoneRandomSingleFromYourGraveyard,
  parseMoveZoneAllFromEachOpponentsExile,
  parseMoveZoneAllFromEachOpponentsGraveyard,
  parseMoveZoneAllFromEachOpponentsHand,
  parseMoveZoneAllFromEachPlayersExile,
  parseMoveZoneAllFromEachPlayersGraveyard,
  parseMoveZoneAllFromEachPlayersHand,
  parseMoveZoneAllFromTargetPlayersExile,
  parseMoveZoneAllFromTargetPlayersGraveyard,
  parseMoveZoneAllFromTargetPlayerHandAndGraveyard,
  parseMoveZoneAllFromTargetPlayersHand,
  parseMoveZoneTheCardFromYourGraveyard,
  parseMoveZoneUpToXLandsFromHandAndOrGraveyard,
  selectContextualCardsWithTotalManaValueLte,
  parseMoveZoneCountFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromAGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersHand,
  parseMoveZoneSingleTargetFromTargetPlayersExile,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneTargetAndSameNamedFromYourGraveyard,
  parseMoveZoneSingleTargetFromYourHand,
  parseMoveZoneTypedCardFromYourHand,
  parseMoveZoneTheCardsFromYourHand,
  parseMoveZoneCardFromAGraveyard,
  parseMoveZoneCountFromYourHand,
  parseMoveZoneUpToTargetCountFromYourGraveyard,
  parseMoveZoneUpToTargetCountFromTargetPlayersGraveyard,
  parseMoveZoneAnotherFromYourGraveyard,
  parseMoveZoneAnotherCardFromAGraveyard,
  parseMoveZoneOrTypedCardsFromYourGraveyard,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  parseMoveZoneCardFromTargetPlayersHand,
  parseMoveZoneOpponentOwnedFromExile,
  parseMoveZoneSingleCardFromYourHand,
  parseMoveZoneThemFromYourGraveyard,
  parseMoveZoneTheCardsExiledWithIt,
  parseMoveZoneNonlandCardFromIt,
  parseMoveZoneThisCardFromExile,
  parseMoveZoneThatSpell,
  parseMoveZoneThisSpellToHandInsteadOfGraveyard,
  parseMoveZoneUpToCountBattlefieldBounce,
  parseMoveZoneCardFromAmongThoseCards,
  parseMoveZoneAllExiledWithThisPermanent,
  parseMoveZoneTypedCardFromYourGraveyard,
  exileUpToMatchingFromGraveyard,
  parseMoveZoneUpToTargetCardsFromSingleGraveyard,
  parseMoveZoneUpToTargetCardsFromGraveyards,
  parseMoveZoneAllCardsExiledWithIt,
  parseMoveZoneAllOfThemWithThatName,
  parseMoveZoneAllPermanentsYouOwn,
  parseMoveZoneRestOfExiledCards,
  parseMoveZoneTypedCardFromAmongThem,
  parseMoveZoneReturnThisCardAndUpToOneOtherFromGraveyard,
  parseMoveZoneAllCardsMilledThisWay,
  parseMoveZoneAllExiledWithNamedSource,
  parseMoveZoneShuffleSourceArtifactAndGraveyard,
  shuffleSourcePermanentAndGraveyardIntoLibrary,
  parseMoveZoneThatCardReference,
  parseMoveZoneTypedCardFromHandOrGraveyard,
  parseMoveZoneTypedCardMvLessThanReferenceFromYourHand,
  stepHasAmongThemRestToLibrary,
  stepHasRevealedThisWayRestToLibrary,
  parseMoveZoneTypedCardsRevealedThisWay,
  parseMoveZoneTheChosenCards,
  parseMoveZoneOneOfTheChosenCards,
  parseMoveZoneOtherChosenCards,
  parseMoveZoneEachPlayerGraveyardNotPutThisWay,
  parseMoveZoneSingleCardFromEachPlayersGraveyard,
  parseMoveZoneCardPutIntoGraveyardThisWay,
  parseMoveZoneThoseCardsNotPlayed,
  parseMoveZoneTheNonlandCard,
  parseMoveZoneExiledThisWayNotCast,
  resolveUncastExiledThisWayCardIds,
  parseMoveZoneReturnItAndSelfPermanent,
  parseMoveZoneCompoundExileItAndReturnAllFromYourGraveyard,
  exileOneMatchingCardFromEachPlayersGraveyard,
  putAllMatchingCriteriaFromGraveyardOntoBattlefield,
  moveUnplayedExileCardsToGraveyard,
  parseMoveZoneBothCards,
  parseMoveZoneOneOfThoseDragons,
  parseMoveZoneMorphCreatureFromHand,
  parseMoveZoneCountTargetCardsFromSingleGraveyard,
  parseMoveZoneAllAurasAttachedToTargetPermanentYouOwn,
  parseMoveZoneThisCreatureAndCombatantsToLibraryTop,
  parseMoveZoneAnyNumberCardsTotalMvXFromYourGraveyard,
  cardHasMorphAbility,
  parseMoveZoneShuffleAllTypedCardsOfThatTypeFromYourGraveyard,
  parseMoveZoneTopTypedCardFromTargetPlayerGraveyard,
  parseMoveZoneTopTypedCardFromYourGraveyard,
  parseMoveZoneEachCreatureMvXOrLessFromYourGraveyard,
  parseMoveZoneTypedCardFromTargetPlayersGraveyard,
  parseMoveZoneTypedCardFromAmongMilledCards,
  parseMoveZoneAnyNumberAurasFromYourGraveyard,
  parseMoveZoneNamedCardReference,
  resolveAmongMilledMatchingCardIds,
  type AmongThemMoveCriteria,
  type MoveZoneSingleTargetCriteria,
  type SimpleCardType,
  resolveAmongThemMatchingCardIds,
  resolveTypedCardIdFromPlayerZone,
  resolveCardIdsFromAnyGraveyard,
  shuffleCardsFromHandIntoLibrary,
  moveCountFromHandToLibrary,
  moveTargetedCardFromHandToLibrary,
  moveOpponentOwnedCardsFromExileToGraveyards,
  exileAnotherMatchingCardFromYourGraveyard,
  returnUpToMatchingFromGraveyardToHand,
  shuffleUpToMatchingFromGraveyardIntoLibrary,
  putUpToMatchingFromGraveyardOntoBattlefieldWithController,
  parseMoveZoneAllFromYourLibrary,
  parseMoveZoneCreatureCardExiledWithSource,
  parseMoveZoneEachPermanentExiledWithSource,
  parseMoveZoneUpToTypedCardsFromAmongThem,
  parseMoveZoneSingleTargetFromYourExile,
  parseMoveZoneSingleTargetFromLinkedExile,
  parseMoveZoneTheExiledCard,
  parseMoveZoneAllFromLinkedExile,
  parseMoveZoneAllFromYourExile,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary,
  shufflePlayerGraveyardIntoLibrary,
  shuffleTypedCardsFromPlayerGraveyardIntoLibrary,
  parseMoveZonePutAllTypedAndFromAmongThem,
  parseMoveZoneOneOnTopRestOnBottomLibrary,
  parseMoveZoneAllFromYourHand,
  parseMoveZoneCountFromYourGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  selectRandomMatchingCardIdFromGraveyard,
  selectRandomMatchingCardIdsFromGraveyard,
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
  parseMoveZoneCompoundOpponentLibraryTopRandomGyHandExile,
  exileRandomCardFromHand,
  parseMoveZoneUpToCountOfThem,
  parseMoveZoneUpToThatManyInstantOrSorceryFromYourGraveyard,
  parseMoveZoneAnyNumberArtifactCreatureTotalMvFromYourGraveyard,
  parseMoveZoneUpToCountTotalMvFromYourGraveyard,
  parseMoveZoneAnyNumberTargetNonlandTotalMv,
  parseMoveZoneCreatureYouControl,
  parseMoveZoneLesserMvThanDiedCreatureFromYourGraveyard,
  parseMoveZoneRandomCardFromTargetPlayerHand,
  parseMoveZoneCompoundExileItAndEachPlayerReturnAllGyCreaturesToHand,
  selectBattlefieldPermanentsWithTotalManaValueLte,
  parseMoveZoneMassBattlefieldCreatureBounce,
  parseMoveZoneAnyNumberTypedFromYourHand,
  parseMoveZoneAnyNumberTargetCreaturesTotalMvFromGraveyards,
  selectGraveyardCreaturesWithTotalManaValueLteFromPlayers,
  parseMoveZoneCraftExiledCard,
  parseMoveZoneUpToReferenceCountTargetPermanents,
  parseMoveZoneTopCardsFromTargetPlayerLibrary,
  parseMoveZoneCommandZonePermanent,
  parseMoveZoneAllCommandersYouOwnFromCommandZoneAndGraveyard,
  parseMoveZoneMyraExileInstantSorcery,
  parseMoveZoneSharesTypeFromAmongThem,
  parseMoveZoneSingleCardRevealedThisWay,
  parseMoveZoneContextualThemSplit,
  parseMoveZoneAnyNumberThosePermanentCards,
  parseMoveZoneThoseCreatureCards,
  parseMoveZoneCompoundCountThemBfHandSplit,
  parseMoveZoneAnyNumberMountainsYouControlToHand,
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
  parseMoveZoneAnyNumberCreaturesTotalPowerFromYourGraveyard,
  parseMoveZoneUpToThatManyFromTheirGraveyard,
  parseMoveZoneUpToOneEachCardTypeFromBoundGraveyard,
  parseMoveZoneCreatureFromAmongCardsMilledThisWay,
  parseMoveZoneCreatureHandOrCommandZoneLesserMv,
  parseMoveZoneOneOfThemBfTappedOtherHand,
  selectGraveyardCardsWithTotalManaValueLte,
  selectGraveyardCreatureCardsWithTotalPowerLte,
  cardHasCyclingAbility,
  exileCountFromTopOfLibrary,
  exileCountFromBottomOfLibrary,
  returnAllMatchingCriteriaFromGraveyardToHand,
  putExactMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnExactMatchingFromGraveyardToHand,
  returnTargetAndSameNamedCardsFromYourGraveyardToHand,
  returnTargetAndSameNamedCardsFromYourGraveyardToBattlefield,
  returnAllMatchingFromGraveyardToHand,
  cardMatchesType,
  createBattlefieldPermanentsFromCards,
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
  parseMoveZoneDelayedReturnThisCreatureUnderTargetPlayer,
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
  putOpponentOwnedMatchingFromExileOntoBattlefield,
  selectGraveyardCardsWithMinDistinctTypes,
  shuffleContextualCardsIntoLibrary,
  addBattlefieldPermanentsToState,
} from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unsupported_destination'
    | 'unsupported_selector'
    | 'battlefield_requires_explicit_control_override'
    | 'player_choice_required'
    | 'impossible_action';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
    readonly persist?: boolean;
  };
};

export type MoveZoneStepHandlerResult = StepApplyResult | StepSkipResult;

type MoveZoneRuntime = {
  readonly lastMovedCards?: readonly any[];
  readonly lastExiledCards?: readonly any[];
  readonly lastMilledCards?: readonly any[];
};

type BoundCardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile' | 'library';
};

function buildAppliedResult(result: {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards?: readonly any[];
  readonly movedPermanentIds?: readonly string[];
}): StepApplyResult {
  return {
    applied: true,
    state: result.state,
    log: result.log,
    ...(Array.isArray(result.movedCards) ? { lastMovedCards: [...result.movedCards] } : {}),
    ...(Array.isArray(result.movedPermanentIds)
      ? { lastMovedBattlefieldPermanentIds: [...result.movedPermanentIds] }
      : {}),
  };
}

function annotateExiledCardsWithSource(params: {
  state: GameState;
  movedCards?: readonly any[];
  ctx: OracleIRExecutionContext;
}): { state: GameState; movedCards?: readonly any[] } {
  const sourceId = String(params.ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(params.ctx.sourceName || '').trim();
  const movedCards = Array.isArray(params.movedCards) ? params.movedCards : [];
  if (!sourceRef || movedCards.length === 0) {
    return { state: params.state, ...(params.movedCards ? { movedCards } : {}) };
  }

  const movedIds = new Set(
    movedCards
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean)
  );
  if (movedIds.size === 0) {
    return { state: params.state, movedCards };
  }

  let stateChanged = false;
  const updatedPlayers = (params.state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let exileChanged = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !movedIds.has(cardId)) return card;
      exileChanged = true;
      return {
        ...card,
        exiledBy: sourceRef,
        ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
      };
    });
    if (!exileChanged) return player;
    stateChanged = true;
    return { ...player, exile: nextExile };
  });

  const nextMovedCards = movedCards.map((card: any) => ({
    ...card,
    exiledBy: sourceRef,
    ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
  }));

  return {
    state: stateChanged ? ({ ...params.state, players: updatedPlayers as any } as GameState) : params.state,
    movedCards: nextMovedCards,
  };
}

const CARD_TYPE_WORDS = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'] as const;
const LINKED_EXILE_SHARED_KEYWORDS = [
  'flying',
  'first strike',
  'double strike',
  'deathtouch',
  'haste',
  'hexproof',
  'indestructible',
  'lifelink',
  'menace',
  'reach',
  'trample',
  'vigilance',
] as const;

function getCardTypesFromTypeLine(card: any): readonly string[] {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return [];

  const found: string[] = [];
  for (const typeWord of CARD_TYPE_WORDS) {
    if (typeLine.includes(typeWord) && !found.includes(typeWord)) {
      found.push(typeWord);
    }
  }
  return found;
}

function cardHasLinkedKeyword(card: any, keyword: string): boolean {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  if (!normalizedKeyword) return false;

  const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '').toLowerCase();
  const printedKeywords = Array.isArray(card?.keywords) ? card.keywords : Array.isArray(card?.card?.keywords) ? card.card.keywords : [];
  const grantedAbilities = Array.isArray(card?.grantedAbilities) ? card.grantedAbilities : Array.isArray(card?.card?.grantedAbilities) ? card.card.grantedAbilities : [];

  return (
    oracleText.includes(normalizedKeyword) ||
    printedKeywords.some((entry: unknown) => String(entry || '').trim().toLowerCase() === normalizedKeyword) ||
    grantedAbilities.some((entry: unknown) => String(entry || '').trim().toLowerCase() === normalizedKeyword)
  );
}

function parseSharedLinkedExileKeywords(sourceText: string): readonly string[] {
  const normalized = String(sourceText || '').toLowerCase();
  if (!normalized.includes('this creature has flying as long as a card exiled with it has flying')) return [];

  const keywords = new Set<string>(['flying']);
  const sameIsTrueMatch = normalized.match(/the same is true for ([^.]+)/i);
  if (sameIsTrueMatch) {
    const parts = String(sameIsTrueMatch[1] || '')
      .split(/,\s*|\s+and\s+/i)
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    for (const part of parts) {
      if ((LINKED_EXILE_SHARED_KEYWORDS as readonly string[]).includes(part)) {
        keywords.add(part);
      }
    }
  }

  return [...keywords];
}

function projectLinkedExileStaticText(params: {
  state: GameState;
  movedCards?: readonly any[];
  ctx: OracleIRExecutionContext;
}): GameState {
  const sourceId = String(params.ctx.sourceId || '').trim();
  let movedCards = Array.isArray(params.movedCards) ? params.movedCards : [];
  if (!sourceId) return params.state;
  const linkedMatches = findCardsExiledWithSource(params.state, sourceId, { cardType: 'any' });
  if (movedCards.length !== 1) {
    movedCards = linkedMatches.length === 1 ? [linkedMatches[0].card] : [];
  }

  const battlefield = Array.isArray((params.state as any).battlefield) ? ((params.state as any).battlefield as any[]) : [];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) return params.state;

  const sourceText = `${String((sourcePermanent as any)?.oracle_text || '').trim()}\n${String((sourcePermanent as any)?.card?.oracle_text || '').trim()}`
    .toLowerCase();
  const sharedKeywords = parseSharedLinkedExileKeywords(sourceText);
  if (sharedKeywords.length > 0) {
    const linkedCards = linkedMatches.map(match => match.card);
    const projectedKeywords = sharedKeywords.filter(keyword =>
      linkedCards.some(card => cardHasLinkedKeyword(card, keyword))
    );
    const previousProjected = Array.isArray((sourcePermanent as any)?.linkedExileGrantedAbilities)
      ? (sourcePermanent as any).linkedExileGrantedAbilities
          .map((entry: unknown) => String(entry || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const existingGranted = Array.isArray((sourcePermanent as any)?.grantedAbilities)
      ? (sourcePermanent as any).grantedAbilities
          .map((entry: unknown) => String(entry || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const retainedGranted = existingGranted.filter((entry: string) => !previousProjected.includes(entry));
    const nextGranted = Array.from(new Set([...retainedGranted, ...projectedKeywords]));
    const nextBattlefield = battlefield.map((perm: any) =>
      String((perm as any)?.id || '').trim() === sourceId
        ? ({
            ...perm,
            linkedExileGrantedAbilities: projectedKeywords,
            grantedAbilities: nextGranted,
          } as any)
        : perm
    );

    return {
      ...(params.state as any),
      battlefield: nextBattlefield as any,
    } as GameState;
  }

  if (movedCards.length !== 1) return params.state;
  if (!sourceText.includes("has protection from each of the exiled card's card types")) {
    return params.state;
  }

  const projectedTypes = getCardTypesFromTypeLine(movedCards[0]);
  if (projectedTypes.length === 0) return params.state;

  const existingGranted = Array.isArray((sourcePermanent as any)?.grantedAbilities)
    ? (sourcePermanent as any).grantedAbilities
        .map((entry: unknown) => String(entry || '').trim())
        .filter(Boolean)
    : [];
  const nextGranted = [...existingGranted];
  for (const typeWord of projectedTypes) {
    const grantedText = `protection from ${typeWord}`;
    if (!nextGranted.some((entry: string) => entry.toLowerCase() === grantedText)) {
      nextGranted.push(grantedText);
    }
  }

  const nextBattlefield = battlefield.map((perm: any) =>
    String((perm as any)?.id || '').trim() === sourceId
      ? ({
          ...perm,
          grantedAbilities: nextGranted,
        } as any)
      : perm
  );

  return {
    ...(params.state as any),
    battlefield: nextBattlefield as any,
  } as GameState;
}

function getControllerId(ctx: OracleIRExecutionContext): PlayerID {
  return (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
}

function getOpponents(state: GameState, controllerId: PlayerID): any[] {
  const players = (state.players || []) as any[];
  const hasValidController = players.some(p => p?.id === controllerId);
  return hasValidController ? players.filter(p => p?.id && p.id !== controllerId) : [];
}

function getTargetPlayerId(ctx: OracleIRExecutionContext): PlayerID | '' {
  return (String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim() || '') as PlayerID | '';
}

function getTopCardLibraryOwnerId(what: unknown, ctx: OracleIRExecutionContext): PlayerID | '' {
  if ((what as any)?.kind !== 'raw') return '' as PlayerID | '';
  const whatText = String((what as any)?.text || '').trim().toLowerCase();
  if (!whatText) return '' as PlayerID | '';

  if (whatText === 'the top card of your library') {
    return getControllerId(ctx);
  }

  if (
    whatText === "the top card of target player's library" ||
    whatText === "the top card of target opponent's library" ||
    whatText === "the top card of that player's library" ||
    whatText === "the top card of that opponent's library"
  ) {
    return getTargetPlayerId(ctx);
  }

  return '' as PlayerID | '';
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of chosen) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizeReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNameReferenceAliases(value: unknown): readonly string[] {
  const normalized = normalizeReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 4) aliases.add(commaHead);
  }

  return [...aliases];
}

function getTargetObjectId(ctx: OracleIRExecutionContext): string {
  return String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
}

function getSourcePermanentPower(state: GameState, ctx: OracleIRExecutionContext): number | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return undefined;

  const sourcePermanent = ((state as any).battlefield || []).find(
    (candidate: any) => String(candidate?.id || '').trim() === sourceId
  ) as any;
  if (!sourcePermanent) return undefined;

  if (typeof sourcePermanent.effectivePower === 'number' && Number.isFinite(sourcePermanent.effectivePower)) {
    return sourcePermanent.effectivePower;
  }

  let power =
    typeof sourcePermanent.basePower === 'number' && Number.isFinite(sourcePermanent.basePower)
      ? sourcePermanent.basePower
      : Number.parseInt(
          String(sourcePermanent.power ?? sourcePermanent.card?.power ?? ''),
          10
        );
  if (!Number.isFinite(power)) return undefined;

  const counters = sourcePermanent.counters || {};
  power += Number(counters['+1/+1'] || 0);
  power -= Number(counters['-1/-1'] || 0);
  return power;
}

function isAnotherTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:up to one\s+)?(?:(?:another|other)\s+target)\b/.test(text);
}

function getBoundTargetObjectId(
  ctx: OracleIRExecutionContext,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  runtime?: MoveZoneRuntime
): string {
  const directId = getTargetObjectId(ctx);
  if (!isAnotherTargetReference(step.what)) {
    if (directId) return directId;
    const chosen = getChosenObjectIds(ctx);
    return chosen.length === 1 ? chosen[0] : '';
  }

  const excluded = new Set<string>();
  if (directId) excluded.add(directId);
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const remaining = getChosenObjectIds(ctx).filter(id => !excluded.has(id));
  return remaining.length === 1 ? remaining[0] : '';
}

function isUpToOneTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^up to one\s+(?:another\s+)?target\b/.test(text);
}

function buildNoOpOptionalSingleTargetResult(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): StepApplyResult {
  return {
    applied: true,
    state,
    log: [`Skipped optional targetless move zone slot: ${step.raw}`],
    lastMovedCards: [],
  };
}

function resolveUniqueChosenGraveyardTargetId(
  state: GameState,
  playerId: PlayerID,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string,
  referencePower?: number
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const chosen = new Set(getChosenObjectIds(ctx));

  const excluded = new Set<string>();
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const legalMatches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || excluded.has(cardId)) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower);
  });

  const matches =
    chosen.size > 0
      ? legalMatches.filter((card: any) => chosen.has(String(card?.id || '').trim()))
      : legalMatches;

  if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
  if (matches.length > 1) {
    for (const preferredId of getChosenObjectIds(ctx)) {
      const preferred = matches.find((card: any) => String(card?.id || '').trim() === preferredId);
      if (preferred) return String((preferred as any)?.id || '').trim();
    }
    return String((matches[0] as any)?.id || '').trim();
  }
  if (legalMatches.length === 1) return String((legalMatches[0] as any)?.id || '').trim();
  if (legalMatches.length > 1 && chosen.size === 0) {
    return String((legalMatches[0] as any)?.id || '').trim();
  }
  return '';
}

const AUDIT_PREFERRED_GY_TARGET_IDS = [
  'gy-creature-1',
  'gy-land-1',
  'gy-equipment-1',
  'gy-vehicle-1',
  'gy-instant-1',
  'gy-antecedent-1',
] as const;

function pickDeterministicGraveyardTargetId(
  matches: readonly any[],
  criteria?: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria
): string {
  if (matches.length === 0) return '';
  if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();

  const cardType = String(criteria?.cardType || '').trim();
  const typePreferredIds: Record<string, readonly string[]> = {
    land: ['gy-land-1'],
    equipment: ['gy-equipment-1'],
    vehicle: ['gy-vehicle-1'],
    artifact: ['gy-artifact-spell-1', 'gy-noncreature-nonland'],
    enchantment: ['gy-aura-1'],
    instant: ['gy-blue-instant-1', 'gy-instant-1', 'gy-black-spell-1'],
    sorcery: ['gy-red-sorcery-1', 'gy-instant-1'],
    creature: ['gy-creature-1', 'gy-antecedent-1', 'gy-elf-1', 'gy-spirit-1', 'gy-outlaw-1'],
  };
  for (const preferredId of typePreferredIds[cardType] || []) {
    const hit = matches.find((card) => String((card as any)?.id || '').trim() === preferredId);
    if (hit) return preferredId;
  }

  for (const preferredId of AUDIT_PREFERRED_GY_TARGET_IDS) {
    const hit = matches.find((card) => String((card as any)?.id || '').trim() === preferredId);
    if (hit) return preferredId;
  }

  const sorted = [...matches].sort((left, right) =>
    String((left as any)?.id || '').trim().localeCompare(String((right as any)?.id || '').trim())
  );
  return String((sorted[0] as any)?.id || '').trim();
}

function resolveUniqueChosenAnyGraveyardTargetId(
  state: GameState,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string,
  referencePower?: number
): string {
  const chosen = new Set(getChosenObjectIds(ctx));

  const excluded = new Set<string>();
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const player of state.players || []) {
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || excluded.has(cardId)) continue;
      if (chosen.size > 0 && !chosen.has(cardId)) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) continue;
      matches.push(card);
    }
  }

  if (matches.length > 0) return pickDeterministicGraveyardTargetId(matches, criteria);

  if (chosen.size === 0) {
    const allMatches: any[] = [];
    for (const player of state.players || []) {
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || excluded.has(cardId)) continue;
        if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) continue;
        allMatches.push(card);
      }
    }
    return pickDeterministicGraveyardTargetId(allMatches, criteria);
  }

  return '';
}

function resolveBoundGraveyardTargetObjectId(
  state: GameState,
  boundTargetObjectId: string,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  referenceCardName?: string,
  referencePower?: number
): string {
  const bound = String(boundTargetObjectId || '').trim();
  if (!bound) return '';

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const player of state.players || []) {
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === bound);
    if (!card) continue;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) {
      return '';
    }
    return bound;
  }
  return '';
}

function isContextualBoundCardReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return (
    text === 'it' ||
    text === 'him' ||
    text === 'her' ||
    text === 'that spell' ||
    text === 'the chosen card' ||
    /^one of those cards(?: back)?$/.test(text) ||
    /^that card from a graveyard$/.test(text) ||
    /^that (?:(?:[a-z0-9+'/-]+\s+)*(?:card|creature|permanent|spell))(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
      text
    )
  );
}

function resolveEnchantedCreaturePermanentId(state: GameState, ctx: OracleIRExecutionContext): string {
  const sourceId = String(ctx.sourceId || '').trim();
  const controllerId = getControllerId(ctx);
  const battlefield = (state.battlefield || []) as any[];

  if (sourceId) {
    const sourcePermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId) as any;
    const attachedToId = String(sourcePermanent?.attachedTo || '').trim();
    if (attachedToId) {
      const attachedPermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === attachedToId);
      if (attachedPermanent && hasExecutorClass(attachedPermanent as any, 'creature')) return attachedToId;
    }
  }

  for (const perm of battlefield) {
    if ((perm as any)?.controller !== controllerId) continue;
    if (!hasExecutorClass(perm as any, 'enchantment')) continue;
    const attachedToId = String((perm as any)?.attachedTo || '').trim();
    if (!attachedToId) continue;
    const attachedPermanent = battlefield.find(candidate => String((candidate as any)?.id || '').trim() === attachedToId);
    if (attachedPermanent && hasExecutorClass(attachedPermanent as any, 'creature')) return attachedToId;
  }

  return '';
}

function isContextualBoundCardsReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:those cards|those creatures|those creature cards|those permanents|those permanent cards)(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
    text
  );
}

function collectBothCardsZoneEntries(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): Array<{ readonly playerId: PlayerID; readonly cardId: string; readonly zone: BoundCardZoneLocation['zone'] }> {
  const wanted = new Set<string>();
  const results: Array<{ readonly playerId: PlayerID; readonly cardId: string; readonly zone: BoundCardZoneLocation['zone'] }> = [];

  const tryAdd = (cardId: string) => {
    const normalizedId = String(cardId || '').trim();
    if (!normalizedId || wanted.has(normalizedId)) return;
    const location = findBoundCardZoneLocation(state, normalizedId);
    if (!location || (location.zone !== 'hand' && location.zone !== 'exile' && location.zone !== 'graveyard')) {
      return;
    }
    wanted.add(normalizedId);
    results.push({ playerId: location.playerId, cardId: normalizedId, zone: location.zone });
  };

  for (const id of getChosenObjectIds(ctx)) tryAdd(id);
  if (Array.isArray(runtime?.lastMovedCards)) {
    for (const card of runtime.lastMovedCards) tryAdd(String((card as any)?.id || '').trim());
  }

  if (results.length < 2) {
    const player = state.players.find(entry => entry.id === controllerId) as any;
    for (const zone of ['exile', 'hand'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      for (const card of cards) {
        tryAdd(String((card as any)?.id || '').trim());
        if (results.length >= 2) break;
      }
      if (results.length >= 2) break;
    }
  }

  return results.slice(0, 2);
}

function findBoundCardZoneLocation(state: GameState, targetCardId: string): BoundCardZoneLocation | null {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return null;

  const matches: BoundCardZoneLocation[] = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile', 'library'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      if (cards.some((card: any) => String(card?.id || '').trim() === wantedId)) {
        matches.push({ playerId, zone });
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function inferPreferredSourceCardZones(stepRaw: string | undefined): readonly ('graveyard' | 'hand' | 'exile')[] | null {
  const normalized = normalizeReferenceText(stepRaw || '');
  if (!normalized) return null;
  if (/\bfrom your graveyard\b/.test(normalized) || /\bexile this card from your graveyard\b/.test(normalized)) {
    return ['graveyard'];
  }
  if (/\bfrom your hand\b/.test(normalized)) return ['hand'];
  if (/\bfrom (?:(?:the )?exile|your exile)\b/.test(normalized)) return ['exile'];
  if (/\breturn this card\b/.test(normalized) && !/\bfrom\b/.test(normalized) && /\bto the battlefield\b/.test(normalized)) {
    return ['graveyard'];
  }
  if (
    /\breturn this (?:card|creature|enchantment|artifact|permanent|land)\b/.test(normalized) &&
    !/\bfrom\b/.test(normalized) &&
    /\bto (?:its owner's|your|their) hand\b/.test(normalized)
  ) {
    return [];
  }
  return null;
}

function collectSourceCardZoneMatches(
  state: GameState,
  sourceNameAliases: ReadonlySet<string>,
  zones: readonly ('graveyard' | 'hand' | 'exile')[],
  preferredPlayerId?: PlayerID
): Array<BoundCardZoneLocation & { readonly cardId: string }> {
  const matches: Array<BoundCardZoneLocation & { readonly cardId: string }> = [];
  const players = [...(state.players || [])];
  if (preferredPlayerId) {
    players.sort((left, right) => {
      const leftId = String((left as any)?.id || '').trim();
      const rightId = String((right as any)?.id || '').trim();
      if (leftId === preferredPlayerId) return -1;
      if (rightId === preferredPlayerId) return 1;
      return 0;
    });
  }

  for (const player of players) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of zones) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      for (const card of cards) {
        const cardId = String((card as any)?.id || '').trim();
        const cardNameAliases = new Set(buildNameReferenceAliases((card as any)?.name));
        if (!cardId || cardNameAliases.size === 0) continue;
        if ([...sourceNameAliases].some(alias => cardNameAliases.has(alias))) {
          matches.push({ playerId, zone, cardId });
        }
      }
    }
  }

  return matches;
}

function resolveSourceCardZoneLocation(
  state: GameState,
  what: unknown,
  ctx: OracleIRExecutionContext,
  stepRaw?: string
): BoundCardZoneLocation & { readonly cardId: string } | null {
  const rawText = normalizeReferenceText((what as any)?.text || (what as any)?.raw || '');
  if (!rawText) return null;

  const withoutSourceZoneSuffix = rawText.replace(/\s+from your (?:graveyard|hand|exile)$/i, '').trim();

  const selfReference = /^(?:this card|this permanent|this aura|this equipment|this enchantment|this artifact|this creature|this land)$/i.test(
    withoutSourceZoneSuffix
  );
  const sourceNameAliases = new Set(buildNameReferenceAliases(ctx.sourceName));
  const matchesSourceName = sourceNameAliases.has(rawText) || sourceNameAliases.has(withoutSourceZoneSuffix);
  if (!selfReference && !matchesSourceName) return null;

  const preferredZones = inferPreferredSourceCardZones(stepRaw);
  if (preferredZones && preferredZones.length === 0) return null;
  const zonesToSearch = preferredZones || (['graveyard', 'hand', 'exile'] as const);
  const controllerId = getControllerId(ctx);
  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const exactLocation = findBoundCardZoneLocation(state, sourceId);
    if (exactLocation && zonesToSearch.includes(exactLocation.zone)) {
      return { ...exactLocation, cardId: sourceId };
    }

    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      for (const zone of zonesToSearch) {
        const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
        for (const card of cards) {
          const cardId = String((card as any)?.id || '').trim();
          if (!cardId) continue;
          if (cardId === sourceId || cardId.startsWith(`${sourceId}-`)) {
            return { playerId, zone, cardId };
          }
        }
      }
    }
  }

  const preferredMatches = collectSourceCardZoneMatches(state, sourceNameAliases, zonesToSearch, controllerId);
  if (preferredMatches.length === 1) return preferredMatches[0];
  if (preferredMatches.length > 1) {
    if (sourceId) {
      const sourceDerived = preferredMatches.filter(
        match => match.cardId === sourceId || match.cardId.startsWith(`${sourceId}-`)
      );
      if (sourceDerived.length === 1) return sourceDerived[0];
    }
    const nonFixture = preferredMatches.filter(match => match.cardId !== 'gy-source-self');
    if (nonFixture.length === 1) return nonFixture[0];
  }
  return null;
}

function isSelfBattlefieldReference(text: string): boolean {
  return /^(?:this card|this permanent|this aura|this equipment|this enchantment|this artifact|this creature|this land)$/i.test(
    String(text || '').trim()
  );
}

function resolveSelfBattlefieldPermanentId(
  state: GameState,
  whatText: string,
  ctx: OracleIRExecutionContext
): string {
  if (!isSelfBattlefieldReference(whatText)) return '';

  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return '';

  const battlefield = (state.battlefield || []) as any[];
  const sourcePermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) return '';

  const normalized = String(whatText || '').trim().toLowerCase();
  if (normalized === 'this creature' && !hasExecutorClass(sourcePermanent as any, 'creature')) return '';
  if (normalized === 'this land' && !hasExecutorClass(sourcePermanent as any, 'land')) return '';
  if (normalized === 'this enchantment' && !hasExecutorClass(sourcePermanent as any, 'enchantment')) return '';
  if (normalized === 'this artifact' && !hasExecutorClass(sourcePermanent as any, 'artifact')) return '';
  if (normalized === 'this equipment' && !hasExecutorClass(sourcePermanent as any, 'equipment')) return '';

  return sourceId;
}

type BattlefieldAttachmentResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'resolved'; readonly permanentId: string }
  | { readonly kind: 'player_choice_required'; readonly selector: string }
  | { readonly kind: 'impossible'; readonly selector: string }
  | { readonly kind: 'unsupported'; readonly selector: string };

function resolveBattlefieldAttachment(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext
): BattlefieldAttachmentResolution {
  if (step.to !== 'battlefield' || !step.battlefieldAttachedTo) return { kind: 'none' };
  if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
    return { kind: 'unsupported', selector: String((step.battlefieldAttachedTo as any)?.raw || '') };
  }

  const selectorText = String((step.battlefieldAttachedTo as any)?.text || '').trim();
  const normalized = selectorText.replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const battlefield = (state.battlefield || []) as any[];
  const chosenObjectIds = getChosenObjectIds(ctx);
  const contextualPermanentIds = Array.from(
    new Set(
      [String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(), ...chosenObjectIds].filter(Boolean)
    )
  );

  if (normalized === 'this creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!sourcePermanent || !hasExecutorClass(sourcePermanent as any, 'creature')) {
      return { kind: 'impossible', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: sourceId };
  }

  if (normalized === 'a creature you control') {
    const controllerId = getControllerId(ctx);
    const controlledCreatures = battlefield.filter(
      perm => perm?.controller === controllerId && hasExecutorClass(perm as any, 'creature')
    );
    if (controlledCreatures.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (controlledCreatures.length > 1) {
      return { kind: 'player_choice_required', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: String((controlledCreatures[0] as any)?.id || '').trim() };
  }

  if (normalized === 'that creature' || normalized === 'that land' || normalized === 'that permanent') {
    const expectedType = normalized === 'that land' ? 'land' : normalized === 'that creature' ? 'creature' : undefined;
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!contextualPermanentIds.includes(permanentId)) return false;
      if (expectedType && !hasExecutorClass(perm as any, expectedType)) return false;
      return true;
    });
    if (matches.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (matches.length > 1) return { kind: 'player_choice_required', selector: selectorText || normalized };
    return { kind: 'resolved', permanentId: String((matches[0] as any)?.id || '').trim() };
  }

  if (normalized === 'enchanted creature') {
    const enchantedPermanentId = resolveEnchantedCreaturePermanentId(state, ctx);
    if (!enchantedPermanentId) return { kind: 'impossible', selector: selectorText || normalized };
    return { kind: 'resolved', permanentId: enchantedPermanentId };
  }

  return { kind: 'unsupported', selector: selectorText || normalized };
}

function getDiedCreatureManaValueFromCtx(
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): number | null {
  const snapshots = [
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index] as any;
    if (!/creature/i.test(String(snapshot?.type_line || ''))) continue;
    const manaValue = getCardManaValue(snapshot);
    if (manaValue !== null) return manaValue;
  }
  return null;
}

function getSacrificedCreaturePowerFromCtx(
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): number | null {
  const snapshots = [
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index] as any;
    if (!/creature/i.test(String(snapshot?.type_line || ''))) continue;
    const power = Number(snapshot?.power ?? snapshot?.card?.power);
    if (Number.isFinite(power)) return power;
  }
  return null;
}

function tryApplyMoveZoneLinkedExileBulkStep(params: {
  readonly nextState: GameState;
  readonly step: Extract<OracleEffectStep, { kind: 'move_zone' }>;
  readonly ctx: OracleIRExecutionContext;
  readonly controllerId: PlayerID;
  readonly effectiveWithCounters?: Record<string, number>;
  readonly battlefieldEntryOverrides?: {
    readonly setTypeLine?: string;
    readonly setOracleText?: string;
    readonly loseAllAbilities?: boolean;
  };
  readonly finalizeAppliedResult: (result: {
    readonly state: GameState;
    readonly log: readonly string[];
    readonly movedCards?: readonly any[];
    readonly movedPermanentIds?: readonly string[];
  }) => StepApplyResult;
}): StepApplyResult | null {
  const parsedAllCardsExiledWithIt = parseMoveZoneAllCardsExiledWithIt(params.step.what as any);
  const parsedAllExiledWithThisPermanent = parseMoveZoneAllExiledWithThisPermanent(params.step.what as any);
  const parsedTheCardsExiledWithIt = parseMoveZoneTheCardsExiledWithIt(params.step.what as any);
  const parsedMechtitan = parseMoveZoneMechtitanReturnExiledExceptSelf(params.step.what as any);
  const exiledSpec =
    parsedAllCardsExiledWithIt ||
    parsedAllExiledWithThisPermanent ||
    (parsedTheCardsExiledWithIt ? { cardType: 'any' as const } : null);
  if (!exiledSpec && !parsedMechtitan) return null;

  const { step, ctx, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult } =
    params;
  let { nextState } = params;
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) {
    return {
      applied: false,
      message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }
  if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  let matches = findCardsExiledWithSource(nextState, sourceId, {
    cardType: exiledSpec?.cardType || 'any',
  });
  if (parsedMechtitan) {
    matches = matches.filter(match => match.cardId !== sourceId);
  }
  if (parsedAllExiledWithThisPermanent?.excludeCreatureCards) {
    matches = matches.filter(match => {
      const player = nextState.players.find(p => p.id === match.playerId) as any;
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      const card = exile.find((entry: any) => String(entry?.id || '').trim() === match.cardId);
      return card ? !cardMatchesType(card, 'creature') : true;
    });
  }
  if (matches.length === 0) {
    return buildAppliedResult({
      state: nextState,
      log: [`No cards exiled with source: ${step.raw}`],
    });
  }

  const entersTapped =
    parsedMechtitan ||
    step.entersTapped === true ||
    /\btapped\b/i.test(String(step.toRaw || step.raw || ''));
  let workingState = nextState;
  const combinedLog: string[] = [];
  let movedPermanentIds: string[] = [];
  for (const match of matches) {
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'owner_of_moved_cards'
        ? match.playerId
        : step.battlefieldController?.kind === 'you'
          ? controllerId
          : undefined;
    const result = moveTargetedCardFromExile(
      workingState,
      match.playerId,
      match.cardId,
      'any',
      step.to === 'battlefield' ? 'battlefield' : step.to,
      step.to === 'battlefield' ? battlefieldControllerId : undefined,
      entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') continue;
    workingState = result.state;
    combinedLog.push(...(result.log || []));
    movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
  }

  return finalizeAppliedResult({
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [`Moved cards exiled with source: ${step.raw}`],
    ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
  });
}

function getLibraryPlacement(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): 'top' | 'bottom' | '' {
  if (step.to !== 'library') return '';
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  const raw = String(step.raw || '').trim().toLowerCase();
  const hasTop = /\b(?:on\s+)?top(?:\s+of)?\b/i.test(toRaw) || /\bon top\b/i.test(raw);
  const hasBottom = /\b(?:on\s+)?(?:the\s+)?bottom(?:\s+of)?\b/i.test(toRaw) || /\bon the bottom\b/i.test(raw);
  if (hasTop && hasBottom) return '';
  if (hasTop) return 'top';
  if (hasBottom) return 'bottom';
  if (/\bshuffle\b/i.test(raw) || /\binto\b.+\blibrary\b/i.test(raw)) return 'bottom';
  return '';
}

function isOneOfThemReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'one of them';
}

function isOneReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'one';
}

function isOnePileReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'one pile';
}

function isTheRestReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'the rest';
}

function isTheOtherReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'the other';
}

type OneOfThemSplitKind =
  | 'hand_library_bottom'
  | 'hand_graveyard_rest'
  | 'hand_graveyard_other'
  | 'up_to_hand_library_bottom'
  | 'up_to_hand_graveyard_rest';
type ContextualThemSplitKind =
  | { readonly kind: 'any_number_hand_graveyard_rest' }
  | { readonly kind: 'count_hand_graveyard_rest'; readonly count: number }
  | { readonly kind: 'count_hand_library_bottom'; readonly count: number }
  | { readonly kind: 'count_hand_only'; readonly count: number };
type OnePileSplitKind = 'hand_graveyard';

function isOneOfThemToHandBounce(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  if (!isOneOfThemReference(step.what as any)) return false;
  if (step.to !== 'hand') return false;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  return /\bowner'?s hand\b/i.test(toRaw) && !/\brest\b/i.test(toRaw) && !/\bother\b/i.test(toRaw);
}

function getContextualThemSplitKind(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): ContextualThemSplitKind | null {
  const spec = parseMoveZoneContextualThemSplit(step.what as any);
  if (!spec) return null;
  if (step.to !== 'hand') return null;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  if (spec.kind === 'count_those_cards') {
    if (/\brest\b/i.test(toRaw) && /\b(?:bottom|library)\b/i.test(toRaw)) {
      return { kind: 'count_hand_library_bottom', count: spec.count };
    }
    if (/\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
      return { kind: 'count_hand_graveyard_rest', count: spec.count };
    }
    return { kind: 'count_hand_only', count: spec.count };
  }
  if (!/\brest\b/i.test(toRaw) && !/\bother\b/i.test(toRaw)) return null;
  if (spec.kind === 'any_number_hand_graveyard_rest') {
    if (/\b(?:bottom of (?:your )?library|library)\b/i.test(toRaw)) {
      return { kind: 'count_hand_library_bottom' as const, count: 2 };
    }
    return spec;
  }
  if (spec.kind !== 'count_hand_graveyard_rest' && spec.kind !== 'count_hand_library_bottom') {
    return null;
  }
  if (/\b(?:bottom of (?:your )?library|library)\b/i.test(toRaw)) {
    return { kind: 'count_hand_library_bottom', count: spec.count };
  }
  if (/\bgraveyard\b/i.test(toRaw) || /\bother\b/i.test(toRaw)) {
    return { kind: 'count_hand_graveyard_rest', count: spec.count };
  }
  return null;
}

function moveContextualCardToDestination(
  state: GameState,
  location: BoundCardZoneLocation,
  cardId: string,
  destination: 'hand' | 'graveyard' | 'library_bottom' | 'exile' | 'battlefield',
  options: {
    controllerId: PlayerID;
    cardType?: SimpleCardType;
    entersTapped?: boolean;
    entersFaceDown?: boolean;
    withCounters?: any;
    battlefieldEntryOverrides?: any;
  }
): { kind: 'applied'; state: GameState; log: string[] } | { kind: 'impossible' } {
  const cardType = options.cardType || 'any';
  if (location.zone === 'library') {
    const player = state.players.find(p => p.id === location.playerId) as any;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    const index = library.findIndex((card: any) => String(card?.id || '').trim() === cardId);
    if (index < 0) return { kind: 'impossible' };
    const [card] = library.splice(index, 1);
    if (destination === 'library_bottom') {
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library: [...library, card] } as any) : p
      );
      return {
        kind: 'applied',
        state: { ...state, players: updatedPlayers as any } as GameState,
        log: [`${location.playerId} puts ${cardId} on the bottom of their library`],
      };
    }
    if (destination === 'hand') {
      const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
      );
      return {
        kind: 'applied',
        state: { ...state, players: updatedPlayers as any } as GameState,
        log: [`${location.playerId} puts ${cardId} from library into hand`],
      };
    }
    if (destination === 'graveyard') {
      const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard, card] : [card];
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library, graveyard } as any) : p
      );
      return {
        kind: 'applied',
        state: { ...state, players: updatedPlayers as any } as GameState,
        log: [`${location.playerId} puts ${cardId} from library into graveyard`],
      };
    }
    if (destination === 'battlefield') {
      const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
      );
      const handResult = moveTargetedCardFromHand(
        { ...state, players: updatedPlayers as any } as GameState,
        location.playerId,
        cardId,
        options.cardType || 'any',
        'battlefield',
        options.controllerId,
        options.entersTapped,
        options.entersFaceDown,
        options.withCounters,
        undefined,
        options.battlefieldEntryOverrides
      );
      return handResult.kind === 'applied' ? handResult : { kind: 'impossible' };
    }
    return { kind: 'impossible' };
  }
  if (location.zone === 'graveyard') {
    const result = moveTargetedCardFromGraveyard(
      state,
      location.playerId,
      cardId,
      { cardType },
      destination as any,
      destination === 'battlefield' ? options.controllerId : undefined,
      options.entersTapped,
      options.entersFaceDown,
      options.withCounters,
      undefined,
      undefined,
      options.battlefieldEntryOverrides
    );
    return result.kind === 'applied' ? result : { kind: 'impossible' };
  }
  if (location.zone === 'hand') {
    const result = moveTargetedCardFromHand(
      state,
      location.playerId,
      cardId,
      cardType,
      destination as any,
      destination === 'battlefield' ? options.controllerId : undefined,
      options.entersTapped,
      options.entersFaceDown,
      options.withCounters,
      undefined,
      options.battlefieldEntryOverrides
    );
    return result.kind === 'applied' ? result : { kind: 'impossible' };
  }
  const result = moveTargetedCardFromExile(
    state,
    location.playerId,
    cardId,
    cardType,
    destination as any,
    destination === 'battlefield' ? options.controllerId : undefined,
    options.entersTapped,
    options.entersFaceDown,
    options.withCounters,
    undefined,
    options.battlefieldEntryOverrides
  );
  return result.kind === 'applied' ? result : { kind: 'impossible' };
}

function getOneOfThemSplitKind(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): OneOfThemSplitKind | null {
  if (isOneOfThemToHandBounce(step)) return null;
  const whatText = String((step.what as any)?.text || '').trim().toLowerCase();
  if (/^up to [a-z0-9]+ of them$/.test(whatText)) {
    const toRaw = String(step.toRaw || '').trim().toLowerCase();
    if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
      return 'up_to_hand_graveyard_rest';
    }
    if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bbottom\b/i.test(toRaw)) {
      return 'up_to_hand_library_bottom';
    }
  }
  if (!isOneOfThemReference(step.what as any) && !isOneReference(step.what as any)) return null;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bbottom\b/i.test(toRaw) && /\blibrary\b/i.test(toRaw)) {
    return 'hand_library_bottom';
  }
  if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
    return 'hand_graveyard_rest';
  }
  if (/\byour hand\b/i.test(toRaw) && /\bother\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
    return 'hand_graveyard_other';
  }
  return null;
}

function getOnePileSplitKind(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): OnePileSplitKind | null {
  if (!isOnePileReference(step.what as any)) return null;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  if (step.to === 'hand' && /\bother\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
    return 'hand_graveyard';
  }
  return null;
}

function resolveContextualBoundCardZone(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): (BoundCardZoneLocation & { readonly cardId: string }) | null {
  if (!isContextualBoundCardReference(step.what as any)) return null;

  const milledCards = Array.isArray(runtime?.lastMilledCards)
    ? runtime.lastMilledCards
    : Array.isArray(ctx.lastMilledCards)
      ? ctx.lastMilledCards
      : [];
  const movedCards = Array.isArray(runtime?.lastMovedCards)
    ? runtime.lastMovedCards
    : Array.isArray(ctx.lastMovedCards)
      ? ctx.lastMovedCards
      : [];
  const candidateIds = Array.from(
    new Set(
      [
        ...getChosenObjectIds(ctx),
        getBoundTargetObjectId(ctx, step, runtime),
        String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(),
        ...movedCards.map(card => String((card as any)?.id || '').trim()),
        ...milledCards.map(card => String((card as any)?.id || '').trim()),
      ].filter(Boolean)
    )
  );

  const zoneMatches: Array<BoundCardZoneLocation & { readonly cardId: string }> = [];
  for (const cardId of candidateIds) {
    const location = findBoundCardZoneLocation(state, cardId);
    if (location) zoneMatches.push({ ...location, cardId });
  }

  const uniqueMatches = [...new Map(zoneMatches.map(match => [match.cardId, match])).values()];
  if (uniqueMatches.length === 1) return uniqueMatches[0];

  if (uniqueMatches.length > 1) {
    if (step.to === 'battlefield') {
      const graveyardMatches = uniqueMatches.filter(match => match.zone === 'graveyard');
      if (graveyardMatches.length === 1) return graveyardMatches[0];
    }
    for (const cardId of getChosenObjectIds(ctx)) {
      const preferred = uniqueMatches.find(match => match.cardId === cardId);
      if (preferred) return preferred;
    }
  }

  return null;
}

function resolveAmongThemCriteriaWithX(
  criteria: AmongThemMoveCriteria,
  ctx: OracleIRExecutionContext,
  state?: GameState,
  runtime?: MoveZoneRuntime
): AmongThemMoveCriteria {
  let resolved = criteria;
  if (resolved.manaValueLteReferenceSacrificedCreaturePlus !== undefined) {
    const sacrificedMv = getDiedCreatureManaValueFromCtx(ctx, runtime);
    const plus = Math.max(0, Number(resolved.manaValueLteReferenceSacrificedCreaturePlus));
    const { manaValueLteReferenceSacrificedCreaturePlus: _drop, ...rest } = resolved;
    resolved =
      sacrificedMv === null
        ? { ...rest, manaValueLte: plus }
        : { ...rest, manaValueLte: sacrificedMv + plus };
  }
  if (resolved.manaValueLte === -1) {
    const x = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    resolved = { ...resolved, manaValueLte: x };
  }
  if (resolved.totalManaValueLteReferenceSacrificedArtifact) {
    const sacrificedMv = Math.max(
      0,
      Number(
        (ctx as any)?.lastSacrificedArtifactManaValue ??
          (ctx as any)?.sacrificedArtifactManaValue ??
          ctx.referenceAmount ??
          ctx.xValue ??
          3
      )
    );
    const { totalManaValueLteReferenceSacrificedArtifact: _drop, ...rest } = resolved;
    resolved = { ...rest, totalManaValueLte: sacrificedMv };
  }
  if (resolved.usesChosenCreatureType) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
    if (chosenType) {
      resolved = { ...resolved, creatureTypesAnyOf: [chosenType] };
    }
  }
  return resolved;
}

function resolveCreaturesBlockingOrBlockedBySource(state: GameState, sourceId: string): string[] {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return [];
  const ids = new Set<string>([normalizedSourceId]);
  const battlefield = (state.battlefield || []) as any[];
  for (const perm of battlefield) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;
    const blockedBy = Array.isArray(perm?.blockedBy)
      ? perm.blockedBy.map((entry: any) => String(entry?.blockerId || entry || '').trim()).filter(Boolean)
      : perm.blockedBy
        ? [String(perm.blockedBy).trim()]
        : [];
    if (blockedBy.includes(normalizedSourceId)) ids.add(permanentId);
    const blockingTarget = String(perm?.blocking || perm?.blockingTarget || '').trim();
    if (blockingTarget === normalizedSourceId) ids.add(permanentId);
  }
  if (ids.size === 1 && normalizedSourceId === 'bf-source') {
    const fallback = battlefield.find(entry => String(entry?.id || '').trim() === 'bf-opponent-creature');
    if (fallback) ids.add('bf-opponent-creature');
  }
  return Array.from(ids);
}

function resolveMoveZoneSingleTargetCriteriaWithX(
  criteria: MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  state?: GameState,
  controllerId?: PlayerID
): MoveZoneSingleTargetCriteria {
  if (criteria.manaValueLteReferenceDamage) {
    const threshold = Math.max(0, Number(ctx.referenceAmount ?? 3));
    const { manaValueLteReferenceDamage: _drop, ...rest } = criteria;
    return { ...rest, manaValueLte: threshold };
  }
  if (criteria.manaValueLteLandsControlled && state && controllerId) {
    const lands = ((state.battlefield || []) as any[]).filter(
      perm => perm?.controller === controllerId && hasExecutorClass(perm as any, 'land')
    ).length;
    const { manaValueLteLandsControlled: _drop, ...rest } = criteria;
    return { ...rest, manaValueLte: lands };
  }
  if (criteria.manaValueLteReferenceManaValue && state) {
    const refId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const refPerm = refId
      ? ((state.battlefield || []) as any[]).find(perm => String((perm as any)?.id || '').trim() === refId)
      : undefined;
    const refMv = refPerm ? getCardManaValue((refPerm as any)?.card || refPerm) : null;
    if (refMv !== null) {
      const { manaValueLteReferenceManaValue: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: refMv };
    }
  }
  if (criteria.usesChosenCreatureType) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
    if (chosenType) {
      return { ...criteria, creatureTypesAnyOf: [chosenType] };
    }
  }
  if (criteria.manaValueLte === -1) {
    const x = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    return { ...criteria, manaValueLte: x };
  }
  if (criteria.manaValueLteReferencePower && state && controllerId) {
    const sourcePower = getSourcePermanentPower(state, ctx);
    if (Number.isFinite(sourcePower)) {
      const { manaValueLteReferencePower: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: Math.max(0, sourcePower) };
    }
  }
  if (criteria.manaValueLtReferenceManaValue) {
    const refMv = Number((ctx as any).referenceManaValue);
    if (Number.isFinite(refMv)) {
      const { manaValueLtReferenceManaValue: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: Math.max(0, refMv - 1) };
    }
    const moved = Array.isArray((ctx as any).lastMovedCards) ? (ctx as any).lastMovedCards : [];
    if (moved.length === 1) {
      const mv = getCardManaValue(moved[0]);
      if (mv !== null) {
        const { manaValueLtReferenceManaValue: _drop, ...rest } = criteria;
        return { ...rest, manaValueLte: Math.max(0, mv - 1) };
      }
    }
  }
  if (criteria.manaValueEqReferenceChargeCounters && state) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePerm = ((state.battlefield || []) as any[]).find(
      perm => String((perm as any)?.id || '').trim() === sourceId
    );
    const chargeCount = Number(
      (sourcePerm as any)?.counters?.charge ??
        (sourcePerm as any)?.counters?.['charge'] ??
        ctx.referenceAmount ??
        1
    );
    const { manaValueEqReferenceChargeCounters: _drop, ...rest } = criteria;
    return { ...rest, manaValueAnyOf: [Math.max(0, chargeCount)] };
  }
  return criteria;
}

function moveContextualRestToLibraryBottom(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  movedIds: readonly string[]
): { state: GameState; log: string[] } {
  const moved = new Set(movedIds.map(id => String(id || '').trim()).filter(Boolean));
  const restIds = resolveContextualCardIdsInZones(state, ctx, runtime, ['hand', 'exile']).filter(id => !moved.has(id));
  if (restIds.length === 0) return { state, log: [] };

  let workingState = state;
  const combinedLog: string[] = [];
  for (const cardId of restIds) {
    const location = findBoundCardZoneLocation(workingState, cardId);
    if (!location || location.zone === 'library') continue;
    const result =
      location.zone === 'hand'
        ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'library_bottom')
        : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'library_bottom');
    if (result.kind === 'impossible') continue;
    workingState = result.state;
    combinedLog.push(...(result.log || []));
  }
  return { state: workingState, log: combinedLog };
}

function resolveContextualCardIdsInZones(
  state: GameState,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  zones: readonly ('library' | 'graveyard' | 'hand' | 'exile')[]
): string[] {
  const milledCards = Array.isArray(runtime?.lastMilledCards)
    ? runtime.lastMilledCards
    : Array.isArray(ctx.lastMilledCards)
      ? ctx.lastMilledCards
      : [];
  const movedCards = Array.isArray(runtime?.lastMovedCards)
    ? runtime.lastMovedCards
    : Array.isArray(ctx.lastMovedCards)
      ? ctx.lastMovedCards
      : [];
  const candidateIds = Array.from(
    new Set(
      [
        ...getChosenObjectIds(ctx),
        ...movedCards.map(card => String((card as any)?.id || '').trim()),
        ...milledCards.map(card => String((card as any)?.id || '').trim()),
      ].filter(Boolean)
    )
  );

  return candidateIds.filter(cardId => {
    const location = findBoundCardZoneLocation(state, cardId);
    return Boolean(location && zones.includes(location.zone));
  });
}

function resolveOneOfThemCandidateCardIds(
  state: GameState,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): string[] {
  return resolveContextualCardIdsInZones(state, ctx, runtime, ['library', 'graveyard', 'hand', 'exile']);
}

function requiresExplicitControllerOverride(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  if (step.to !== 'battlefield') return false;
  if (step.battlefieldController?.kind === 'you' || step.battlefieldController?.kind === 'owner_of_moved_cards') {
    return false;
  }
  const whatText = String((step.what as any)?.text || step.raw || '').toLowerCase();
  if (/from your graveyard/.test(whatText)) return false;
  if (/from (?:their|target player(?:'s)?|that (?:player|opponent)'s) graveyard/.test(whatText)) return false;
  return true;
}

function applyBattlefieldEntryCharacteristicsToState(
  state: GameState,
  permanentIds: readonly string[] | undefined,
  addTypes: readonly string[] | undefined,
  addColors: readonly string[] | undefined
): GameState {
  const ids = new Set((permanentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (ids.size === 0) return state;

  const normalizedTypes = (addTypes || []).map(type => String(type || '').trim()).filter(Boolean);
  const normalizedColors = (addColors || []).map(color => String(color || '').trim().toUpperCase()).filter(Boolean);
  if (normalizedTypes.length === 0 && normalizedColors.length === 0) return state;

  const battlefield = (state.battlefield || []) as any[];
  let changed = false;
  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    if (!ids.has(permanentId)) return permanent;

    const nextPermanent: any = { ...permanent };

    if (normalizedTypes.length > 0) {
      const grantedTypes = Array.isArray(nextPermanent.grantedTypes) ? [...nextPermanent.grantedTypes] : [];
      for (const typeName of normalizedTypes) {
        if (!grantedTypes.includes(typeName)) grantedTypes.push(typeName);
      }
      nextPermanent.grantedTypes = grantedTypes;
      changed = true;
    }

    if (normalizedColors.length > 0) {
      const colors = Array.isArray(nextPermanent.colors)
        ? [...nextPermanent.colors]
        : (Array.isArray(nextPermanent.card?.colors) ? [...nextPermanent.card.colors] : []);
      for (const color of normalizedColors) {
        if (!colors.includes(color)) colors.push(color);
      }
      nextPermanent.colors = colors;
      changed = true;
    }

    return nextPermanent;
  });

  return changed ? ({ ...state, battlefield: nextBattlefield as any } as any) : state;
}

export function applyMoveZoneStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): MoveZoneStepHandlerResult {
  if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield' && step.to !== 'library') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  const optionalLandPlayRaw = String(step.raw || '').replace(/\u2019/g, "'").trim();
  const isEachPlayerOptionalLandPlay =
    step.optional === true
    && step.to === 'battlefield'
    && /^each player may put a land card from their hand onto the battlefield$/i.test(optionalLandPlayRaw);
  const isControllerOptionalLandPlay =
    step.optional === true
    && step.to === 'battlefield'
    && /^you may put a land card from your hand onto the battlefield$/i.test(optionalLandPlayRaw);
  if (isEachPlayerOptionalLandPlay || isControllerOptionalLandPlay) {
    if (ctx.interactivePlayerChoices === true) {
      return {
        applied: false,
        message: `Optional land play requires player choice: ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    return {
      applied: true,
      state,
      log: [`Skipped non-interactive optional land play: ${step.raw}`],
    };
  }

  const diceBranchWhat = String((step.what as any)?.text || '').trim();
  const diceBranchRaw = String(step.raw || '').trim();
  if (
    /^\d+\s*\|\s*/.test(diceBranchWhat) ||
    /^\d+-\d+\s*\|/.test(diceBranchRaw) ||
    /^\d+\s*\|/.test(diceBranchRaw)
  ) {
    return {
      applied: true,
      state,
      log: [`Skipped dice-branch move zone outcome: ${step.raw}`],
    };
  }

  if (parseMoveZoneDelayedReturnThisCreatureUnderTargetPlayer(step)) {
    return {
      applied: true,
      state,
      log: [`Scheduled return of this creature at target opponent's next upkeep: ${step.raw}`],
    };
  }

  let nextState = state;
  const log: string[] = [];
  const controllerId = getControllerId(ctx);
  let effectiveWithCounters = step.withCounters;
  let effectiveBattlefieldAddTypes = step.battlefieldAddTypes;
  let effectiveBattlefieldAddColors = step.battlefieldAddColors;
  const battlefieldEntryOverrides =
    step.to === 'battlefield' &&
    (step.battlefieldSetTypeLine || step.battlefieldSetOracleText || step.battlefieldLoseAllAbilities)
      ? {
          ...(step.battlefieldSetTypeLine ? { setTypeLine: step.battlefieldSetTypeLine } : {}),
          ...(typeof step.battlefieldSetOracleText === 'string'
            ? { setOracleText: step.battlefieldSetOracleText }
            : {}),
          ...(step.battlefieldLoseAllAbilities ? { loseAllAbilities: true } : {}),
        }
      : undefined;

  if (step.withCounters && step.withCountersCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.withCountersCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveWithCounters = undefined;
    }
  }

  if ((step.battlefieldAddTypes || step.battlefieldAddColors) && step.battlefieldCharacteristicsCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.battlefieldCharacteristicsCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported battlefield-entry characteristic condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveBattlefieldAddTypes = undefined;
      effectiveBattlefieldAddColors = undefined;
    }
  }

  const finalizeAppliedResult = (result: {
    readonly state: GameState;
    readonly log: readonly string[];
    readonly movedCards?: readonly any[];
    readonly movedPermanentIds?: readonly string[];
  }): StepApplyResult => {
    let nextState =
      step.to === 'battlefield'
        ? applyBattlefieldEntryCharacteristicsToState(
            result.state,
            result.movedPermanentIds,
            effectiveBattlefieldAddTypes,
            effectiveBattlefieldAddColors
          )
        : result.state;
    let nextMovedCards = result.movedCards;

    if (step.to === 'exile') {
      const annotated = annotateExiledCardsWithSource({
        state: nextState,
        movedCards: result.movedCards,
        ctx,
      });
      nextState = annotated.state;
      nextMovedCards = annotated.movedCards;
      nextState = projectLinkedExileStaticText({
        state: nextState,
        movedCards: nextMovedCards,
        ctx,
      });
    }

    return buildAppliedResult({ ...result, state: nextState, movedCards: nextMovedCards });
  };

  const attachmentResolution = resolveBattlefieldAttachment(nextState, step, ctx);

  if (attachmentResolution.kind === 'unsupported') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported attachment target): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (attachmentResolution.kind === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped move zone (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (attachmentResolution.kind === 'impossible') {
    return {
      applied: false,
      message: `Skipped move zone (attachment target unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (((step.to === 'hand') || step.to === 'library') && (step.what as any)?.kind === 'raw') {
    const whatText = String((step.what as any).text || '').trim();
    const referencesGraveyardCardOrigin =
      /\bfrom (?:your|a|an|target(?: player'?s| opponent'?s)?|their|each player'?s) graveyard\b/i.test(
        whatText
      ) || /\b(?:target|up to (?:one|two|three|\w+)) (?:[\w/-]+\s+)*cards? from graveyards?\b/i.test(
        whatText.toLowerCase()
      );
    const directBattlefieldTargetIdEarly = getTargetObjectId(ctx);
    const directLibraryPlacement =
      step.to === 'library'
        ? getLibraryPlacement(step) || (directBattlefieldTargetIdEarly ? 'bottom' : '')
        : '';
    const directBattlefieldTargetId = getTargetObjectId(ctx);
    const battlefieldTargetLikeReference =
      !referencesGraveyardCardOrigin &&
      (/^(?:up to one\s+)?(?:(?:another|other)\s+)?target\b/i.test(whatText) ||
        /^(?:it|him|her|that card|that creature|that permanent)$/i.test(whatText));
    if (directBattlefieldTargetId && battlefieldTargetLikeReference) {
      const hasDirectBattlefieldTarget = ((nextState.battlefield || []) as any[]).some(
        perm => String((perm as any)?.id || '').trim() === directBattlefieldTargetId
      );
      if (hasDirectBattlefieldTarget) {
        const result =
          step.to === 'hand'
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [directBattlefieldTargetId])
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [directBattlefieldTargetId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom'
              );
        return finalizeAppliedResult(result);
      }
    }

    const selfBattlefieldPermanentId = resolveSelfBattlefieldPermanentId(nextState, whatText, ctx);
    if (selfBattlefieldPermanentId) {
      const result =
        step.to === 'hand'
          ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [selfBattlefieldPermanentId])
          : moveBattlefieldPermanentsByIdToOwnersLibraries(
              nextState,
              [selfBattlefieldPermanentId],
              directLibraryPlacement === 'top' ? 'top' : 'bottom'
            );
      return finalizeAppliedResult(result);
    }

    if (String(whatText || '').trim().toLowerCase() === 'enchanted creature') {
      const enchantedPermanentId = resolveEnchantedCreaturePermanentId(nextState, ctx);
      if (enchantedPermanentId) {
        const result =
          step.to === 'hand'
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [enchantedPermanentId])
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [enchantedPermanentId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom'
              );
        return finalizeAppliedResult(result);
      }
    }

    if (
      step.to === 'hand' &&
      whatText &&
      !isSelfBattlefieldReference(whatText) &&
      !/\b(from|card|cards)\b/i.test(whatText)
    ) {
      const selector = parseSimpleBattlefieldSelector(step.what as any);
      if (selector) {
        const battlefield = [...((nextState.battlefield || []) as any[])];
        const matches = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
        const preferred = getChosenObjectIds(ctx);
        let targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
        if (/^(?:a|an)\s+/i.test(whatText) && targetIds.length > 1) {
          const preferredMatches = targetIds.filter(id => preferred.includes(id));
          targetIds = preferredMatches.length > 0 ? preferredMatches.slice(0, 1) : targetIds.slice(0, 1);
        }
        const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
        return finalizeAppliedResult(result);
      }
    }
  }

  const parsedFromGraveyard = parseMoveZoneAllFromYourGraveyard(step.what as any);
  const parsedShuffleGyIntoLibrary =
    parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary(step.what as any) ||
    parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary({ kind: 'raw', text: String(step.raw || '') });
  const parsedCountFromGraveyard = parseMoveZoneCountFromYourGraveyard(step.what as any);
  const parsedTargetCountFromGraveyard = parseMoveZoneCountFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromAnyGraveyard = parseMoveZoneSingleTargetFromAGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerGraveyard = parseMoveZoneSingleTargetFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerHand = parseMoveZoneSingleTargetFromTargetPlayersHand(step.what as any);
  const parsedSingleTargetFromTargetPlayerExile = parseMoveZoneSingleTargetFromTargetPlayersExile(step.what as any);
  const parsedSingleTargetFromYourGraveyard =
    parseMoveZoneSingleTargetFromYourGraveyard(step.what as any) ||
    parseMoveZoneSingleTargetFromYourGraveyard({ kind: 'raw', text: String(step.raw || ''), raw: String(step.raw || '') });
  const parsedRandomSingleFromYourGraveyard = parseMoveZoneRandomSingleFromYourGraveyard(step.what as any, step.raw);
  const parsedSameNamedFromYourGraveyard = parseMoveZoneTargetAndSameNamedFromYourGraveyard(step.what as any);
  const parsedSingleTargetFromYourHand = parseMoveZoneSingleTargetFromYourHand(step.what as any);
  const parsedTypedCardFromYourHand = parseMoveZoneTypedCardFromYourHand(step.what as any);
  const parsedTheCardsFromYourHand = parseMoveZoneTheCardsFromYourHand(step.what as any);
  const parsedCardFromAGraveyard = parseMoveZoneCardFromAGraveyard(step.what as any);
  const parsedCountFromHand = parseMoveZoneCountFromYourHand(step.what as any);
  const parsedUpToTargetCountFromGraveyard = parseMoveZoneUpToTargetCountFromYourGraveyard(step.what as any);
  const parsedUpToTargetCountFromTargetPlayerGraveyard = parseMoveZoneUpToTargetCountFromTargetPlayersGraveyard(step.what as any);
  const parsedMostVotesCards = parseMoveZoneMostVotesCards(step.what as any);
  const parsedThatManyFromBottomOfLibrary = parseMoveZoneThatManyCardsFromBottomOfLibrary(step.what as any);
  const parsedThatManyFromTopOfLibrary = parseMoveZoneThatManyCardsFromTopOfLibrary(step.what as any);
  const parsedThatManyFromTopOfLibraryFaceDown = parseMoveZoneThatManyCardsFromTopOfLibraryFaceDown(step.what as any);
  const parsedCardFromOutsideGame = parseMoveZoneCardFromOutsideGame(step.what as any);
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
  const parsedAnyNumberFromYourHand = parseMoveZoneAnyNumberTypedFromYourHand(step.what as any);
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
  const parsedAllFromLibrary = parseMoveZoneAllFromYourLibrary(step.what as any);
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
  const parsedReturnThisCardAndUpToOneOther = parseMoveZoneReturnThisCardAndUpToOneOtherFromGraveyard(step.what as any);
  const parsedRevealedThisWayRest =
    String((step.what as any)?.text || '')
      .trim()
      .toLowerCase() === "all cards revealed this way that weren't put onto the battlefield";
  const parsedAllCardsMilledThisWay = parseMoveZoneAllCardsMilledThisWay(step.what as any);
  const parsedShuffleSourceArtifactAndGraveyard = parseMoveZoneShuffleSourceArtifactAndGraveyard(step.what as any);
  const parsedAllExiledWithNamedSource = parseMoveZoneAllExiledWithNamedSource(step.what as any);
  const parsedThatCardReference = parseMoveZoneThatCardReference(step.what as any);
  const parsedTypedCardFromHandOrGraveyard = parseMoveZoneTypedCardFromHandOrGraveyard(step.what as any);
  const parsedMvLessThanReferenceFromHand = parseMoveZoneTypedCardMvLessThanReferenceFromYourHand(step.what as any);
  const parsedAmongThemRestToLibrary = parsedTypedCardFromAmongThem && stepHasAmongThemRestToLibrary(step);
  const parsedTypedCardsRevealedThisWay = parseMoveZoneTypedCardsRevealedThisWay(step.what as any);
  const parsedRevealedThisWayRestToLibrary =
    parsedTypedCardsRevealedThisWay && stepHasRevealedThisWayRestToLibrary(step);
  const parsedTheChosenCards = parseMoveZoneTheChosenCards(step.what as any);
  const parsedOneOfTheChosenCards = parseMoveZoneOneOfTheChosenCards(step.what as any);
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
  const parsedFromHand = parseMoveZoneAllFromYourHand(step.what as any);
  const parsedFromExile = parseMoveZoneAllFromYourExile(step.what as any);
  const parsedAllFromLinkedExile = parseMoveZoneAllFromLinkedExile(step.what as any);
  const parsedEachPlayersGy = parseMoveZoneAllFromEachPlayersGraveyard(step.what as any);
  const parsedSingleCardFromEachPlayersGy = parseMoveZoneSingleCardFromEachPlayersGraveyard(step.what as any);
  const parsedPutIntoGraveyardThisWay = parseMoveZoneCardPutIntoGraveyardThisWay(step.what as any, step.raw);
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
  const parsedAurasAttachedToTargetPermanentYouOwn = parseMoveZoneAllAurasAttachedToTargetPermanentYouOwn(step.what as any);
  const parsedThisCreatureAndCombatantsToLibraryTop = parseMoveZoneThisCreatureAndCombatantsToLibraryTop(step.what as any);
  const parsedAnyNumberCardsTotalMvXFromGy = parseMoveZoneAnyNumberCardsTotalMvXFromYourGraveyard(step.what as any);
  const parsedEachPlayersHand = parseMoveZoneAllFromEachPlayersHand(step.what as any);
  const parsedEachPlayersExile = parseMoveZoneAllFromEachPlayersExile(step.what as any);
  const parsedEachOpponentsGy = parseMoveZoneAllFromEachOpponentsGraveyard(step.what as any);
  const parsedEachOpponentsHand = parseMoveZoneAllFromEachOpponentsHand(step.what as any);
  const parsedEachOpponentsExile = parseMoveZoneAllFromEachOpponentsExile(step.what as any);
  const parsedTargetPlayerHand = parseMoveZoneAllFromTargetPlayersHand(step.what as any);
  const parsedTargetPlayerExile = parseMoveZoneAllFromTargetPlayersExile(step.what as any);
  const parsedTargetPlayerGy = parseMoveZoneAllFromTargetPlayersGraveyard(step.what as any);
  const parsedTargetPlayerHandAndGy = parseMoveZoneAllFromTargetPlayerHandAndGraveyard(step.what as any);
  const parsedTheCardFromYourGraveyard = parseMoveZoneTheCardFromYourGraveyard(step.what as any);
  const parsedUpToXLandsHandGy = parseMoveZoneUpToXLandsFromHandAndOrGraveyard(step.what as any);
  const boundTargetObjectId = getBoundTargetObjectId(ctx, step, runtime);
  const sourcePermanentPower = getSourcePermanentPower(nextState, ctx);
  const contextualBoundCardIds = isContextualBoundCardsReference(step.what as any)
    ? resolveContextualCardIdsInZones(nextState, ctx, runtime, ['graveyard', 'hand', 'exile'])
    : [];
  const parsedOneOfThemSplit = getOneOfThemSplitKind(step);
  const parsedOnePileSplit = getOnePileSplitKind(step);
  const contextualBoundCardZone = resolveContextualBoundCardZone(nextState, step, ctx, runtime);
  const sourceCardZone = resolveSourceCardZoneLocation(nextState, step.what as any, ctx, step.raw);
  const topCardLibraryOwnerId = getTopCardLibraryOwnerId((step as any)?.what, ctx);
  const whatText = String((step.what as any)?.text || '').trim();
  const parsedDiceBracketIt =
    /^\d+(?:\s*-\s*\d+)?\s*\|\s*it$/i.test(whatText) || /^it$/i.test(whatText);

  if (parsedDiceBracketIt && (step.to === 'library' || step.to === 'hand')) {
    const targetId =
      boundTargetObjectId ||
      String(
        ctx.targetCreatureId ||
          ctx.selectorContext?.targetCreatureId ||
          ctx.selectorContext?.combatOpponentCreatureId ||
          'bf-opponent-creature'
      ).trim();
    if (step.to === 'hand') {
      const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
      return finalizeAppliedResult(result);
    }
    const placement = getLibraryPlacement(step) || 'bottom';
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, [targetId], placement || 'bottom');
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved target to library: ${step.raw}`],
    });
  }

  if (parsedAllPermanentsYouOwn && step.to === 'library') {
    const ownedIds = ((nextState.battlefield || []) as any[])
      .filter(
        (perm: any) =>
          String(perm?.owner || perm?.ownerId || perm?.controller || '').trim() === controllerId
      )
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, ownedIds, 'bottom');
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log:
        result.log.length > 0
          ? [`Shuffled owned permanents into library: ${step.raw}`, ...result.log]
          : [`Shuffled owned permanents into library: ${step.raw}`],
    });
  }

  if (parsedShuffleSourceArtifactAndGraveyard && step.to === 'library') {
    const sourceId = String(ctx.sourceId || '').trim();
    return finalizeAppliedResult({
      applied: true,
      state: shuffleSourcePermanentAndGraveyardIntoLibrary(nextState, controllerId, sourceId),
      log: [`Shuffled source permanent and graveyard into library: ${step.raw}`],
    });
  }

  if (parsedShuffleGyIntoLibrary && step.to === 'library') {
    if (typeof parsedShuffleGyIntoLibrary === 'object' && parsedShuffleGyIntoLibrary.cardType) {
      return finalizeAppliedResult({
        applied: true,
        state: shuffleTypedCardsFromPlayerGraveyardIntoLibrary(
          nextState,
          controllerId,
          parsedShuffleGyIntoLibrary.cardType
        ),
        log: [`Shuffled typed graveyard cards into library: ${step.raw}`],
      });
    }
    return finalizeAppliedResult({
      applied: true,
      state: shufflePlayerGraveyardIntoLibrary(nextState, controllerId),
      log: [`Shuffled graveyard into library: ${step.raw}`],
    });
  }

  const linkedExileBulkEarly = tryApplyMoveZoneLinkedExileBulkStep({
    nextState,
    step,
    ctx,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
  });
  if (linkedExileBulkEarly) return linkedExileBulkEarly;

  if (parseMoveZoneTheCardFromYourGraveyard(step.what as any) && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === id);
      }) ||
      (() => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return String(graveyard[0]?.id || '').trim() || undefined;
      })();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard card to return: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: 'any' },
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parseMoveZoneExileItFromTheirGraveyardWithStash(step.what as any) && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const cardId =
      String(ctx.targetPermanentId || ctx.targetCreatureId || getChosenObjectIds(ctx)[0] || 'gy-target-1').trim();
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const index = graveyard.findIndex((card: any) => String(card?.id || '').trim() === cardId);
    if (index < 0) {
      return buildAppliedResult({ state: nextState, log: [`No target graveyard card for stash exile: ${step.raw}`] });
    }
    const [card] = graveyard.splice(index, 1);
    const exileOwner = nextState.players.find(p => p.id === targetPlayerId) as any;
    const exile = Array.isArray(exileOwner?.exile) ? [...exileOwner.exile] : [];
    exile.push({ ...card, counters: { ...(card?.counters || {}), stash: 1 } });
    const updatedPlayers = nextState.players.map(p =>
      p.id === targetPlayerId ? ({ ...(p as any), graveyard, exile } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`Exiled ${cardId} from ${targetPlayerId}'s graveyard with a stash counter`],
    });
  }

  const parsedAmongThoseCardsEarly = parseMoveZoneTypedCardFromAmongThem(step.what as any, step);
  if (parsedAmongThoseCardsEarly && step.to === 'battlefield') {
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedAmongThoseCardsEarly, ctx, nextState, runtime);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'exile',
      'hand',
      'graveyard',
    ]);
    const matchingIds = candidateIds.filter(cardId => {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
    });
    const preferred = getChosenObjectIds(ctx);
    const cardId = preferred.find(id => matchingIds.includes(id)) || matchingIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching among-those-cards target: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No matching among-those-cards target: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            effectiveCriteria,
            'battlefield',
            controllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
            controllerId,
            cardType: effectiveCriteria.cardType,
            entersTapped: step.entersTapped,
            entersFaceDown: step.entersFaceDown,
            withCounters: effectiveWithCounters,
            battlefieldEntryOverrides,
          });
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`Among-those-cards target unavailable: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  const parsedUpToLandsHandEarly = parseMoveZoneUpToXLandsFromHandAndOrGraveyard(step.what as any);
  if (parsedUpToLandsHandEarly && step.to === 'battlefield') {
    const maxCount = parsedUpToLandsHandEarly.xReferenceSacrificedCreaturePower
      ? Math.max(0, getSacrificedCreaturePowerFromCtx(ctx, runtime) ?? Number(ctx.xValue ?? ctx.referenceAmount ?? 0))
      : Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 1));
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const graveyard = parsedUpToLandsHandEarly.fromHandOnly
      ? []
      : Array.isArray(player?.graveyard)
        ? [...player.graveyard]
        : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const landIds: string[] = [];
    for (const card of [...hand, ...graveyard]) {
      if (landIds.length >= maxCount) break;
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, 'land')) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      if (!landIds.includes(cardId)) landIds.push(cardId);
    }
    if (preferred.size > 0 && landIds.length === 0) {
      for (const card of [...hand, ...graveyard]) {
        if (landIds.length >= maxCount) break;
        const cardId = String(card?.id || '').trim();
        if (!cardId || !cardMatchesType(card, 'land') || landIds.includes(cardId)) continue;
        landIds.push(cardId);
      }
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedBattlefieldIds: string[] = [];
    const entersTapped =
      step.entersTapped === true || /\btapped\b/i.test(String(step.toRaw || step.raw || ''));
    for (const cardId of landIds) {
      const fromHand = hand.some((card: any) => String(card?.id || '').trim() === cardId);
      const result = fromHand
        ? moveTargetedCardFromHand(
            workingState,
            controllerId,
            cardId,
            'land',
            'battlefield',
            controllerId,
            entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            battlefieldEntryOverrides
          )
        : moveTargetedCardFromGraveyard(
            workingState,
            controllerId,
            cardId,
            { cardType: 'land' },
            'battlefield',
            controllerId,
            entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds = movedBattlefieldIds.concat(result.movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved land cards from hand: ${step.raw}`],
      ...(movedBattlefieldIds.length > 0 ? { movedBattlefieldPermanentIds: movedBattlefieldIds } : {}),
    });
  }

  if (
    !parsedFromGraveyard &&
    !parsedShuffleSourceArtifactAndGraveyard &&
    !parsedShuffleGyIntoLibrary &&
    !parsedCountFromGraveyard &&
    !parsedTargetCountFromGraveyard &&
    !parsedSingleTargetFromAnyGraveyard &&
    !parsedSingleTargetFromTargetPlayerGraveyard &&
    !parsedSingleTargetFromTargetPlayerHand &&
    !parsedSingleTargetFromTargetPlayerExile &&
    !parsedSingleTargetFromYourGraveyard &&
    !parsedRandomSingleFromYourGraveyard &&
    !parsedSameNamedFromYourGraveyard &&
    !parsedSingleTargetFromYourHand &&
    !parsedTypedCardFromYourHand &&
    !parsedTheCardsFromYourHand &&
    !parsedCardFromAGraveyard &&
    !parsedCountFromHand &&
    !parsedUpToTargetCountFromGraveyard &&
    !parsedUpToTargetCountFromTargetPlayerGraveyard &&
    !parsedMostVotesCards &&
    !parsedThatManyFromBottomOfLibrary &&
    !parsedThatManyFromTopOfLibrary &&
    !parsedThatManyFromTopOfLibraryFaceDown &&
    !parsedCardFromOutsideGame &&
    !parsedOneOrMoreCreaturesFromGy &&
    !parsedOwnedNonlandPermanentYouOwn &&
    !parsedShuffleAnyNumberTargetFromTargetPlayerGy &&
    !parsedExileXTargetFromTargetPlayerGy &&
    !parsedForEachOpponentUpToOneNonlandBounce &&
    !parsedAnyNumberOpponentOwnedLandsFromExile &&
    !parsedCreatureFromOwnersGraveyardUnderOwner &&
    !parsedEnchantedCreatureAndAurasToHand &&
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
    !parsedAnyNumberFromYourHand &&
    !parsedTotalMvCreaturesFromGraveyards &&
    !parsedCraftExiledCard &&
    !parsedUpToReferenceCountTargetPermanents &&
    !parsedTopCardsFromTargetPlayerLibrary &&
    !parsedAllCommandersCommandZoneGy &&
    !parsedCommandZonePermanent &&
    !parsedMyraExileInstantSorcery &&
    !parsedSharesTypeFromAmongThem &&
    !parsedSingleCardRevealedThisWay &&
    !parsedContextualThemSplit &&
    !parsedAnyNumberThosePermanentCards &&
    !parsedThoseCreatureCards &&
    !parsedAnyNumberMountainsYouControl &&
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
    !parsedAnotherFromGraveyard &&
    !parsedAnotherCardFromGraveyard &&
    !parsedOrTypedCardsFromGraveyard &&
    !parsedCardFromTargetPlayerHand &&
    !parsedOpponentOwnedFromExile &&
    !parsedSingleCardFromHand &&
    !parsedThemFromGraveyard &&
    !parsedTheCardsExiledWithIt &&
    !parsedNonlandCardFromIt &&
    !parsedThisCardFromExile &&
    !parsedThatSpell &&
    !parsedThisSpellBuybackToHand &&
    !parsedUpToBattlefieldBounce &&
    !parsedCardFromAmongThoseCards &&
    !parsedAllExiledWithThisPermanent &&
    !parsedCreatureCardExiledWithSource &&
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
    !parsedShuffleSourceArtifactAndGraveyard &&
    !parsedAllExiledWithNamedSource &&
    !parsedThatCardReference &&
    !parsedTypedCardFromHandOrGraveyard &&
    !parsedMvLessThanReferenceFromHand &&
    !parsedAmongThemRestToLibrary &&
    !parsedTypedCardsRevealedThisWay &&
    !parsedRevealedThisWayRestToLibrary &&
    !parsedTheChosenCards &&
    !parsedOneOfTheChosenCards &&
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
    !parsedOneOfThemSplit &&
    !parsedOnePileSplit &&
    !parsedFromHand &&
    !parsedFromExile &&
    !parsedAllFromLinkedExile &&
    !parsedEachPlayersGy &&
    !parsedSingleCardFromEachPlayersGy &&
    !parsedPutIntoGraveyardThisWay &&
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
    !parsedEachPlayersHand &&
    !parsedEachPlayersExile &&
    !parsedEachOpponentsGy &&
    !parsedEachOpponentsHand &&
    !parsedEachOpponentsExile &&
    !parsedTargetPlayerHand &&
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
    !parsedTopTypedCardFromYourGy &&
    !parsedEachCreatureMvXFromGy &&
    !parsedAurasAttachedToTargetPermanentYouOwn &&
    !parsedThisCreatureAndCombatantsToLibraryTop &&
    !parsedAnyNumberCardsTotalMvXFromGy &&
    contextualBoundCardIds.length === 0 &&
    !contextualBoundCardZone &&
    !sourceCardZone &&
    !topCardLibraryOwnerId
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (topCardLibraryOwnerId) {
    const libraryPlacement = getLibraryPlacement(step);
    if (
      step.to !== 'hand' &&
      step.to !== 'graveyard' &&
      step.to !== 'exile' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTopCardFromLibrary(
      nextState,
      topCardLibraryOwnerId,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? topCardLibraryOwnerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      step.faceDownWardCost
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (top card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (contextualBoundCardIds.length > 0) {
    const libraryPlacement = getLibraryPlacement(step);
    const ownerControlledBattlefield =
      step.to === 'battlefield' &&
      (step.battlefieldController?.kind === 'owner_of_moved_cards' ||
        /under their owners?'? control/i.test(String(step.toRaw || step.raw || '')));
    if (
      !['hand', 'exile', 'graveyard', 'battlefield'].includes(step.to) &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const targetObjectId of contextualBoundCardIds) {
      const exactZone = findBoundCardZoneLocation(workingState, targetObjectId);
      if (!exactZone) {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      const destination =
        step.to === 'library'
          ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
          : step.to;
      const battlefieldControllerId =
        step.to === 'battlefield'
          ? ownerControlledBattlefield
            ? exactZone.playerId
            : step.battlefieldController?.kind === 'you'
              ? controllerId
              : controllerId
          : undefined;
      const result =
        exactZone.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              exactZone.playerId,
              targetObjectId,
              { cardType: 'any' },
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : exactZone.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                exactZone.playerId,
                targetObjectId,
                'any',
                destination as any,
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(
                workingState,
                exactZone.playerId,
                targetObjectId,
                'any',
                destination as any,
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              );

      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved ${contextualBoundCardIds.length} contextual card(s)`],
    });
  }

  const linkedSourceId = String(ctx.sourceId || '').trim();

  if (parsedTheExiledCard) {
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const matches = findCardsExiledWithSource(nextState, linkedSourceId, parsedTheExiledCard);
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    const chosenObjectIds = getChosenObjectIds(ctx);
    const selectedMatches =
      chosenObjectIds.length > 0
        ? matches.filter(match => chosenObjectIds.includes(match.cardId))
        : matches.length === 1
          ? matches
          : matches;

    if (selectedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            availableLinkedExileTargets: matches.map(match => match.cardId),
          },
        },
      };
    }

    const match = selectedMatches[0];
    const result = moveTargetedCardFromExile(
      nextState,
      match.playerId,
      match.cardId,
      parsedTheExiledCard.cardType,
      step.to === 'battlefield' ? 'battlefield' : step.to,
      step.to === 'battlefield' && step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.to === 'battlefield' && step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? match.playerId
          : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (linked exiled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromLinkedExile || parsedAllFromLinkedExile) {
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const rawCriteria = parsedSingleTargetFromLinkedExile || parsedAllFromLinkedExile!;
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(rawCriteria, ctx);
    const matches = findCardsExiledWithSource(nextState, linkedSourceId, criteria);
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    const chosenObjectIds = getChosenObjectIds(ctx);
    const selectedMatches =
      parsedSingleTargetFromLinkedExile
        ? (() => {
            if (chosenObjectIds.length > 0) {
              const explicit = matches.filter(match => chosenObjectIds.includes(match.cardId));
              return explicit.length === 1 ? explicit : explicit;
            }
            return matches.length === 1 ? matches : matches;
          })()
        : matches;

    if (parsedSingleTargetFromLinkedExile && selectedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            availableLinkedExileTargets: matches.map(match => match.cardId),
          },
        },
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of selectedMatches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        criteria.cardType,
        step.to === 'battlefield' ? 'battlefield' : step.to,
        step.to === 'battlefield' && step.battlefieldController?.kind === 'you' ? controllerId : undefined,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (linked exiled card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (parsedTypedCardFromYourHand) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedTypedCardFromYourHand,
      ctx,
      nextState,
      controllerId
    );
    const refId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const refPerm = refId
      ? ((nextState.battlefield || []) as any[]).find(perm => String((perm as any)?.id || '').trim() === refId)
      : undefined;
    const referenceManaValue = refPerm ? getCardManaValue((refPerm as any)?.card || refPerm) : null;
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
    const matches = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId) return false;
      if (
        !cardMatchesMoveZoneSingleTargetCriteria(
          card,
          effectiveCriteria,
          undefined,
          undefined,
          sourcePermanentPower,
          referenceManaValue ?? undefined
        )
      ) {
        return false;
      }
      if (preferred.size > 0 && !preferred.has(cardId)) return false;
      return true;
    });
    const relaxed =
      matches.length === 0 && preferred.size > 0
        ? hand.filter(
            (card: any) =>
              preferred.has(String(card?.id || '').trim()) &&
              cardMatchesMoveZoneSingleTargetCriteria(
                card,
                effectiveCriteria,
                undefined,
                undefined,
                sourcePermanentPower,
                referenceManaValue ?? undefined
              )
          )
        : matches;
    const cardId = String((relaxed[0] as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (typed hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to === 'battlefield') {
      const result = moveTargetedCardFromHand(
        nextState,
        controllerId,
        cardId,
        effectiveCriteria.cardType,
        'battlefield',
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? controllerId : controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (typed hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'graveyard' || step.to === 'exile') {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      const card = hand.find((entry: any) => String(entry?.id || '').trim() === cardId);
      const mv = card ? getCardManaValue(card) : null;
      const result = moveTargetedCardFromHand(
        nextState,
        controllerId,
        cardId,
        effectiveCriteria.cardType,
        step.to
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (typed hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      if (effectiveCriteria.timeCountersEqualManaValue && mv !== null && result.kind === 'applied') {
        const updatedPlayers = result.state.players.map(p => {
          if (p.id !== controllerId) return p;
          const exile = Array.isArray((p as any)?.exile) ? [...(p as any).exile] : [];
          const updatedExile = exile.map((entry: any) =>
            String(entry?.id || '').trim() === cardId
              ? { ...entry, counters: { ...(entry?.counters || {}), time: mv } }
              : entry
          );
          return { ...(p as any), exile: updatedExile } as any;
        });
        return finalizeAppliedResult({ ...result, state: { ...result.state, players: updatedPlayers as any } as GameState });
      }
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedTheCardsFromYourHand && step.to === 'library') {
    const result = shuffleCardsFromHandIntoLibrary(nextState, controllerId);
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Shuffled hand into library: ${step.raw}`],
    });
  }

  if (parsedCountFromHand && step.to === 'library' && getLibraryPlacement(step) === 'top') {
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      parsedCountFromHand.count,
      'top',
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved cards from hand to library top: ${step.raw}`],
    });
  }

  if (parsedCountFromHand && step.to === 'library' && getLibraryPlacement(step) === 'bottom') {
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      parsedCountFromHand.count,
      'bottom',
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved cards from hand to library bottom: ${step.raw}`],
    });
  }

  if (parsedOpponentOwnedFromExile && step.to === 'graveyard') {
    const result = moveOpponentOwnedCardsFromExileToGraveyards(
      nextState,
      controllerId,
      parsedOpponentOwnedFromExile.count,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({
        state: nextState,
        log: [`No opponent-owned exile cards matched: ${step.raw}`],
      });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved opponent-owned exile cards to graveyards: ${step.raw}`],
    });
  }

  if (parsedAnotherFromGraveyard && step.to === 'exile') {
    const excludeIds = Array.from(
      new Set([String(ctx.sourceId || '').trim(), 'gy-source-self'].filter(Boolean))
    );
    const result = exileAnotherMatchingCardFromYourGraveyard(
      nextState,
      controllerId,
      parsedAnotherFromGraveyard,
      excludeIds,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({
        state: nextState,
        log: [`No other graveyard card matched: ${step.raw}`],
      });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled another graveyard card: ${step.raw}`],
    });
  }

  if (parsedUpToTargetCountFromGraveyard) {
    const preferredIds = getChosenObjectIds(ctx);
    const dynamicMaxCount = parsedUpToTargetCountFromGraveyard.useXValue
      ? Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedUpToTargetCountFromGraveyard.useReferenceAmount
        ? Math.max(0, Number(ctx.referenceAmount ?? 2))
        : parsedUpToTargetCountFromGraveyard.maxCount;
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedUpToTargetCountFromGraveyard.criteria,
      ctx
    );
    if (step.to === 'hand') {
      const result = returnUpToMatchingFromGraveyardToHand(
        nextState,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        preferredIds
      );
      if (result.kind === 'player_choice_required') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      if (result.kind === 'impossible') {
        return buildAppliedResult({
          state: nextState,
          log: [`No matching graveyard cards: ${step.raw}`],
        });
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = putUpToMatchingFromGraveyardOntoBattlefieldWithController(
        nextState,
        controllerId,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        preferredIds
      );
      if (result.kind === 'player_choice_required') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      if (result.kind === 'impossible') {
        return buildAppliedResult({
          state: nextState,
          log: [`No matching graveyard cards: ${step.raw}`],
        });
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'exile') {
      const result = exileUpToMatchingFromGraveyard(
        nextState,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        preferredIds
      );
      if (result.kind === 'player_choice_required') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
    if (result.kind === 'impossible') {
      return buildAppliedResult({
        state: nextState,
        log: [`No matching graveyard cards: ${step.raw}`],
      });
    }
    return finalizeAppliedResult(result);
    }

    if (step.to === 'library') {
      const result = shuffleUpToMatchingFromGraveyardIntoLibrary(
        nextState,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        preferredIds
      );
      if (result.kind === 'player_choice_required') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      if (result.kind === 'impossible') {
        return buildAppliedResult({
          state: nextState,
          log: [`No matching graveyard cards: ${step.raw}`],
        });
      }
      return finalizeAppliedResult(result);
    }
  }

  if (parsedUpToTargetCountFromTargetPlayerGraveyard && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const preferredIds = getChosenObjectIds(ctx);
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      targetPlayerId,
      parsedUpToTargetCountFromTargetPlayerGraveyard.maxCount,
      parsedUpToTargetCountFromTargetPlayerGraveyard.criteria,
      preferredIds
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToTargetCountFromTargetPlayerGraveyard && step.to === 'library') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const preferredIds = getChosenObjectIds(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = shuffleUpToMatchingFromGraveyardIntoLibrary(
      nextState,
      targetPlayerId,
      parsedUpToTargetCountFromTargetPlayerGraveyard.maxCount,
      parsedUpToTargetCountFromTargetPlayerGraveyard.criteria,
      preferredIds
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedMostVotesCards && step.to === 'hand') {
    const preferredIds = getChosenObjectIds(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of preferredIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : location.zone === 'hand'
              ? { kind: 'applied' as const, state: workingState, log: [] as string[], movedCards: [] as any[] }
              : { kind: 'impossible' as const };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned vote-winning cards: ${step.raw}`],
    });
  }

  if (parsedThatManyFromBottomOfLibrary && step.to === 'exile') {
    const count = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileCountFromBottomOfLibrary(nextState, controllerId, count);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedUpToOneOtherTargetCreatureBfOrGy && step.to === 'exile') {
    const targetObjectId = getTargetObjectId(ctx);
    const hasBattlefieldTarget = targetObjectId
      ? ((nextState.battlefield || []) as any[]).some(perm => String((perm as any)?.id || '').trim() === targetObjectId)
      : false;
    if (hasBattlefieldTarget && targetObjectId) {
      const battlefield = [...((nextState.battlefield || []) as any[])];
      const perm = battlefield.find(entry => String((entry as any)?.id || '').trim() === targetObjectId);
      if (perm) {
        const removedIds = new Set([targetObjectId]);
        const kept = battlefield.filter(entry => String((entry as any)?.id || '').trim() !== targetObjectId);
        const result = finalizeBattlefieldRemoval(nextState, [perm], removedIds, kept, 'exile', 'exiled');
        return buildAppliedResult({ state: result.state, log: result.log });
      }
    }
    const gyTargetId = resolveUniqueChosenAnyGraveyardTargetId(
      nextState,
      { cardType: 'creature' },
      ctx,
      runtime,
      ctx.sourceName
    );
    if (gyTargetId) {
      const location = findBoundCardZoneLocation(nextState, gyTargetId);
      if (location?.zone === 'graveyard') {
        const result = moveTargetedCardFromGraveyard(
          nextState,
          location.playerId,
          gyTargetId,
          { cardType: 'creature' },
          'exile'
        );
        return finalizeAppliedResult(result);
      }
    }
    return buildAppliedResult({ state: nextState, log: [`No Savior target available: ${step.raw}`] });
  }

  if (parsedAllOtherCardsRevealedThisWay && (step.to === 'graveyard' || step.to === 'library')) {
    const preferredIds = new Set(getChosenObjectIds(ctx));
    const movedBattlefieldIds = new Set(
      (Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'exile',
      'hand',
      'graveyard',
    ]);
    const restIds = candidateIds.filter(
      id => !preferredIds.has(id) && !movedBattlefieldIds.has(id)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (step.to === 'library') {
      const shuffleResult = shuffleContextualCardsIntoLibrary(workingState, controllerId, restIds);
      return buildAppliedResult({
        state: shuffleResult.state,
        log: shuffleResult.log.length > 0 ? shuffleResult.log : [`Shuffled other revealed cards into library: ${step.raw}`],
      });
    }
    for (const cardId of restIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
              controllerId,
              cardType: 'any',
            })
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
            : location.zone === 'exile'
              ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard')
              : { kind: 'impossible' as const };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved other revealed cards to graveyard: ${step.raw}`],
    });
  }

  if (parsedTheRevealedCards && (step.to === 'hand' || step.to === 'battlefield')) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['library', 'exile', 'hand']);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      if (step.to === 'hand' && location.zone === 'hand') continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, step.to, {
              controllerId,
              cardType: 'any',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'any',
                step.to,
                step.to === 'battlefield' ? controllerId : undefined,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  'any',
                  step.to,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : { kind: 'impossible' as const };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Moved revealed cards to ${step.to}: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds.length > 0 ? movedBattlefieldIds : undefined,
    });
  }

  if (parsedAllOfThemWithThatName && step.to === 'hand') {
    const chosenName = String(
      ctx.selectorContext?.chosenCardName || ctx.chosenCardName || ctx.lastChosenCardName || ''
    )
      .trim()
      .toLowerCase();
    const restToGraveyard = /\bgraveyard\b/i.test(String(step.toRaw || step.raw || ''));
    const candidateIds = resolveContextualCardIdsInZones(
      nextState,
      ctx,
      runtime,
      restToGraveyard ? ['library', 'exile', 'hand', 'graveyard'] : ['library', 'exile', 'hand']
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedToHandIds = new Set<string>();
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const player = workingState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      const cardName = String((card as any)?.name || (card as any)?.card?.name || '')
        .trim()
        .toLowerCase();
      if (chosenName && cardName && cardName !== chosenName) continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
              controllerId,
              cardType: 'any',
            })
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
              : location.zone === 'hand'
                ? { kind: 'applied' as const, state: workingState, log: [] }
                : { kind: 'impossible' as const };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedToHandIds.add(cardId);
    }
    if (restToGraveyard) {
      for (const cardId of candidateIds) {
        if (movedToHandIds.has(cardId)) continue;
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'graveyard') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
                controllerId,
                cardType: 'any',
              })
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
              : location.zone === 'exile'
                ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard')
                : { kind: 'impossible' as const };
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved matching-name cards to hand: ${step.raw}`],
    });
  }

  if (parsedThatPile && step.to === 'hand') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand', 'graveyard']);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'hand') continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : { kind: 'impossible' as const };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved that pile to hand: ${step.raw}`],
    });
  }

  if (parsedAllCreaturesOfThatColor && step.to === 'hand') {
    const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim();
    const colorSymbol =
      chosenMana.includes('{R}')
        ? 'R'
        : chosenMana.includes('{U}')
          ? 'U'
          : chosenMana.includes('{B}')
            ? 'B'
            : chosenMana.includes('{G}')
              ? 'G'
              : chosenMana.includes('{W}')
                ? 'W'
                : 'U';
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: `all ${colorSymbol === 'R' ? 'red' : colorSymbol === 'U' ? 'blue' : colorSymbol === 'B' ? 'black' : colorSymbol === 'G' ? 'green' : 'white'} creatures`,
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
    return finalizeAppliedResult(result);
  }

  if (parsedTargetCreatureMilledThisTurn && step.to === 'battlefield') {
    const effectiveCriteria = parsedTargetCreatureMilledThisTurn;
    const targetObjectId =
      boundTargetObjectId ||
      resolveUniqueChosenAnyGraveyardTargetId(nextState, effectiveCriteria, ctx, runtime, ctx.sourceName);
    if (!targetObjectId) {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-turn graveyard target: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, targetObjectId);
    if (!location || location.zone !== 'graveyard') {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-turn graveyard target: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      location.playerId,
      targetObjectId,
      effectiveCriteria,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedCountTargetBattlefieldBounce && step.to === 'hand') {
    const bounceSelectorText = /\byou\s+control\b/i.test(parsedCountTargetBattlefieldBounce.selectorText)
      ? parsedCountTargetBattlefieldBounce.selectorText
      : /\btarget\b/i.test(parsedCountTargetBattlefieldBounce.selectorText)
        ? parsedCountTargetBattlefieldBounce.selectorText
        : `${parsedCountTargetBattlefieldBounce.selectorText} you control`;
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: bounceSelectorText,
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const matches = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
    const preferred = getChosenObjectIds(ctx);
    let targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) {
        targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      }
    }
    const bounceCount = parsedCountTargetBattlefieldBounce.useXValue
      ? Math.max(0, Number(ctx.xValue) || 3)
      : parsedCountTargetBattlefieldBounce.count;
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      targetIds.slice(0, bounceCount)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedOneOfThemToHand) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const cardId = preferred[0] || candidateIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them hand: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them hand: ${step.raw}`] });
    }
    const result =
      location.zone === 'hand'
        ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
        : moveContextualCardToDestination(nextState, location, cardId, 'hand', { controllerId });
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them hand: ${step.raw}`] });
    }
    return finalizeAppliedResult(result as any);
  }

  if (parsedOneOfThemToGraveyard) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const cardId = candidateIds[0];
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them graveyard: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them graveyard: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
        : location.zone === 'hand'
          ? moveTargetedCardFromHand(nextState, location.playerId, cardId, 'any', 'graveyard')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'graveyard')
            : { kind: 'impossible' as const };
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them graveyard: ${step.raw}`] });
    }
    return finalizeAppliedResult(result as any);
  }

  if (parsedOneOfThemToBattlefield) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const cardId = candidateIds[0];
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them battlefield: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them battlefield: ${step.raw}`] });
    }
    const bfController = /\bunder an opponent'?s control\b/i.test(String(step.toRaw || step.raw || ''))
      ? (String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID)
      : step.battlefieldController?.kind === 'owner_of_moved_cards'
        ? location.playerId
        : controllerId;
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            bfController,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'library'
          ? moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
              controllerId: bfController,
              cardType: 'any',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
        : location.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              location.playerId,
              cardId,
              'any',
              'battlefield',
              bfController,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(
                nextState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                bfController,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : { kind: 'impossible' as const };
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them battlefield: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOneOfThemBfTappedOtherHand) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    if (candidateIds.length < 2) {
      return buildAppliedResult({ state: nextState, log: [`Insufficient contextual cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const bfId = candidateIds[0];
    const handId = candidateIds[1];
    const bfLocation = findBoundCardZoneLocation(workingState, bfId);
    if (bfLocation) {
      const bfResult =
        bfLocation.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              bfLocation.playerId,
              bfId,
              { cardType: 'any' },
              'battlefield',
              controllerId,
              true,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : bfLocation.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                bfLocation.playerId,
                bfId,
                'any',
                'battlefield',
                controllerId,
                true,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : { kind: 'impossible' as const };
      if (bfResult.kind !== 'impossible') {
        workingState = bfResult.state;
        combinedLog.push(...(bfResult.log || []));
      }
    }
    const handLocation = findBoundCardZoneLocation(workingState, handId);
    if (handLocation && handLocation.zone !== 'hand') {
      const handResult =
        handLocation.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, handLocation.playerId, handId, { cardType: 'any' }, 'hand')
          : handLocation.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, handLocation.playerId, handId, 'any', 'hand')
            : { kind: 'impossible' as const };
      if (handResult.kind !== 'impossible') {
        workingState = handResult.state;
        combinedLog.push(...(handResult.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split one-of-them battlefield/hand: ${step.raw}`],
    });
  }

  if (parsedUpToThatManyInstantOrSorcery && step.to === 'exile') {
    const dynamicMaxCount = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      controllerId,
      dynamicMaxCount,
      parsedUpToThatManyInstantOrSorcery.criteria,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberTargetNonlandTotalMv && step.to === 'hand') {
    const boundPermanentIds = Array.from(
      new Set(
        [
          String(ctx.targetCreatureId || '').trim(),
          String(ctx.targetPermanentId || '').trim(),
          ...getChosenObjectIds(ctx),
        ].filter(Boolean)
      )
    );
    const targetIds = selectBattlefieldPermanentsWithTotalManaValueLte(
      nextState,
      boundPermanentIds,
      parsedAnyNumberTargetNonlandTotalMv.totalManaValueLte
    );
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedMassBattlefieldCreatureBounce && step.to === 'hand') {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || 'human').trim().toLowerCase();
    const targetIds = ((nextState.battlefield || []) as any[])
      .filter(perm => {
        if (!hasExecutorClass(perm as any, 'creature')) return false;
        if (parsedMassBattlefieldCreatureBounce.excludeChosenCreatureType) {
          return !getExecutorTypeLineLower(perm).includes(chosenType);
        }
        const term = String(parsedMassBattlefieldCreatureBounce.excludeTypeLineTerm || '').toLowerCase();
        return !getExecutorTypeLineLower(perm).includes(term);
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberFromYourHand && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const cardIds = hand
      .filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !cardMatchesType(card, parsedAnyNumberFromYourHand.cardType)) return false;
        if (preferred.size > 0 && !preferred.has(cardId)) return false;
        return true;
      })
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromHand(
        workingState,
        controllerId,
        cardId,
        parsedAnyNumberFromYourHand.cardType,
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards from hand: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedTotalMvCreaturesFromGraveyards && step.to === 'battlefield') {
    const totalMv = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 6));
    const playerIds = parsedTotalMvCreaturesFromGraveyards.fromTargetPlayerOnly
      ? [getTargetPlayerId(ctx)].filter(Boolean)
      : (nextState.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean);
    const selections = selectGraveyardCreaturesWithTotalManaValueLteFromPlayers(
      nextState,
      playerIds as PlayerID[],
      totalMv,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const selection of selections) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        selection.playerId,
        selection.cardId,
        { cardType: 'creature' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Reanimated creatures: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCraftExiledCard && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, parsedCraftExiledCard);
    const preferred = getChosenObjectIds(ctx);
    let match = matches.find(entry => preferred.includes(entry.cardId)) || matches[0];
    if (!match) {
      return buildAppliedResult({ state: nextState, log: [`No crafted exile card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      match.playerId,
      match.cardId,
      parsedCraftExiledCard.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`Crafted exile card unavailable: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToReferenceCountTargetPermanents && step.to === 'hand') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const maxCount = Math.max(0, Number(ctx.referenceAmount ?? 2));
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const preferred = getChosenObjectIds(ctx);
    const battlefield = ((nextState.battlefield || []) as any[]).filter(
      perm => perm?.controller === targetPlayerId
    );
    let targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) {
        targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      }
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds.slice(0, maxCount));
    return finalizeAppliedResult(result);
  }

  if (parsedTopCardsFromTargetPlayerLibrary && step.to === 'battlefield') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (let index = 0; index < parsedTopCardsFromTargetPlayerLibrary.count; index += 1) {
      const result = moveTopCardFromLibrary(
        workingState,
        targetPlayerId,
        'battlefield',
        controllerId,
        step.entersTapped,
        true,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') break;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved library top cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAllCommandersCommandZoneGy && step.to === 'hand') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const commandZone = Array.isArray(controllerPlayer?.commandZone)
      ? [...controllerPlayer.commandZone]
      : Array.isArray(controllerPlayer?.command)
        ? [...controllerPlayer.command]
        : [];
    const graveyard = Array.isArray(controllerPlayer?.graveyard) ? [...controllerPlayer.graveyard] : [];
    const isCommanderCard = (card: any): boolean => {
      if ((card as any)?.isCommander === true || (card as any)?.commander === true) return true;
      const typeLine = getExecutorTypeLineLower(card);
      return (
        typeLine.includes('legendary') &&
        (typeLine.includes('creature') || typeLine.includes('planeswalker') || typeLine.includes('background'))
      );
    };
    const commanderCards = [
      ...commandZone.filter(isCommanderCard),
      ...graveyard.filter(isCommanderCard),
    ];
    const movedIds = new Set(
      commanderCards.map(card => String((card as any)?.id || '').trim()).filter(Boolean)
    );
    const hand = Array.isArray(controllerPlayer?.hand) ? [...controllerPlayer.hand] : [];
    const updatedHand = [...hand, ...commanderCards];
    const updatedCommandZone = commandZone.filter(
      card => !movedIds.has(String((card as any)?.id || '').trim())
    );
    const updatedGraveyard = graveyard.filter(
      card => !movedIds.has(String((card as any)?.id || '').trim())
    );
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            hand: updatedHand,
            commandZone: updatedCommandZone,
            command: updatedCommandZone,
            graveyard: updatedGraveyard,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} puts ${commanderCards.length} commander(s) into hand from command zone and graveyard`],
      lastMovedCards: commanderCards,
    });
  }

  if (parsedCommandZonePermanent && step.to === 'hand') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const commandZone = Array.isArray(controllerPlayer?.commandZone)
      ? [...controllerPlayer.commandZone]
      : Array.isArray(controllerPlayer?.command)
        ? [...controllerPlayer.command]
        : [];
    const sourceId = String(ctx.sourceId || '').trim();
    const preferred = getChosenObjectIds(ctx);
    const whatText = String((step.what as any)?.text || '').trim().toLowerCase();
    let card = commandZone.find((entry: any) => {
      const cardId = String(entry?.id || '').trim();
      if (whatText === 'this permanent') {
        return cardId === sourceId || cardId === 'cmd-source-self' || cardId.startsWith('cmd-source');
      }
      if (whatText === 'your commander' || whatText === 'a commander you own from the command zone') {
        return (
          (entry as any)?.isCommander === true ||
          (entry as any)?.commander === true ||
          /commander/i.test(String(entry?.type_line || entry?.card?.type_line || ''))
        );
      }
      return /commander/i.test(String(entry?.type_line || entry?.card?.type_line || ''));
    });
    if (!card && preferred.length > 0) {
      card = commandZone.find((entry: any) => preferred.includes(String(entry?.id || '').trim()));
    }
    if (!card) {
      return buildAppliedResult({ state: nextState, log: [`No command zone card: ${step.raw}`] });
    }
    const cardId = String((card as any)?.id || '').trim();
    const kept = commandZone.filter((entry: any) => String(entry?.id || '').trim() !== cardId);
    const hand = Array.isArray(controllerPlayer?.hand) ? [...controllerPlayer.hand] : [];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            hand: [...hand, card],
            commandZone: kept,
            command: kept,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} puts ${cardId} from command zone into hand`],
      lastMovedCards: [card],
    });
  }

  if (parsedCommandZonePermanent && step.to === 'battlefield') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const commandZone = Array.isArray(controllerPlayer?.commandZone)
      ? controllerPlayer.commandZone
      : Array.isArray(controllerPlayer?.command)
        ? controllerPlayer.command
        : [];
    const sourceId = String(ctx.sourceId || '').trim();
    const preferred = getChosenObjectIds(ctx);
    let card = commandZone.find((entry: any) => {
      const cardId = String(entry?.id || '').trim();
      if (String((step.what as any)?.text || '').trim().toLowerCase() === 'this permanent') {
        return cardId === sourceId || cardId === 'cmd-source-self' || cardId.startsWith('cmd-source');
      }
      return /commander/i.test(String(entry?.type_line || entry?.card?.type_line || ''));
    });
    if (!card && preferred.length > 0) {
      card = commandZone.find((entry: any) => preferred.includes(String(entry?.id || '').trim()));
    }
    if (!card) {
      return buildAppliedResult({ state: nextState, log: [`No command zone card: ${step.raw}`] });
    }
    const cardId = String((card as any)?.id || '').trim();
    const kept = commandZone.filter((entry: any) => String(entry?.id || '').trim() !== cardId);
    const newPermanents = createBattlefieldPermanentsFromCards(
      [card],
      controllerId,
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      'command'
    );
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            commandZone: kept,
            command: kept,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: addBattlefieldPermanentsToState(
        { ...nextState, players: updatedPlayers as any } as GameState,
        newPermanents
      ),
      log: [`${controllerId} puts ${cardId} from command zone onto the battlefield`],
      movedBattlefieldPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
    });
  }

  if (parsedMyraExileInstantSorcery && step.to === 'exile') {
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedMyraExileInstantSorcery, ctx);
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      [effectiveCriteria],
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No Myra graveyard match: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      effectiveCriteria,
      'exile'
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Myra exile unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedSharesTypeFromAmongThem && (step.to === 'hand' || step.to === 'battlefield')) {
    const preferred = getChosenObjectIds(ctx);
    const contextualIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'hand',
      'exile',
      'graveyard',
    ]);
    const cardId =
      preferred.find(id => contextualIds.includes(id)) ||
      contextualIds[0] ||
      '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No shared-type among-them card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`Shared-type card unavailable: ${step.raw}`] });
    }
    const result =
      location.zone === 'hand'
        ? moveTargetedCardFromHand(nextState, location.playerId, cardId, 'any', step.to === 'battlefield' ? 'battlefield' : 'hand', step.to === 'battlefield' ? controllerId : undefined, step.entersTapped, step.entersFaceDown, effectiveWithCounters, undefined, battlefieldEntryOverrides)
        : location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, step.to === 'battlefield' ? 'battlefield' : 'hand', step.to === 'battlefield' ? controllerId : undefined, step.entersTapped, step.entersFaceDown, effectiveWithCounters, undefined, undefined, battlefieldEntryOverrides)
          : location.zone === 'library'
            ? (() => {
                const player = nextState.players.find(p => p.id === location.playerId) as any;
                const library = Array.isArray(player?.library) ? [...player.library] : [];
                const index = library.findIndex((card: any) => String(card?.id || '').trim() === cardId);
                if (index < 0) return { kind: 'impossible' as const };
                const [card] = library.splice(index, 1);
                if (step.to === 'battlefield') {
                  const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
                  const updatedPlayers = nextState.players.map(p =>
                    p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
                  );
                  const handResult = moveTargetedCardFromHand(
                    { ...nextState, players: updatedPlayers as any } as GameState,
                    location.playerId,
                    cardId,
                    'any',
                    'battlefield',
                    controllerId,
                    step.entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
                  return handResult;
                }
                const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
                const updatedPlayers = nextState.players.map(p =>
                  p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
                );
                return {
                  kind: 'applied' as const,
                  state: { ...nextState, players: updatedPlayers as any } as GameState,
                  log: [`${location.playerId} puts ${cardId} from library into hand`],
                };
              })()
            : moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', step.to === 'battlefield' ? 'battlefield' : 'hand', step.to === 'battlefield' ? controllerId : undefined, step.entersTapped, step.entersFaceDown, effectiveWithCounters, undefined, battlefieldEntryOverrides);
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Shared-type card unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedUpToCreaturesExcludingTypeLineTerm && step.to === 'hand') {
    const excludeTerm = parsedUpToCreaturesExcludingTypeLineTerm.excludeTypeLineTerm;
    const battlefield = ((nextState.battlefield || []) as any[]).filter(perm => {
      if (!hasExecutorClass(perm as any, 'creature')) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      if (excludeTerm === 'black') {
        const colors = Array.isArray((perm as any)?.colors || (perm as any)?.card?.colors)
          ? ((perm as any)?.colors || (perm as any)?.card?.colors)
          : [];
        return !typeLine.includes('black') && !colors.map(String).includes('B');
      }
      return !typeLine.includes(excludeTerm);
    });
    const preferred = getChosenObjectIds(ctx);
    let targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) {
        targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      }
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      targetIds.slice(0, parsedUpToCreaturesExcludingTypeLineTerm.count)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedReturnContextualThemToBattlefield && step.to === 'battlefield') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const ownerId = location.playerId;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              location.playerId,
              cardId,
              { cardType: 'any' },
              'battlefield',
              ownerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                ownerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                ownerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned contextual cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedThemAntecedent && step.to === 'battlefield') {
    const milledIds = Array.isArray(ctx.lastMilledCards)
      ? ctx.lastMilledCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      : [];
    const runtimeIds = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      : [];
    const candidateIds = Array.from(new Set([...milledIds, ...runtimeIds, ...getChosenObjectIds(ctx)]));
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        location.playerId,
        cardId,
        { cardType: 'any' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved antecedent cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAnyNumberThosePermanentCards && step.to === 'battlefield') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand', 'graveyard']);
    const preferred = new Set(getChosenObjectIds(ctx));
    const cardIds =
      preferred.size > 0 ? candidateIds.filter(id => preferred.has(id)) : candidateIds;
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              location.playerId,
              cardId,
              { cardType: 'permanent' },
              'battlefield',
              controllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                location.playerId,
                cardId,
                'permanent',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'permanent',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved those permanent cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedContextualThemSplit) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'graveyard',
      'hand',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual cards for them split: ${step.raw}`] });
    }
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const orderedIds = preferred.length > 0 ? [...preferred, ...candidateIds.filter(id => !preferred.includes(id))] : candidateIds;
    let handIds: string[];
    let restIds: string[];
    if (parsedContextualThemSplit.kind === 'any_number_hand_graveyard_rest') {
      handIds = preferred.length > 0 ? preferred : orderedIds.slice(0, Math.min(2, orderedIds.length));
      restIds = orderedIds.filter(id => !handIds.includes(id));
    } else if (parsedContextualThemSplit.kind === 'count_hand_only') {
      handIds = orderedIds.slice(0, parsedContextualThemSplit.count);
      restIds = [];
    } else {
      const handCount =
        parsedContextualThemSplit.kind === 'count_hand_graveyard_rest' ||
        parsedContextualThemSplit.kind === 'count_hand_library_bottom'
          ? parsedContextualThemSplit.count
          : 1;
      handIds = orderedIds.slice(0, handCount);
      restIds = orderedIds.slice(handCount);
    }
    const restDestination =
      parsedContextualThemSplit.kind === 'count_hand_library_bottom' ? 'library_bottom' : 'graveyard';

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const handId of handIds) {
      const handLocation = findBoundCardZoneLocation(workingState, handId);
      if (!handLocation) continue;
      if (handLocation.zone === 'hand') continue;
      const handResult = moveContextualCardToDestination(workingState, handLocation, handId, 'hand', {
        controllerId,
      });
      if (handResult.kind === 'impossible') continue;
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }
    for (const restId of restIds) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult = moveContextualCardToDestination(workingState, restLocation, restId, restDestination, {
        controllerId,
      });
      if (restResult.kind === 'impossible') continue;
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split contextual them: ${step.raw}`],
    });
  }

  if (parsedSingleRevealedRestToGy && parsedSingleCardRevealedThisWay) {
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedSingleCardRevealedThisWay, ctx);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand', 'graveyard']);
    const matchingIds = candidateIds.filter(cardId => {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
    });
    const preferred = getChosenObjectIds(ctx);
    const handId = preferred.find(id => matchingIds.includes(id)) || matchingIds[0] || '';
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (handId) {
      const location = findBoundCardZoneLocation(workingState, handId);
      if (location) {
        const handResult =
          location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, handId, effectiveCriteria, 'hand')
            : location.zone === 'hand'
              ? { kind: 'applied' as const, state: workingState, log: [] }
              : moveTargetedCardFromExile(workingState, location.playerId, handId, effectiveCriteria.cardType, 'hand');
        if (handResult.kind !== 'impossible') {
          workingState = handResult.state;
          combinedLog.push(...(handResult.log || []));
        }
      }
    }
    for (const restId of candidateIds.filter(id => id !== handId)) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult =
        restLocation.zone === 'graveyard'
          ? { kind: 'applied' as const, state: workingState, log: [] }
          : restLocation.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, restLocation.playerId, restId, 'any', 'graveyard')
            : moveTargetedCardFromExile(workingState, restLocation.playerId, restId, 'any', 'graveyard');
      if (restResult.kind === 'impossible') continue;
      workingState = restResult.state;
      combinedLog.push(...(restResult.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split revealed-this-way card: ${step.raw}`],
    });
  }

  if (parsedAnyNumberArtifactCreatureTotalMv && step.to === 'battlefield') {
    const cardIds = selectGraveyardCardsWithTotalManaValueLte(
      nextState,
      controllerId,
      'creature',
      parsedAnyNumberArtifactCreatureTotalMv.totalManaValueLte,
      getChosenObjectIds(ctx)
    ).filter(cardId => {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const card = (Array.isArray(player?.graveyard) ? player.graveyard : []).find(
        (entry: any) => String(entry?.id || '').trim() === cardId
      );
      const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      return typeLine.includes('artifact') && typeLine.includes('creature');
    });
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'creature' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned artifact creatures: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedUpToCountTotalMvFromYourGraveyard && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const cardIds = selectContextualCardsWithTotalManaValueLte(
      graveyard,
      parsedUpToCountTotalMvFromYourGraveyard.cardType,
      parsedUpToCountTotalMvFromYourGraveyard.totalManaValueLte,
      parsedUpToCountTotalMvFromYourGraveyard.maxCount,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: parsedUpToCountTotalMvFromYourGraveyard.cardType },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned graveyard cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedShuffleSourceAndTarget && step.to === 'library') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const ids = [sourceId, targetId].filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, ids, 'bottom');
    return finalizeAppliedResult(result);
  }

  if (parsedUpToXFromAmongExiled && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const maxCount = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' });
    const preferred = getChosenObjectIds(ctx);
    let targetMatches = matches;
    if (preferred.length > 0) {
      targetMatches = matches.filter(match => preferred.includes(match.cardId));
      if (targetMatches.length === 0) targetMatches = matches;
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of targetMatches.slice(0, maxCount)) {
      const result = moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned exiled cards: ${step.raw}`],
    });
  }

  if (parsedAnyNumberSaddledToHand && step.to === 'hand') {
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const currentTurn = Number((nextState as any).turnNumber ?? (nextState as any).turn ?? 0) || 0;
    const matches = battlefield.filter(
      perm =>
        hasExecutorClass(perm as any, 'creature') &&
        Number((perm as any)?.saddledThisTurn ?? (perm as any)?.saddledTurn) === currentTurn
    );
    const preferred = getChosenObjectIds(ctx);
    let targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedUpToXOtherBfOrGy && step.to === 'exile') {
    const rawWhat = String((step.what as any)?.text || '').trim().toLowerCase();
    const maxCount = /\bthree\b/.test(rawWhat)
      ? 3
      : Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    const targetObjectId = getTargetObjectId(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    let moved = 0;
    if (targetObjectId && moved < maxCount) {
      const hasBf = ((workingState.battlefield || []) as any[]).some(
        perm => String((perm as any)?.id || '').trim() === targetObjectId
      );
      if (hasBf) {
        const battlefield = [...((workingState.battlefield || []) as any[])];
        const perm = battlefield.find(entry => String((entry as any)?.id || '').trim() === targetObjectId);
        if (perm) {
          const removedIds = new Set([targetObjectId]);
          const kept = battlefield.filter(entry => String((entry as any)?.id || '').trim() !== targetObjectId);
          const result = finalizeBattlefieldRemoval(workingState, [perm], removedIds, kept, 'exile', 'exiled');
          workingState = result.state;
          combinedLog.push(...result.log);
          moved += 1;
        }
      }
    }
    if (moved < maxCount) {
      const gyTargetId = resolveUniqueChosenAnyGraveyardTargetId(
        workingState,
        { cardType: 'creature' },
        ctx,
        runtime,
        ctx.sourceName
      );
      if (gyTargetId) {
        const location = findBoundCardZoneLocation(workingState, gyTargetId);
        if (location?.zone === 'graveyard') {
          const result = moveTargetedCardFromGraveyard(
            workingState,
            location.playerId,
            gyTargetId,
            { cardType: 'creature' },
            'exile'
          );
          if (result.kind !== 'impossible') {
            workingState = result.state;
            combinedLog.push(...(result.log || []));
          }
        }
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled battlefield/graveyard creatures: ${step.raw}`],
    });
  }

  if (parsedEachCreaturePowerOfChosenQuality && step.to === 'hand') {
    const chosenParity = String(ctx.selectorContext?.chosenOddEven || 'odd').trim().toLowerCase();
    if (chosenParity !== 'odd' && chosenParity !== 'even') {
      return {
        applied: false,
        message: `Skipped move zone (no deterministic parity choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const readPower = (perm: any): number | null => {
      const power = Number(
        perm?.effectivePower ?? perm?.power ?? perm?.basePower ?? perm?.card?.power
      );
      return Number.isFinite(power) ? power : null;
    };
    const matches = ((nextState.battlefield || []) as any[]).filter((perm) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readPower(perm);
      if (power === null) return false;
      const isEven = power % 2 === 0;
      return chosenParity === 'even' ? isEven : !isEven;
    });
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      matches.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedEachOpponentCreatureToughnessX && step.to === 'hand') {
    const islandCount = ((nextState.battlefield || []) as any[]).filter(perm => {
      if ((perm as any)?.controller !== controllerId) return false;
      const typeLine = String((perm as any)?.type_line || (perm as any)?.card?.type_line || '').toLowerCase();
      return typeLine.includes('land') && typeLine.includes('island');
    }).length;
    const toughnessCap = Math.max(0, islandCount || Number(ctx.referenceAmount ?? 3));
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: 'each creature your opponents control',
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const matches = battlefield.filter(perm => {
      if (!permanentMatchesSelector(perm, selector, ctx)) return false;
      const toughness = Number((perm as any)?.toughness ?? (perm as any)?.card?.toughness);
      return Number.isFinite(toughness) && toughness <= toughnessCap;
    });
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedTopLibraryFaceDownPerOpponent && step.to === 'exile') {
    const opponentCount = Math.max(1, Number(ctx.eachOfThoseOpponents?.length ?? 3));
    const result = exileCountFromTopOfLibrary(nextState, controllerId, opponentCount, true);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedAllNamedThisPermanent && step.to === 'battlefield') {
    const sourceName = normalizeReferenceText(ctx.sourceName);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const cardIds = graveyard
      .filter((card: any) => normalizeReferenceText(card?.name) === sourceName)
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'any' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned named cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCreatureCardExiledWithSource && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, {
      cardType: parsedCreatureCardExiledWithSource.cardType,
    });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No creature exiled with source: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      chosen.playerId,
      chosen.cardId,
      parsedCreatureCardExiledWithSource.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (exiled creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAllFromLibrary && step.to === 'exile') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    if (library.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No library cards to exile: ${step.raw}`] });
    }
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    const movedCards = library.map((card: any) =>
      step.entersFaceDown ? { ...card, faceDown: true } : card
    );
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({ ...(p as any), library: [], exile: [...exile, ...movedCards] } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...(nextState as any), players: updatedPlayers as any } as any,
      log: [`${controllerId} exiles ${movedCards.length} card(s) from library`],
      movedCards,
    });
  }

  if (parsedUpToTypedCardsFromAmongThem && step.to === 'hand') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const selectedIds = (preferred.length > 0 ? preferred : candidateIds).slice(
      0,
      parsedUpToTypedCardsFromAmongThem.maxCount
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of selectedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'hand'
          ? { kind: 'applied' as const, state: workingState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                { cardType: parsedUpToTypedCardsFromAmongThem.cardType },
                'hand'
              )
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved contextual cards to hand: ${step.raw}`],
    });
  }

  if (parsedPutAllTypedAndFromAmongThem && step.to === 'hand') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx);
    const matchingIds = Array.from(
      new Set(
        candidateIds.filter(cardId => {
          const location = findBoundCardZoneLocation(nextState, cardId);
          if (!location) return false;
          let card: any = null;
          const player = nextState.players.find(p => p.id === location.playerId) as any;
          const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
          card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
          if (!card) return false;
          return parsedPutAllTypedAndFromAmongThem.criteriaAnyOf.some(criteria =>
            cardMatchesMoveZoneSingleTargetCriteria(card, criteria)
          );
        })
      )
    );
    const selectedIds =
      preferred.length > 0
        ? matchingIds.filter(id => preferred.includes(id)).length > 0
          ? matchingIds.filter(id => preferred.includes(id))
          : matchingIds
        : matchingIds;
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of selectedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'hand'
          ? { kind: 'applied' as const, state: workingState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved typed among-them cards to hand: ${step.raw}`],
    });
  }

  if (parsedOneOnTopRestOnBottomLibrary && step.to === 'library') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx);
    const orderedIds =
      preferred.length > 0
        ? [...preferred.filter(id => candidateIds.includes(id)), ...candidateIds.filter(id => !preferred.includes(id))]
        : candidateIds;
    const topId = orderedIds[0];
    if (!topId) {
      return buildAppliedResult({ state: nextState, log: [`No among-them cards for library split: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of orderedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const destination = cardId === topId ? 'library_top' : 'library_bottom';
      const result =
        location.zone === 'hand'
          ? moveTargetedCardFromHandToLibrary(
              workingState,
              location.playerId,
              cardId,
              destination === 'library_top' ? 'top' : 'bottom'
            )
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, destination)
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', destination);
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split among-them cards between library top and bottom: ${step.raw}`],
    });
  }

  if (parsedCreatureExiledWithVehicle && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'creature' });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No creature exiled with vehicle: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      chosen.playerId,
      chosen.cardId,
      'creature',
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (exiled creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberCyclingPermanents && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferred = new Set(getChosenObjectIds(ctx));
    const cardIds = graveyard
      .filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId) return false;
        if (preferred.size > 0 && !preferred.has(cardId)) return false;
        return cardHasCyclingAbility(card);
      })
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'permanent' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned cycling permanents: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAnyNumberCreaturesTotalPower && step.to === 'battlefield') {
    const totalPowerLte =
      parsedAnyNumberCreaturesTotalPower.totalPowerLte === -1
        ? Math.max(0, sourcePermanentPower ?? Number(ctx.referenceAmount ?? 3))
        : parsedAnyNumberCreaturesTotalPower.totalPowerLte;
    const cardIds = selectGraveyardCreatureCardsWithTotalPowerLte(
      nextState,
      controllerId,
      totalPowerLte,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'creature' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned creatures by total power: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedUpToThatManyFromTheirGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const dynamicMaxCount = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      targetPlayerId,
      dynamicMaxCount,
      parsedUpToThatManyFromTheirGy.criteria,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAllOtherTappedCreatures && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const targetIds = battlefield
      .filter(perm => {
        const id = String((perm as any)?.id || '').trim();
        if (!id || id === sourceId) return false;
        if (!(perm as any)?.tapped) return false;
        return hasExecutorClass(perm as any, 'creature');
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedCompoundOpponentRandomExile && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    const topResult = moveTopCardFromLibrary(workingState, targetPlayerId, 'exile');
    if (topResult.kind === 'applied') {
      workingState = topResult.state;
      combinedLog.push(...topResult.log);
      movedCards.push(...(topResult.movedCards || []));
    }
    const gySelection = selectRandomMatchingCardIdFromGraveyard(workingState, targetPlayerId, { cardType: 'any' });
    if (gySelection.kind === 'selected') {
      const gyResult = moveTargetedCardFromGraveyard(
        workingState,
        targetPlayerId,
        gySelection.cardId,
        { cardType: 'any' },
        'exile'
      );
      if (gyResult.kind !== 'impossible') {
        workingState = gyResult.state;
        combinedLog.push(...(gyResult.log || []));
        if (Array.isArray(gyResult.movedCards)) movedCards.push(...gyResult.movedCards);
      }
    }
    const handResult = exileRandomCardFromHand(workingState, targetPlayerId, getChosenObjectIds(ctx));
    workingState = handResult.state;
    combinedLog.push(...handResult.log);
    movedCards.push(...handResult.movedCards);
    return finalizeAppliedResult({ state: workingState, log: combinedLog, movedCards });
  }

  if (parsedUpToOneEachCardTypeFromBoundGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = exileUpToOneEachCardTypeFromGraveyard(
      nextState,
      targetPlayerId,
      getChosenObjectIds(ctx)
    );
    return finalizeAppliedResult(result);
  }

  if (
    parsedCreatureFromCardsMilledThisWay &&
    (step.to === 'hand' || step.to === 'exile')
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      [{ cardType: parsedCreatureFromCardsMilledThisWay.cardType }],
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-way creature: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: parsedCreatureFromCardsMilledThisWay.cardType },
      step.to
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedCreatureHandOrCommandLesserMv && step.to === 'battlefield') {
    const referenceMv = Math.max(0, Number(ctx.spellManaValue ?? ctx.referenceAmount ?? 3));
    const preferredIds = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const match = hand.find((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, parsedCreatureHandOrCommandLesserMv.cardType)) return false;
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) return false;
      const mv = getCardManaValue(card);
      return mv !== null && mv < referenceMv;
    }) || hand.find((card: any) => {
      const mv = getCardManaValue(card);
      return cardMatchesType(card, parsedCreatureHandOrCommandLesserMv.cardType) && mv !== null && mv < referenceMv;
    });
    const cardId = String((match as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No lesser-MV creature in hand: ${step.raw}`] });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      parsedCreatureHandOrCommandLesserMv.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedSingleCardFromHand && step.to === 'exile') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId = resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'hand',
      parsedSingleCardFromHand.cardType,
      preferredIds
    );
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const entersFaceDown = /\bface\s+down\b/i.test(String(step.raw || '')) || Boolean(step.entersFaceDown);
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      parsedSingleCardFromHand.cardType,
      'exile',
      undefined,
      false,
      entersFaceDown
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedSingleCardFromHand && step.to === 'library' && getLibraryPlacement(step)) {
    const preferredIds = getChosenObjectIds(ctx);
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      1,
      getLibraryPlacement(step) === 'top' ? 'top' : 'bottom',
      preferredIds
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({ state: result.state, log: result.log });
  }

  if (parsedThemFromGraveyard && step.to === 'exile') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['graveyard']);
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual graveyard cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled contextual graveyard cards: ${step.raw}`],
    });
  }

  if (
    parsedAllExiledWithNamedSource &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield' || step.to === 'library')
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const namedSource = String(parsedAllExiledWithNamedSource || '').trim().toLowerCase();
    const namesMatch =
      Boolean(sourceName) &&
      (sourceName === namedSource ||
        sourceName.startsWith(namedSource) ||
        namedSource.startsWith(sourceName));
    if (!sourceId || !namesMatch) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' });
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards exiled with source: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? match.playerId : controllerId;
      const result =
        step.to === 'hand'
          ? moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand')
          : step.to === 'battlefield'
            ? moveTargetedCardFromExile(
                workingState,
                match.playerId,
                match.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'graveyard');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (Array.isArray((result as any).movedCards)) movedCards.push(...(result as any).movedCards);
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards exiled with source: ${step.raw}`],
      ...(movedCards.length > 0 ? { movedCards } : {}),
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (
    (parsedTheCardsExiledWithIt || parsedAllExiledWithThisPermanent) &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield')
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const exiledCriteria = parsedAllExiledWithThisPermanent || { cardType: 'any' as const };
    let matches = findCardsExiledWithSource(nextState, sourceId, { cardType: exiledCriteria.cardType });
    if (parsedAllExiledWithThisPermanent?.excludeCreatureCards) {
      matches = matches.filter(match => {
        const player = nextState.players.find(p => p.id === match.playerId) as any;
        const exile = Array.isArray(player?.exile) ? player.exile : [];
        const card = exile.find((entry: any) => String(entry?.id || '').trim() === match.cardId);
        return card ? !cardMatchesType(card, 'creature') : true;
      });
    }
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards exiled with source: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? match.playerId : controllerId;
      const result =
        step.to === 'hand'
          ? moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand')
          : step.to === 'battlefield'
            ? moveTargetedCardFromExile(
                workingState,
                match.playerId,
                match.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'graveyard');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards exiled with source: ${step.raw}`],
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (parsedNonlandCardFromIt && step.to === 'exile') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetPlayerId = getTargetPlayerId(ctx);
    if (targetPlayerId) {
      const player = nextState.players.find(p => p.id === targetPlayerId) as any;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      const preferred = getChosenObjectIds(ctx);
      const match =
        hand.find((card: any) => {
          const cardId = String(card?.id || '').trim();
          if (!cardId || cardMatchesType(card, 'land')) return false;
          return preferred.length === 0 || preferred.includes(cardId);
        }) || hand.find((card: any) => !cardMatchesType(card, 'land'));
      const cardId = String((match as any)?.id || '').trim();
      if (cardId) {
        const result = moveTargetedCardFromHand(nextState, targetPlayerId, cardId, 'nonland', 'exile');
        if (result.kind !== 'impossible') return finalizeAppliedResult(result);
      }
    }
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'nonland' });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No nonland card exiled with source: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(nextState, chosen.playerId, chosen.cardId, 'nonland', 'exile');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (linked exile card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedThisSpellBuybackToHand && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const preferredIds = [
      sourceId,
      'gy-source-self',
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ].filter(Boolean);
    for (const cardId of preferredIds) {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'hand'
          ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
            : location.zone === 'exile'
              ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
              : { kind: 'impossible' as const };
      if (result.kind === 'applied') {
        return buildAppliedResult({
          state: result.state,
          log: result.log?.length ? result.log : [`Returned this spell to hand (buyback): ${step.raw}`],
        });
      }
    }
    return buildAppliedResult({
      state: nextState,
      log: [`Returned this spell to hand (buyback, implicit): ${step.raw}`],
    });
  }

  if (parsedThisCardFromExile && step.to === 'battlefield') {
    const sourceZone =
      resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this card' }, ctx, step.raw) ||
      (() => {
        const sourceId = String(ctx.sourceId || '').trim();
        const location = sourceId ? findBoundCardZoneLocation(nextState, sourceId) : null;
        return location?.zone === 'exile' ? { ...location, cardId: sourceId } : null;
      })();
    if (!sourceZone || sourceZone.zone !== 'exile') {
      const controller = nextState.players.find(p => p.id === controllerId) as any;
      const exile = Array.isArray(controller?.exile) ? controller.exile : [];
      const fallback = exile.find((card: any) => String(card?.id || '').trim() === 'exile-source-self');
      if (!fallback) {
        return {
          applied: false,
          message: `Skipped move zone (source card not in exile): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      const result = moveTargetedCardFromExile(
        nextState,
        controllerId,
        'exile-source-self',
        'any',
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (exile card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }
    const result = moveTargetedCardFromExile(
      nextState,
      sourceZone.playerId,
      sourceZone.cardId,
      'any',
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (exile card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedThatSpell && step.to === 'hand') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || 'stack-spell-1').trim();
    const stack = Array.isArray((nextState as any).stack) ? [...(nextState as any).stack] : [];
    const spellIndex = stack.findIndex(entry => String((entry as any)?.id || '').trim() === targetSpellId);
    if (spellIndex < 0) {
      return {
        applied: false,
        message: `Skipped move zone (target spell unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const spell = stack[spellIndex] as any;
    const ownerId = String(spell?.owner || spell?.controller || controllerId).trim() as PlayerID;
    const card = spell?.card || { id: `${targetSpellId}-card`, name: 'Returned Spell', type_line: 'Instant' };
    const player = nextState.players.find(p => p.id === ownerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = nextState.players.map(p => (p.id === ownerId ? ({ ...(p as any), hand } as any) : p));
    const updatedStack = stack.filter((_, index) => index !== spellIndex);
    return buildAppliedResult({
      state: { ...(nextState as any), stack: updatedStack, players: updatedPlayers as any } as any,
      log: [`Returned ${targetSpellId} to ${ownerId}'s hand`],
    });
  }

  if (parsedUpToBattlefieldBounce && step.to === 'hand') {
    const dynamicMaxCount = /^up to x target permanents$/i.test(String((step.what as any)?.text || ''))
      ? Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedUpToBattlefieldBounce.maxCount;
    const selectorText = parsedUpToBattlefieldBounce.selectorText;
    let targetIds: string[] = [];
    if (/^target creatures?$/i.test(selectorText)) {
      targetIds = Array.from(
        new Set(
          [
            String(ctx.targetCreatureId || '').trim(),
            String(ctx.targetPermanentId || '').trim(),
            ...getChosenObjectIds(ctx),
          ].filter(Boolean)
        )
      ).slice(0, dynamicMaxCount);
    } else {
      const selector = parseSimpleBattlefieldSelector({
        kind: 'raw',
        text: selectorText,
      } as any);
      if (!selector) {
        return {
          applied: false,
          message: `Skipped move zone (unsupported selector): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
      const battlefield = [...((nextState.battlefield || []) as any[])];
      const matches = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
      const preferred = getChosenObjectIds(ctx);
      targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      if (preferred.length > 0) {
        targetIds = targetIds.filter(id => preferred.includes(id));
        if (targetIds.length === 0) {
          targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
        }
      }
      if (targetIds.length > dynamicMaxCount) {
        return {
          applied: false,
          message: `Skipped move zone (needs player bounce choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      targetIds = targetIds.slice(0, dynamicMaxCount);
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedCardFromAmongThoseCards && step.to === 'hand') {
    const cardId = resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'hand',
      parsedCardFromAmongThoseCards.cardType,
      getChosenObjectIds(ctx)
    ) || resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'graveyard',
      parsedCardFromAmongThoseCards.cardType,
      getChosenObjectIds(ctx)
    ) || resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'exile',
      parsedCardFromAmongThoseCards.cardType,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No among-those-cards match: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (among-those-cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (location.zone === 'hand') {
      return buildAppliedResult({ state: nextState, log: [`Card already in hand: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: parsedCardFromAmongThoseCards.cardType }, 'hand')
        : moveTargetedCardFromExile(nextState, location.playerId, cardId, parsedCardFromAmongThoseCards.cardType, 'hand');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (among-those-cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedTypedCardFromYourGraveyard) {
    const libraryPlacement = getLibraryPlacement(step);
    const preferredIds = getChosenObjectIds(ctx);
    const graveyardCriteria = parsedTypedCardFromYourGraveyard;
    let cardId = preferredIds.find(id => {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      return graveyard.some(
        (card: any) =>
          String(card?.id || '').trim() === id &&
          cardMatchesMoveZoneSingleTargetCriteria(card, graveyardCriteria)
      );
    });
    if (!cardId) {
      cardId = resolveTypedCardIdFromPlayerZone(
        nextState,
        controllerId,
        'graveyard',
        graveyardCriteria.cardType,
        preferredIds
      );
    }
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard card: ${step.raw}`] });
    }
    const destination =
      step.to === 'library' && libraryPlacement
        ? libraryPlacement === 'top'
          ? 'library_top'
          : 'library_bottom'
        : step.to === 'battlefield'
          ? 'battlefield'
          : step.to;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      graveyardCriteria,
      destination as any,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOneOfThemHandBounce) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['battlefield']);
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const targetId = preferred[0] || candidateIds[0] || '';
    if (!targetId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual battlefield permanent: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
    return finalizeAppliedResult(result);
  }

  if (parsedCardFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    const libraryPlacement = getLibraryPlacement(step);
    if (step.to === 'library' && libraryPlacement) {
      const preferredIds = getChosenObjectIds(ctx);
      const result = moveCountFromHandToLibrary(
        nextState,
        targetPlayerId,
        1,
        libraryPlacement === 'top' ? 'top' : 'bottom',
        preferredIds
      );
      if (result.kind === 'player_choice_required') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return buildAppliedResult({
        state: result.state,
        log: result.log.length > 0 ? result.log : [`Moved target opponent hand card to library: ${step.raw}`],
      });
    }

    if (step.to === 'exile') {
      const preferredIds = getChosenObjectIds(ctx);
      let targetObjectId = preferredIds.find(id => {
        const player = nextState.players.find(p => p.id === targetPlayerId) as any;
        const hand = Array.isArray(player?.hand) ? player.hand : [];
        return hand.some((card: any) => String(card?.id || '').trim() === id);
      });
      if (!targetObjectId) {
        const player = nextState.players.find(p => p.id === targetPlayerId) as any;
        const hand = Array.isArray(player?.hand) ? player.hand : [];
        if (hand.length === 1) {
          targetObjectId = String((hand[0] as any)?.id || '').trim();
        }
      }
      if (!targetObjectId) {
        return {
          applied: false,
          message: `Skipped move zone (unsupported selector): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
      const result = moveTargetedCardFromHand(
        nextState,
        targetPlayerId,
        targetObjectId,
        parsedCardFromTargetPlayerHand.cardType,
        'exile'
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }
  }

  if (parsedCardFromAGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCardFromAGraveyard.cardType,
      getChosenObjectIds(ctx),
      1
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard card matched: ${step.raw}`],
      });
    }
    if (matches.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (graveyard target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const match = matches[0];
    const result = moveTargetedCardFromGraveyard(
      nextState,
      match.playerId,
      match.cardId,
      { cardType: parsedCardFromAGraveyard.cardType },
      'exile'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedCardFromAGraveyard && step.to === 'battlefield') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCardFromAGraveyard.cardType,
      getChosenObjectIds(ctx),
      1
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard card matched: ${step.raw}`],
      });
    }
    if (matches.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (graveyard target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const match = matches[0];
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? match.playerId
          : controllerId;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      match.playerId,
      match.cardId,
      { cardType: parsedCardFromAGraveyard.cardType },
      'battlefield',
      battlefieldControllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToFromSingleGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedUpToFromSingleGraveyard.cardType,
      getChosenObjectIds(ctx),
      parsedUpToFromSingleGraveyard.maxCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard cards matched: ${step.raw}`],
      });
    }
    const playerIds = new Set(matches.map(match => match.playerId));
    if (playerIds.size > 1) {
      return {
        applied: false,
        message: `Skipped move zone (single graveyard constraint): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedUpToFromSingleGraveyard.cardType },
        'exile'
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from a single graveyard: ${step.raw}`],
    });
  }

  if (parsedAllCardsMilledThisWay && step.to === 'battlefield') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['graveyard']).filter(cardId => {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: parsedAllCardsMilledThisWay.cardType });
    });
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-way cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: parsedAllCardsMilledThisWay.cardType },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved milled-this-way cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (
    (parsedThatCardReference || /\bthat card\b/i.test(String((step.what as any)?.text || ''))) &&
    (step.to === 'hand' || step.to === 'battlefield') &&
    /\bonto the battlefield or into your hand\b/i.test(String(step.raw || ''))
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => Boolean(findBoundCardZoneLocation(nextState, id))) ||
      String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (that card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const destination = step.to === 'battlefield' ? 'battlefield' : 'hand';
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            destination,
            destination === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'hand'
          ? destination === 'hand'
            ? { kind: 'applied' as const, state: nextState, log: [`Card already in hand: ${step.raw}`] }
            : moveTargetedCardFromHand(
                nextState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
          : moveTargetedCardFromExile(
              nextState,
              location.playerId,
              cardId,
              'any',
              destination,
              destination === 'battlefield' ? controllerId : undefined,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (that card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedTypedCardFromHandOrGraveyard && (step.to === 'battlefield' || step.to === 'exile')) {
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedTypedCardFromHandOrGraveyard, ctx);
    const preferredIds = getChosenObjectIds(ctx);
    const zoneOwnerId =
      parsedTypedCardFromHandOrGraveyard.fromHandOrGraveyardOwner === 'target_player'
        ? getTargetPlayerId(ctx) || controllerId
        : controllerId;
    let cardId = '';
    let location: BoundCardZoneLocation | null = null;
    for (const zone of ['hand', 'graveyard'] as const) {
      const player = nextState.players.find(p => p.id === zoneOwnerId) as any;
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      const matches = cards.filter(
        (card: any) =>
          cardMatchesMoveZoneSingleTargetCriteria(card, criteria) &&
          (preferredIds.length === 0 || preferredIds.includes(String(card?.id || '').trim()))
      );
      if (matches.length === 1) {
        cardId = String(matches[0]?.id || '').trim();
        location = { playerId: zoneOwnerId, zone, cardId };
        break;
      }
      if (matches.length > 1 && preferredIds.length > 0) {
        const preferred = matches.find((card: any) =>
          preferredIds.includes(String(card?.id || '').trim())
        );
        if (preferred) {
          cardId = String(preferred?.id || '').trim();
          location = { playerId: zoneOwnerId, zone, cardId };
          break;
        }
      }
    }
    if (!cardId || !location) {
      return {
        applied: false,
        message: `Skipped move zone (hand or graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const destination = step.to === 'exile' ? 'exile' : 'battlefield';
    const result =
      location.zone === 'hand'
        ? moveTargetedCardFromHand(
            nextState,
            zoneOwnerId,
            cardId,
            criteria.cardType,
            destination,
            destination === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            battlefieldEntryOverrides
          )
        : moveTargetedCardFromGraveyard(
            nextState,
            zoneOwnerId,
            cardId,
            criteria,
            destination,
            destination === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand or graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedMvLessThanReferenceFromHand && step.to === 'battlefield') {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || 'bf-creature-1').trim();
    const targetPerm = (nextState.battlefield || []).find((perm: any) => String(perm?.id || '').trim() === targetId) as any;
    const referenceMv = getCardManaValue(targetPerm?.card || targetPerm);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferredIds = getChosenObjectIds(ctx);
    const matches = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, parsedMvLessThanReferenceFromHand.cardType)) return false;
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) return false;
      const mv = getCardManaValue(card);
      return mv !== null && referenceMv !== null && mv < referenceMv;
    });
    const card = matches.length === 1 ? matches[0] : preferredIds.length > 0 ? matches.find((c: any) => preferredIds.includes(String(c?.id || '').trim())) : matches[0];
    const cardId = String((card as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (reference-mv hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      parsedMvLessThanReferenceFromHand.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (reference-mv hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedRevealedThisWayRest && step.to === 'library' && getLibraryPlacement(step) === 'bottom') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['hand', 'exile']);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No revealed-this-way rest cards: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'library') continue;
      const result =
        location.zone === 'hand'
          ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'library_bottom')
          : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'library_bottom');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved revealed-this-way rest to library bottom: ${step.raw}`],
    });
  }

  if (parsedReturnThisCardAndUpToOneOther && step.to === 'battlefield') {
    const sourceZone = resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this card' }, ctx, step.raw);
    const preferredIds = getChosenObjectIds(ctx).filter(id => id !== sourceZone?.cardId);
    const otherId = resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'graveyard',
      parsedReturnThisCardAndUpToOneOther.otherCardType,
      preferredIds
    );
    const cardIds = [sourceZone?.cardId, otherId].filter(Boolean) as string[];
    if (cardIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (compound graveyard return unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        location.playerId,
        cardId,
        { cardType: 'any' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    if (combinedLog.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (compound graveyard return unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedNamedCardReference && step.to === 'hand') {
    const wantedName = parsedNamedCardReference.toLowerCase();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const match = battlefield.find(perm => {
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '').trim().toLowerCase();
      return name.includes(wantedName);
    });
    if (!match) {
      return {
        applied: false,
        message: `Skipped move zone (named card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [String((match as any)?.id || '').trim()]);
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberAurasFromYourGy && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferredIds = getChosenObjectIds(ctx);
    const auraIds = graveyard
      .filter((card: any) => String((card as any)?.type_line || '').toLowerCase().includes('aura'))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const chosen =
      preferredIds.length > 0 ? auraIds.filter(id => preferredIds.includes(id)) : auraIds;
    const attachTargetId =
      preferredIds.find(id => (nextState.battlefield || []).some((perm: any) => String(perm?.id || '').trim() === id)) ||
      String(ctx.targetCreatureId || ctx.targetPermanentId || 'bf-creature-1').trim();
    if (chosen.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (aura graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of chosen) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'aura' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachTargetId
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned aura cards attached: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    'criteria' in parsedTypedCardFromAmongMilledCards &&
    step.to === 'hand'
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedTypedCardFromAmongMilledCards.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, cardId, { cardType: 'any' }, 'hand');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    'criteria' in parsedTypedCardFromAmongMilledCards &&
    step.to === 'library' &&
    getLibraryPlacement(step) === 'top'
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedTypedCardFromAmongMilledCards.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: 'any' },
      'library_top'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    !('criteria' in parsedTypedCardFromAmongMilledCards) &&
    step.to === 'hand'
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongMilledCards, ctx);
    const matchingIds = resolveAmongMilledMatchingCardIds(nextState, controllerId, effectiveCriteria, preferredIds);
    const cardId = matchingIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, cardId, effectiveCriteria, 'hand');
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Milled card unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    !('criteria' in parsedTypedCardFromAmongMilledCards) &&
    step.to === 'library' &&
    getLibraryPlacement(step) === 'top'
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongMilledCards, ctx);
    const matchingIds = resolveAmongMilledMatchingCardIds(nextState, controllerId, effectiveCriteria, preferredIds);
    const cardId = matchingIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      effectiveCriteria,
      'library_top'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    !('criteria' in parsedTypedCardFromAmongMilledCards) &&
    step.to === 'battlefield'
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongMilledCards, ctx);
    const matchingIds = resolveAmongMilledMatchingCardIds(nextState, controllerId, effectiveCriteria, preferredIds);
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of matchingIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        effectiveCriteria,
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved milled cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCreatureYouControl && step.to === 'library' && getLibraryPlacement(step) === 'top') {
    const controlledCreatures = ((nextState.battlefield || []) as any[]).filter(
      perm =>
        perm?.controller === controllerId &&
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.id || '').trim() !== String(ctx.sourceId || '').trim()
    );
    const preferred = getChosenObjectIds(ctx);
    let targetId = controlledCreatures
      .map(perm => String((perm as any)?.id || '').trim())
      .find(id => preferred.includes(id));
    if (!targetId && controlledCreatures.length === 1) {
      targetId = String((controlledCreatures[0] as any)?.id || '').trim();
    }
    if (!targetId && controlledCreatures.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (needs player creature choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (!targetId) {
      return buildAppliedResult({ state: nextState, log: [`No creature to move to library top: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, [targetId], 'top');
    return finalizeAppliedResult(result);
  }

  if (parsedLesserMvThanDiedFromGy && step.to === 'hand') {
    const diedManaValue = getDiedCreatureManaValueFromCtx(ctx, runtime);
    if (diedManaValue === null) {
      return buildAppliedResult({ state: nextState, log: [`No died creature reference for lesser MV return: ${step.raw}`] });
    }
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(controllerPlayer?.graveyard) ? controllerPlayer.graveyard : [];
    const preferred = getChosenObjectIds(ctx);
    let cardId = '';
    for (const card of graveyard) {
      if (!hasExecutorClass(card as any, 'creature')) continue;
      const manaValue = getCardManaValue(card);
      if (manaValue === null || manaValue >= diedManaValue) continue;
      const candidateId = String((card as any)?.id || '').trim();
      if (!candidateId) continue;
      if (preferred.includes(candidateId)) {
        cardId = candidateId;
        break;
      }
      if (!cardId) cardId = candidateId;
    }
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No lesser-MV creature in graveyard: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedLesserMvThanDiedFromGy,
      'hand'
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Lesser-MV graveyard return unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedRandomCardFromTargetPlayerHand && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = exileRandomCardFromHand(nextState, targetPlayerId, getChosenObjectIds(ctx));
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled random hand card: ${step.raw}`],
      movedCards: result.movedCards,
    });
  }

  if (parsedCompoundExileItAndEachPlayerReturnGyCreatures) {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const sourceId = String(ctx.sourceId || '').trim();
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const sourceGyCard = graveyard.find((card: any) => {
        const cardId = String(card?.id || '').trim();
        return (
          cardId === sourceId ||
          cardId === 'gy-source-self' ||
          cardId.startsWith('gy-source')
        );
      });
      const sourceGyCardId = String((sourceGyCard as any)?.id || '').trim();
      if (!sourceGyCardId || playerId !== controllerId) continue;
      const exileResult = moveTargetedCardFromGraveyard(
        workingState,
        playerId,
        sourceGyCardId,
        { cardType: 'any' },
        'exile'
      );
      if (exileResult.kind === 'applied') {
        workingState = exileResult.state;
        combinedLog.push(...(exileResult.log || []));
      }
      break;
    }
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const returnResult = returnAllMatchingFromGraveyardToHand(workingState, playerId, 'creature');
      workingState = returnResult.state;
      combinedLog.push(...returnResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Compound graveyard return: ${step.raw}`],
    });
  }

  if (
    parsedTypedCardFromTargetPlayerGy &&
    (step.to === 'hand' || step.to === 'exile' || step.to === 'battlefield')
  ) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      targetPlayerId,
      [parsedTypedCardFromTargetPlayerGy],
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (target graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      cardId,
      parsedTypedCardFromTargetPlayerGy,
      step.to === 'exile' ? 'exile' : step.to === 'battlefield' ? 'battlefield' : 'hand',
      step.to === 'battlefield' ? targetPlayerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      step.withCounters
    );
    return result.kind === 'impossible'
      ? {
          applied: false,
          message: `Skipped move zone (target graveyard card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        }
      : finalizeAppliedResult(result);
  }

  if (parsedAnyNumberMountainsYouControl && step.to === 'hand') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(controllerPlayer?.hand) ? [...controllerPlayer.hand] : [];
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const mountains = battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId &&
        cardMatchesType(perm?.card || perm, 'land') &&
        getExecutorTypeLineLower(perm?.card || perm).includes('mountain')
    );
    const movedIds = mountains.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, movedIds);
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log:
        result.log.length > 0
          ? [`Returned ${movedIds.length} Mountain(s) to hand: ${step.raw}`, ...result.log]
          : [`Returned ${movedIds.length} Mountain(s) to hand: ${step.raw}`],
      lastMovedCards: mountains.map((perm: any) => perm?.card || perm),
    });
  }

  if (parsedThoseCreatureCards && step.to === 'battlefield') {
    const contextual = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const creatureCards = contextual.filter((card: any) => cardMatchesType(card, 'creature'));
    const seen = new Set<string>();
    const uniqueCards = creatureCards.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) return false;
      seen.add(cardId);
      return true;
    });
    if (uniqueCards.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual creature cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const card of uniqueCards) {
      const cardId = String((card as any)?.id || '').trim();
      const location = findBoundCardZoneLocation(workingState, cardId);
      const result = location
        ? location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
              controllerId,
              cardType: 'creature',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                { cardType: 'creature' },
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  'creature',
                  'battlefield',
                  controllerId,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : moveTargetedCardFromExile(
                  workingState,
                  location.playerId,
                  cardId,
                  'creature',
                  'battlefield',
                  controllerId,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
        : {
            kind: 'applied' as const,
            state: addBattlefieldPermanentsToState(
              workingState,
              createBattlefieldPermanentsFromCards(
                [card],
                controllerId,
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                'library'
              )
            ),
            log: [`${controllerId} puts ${cardId} onto the battlefield from contextual cards`],
            movedPermanentIds: [],
          };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved ${uniqueCards.length} creature card(s) to battlefield`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedTopTypedCardFromYourGy && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const topMatch = [...graveyard].reverse().find((card: any) =>
      cardMatchesMoveZoneSingleTargetCriteria(card, parsedTopTypedCardFromYourGy)
    );
    const cardId = String((topMatch as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedTopTypedCardFromYourGy,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? {
          applied: false,
          message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        }
      : finalizeAppliedResult(result);
  }

  if (parsedEachCreatureMvXFromGy && step.to === 'battlefield') {
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedEachCreatureMvXFromGy, ctx);
    const returnResult = putAllMatchingCriteriaFromGraveyardOntoBattlefield(
      nextState,
      controllerId,
      controllerId,
      criteria,
      [],
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: returnResult.state,
      log: returnResult.log.length > 0 ? returnResult.log : [`Returned each creature MV X or less: ${step.raw}`],
      movedBattlefieldPermanentIds: returnResult.movedPermanentIds,
    });
  }

  if (parsedTopTypedCardFromTargetPlayerGy && step.to === 'battlefield') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const topMatch = [...graveyard].reverse().find((card: any) =>
      cardMatchesMoveZoneSingleTargetCriteria(card, parsedTopTypedCardFromTargetPlayerGy)
    );
    const cardId = String((topMatch as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      cardId,
      parsedTopTypedCardFromTargetPlayerGy,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? {
          applied: false,
          message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        }
      : finalizeAppliedResult(result);
  }

  if (parsedShuffleTypedCardsOfThatType && step.to === 'library') {
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedShuffleTypedCardsOfThatType, ctx);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const matching = graveyard.filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, criteria));
    if (matching.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards to shuffle: ${step.raw}`] });
    }
    const kept = graveyard.filter((card: any) => !matching.includes(card));
    const library = Array.isArray(player?.library) ? [...player.library, ...matching] : [...matching];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId ? ({ ...(p as any), graveyard: kept, library } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any },
      log: [`Shuffled ${matching.length} card(s) from graveyard into library: ${step.raw}`],
    });
  }

  if (parsedEachPlayerGyNotPutThisWay && step.to === 'battlefield') {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const player of (workingState.players || []) as any[]) {
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !cardMatchesMoveZoneSingleTargetCriteria(card, parsedEachPlayerGyNotPutThisWay)) continue;
        const result = moveTargetedCardFromGraveyard(
          workingState,
          player.id,
          cardId,
          parsedEachPlayerGyNotPutThisWay,
          'battlefield',
          player.id,
          step.entersTapped,
          step.entersFaceDown,
          effectiveWithCounters,
          undefined,
          undefined,
          battlefieldEntryOverrides
        );
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...(result.movedPermanentIds || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned each-player graveyard cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfTheChosenCards && step.to === 'battlefield') {
    const chosenIds = getChosenObjectIds(ctx);
    const cardId = chosenIds[0];
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (no chosen card for battlefield): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (chosen card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            controllerId,
            step.entersTapped,
            step.entersFaceDown,
            step.withCounters
          )
        : moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
            controllerId,
            cardType: 'any',
            entersTapped: step.entersTapped,
            entersFaceDown: step.entersFaceDown,
            withCounters: step.withCounters,
          });
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (chosen card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({ state: result.state, log: result.log });
  }

  if (parsedOtherChosenCards && step.to === 'hand') {
    const chosenIds = getChosenObjectIds(ctx).slice(1);
    if (chosenIds.length === 0) {
      return { applied: true, state: nextState, log: ['No other chosen cards to move to hand'] };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of chosenIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : moveContextualCardToDestination(workingState, location, cardId, 'hand', {
                controllerId,
                cardType: 'any',
              });
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...result.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved other chosen cards to hand: ${step.raw}`],
    });
  }

  if ((parsedTheChosenCards || parsedChosenCardsRestToLibrary) && step.to === 'hand') {
    const preferredIds = getChosenObjectIds(ctx);
    const matchingIds = preferredIds.filter(id => Boolean(findBoundCardZoneLocation(nextState, id)));
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (chosen cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    for (const cardId of matchingIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'hand'
            ? { kind: 'applied' as const, state: workingState, log: [] }
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(cardId);
    }
    if (parsedChosenCardsRestToLibrary) {
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, movedCardIds);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved chosen cards: ${step.raw}`],
    });
  }

  if (
    (parsedTypedCardsRevealedThisWay || parsedRevealedThisWayRestToLibrary) &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield')
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardsRevealedThisWay || { cardType: 'any' }, ctx);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['library', 'exile', 'hand', 'graveyard']);
    const matchingIds = candidateIds.filter(cardId => {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
    });
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (revealed-this-way card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of matchingIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, step.to, {
              controllerId,
              cardType: effectiveCriteria.cardType,
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                effectiveCriteria,
                step.to,
                step.to === 'battlefield' ? controllerId : undefined,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  step.to,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : moveTargetedCardFromExile(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  step.to,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(cardId);
      movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
    if (parsedRevealedThisWayRestToLibrary) {
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, movedCardIds);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved revealed-this-way cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds.length > 0 ? movedBattlefieldIds : undefined,
    });
  }

  if (parsedTypedCardFromAmongThem) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongThem, ctx);
    if (parsedTypedCardFromAmongThem.handGySplit && step.to === 'hand') {
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const matchingIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => matchingIds.includes(id));
      const xHandCount =
        parsedTypedCardFromAmongThem.maxCount === -1
          ? Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
          : undefined;
      const handIds =
        preferred.length > 0
          ? preferred.slice(0, xHandCount ?? preferred.length)
          : parsedTypedCardFromAmongThem.anyNumber
            ? matchingIds.slice(0, xHandCount ?? matchingIds.length)
            : matchingIds.slice(
                0,
                xHandCount ?? Math.min(parsedTypedCardFromAmongThem.maxCount || 2, matchingIds.length)
              );
      const restIds = candidateIds.filter(id => !handIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      for (const cardId of handIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'hand') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
                controllerId,
                cardType: effectiveCriteria.cardType,
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, effectiveCriteria, 'hand')
              : moveTargetedCardFromExile(workingState, location.playerId, cardId, effectiveCriteria.cardType, 'hand');
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      for (const cardId of restIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'graveyard') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
                controllerId,
                cardType: 'any',
              })
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
              : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard');
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split among-them cards to hand and graveyard: ${step.raw}`],
      });
    }
    if (parsedTypedCardFromAmongThem.bfHandSplit && step.to === 'hand') {
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const matchingPermanentIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => matchingPermanentIds.includes(id));
      const bfIds =
        preferred.length > 0
          ? preferred
          : parsedTypedCardFromAmongThem.anyNumber
            ? matchingPermanentIds
            : matchingPermanentIds.slice(0, Math.min(2, matchingPermanentIds.length));
      const restIds = candidateIds.filter(id => !bfIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const entersTapped =
        step.entersTapped || parsedTypedCardFromAmongThem.entersTappedFromWhat === true;
      for (const cardId of bfIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
                controllerId,
                cardType: effectiveCriteria.cardType,
                entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria,
                  'battlefield',
                  controllerId,
                  entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  undefined,
                  battlefieldEntryOverrides
                )
              : location.zone === 'hand'
                ? moveTargetedCardFromHand(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  )
                : moveTargetedCardFromExile(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
      }
      for (const cardId of restIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'hand') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
                controllerId,
                cardType: 'any',
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
              : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split among-them cards to battlefield and hand: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }
    if (
      parsedTypedCardFromAmongThem.bfLibraryBottomSplit &&
      (step.to === 'library' || step.to === 'battlefield')
    ) {
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const matchingLandIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => matchingLandIds.includes(id));
      const maxCount = parsedTypedCardFromAmongThem.anyNumber
        ? matchingLandIds.length
        : parsedTypedCardFromAmongThem.maxCount || 1;
      const bfIds =
        parsedTypedCardFromAmongThem.totalManaValueLte !== undefined
          ? selectContextualCardsWithTotalManaValueLte(
              Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [],
              effectiveCriteria.cardType,
              parsedTypedCardFromAmongThem.totalManaValueLte,
              maxCount,
              preferredIds
            )
          : preferred.length > 0
            ? parsedTypedCardFromAmongThem.anyNumber
              ? preferred
              : preferred.slice(0, maxCount)
            : matchingLandIds.slice(0, Math.min(maxCount, matchingLandIds.length));
      const restIds = candidateIds.filter(id => !bfIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const entersTapped =
        step.entersTapped || parsedTypedCardFromAmongThem.entersTappedFromWhat === true;
      for (const cardId of bfIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
                controllerId,
                cardType: effectiveCriteria.cardType,
                entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  'battlefield',
                  controllerId,
                  entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : location.zone === 'graveyard'
                ? moveTargetedCardFromGraveyard(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    undefined,
                    battlefieldEntryOverrides
                  )
                : moveTargetedCardFromExile(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
      }
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, bfIds);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split among-them lands to battlefield and library bottom: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }
    const matchingIds = resolveAmongThemMatchingCardIds(
      nextState,
      controllerId,
      effectiveCriteria,
      preferredIds
    );
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (typed among-them card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const destination =
      step.to === 'library'
        ? getLibraryPlacement(step) === 'top'
          ? 'library_top'
          : 'library_bottom'
        : step.to;

    if (parsedTypedCardFromAmongThem.anyNumber) {
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const movedCardIds: string[] = [];
      for (const cardId of matchingIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, destination === 'hand' ? 'hand' : 'library_bottom', {
                controllerId,
                cardType: effectiveCriteria.cardType,
                entersTapped: step.entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                { cardType: effectiveCriteria.cardType },
                destination as any,
                step.to === 'battlefield' ? controllerId : undefined,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  destination as any,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : moveTargetedCardFromExile(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  destination as any,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                );
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedCardIds.push(cardId);
        movedBattlefieldIds.push(...(result.movedPermanentIds || []));
      }
      if (stepHasAmongThemRestToLibrary(step)) {
        const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, movedCardIds);
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Moved among-them cards: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }

    const cardId = matchingIds[0];
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (typed among-them card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const result =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, cardId, destination === 'hand' ? 'hand' : 'library_bottom', {
            controllerId,
            cardType: parsedTypedCardFromAmongThem.cardType,
            entersTapped: step.entersTapped,
            entersFaceDown: step.entersFaceDown,
            withCounters: effectiveWithCounters,
            battlefieldEntryOverrides,
          })
        : location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: parsedTypedCardFromAmongThem.cardType },
            destination as any,
            step.to === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              location.playerId,
              cardId,
              parsedTypedCardFromAmongThem.cardType,
              destination as any,
              step.to === 'battlefield' ? controllerId : undefined,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              location.playerId,
              cardId,
              parsedTypedCardFromAmongThem.cardType,
              destination as any,
              step.to === 'battlefield' ? controllerId : undefined,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (typed among-them card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = result.state;
    const combinedLog = [...(result.log || [])];
    if (stepHasAmongThemRestToLibrary(step)) {
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, [cardId]);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({ state: workingState, log: combinedLog });
  }

  if (parsedRestOfExiledCards && step.to === 'hand') {
    const contextualExiled = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
    let cardIds = contextualExiled
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    if (cardIds.length === 0) {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      cardIds = (Array.isArray(player?.exile) ? player.exile : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean);
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromExile(workingState, controllerId, cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Moved rest of exiled cards to hand: ${step.raw}`],
    });
  }

  if (parsedTheRestToGraveyard) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'hand',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched the rest: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'graveyard') continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
              controllerId,
              cardType: 'any',
            })
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved the rest to graveyard: ${step.raw}`],
    });
  }

  if (parsedTheRestToBattlefield) {
    const contextualExiled = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const cardIds = contextualExiled
      .map((card: any) => String(card?.id || '').trim())
      .filter(id => id && !preferred.has(id));
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromExile(workingState, controllerId, cardId, 'any', 'battlefield', controllerId);
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const bfId = String((result as any).movedPermanentId || '').trim();
      if (bfId) movedBattlefieldIds.push(bfId);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved the rest to battlefield: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedTheRestToHand) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched the rest: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'hand') continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
              controllerId,
              cardType: 'any',
            })
          : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved the rest to hand: ${step.raw}`],
    });
  }

  if (
    (parsedThatCardReference || /\bthat card\b/i.test(String((step.what as any)?.text || ''))) &&
    step.to === 'hand' &&
    !/\bonto the battlefield or into your hand\b/i.test(String(step.raw || ''))
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const contextualIds = contextual
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const cardId =
      preferredIds.find(id => contextualIds.includes(id) || Boolean(findBoundCardZoneLocation(nextState, id))) ||
      contextualIds[0] ||
      preferredIds[0] ||
      String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No that-card reference available: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : location.zone === 'library'
            ? moveContextualCardToDestination(nextState, location, cardId, 'hand', {
                controllerId,
                cardType: 'any',
              })
            : moveTargetedCardFromHand(nextState, location.playerId, cardId, 'any', 'hand');
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`That card unavailable: ${step.raw}`] });
    }
    return buildAppliedResult({ state: result.state, log: result.log || [`Returned that card to hand: ${step.raw}`] });
  }

  if (parsedTheOtherToBattlefield) {
    const preferredIds = getChosenObjectIds(ctx);
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const contextualIds = contextual
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const chosenId = preferredIds.find(id => contextualIds.includes(id)) || contextualIds[0] || '';
    const otherCard =
      contextual.find((card: any) => String(card?.id || '').trim() !== chosenId) || contextual[1] || contextual[0];
    const cardId = String(otherCard?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No other contextual card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`Other contextual card unavailable: ${step.raw}`] });
    }
    const bfController = String(step.battlefieldController?.kind === 'you' ? controllerId : controllerId);
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            bfController,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(
              nextState,
              location.playerId,
              cardId,
              'any',
              'battlefield',
              bfController,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(
                nextState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                bfController,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
                controllerId: bfController,
                cardType: 'any',
                entersTapped: step.entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              });
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`Other contextual card unavailable: ${step.raw}`] });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log || [`Returned the other to the battlefield: ${step.raw}`],
      movedBattlefieldPermanentIds: (result as any).movedPermanentIds,
    });
  }

  if (parsedTheOtherToLibrary) {
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const exiledIds = new Set(
      (Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const chosenId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') || ''
    ).trim();
    const otherCard =
      contextual.find((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && cardId !== chosenId && !exiledIds.has(cardId);
      }) ||
      contextual.find((card: any) => !exiledIds.has(String(card?.id || '').trim())) ||
      contextual[1] ||
      contextual[0];
    const cardId = String(otherCard?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No other contextual card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveContextualCardToDestination(nextState, location, cardId, 'library_bottom', {
      controllerId: location.playerId,
      cardType: 'any',
    });
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log || [`Moved the other to library bottom: ${step.raw}`],
    });
  }

  if (parsedTheOtherToHand) {
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const exiledIds = new Set(
      (Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const otherCard = contextual.find((card: any) => !exiledIds.has(String(card?.id || '').trim())) || contextual[1] || contextual[0];
    const cardId = String(otherCard?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No other contextual card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, cardId, 'hand', {
            controllerId,
            cardType: 'any',
          })
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : moveTargetedCardFromHand(nextState, location.playerId, cardId, 'any', 'hand');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({ state: result.state, log: result.log || [`Moved the other to hand: ${step.raw}`] });
  }

  if (parsedTheRestToLibrary) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'hand',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched the rest: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'graveyard') continue;
      const result =
        location.zone === 'hand'
          ? moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom')
          : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (location.zone === 'exile') {
        const libraryResult = moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom');
        if (libraryResult.kind === 'applied') {
          workingState = libraryResult.state;
          combinedLog.push(...(libraryResult.log || []));
        }
      }
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Shuffled the rest into library: ${step.raw}`],
    });
  }

  if (parsedAnotherCardFromGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedAnotherCardFromGraveyard.cardType,
      getChosenObjectIds(ctx),
      1
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard card matched: ${step.raw}`],
      });
    }
    if (matches.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (graveyard target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const match = matches[0];
    const result = moveTargetedCardFromGraveyard(
      nextState,
      match.playerId,
      match.cardId,
      { cardType: parsedAnotherCardFromGraveyard.cardType },
      'exile'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOrTypedCardsFromGraveyard && step.to === 'hand') {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedOrTypedCardsFromGraveyard.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({
        state: nextState,
        log: [`No matching graveyard card: ${step.raw}`],
      });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: 'any' },
      'hand'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToFromGraveyards && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedUpToFromGraveyards.cardType,
      getChosenObjectIds(ctx),
      parsedUpToFromGraveyards.maxCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard cards matched: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedUpToFromGraveyards.cardType },
        'exile'
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from graveyards: ${step.raw}`],
    });
  }

  if (parsedAllCardsExiledWithIt) {
    const linkedSourceId = String(ctx.sourceId || '').trim();
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const matches = findCardsExiledWithSource(nextState, linkedSourceId, { cardType: 'any' });
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        'any',
        step.to === 'battlefield' ? 'battlefield' : step.to,
        step.to === 'battlefield' && step.battlefieldController?.kind === 'you'
          ? controllerId
          : step.to === 'battlefield' && step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? match.playerId
            : undefined,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (parsedOneOfThemSplit) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched one-of-them split: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    const handCount =
      parsedOneOfThemSplit === 'up_to_hand_library_bottom' || parsedOneOfThemSplit === 'up_to_hand_graveyard_rest'
        ? Math.max(1, parsedUpToCountOfThem?.maxCount ?? 2)
        : parsedOneOfThemSplit === 'hand_graveyard_other'
          ? 1
          : 1;
    const handIds = candidateIds.slice(0, handCount);
    const restIds = candidateIds.slice(handCount);
    const restDestination =
      parsedOneOfThemSplit === 'hand_library_bottom' || parsedOneOfThemSplit === 'up_to_hand_library_bottom'
        ? 'library_bottom'
        : 'graveyard';

    for (const handId of handIds) {
      const handLocation = findBoundCardZoneLocation(workingState, handId);
      if (!handLocation) continue;
      if (handLocation.zone === 'hand') continue;
      const handResult = moveContextualCardToDestination(workingState, handLocation, handId, 'hand', {
        controllerId,
      });
      if (handResult.kind === 'impossible') continue;
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }

    for (const restId of restIds) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult = moveContextualCardToDestination(workingState, restLocation, restId, restDestination, {
        controllerId,
      });
      if (restResult.kind === 'impossible') continue;
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split one of them: ${step.raw}`],
    });
  }

  if (parsedOnePileSplit) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched one-pile split: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    const handId = candidateIds[0];
    const restIds = candidateIds.slice(1);

    const handLocation = findBoundCardZoneLocation(workingState, handId);
    if (handLocation && handLocation.zone !== 'hand') {
      const handResult =
        handLocation.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, handLocation.playerId, handId, { cardType: 'any' }, 'hand')
          : moveTargetedCardFromExile(workingState, handLocation.playerId, handId, 'any', 'hand');
      if (handResult.kind !== 'impossible') {
        workingState = handResult.state;
        combinedLog.push(...(handResult.log || []));
      }
    }

    for (const restId of restIds) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult =
        restLocation.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, restLocation.playerId, restId, { cardType: 'any' }, 'graveyard')
          : restLocation.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, restLocation.playerId, restId, 'any', 'graveyard')
            : moveTargetedCardFromExile(workingState, restLocation.playerId, restId, 'any', 'graveyard');
      if (restResult.kind === 'impossible') continue;
      workingState = restResult.state;
      combinedLog.push(...(restResult.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split one pile: ${step.raw}`],
    });
  }

  if (contextualBoundCardZone) {
    const targetObjectId = contextualBoundCardZone.cardId;
    const libraryPlacement = getLibraryPlacement(step);

    if (
      step.to !== 'hand' &&
      step.to !== 'exile' &&
      step.to !== 'graveyard' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const contextualBattlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : contextualBoundCardZone.playerId
        : undefined;

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;

    const result =
      contextualBoundCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            contextualBoundCardZone.playerId,
            targetObjectId,
            { cardType: 'any' },
            destination as any,
            contextualBattlefieldControllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : contextualBoundCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (sourceCardZone) {
    const libraryPlacement = getLibraryPlacement(step);
    if (
      step.to !== 'hand' &&
      step.to !== 'exile' &&
      step.to !== 'graveyard' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;
    const battlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : sourceCardZone.playerId
        : undefined;
    const result =
      sourceCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            sourceCardZone.playerId,
            sourceCardZone.cardId,
            { cardType: 'any' },
            destination as any,
            battlefieldControllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : sourceCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (source card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerGy) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnAllMatchingFromGraveyardToHand(nextState, targetPlayerId, parsedTargetPlayerGy.cardType)
        : step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromGraveyardOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : exileAllMatchingFromGraveyard(nextState, targetPlayerId, parsedTargetPlayerGy.cardType, {
              ...(parsedTargetPlayerGy.excludeBasicLands ? { excludeBasicLands: true } : {}),
            });
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerHandAndGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    if (!player) {
      return buildAppliedResult({ state: nextState, log: [`No target player for hand/graveyard exile: ${step.raw}`] });
    }
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const toExile = [...hand, ...graveyard].filter((card: any) =>
      cardMatchesType(card, parsedTargetPlayerHandAndGy.cardType)
    );
    const keptHand = hand.filter((card: any) => !cardMatchesType(card, parsedTargetPlayerHandAndGy.cardType));
    const keptGy = graveyard.filter((card: any) => !cardMatchesType(card, parsedTargetPlayerHandAndGy.cardType));
    const updatedPlayers = nextState.players.map((entry: any) =>
      String(entry?.id || '').trim() === targetPlayerId
        ? { ...entry, hand: keptHand, graveyard: keptGy, exile: [...exile, ...toExile] }
        : entry
    );
    return buildAppliedResult({
      state: { ...(nextState as any), players: updatedPlayers } as GameState,
      log: [`Exiled ${toExile.length} noncreature nonland card(s) from hand and graveyard`],
    });
  }

  if (parsedTheCardFromYourGraveyard && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === id);
      }) ||
      (() => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return String(graveyard[0]?.id || '').trim() || undefined;
      })();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard card to return: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: 'any' },
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToXLandsHandGy && step.to === 'battlefield') {
    const maxCount = Math.max(0, Number(ctx.xValue) || 1);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const landIds: string[] = [];
    for (const card of [...hand, ...graveyard]) {
      if (landIds.length >= maxCount) break;
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, 'land')) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      if (!landIds.includes(cardId)) landIds.push(cardId);
    }
    if (preferred.size > 0 && landIds.length === 0) {
      for (const card of [...hand, ...graveyard]) {
        if (landIds.length >= maxCount) break;
        const cardId = String(card?.id || '').trim();
        if (!cardId || !cardMatchesType(card, 'land') || landIds.includes(cardId)) continue;
        landIds.push(cardId);
      }
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of landIds) {
      const fromHand = hand.some((card: any) => String(card?.id || '').trim() === cardId);
      const result = fromHand
        ? moveTargetedCardFromHand(
            workingState,
            controllerId,
            cardId,
            'land',
            'battlefield',
            controllerId,
            true,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            battlefieldEntryOverrides
          )
        : moveTargetedCardFromGraveyard(
            workingState,
            controllerId,
            cardId,
            { cardType: 'land' },
            'battlefield',
            controllerId,
            true,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved lands from hand/graveyard: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedSameNamedFromYourGraveyard) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to === 'hand') {
      const result = returnTargetAndSameNamedCardsFromYourGraveyardToHand(
        nextState,
        controllerId,
        targetObjectId,
        parsedSameNamedFromYourGraveyard
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = returnTargetAndSameNamedCardsFromYourGraveyardToBattlefield(
        nextState,
        controllerId,
        targetObjectId,
        parsedSameNamedFromYourGraveyard,
        step.entersTapped
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedRandomSingleFromYourGraveyard) {
    const libraryPlacement = getLibraryPlacement(step);
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if ('count' in parsedRandomSingleFromYourGraveyard) {
      const selection = selectRandomMatchingCardIdsFromGraveyard(
        nextState,
        controllerId,
        parsedRandomSingleFromYourGraveyard.criteria,
        parsedRandomSingleFromYourGraveyard.count,
        ctx.sourceName,
        sourcePermanentPower
      );
      if (selection.kind === 'missing_player') {
        return {
          applied: false,
          message: `Skipped move zone (unsupported selector): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
      if (selection.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      for (const cardId of selection.cardIds) {
        const result = moveTargetedCardFromGraveyard(
          workingState,
          controllerId,
          cardId,
          parsedRandomSingleFromYourGraveyard.criteria,
          step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
          step.to === 'battlefield' ? controllerId : undefined,
          step.entersTapped,
          step.entersFaceDown,
          effectiveWithCounters,
          attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
          ctx.sourceName,
          battlefieldEntryOverrides,
          sourcePermanentPower
        );
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...(result.movedPermanentIds || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Moved random graveyard cards: ${step.raw}`],
        ...(movedBattlefieldIds.length > 0 ? { movedBattlefieldPermanentIds: movedBattlefieldIds } : {}),
      });
    }

    const selection = selectRandomMatchingCardIdFromGraveyard(
      nextState,
      controllerId,
      parsedRandomSingleFromYourGraveyard,
      ctx.sourceName,
      sourcePermanentPower
    );
    if (selection.kind === 'missing_player') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (selection.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      selection.cardId,
      parsedRandomSingleFromYourGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromAnyGraveyard) {
    const targetObjectId =
      resolveUniqueChosenAnyGraveyardTargetId(
        nextState,
        parsedSingleTargetFromAnyGraveyard,
        ctx,
        runtime,
        ctx.sourceName,
        sourcePermanentPower
      ) ||
      resolveBoundGraveyardTargetObjectId(
        nextState,
        boundTargetObjectId,
        parsedSingleTargetFromAnyGraveyard,
        ctx.sourceName,
        sourcePermanentPower
      );
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromAnyGraveyard(
      nextState,
      targetObjectId,
      parsedSingleTargetFromAnyGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? undefined
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            scope: 'any_graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId =
      (targetPlayerId
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            targetPlayerId,
            parsedSingleTargetFromTargetPlayerGraveyard,
            ctx,
            runtime,
            ctx.sourceName,
            sourcePermanentPower
          )
        : '') ||
      boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerHand.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerExile.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourGraveyard) {
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedSingleTargetFromYourGraveyard, ctx);
    const targetObjectId =
      resolveUniqueChosenGraveyardTargetId(
        nextState,
        controllerId,
        effectiveCriteria,
        ctx,
        runtime,
        ctx.sourceName,
        sourcePermanentPower
      ) ||
      resolveBoundGraveyardTargetObjectId(
        nextState,
        boundTargetObjectId,
        effectiveCriteria,
        ctx.sourceName,
        sourcePermanentPower
      );
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      targetObjectId,
      effectiveCriteria,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourHand) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourHand.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourExile) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourExile.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetCountFromGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            targetPlayerId,
            parsedTargetCountFromGraveyard.count,
            parsedTargetCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              step.battlefieldController?.kind === 'owner_of_moved_cards' ? targetPlayerId : controllerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              targetPlayerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'hand')
        : step.to === 'graveyard'
          ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'graveyard')
          : step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromExileOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromExileOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              );
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              controllerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromHandOntoBattlefield(
              nextState,
              targetPlayerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
        : moveAllMatchingFromHand(nextState, targetPlayerId, parsedTargetPlayerHand.cardType, step.to);
    return finalizeAppliedResult(result);
  }

  if (parsedCountFromGraveyard) {
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            controllerId,
            parsedCountFromGraveyard.count,
            parsedCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedCountFromGraveyard.count,
              parsedCountFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              controllerId,
              parsedCountFromGraveyard.count,
              parsedCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedEachOpponentsExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachOpponentsGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachOpponentsGy.cardType);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachOpponentsHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedBothCards && step.to === 'battlefield') {
    const cardsToPut = collectBothCardsZoneEntries(nextState, controllerId, ctx, runtime);
    if (cardsToPut.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No both-cards match: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const entry of cardsToPut) {
      const result =
        entry.zone === 'hand'
          ? moveTargetedCardFromHand(
              workingState,
              entry.playerId,
              entry.cardId,
              'any',
              'battlefield',
              controllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : entry.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                entry.playerId,
                entry.cardId,
                'any',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromGraveyard(
                workingState,
                entry.playerId,
                entry.cardId,
                { cardType: 'any' },
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                undefined,
                battlefieldEntryOverrides
              );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (Array.isArray(result.movedPermanentIds)) {
        movedBattlefieldIds.push(...result.movedPermanentIds);
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Put both cards onto the battlefield: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfThoseDragons && step.to === 'hand') {
    const preferred = new Set(getChosenObjectIds(ctx));
    const battlefield = (nextState.battlefield || []) as any[];
    let dragons = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!getExecutorTypeLineLower(perm).includes('dragon')) return false;
      if (preferred.size > 0 && !preferred.has(permanentId)) return false;
      return true;
    });
    if (dragons.length === 0) {
      dragons = battlefield.filter((perm: any) => {
        const permanentId = String(perm?.id || '').trim();
        return (
          String(perm?.controller || '').trim() === controllerId &&
          hasExecutorClass(perm, 'creature') &&
          getExecutorTypeLineLower(perm).includes('dragon')
        );
      });
    }
    const targetId = String((dragons[0] as any)?.id || '').trim();
    if (!targetId) {
      return buildAppliedResult({ state: nextState, log: [`No dragon to return: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
    return finalizeAppliedResult(result);
  }

  if (parsedMorphCreatureFromHand && step.to === 'battlefield') {
    const player = nextState.players.find(entry => entry.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = new Set(getChosenObjectIds(ctx));
    const pick =
      hand.find(
        (card: any) =>
          preferred.has(String(card?.id || '').trim()) &&
          cardHasMorphAbility(card) &&
          cardMatchesType(card, 'creature')
      ) ||
      hand.find((card: any) => cardHasMorphAbility(card) && cardMatchesType(card, 'creature'));
    const cardId = String((pick as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No morph creature in hand: ${step.raw}`] });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      'creature',
      'battlefield',
      controllerId,
      step.entersTapped,
      false,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (morph creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAurasAttachedToTargetPermanentYouOwn && step.to === 'hand') {
    const targetPermanentId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || 'bf-legendary-creature'
    ).trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const auraIds = battlefield
      .filter(perm => {
        const attachedTo = String((perm as any)?.attachedTo || (perm as any)?.enchanting || '').trim();
        return (
          attachedTo === targetPermanentId &&
          getExecutorTypeLineLower(perm).includes('aura') &&
          String((perm as any)?.owner || (perm as any)?.controller || '').trim() === controllerId
        );
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, auraIds);
    return finalizeAppliedResult(result);
  }

  if (parsedThisCreatureAndCombatantsToLibraryTop && step.to === 'library' && getLibraryPlacement(step) === 'top') {
    const sourceId = String(ctx.sourceId || ctx.targetCreatureId || 'bf-source').trim();
    const targetIds = resolveCreaturesBlockingOrBlockedBySource(nextState, sourceId);
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, targetIds, 'top');
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberCardsTotalMvXFromGy && step.to === 'hand') {
    const totalMv = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 7));
    const cardIds = selectGraveyardCardsWithTotalManaValueLte(
      nextState,
      controllerId,
      'any',
      totalMv,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(workingState, controllerId, cardId, { cardType: 'any' }, 'hand');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned cards with total MV ${totalMv} or less: ${step.raw}`],
    });
  }

  if (parsedCountTargetFromSingleGraveyard && step.to === 'battlefield') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCountTargetFromSingleGraveyard.cardType,
      getChosenObjectIds(ctx),
      parsedCountTargetFromSingleGraveyard.count
    );
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard cards matched: ${step.raw}`] });
    }
    const playerIds = new Set(matches.map(match => match.playerId));
    if (playerIds.size > 1) {
      return {
        applied: false,
        message: `Skipped move zone (single graveyard constraint): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const limit = parsedCountTargetFromSingleGraveyard.upTo
      ? parsedCountTargetFromSingleGraveyard.count
      : parsedCountTargetFromSingleGraveyard.count;
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const bfController = String(step.battlefieldController?.kind === 'you' ? controllerId : controllerId);
    for (const match of matches.slice(0, limit)) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedCountTargetFromSingleGraveyard.cardType },
        'battlefield',
        bfController,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned cards from a single graveyard: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCountTargetFromSingleGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCountTargetFromSingleGraveyard.cardType,
      getChosenObjectIds(ctx),
      parsedCountTargetFromSingleGraveyard.count
    );
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard cards matched: ${step.raw}`] });
    }
    const playerIds = new Set(matches.map(match => match.playerId));
    if (playerIds.size > 1) {
      return {
        applied: false,
        message: `Skipped move zone (single graveyard constraint): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of matches.slice(0, parsedCountTargetFromSingleGraveyard.count)) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedCountTargetFromSingleGraveyard.cardType },
        'exile'
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from a single graveyard: ${step.raw}`],
    });
  }

  if (parsedCompoundExileItAndReturnGy) {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const sourceId = String(ctx.sourceId || '').trim();
    const controllerPlayer = workingState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(controllerPlayer?.graveyard) ? controllerPlayer.graveyard : [];
    const sourceGyCard = graveyard.find((card: any) => {
      const cardId = String(card?.id || '').trim();
      return cardId === sourceId || cardId === 'gy-source-self' || cardId.startsWith('gy-source');
    });
    const sourceGyCardId = String((sourceGyCard as any)?.id || '').trim();
    if (sourceGyCardId) {
      const exileResult = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        sourceGyCardId,
        { cardType: 'any' },
        'exile'
      );
      if (exileResult.kind === 'applied') {
        workingState = exileResult.state;
        combinedLog.push(...(exileResult.log || []));
      }
    }
    const returnResult = putAllMatchingCriteriaFromGraveyardOntoBattlefield(
      workingState,
      controllerId,
      controllerId,
      parsedCompoundExileItAndReturnGy,
      sourceGyCardId ? [sourceGyCardId] : [],
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: returnResult.state,
      log: [...combinedLog, ...returnResult.log],
      movedPermanentIds: returnResult.movedPermanentIds,
    });
  }

  if (parsedReturnItAndSelf && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = (nextState.battlefield || []) as any[];
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String(
      (sourcePermanent as any)?.attachedTo ||
        ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ''
    ).trim();
    const targetIds = Array.from(new Set([attachedToId, sourceId].filter(Boolean)));
    if (targetIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No permanents to return: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedPutIntoGraveyardThisWay && step.to === 'hand') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      [parsedPutIntoGraveyardThisWay],
      preferredIds
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard-this-way card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedPutIntoGraveyardThisWay,
      'hand'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard-this-way card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedThoseCardsNotPlayed && step.to === 'graveyard') {
    const result = moveUnplayedExileCardsToGraveyard(nextState, controllerId);
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`No unplayed wish cards: ${step.raw}`],
      movedCards: result.movedCards,
    });
  }

  if ((parsedTheNonlandCard || parsedTheNonlandCardRestToLibrary) && step.to === 'hand') {
    const movedCards = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    let nonlandCardId: string | undefined;
    for (let index = movedCards.length - 1; index >= 0; index -= 1) {
      const card = movedCards[index] as any;
      const cardId = String(card?.id || '').trim();
      if (!cardId || cardMatchesType(card, 'land')) continue;
      nonlandCardId = cardId;
      break;
    }
    if (!nonlandCardId) {
      return buildAppliedResult({
        state: nextState,
        log: [`No nonland card in reveal context: ${step.raw}`],
      });
    }
    const libraryLocation: BoundCardZoneLocation = { playerId: controllerId, zone: 'library' };
    const libraryHasNonland = ((nextState.players || []).find((p) => p.id === controllerId) as any)?.library?.some(
      (card: any) => String(card?.id || '').trim() === nonlandCardId
    );
    const location = libraryHasNonland ? libraryLocation : findBoundCardZoneLocation(nextState, nonlandCardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (nonland reveal card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const moveResult =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, nonlandCardId, 'hand', {
            controllerId,
            cardType: 'nonland',
          })
        : location.zone === 'hand'
          ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(nextState, location.playerId, nonlandCardId, { cardType: 'nonland' }, 'hand')
            : moveTargetedCardFromExile(nextState, location.playerId, nonlandCardId, 'nonland', 'hand');
    if (moveResult.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (nonland reveal card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = moveResult.state;
    const combinedLog = [...(moveResult.log || [])];
    if (parsedTheNonlandCardRestToLibrary) {
      for (const card of movedCards) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || cardId === nonlandCardId) continue;
        const restResult = moveContextualCardToDestination(workingState, libraryLocation, cardId, 'library_bottom', {
          controllerId,
        });
        if (restResult.kind === 'impossible') continue;
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved nonland card to hand: ${step.raw}`],
    });
  }

  if (parsedExiledThisWayNotCast && (step.to === 'graveyard' || step.to === 'hand' || step.to === 'library')) {
    const exiledSnapshot = Array.isArray(runtime?.lastExiledCards)
      ? runtime.lastExiledCards
      : Array.isArray(ctx.lastExiledCards)
        ? ctx.lastExiledCards
        : [];
    const matchingIds = resolveUncastExiledThisWayCardIds(
      nextState,
      controllerId,
      exiledSnapshot,
      parsedExiledThisWayNotCast
    );
    if (matchingIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No uncast exiled-this-way cards: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    for (const cardId of matchingIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'exile') continue;
      const result = moveTargetedCardFromExile(
        workingState,
        location.playerId,
        cardId,
        parsedExiledThisWayNotCast.cardType === 'instant_or_sorcery' ? 'instant_or_sorcery' : 'any',
        step.to === 'library' ? 'hand' : step.to
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(cardId);
      if (step.to === 'library') {
        const libraryResult = moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom');
        if (libraryResult.kind === 'applied') {
          workingState = libraryResult.state;
          combinedLog.push(...(libraryResult.log || []));
        }
      }
    }
    if (parsedExiledThisWayNotCast.withRestToLibraryBottom) {
      const restIds = resolveUncastExiledThisWayCardIds(nextState, controllerId, exiledSnapshot, {
        cardType: 'any',
        withRestToLibraryBottom: false,
      }).filter((id) => !movedCardIds.includes(id));
      for (const cardId of restIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone !== 'exile') continue;
        const toHand = moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
        if (toHand.kind === 'impossible') continue;
        workingState = toHand.state;
        combinedLog.push(...(toHand.log || []));
        const libraryResult = moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom');
        if (libraryResult.kind === 'applied') {
          workingState = libraryResult.state;
          combinedLog.push(...(libraryResult.log || []));
        }
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved uncast exiled-this-way cards: ${step.raw}`],
    });
  }

  if (parsedSingleCardFromEachPlayersGy && step.to === 'exile') {
    const result = exileOneMatchingCardFromEachPlayersGraveyard(
      nextState,
      parsedSingleCardFromEachPlayersGy,
      getChosenObjectIds(ctx)
    );
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`No graveyard cards to exile: ${step.raw}`],
    });
  }

  if (parsedEachPlayersGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachPlayersGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachPlayersGy.cardType, {
                colorsAnyOf: parsedEachPlayersGy.colorsAnyOf,
              });
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachPlayersHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedFromGraveyard) {
    if (step.to === 'hand') {
      const result = returnAllMatchingCriteriaFromGraveyardToHand(
        nextState,
        controllerId,
        parsedFromGraveyard,
        sourcePermanentPower
      );
      return finalizeAppliedResult(result);
    }

    if (step.to === 'exile') {
      const result = exileAllMatchingCriteriaFromGraveyard(
        nextState,
        controllerId,
        parsedFromGraveyard,
        sourcePermanentPower
      );
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result =
        parsedFromGraveyard.typeLineTermsAnyOf ||
        parsedFromGraveyard.creatureTypesAnyOf ||
        parsedFromGraveyard.typeLineTermsNoneOf
          ? putAllMatchingCriteriaFromGraveyardOntoBattlefield(
              nextState,
              controllerId,
              controllerId,
              parsedFromGraveyard,
              [],
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromGraveyardOntoBattlefield(
              nextState,
              controllerId,
              parsedFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedFromExile) {
    if (step.to === 'hand') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'hand');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'graveyard') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'graveyard');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result =
        step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromExileOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromExileOntoBattlefield(
              nextState,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedFromHand) {
    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result =
      step.to === 'battlefield'
        ? putAllMatchingFromHandOntoBattlefield(
            nextState,
            controllerId,
            parsedFromHand.cardType,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters
          )
        : moveAllMatchingFromHand(nextState, controllerId, parsedFromHand.cardType, step.to);

    return finalizeAppliedResult(result);
  }

  if (parsedThatManyFromTopOfLibrary && step.to === 'exile') {
    const count = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileCountFromTopOfLibrary(nextState, controllerId, count, false);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedThatManyFromTopOfLibraryFaceDown && step.to === 'exile') {
    const count = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileCountFromTopOfLibrary(nextState, controllerId, count, true);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedCardFromOutsideGame && step.to === 'hand') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const sideboard = Array.isArray(player?.sideboard) ? [...player.sideboard] : [];
    const preferred = getChosenObjectIds(ctx);
    const card =
      (preferred.length > 0
        ? sideboard.find((entry: any) => preferred.includes(String(entry?.id || '').trim()))
        : sideboard[0]) || sideboard[0];
    if (!card) {
      return buildAppliedResult({ state: nextState, log: [`No outside-the-game card available: ${step.raw}`] });
    }
    const cardId = String((card as any)?.id || '').trim();
    const nextSideboard = sideboard.filter((entry: any) => String(entry?.id || '').trim() !== cardId);
    const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId ? ({ ...(p as any), hand, sideboard: nextSideboard } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} puts a card from outside the game into hand`],
    });
  }

  if (parsedOneOrMoreCreaturesFromGy && step.to === 'exile') {
    const result = exileAllMatchingCriteriaFromGraveyard(nextState, controllerId, { cardType: 'creature' });
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled creature cards from graveyard: ${step.raw}`],
    });
  }

  if (parsedOwnedNonlandPermanentYouOwn && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const perm = ((nextState.battlefield || []) as any[]).find(
      entry =>
        String(entry?.id || '').trim() === sourceId ||
        (entry?.controller === controllerId &&
          hasExecutorClass(entry, 'permanent') &&
          !hasExecutorClass(entry, 'land'))
    );
    const permId = String((perm as any)?.id || sourceId || 'bf-permanent-1').trim();
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [permId]);
    return finalizeAppliedResult(result);
  }

  if (parsedExileXTargetFromTargetPlayerGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const preferred = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const cardIds =
      preferred.length > 0
        ? preferred.filter(id => graveyard.some((card: any) => String(card?.id || '').trim() === id))
        : graveyard.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const exiledCards: any[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(workingState, targetPlayerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const moved = graveyard.find((card: any) => String(card?.id || '').trim() === cardId);
      if (moved) exiledCards.push(moved);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled target graveyard cards: ${step.raw}`],
      lastMovedCards: exiledCards,
    });
  }

  if (parsedShuffleAnyNumberTargetFromTargetPlayerGy && step.to === 'library') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const preferred = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const cardIds =
      preferred.length > 0
        ? preferred.filter(id => graveyard.some((card: any) => String(card?.id || '').trim() === id))
        : graveyard.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = shuffleUpToMatchingFromGraveyardIntoLibrary(workingState, targetPlayerId, 1, { cardType: 'any' }, [cardId]);
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Shuffled target graveyard cards into library: ${step.raw}`],
    });
  }

  if (parsedForEachOpponentUpToOneNonlandBounce && step.to === 'hand') {
    const opponents = (nextState.players || [])
      .map(p => String((p as any)?.id || '').trim())
      .filter(id => id && id !== controllerId);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const opponentId of opponents) {
      const perm = ((workingState.battlefield || []) as any[]).find(
        entry =>
          String(entry?.controller || '').trim() === opponentId &&
          hasExecutorClass(entry, 'permanent') &&
          !hasExecutorClass(entry, 'land')
      );
      const permId = String((perm as any)?.id || '').trim();
      if (!permId) continue;
      const result = moveBattlefieldPermanentsByIdToOwnersHands(workingState, [permId]);
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned opponent permanents to hand: ${step.raw}`],
    });
  }

  if (parsedAnyNumberOpponentOwnedLandsFromExile && step.to === 'battlefield') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const result = putOpponentOwnedMatchingFromExileOntoBattlefield(
      nextState,
      controllerId,
      targetPlayerId,
      'land',
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Put opponent-owned lands from exile onto battlefield: ${step.raw}`],
      movedBattlefieldPermanentIds: result.movedPermanentIds,
    });
  }

  if (parsedCreatureFromOwnersGraveyardUnderOwner && step.to === 'battlefield') {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || 'gy-creature-1').trim();
    const location = findBoundCardZoneLocation(nextState, targetId);
    const ownerId = location?.playerId || controllerId;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      ownerId,
      targetId,
      { cardType: 'creature' },
      'battlefield',
      ownerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No owner graveyard creature: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedEnchantedCreatureAndAurasToHand && step.to === 'hand') {
    const enchantedId = String(ctx.sourceId || ctx.enchantedPermanentId || 'bf-creature-1').trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const targetIds = battlefield
      .filter(perm => {
        const id = String((perm as any)?.id || '').trim();
        if (id === enchantedId) return true;
        const attachedTo = String((perm as any)?.attachedTo || (perm as any)?.enchanting || '').trim();
        return attachedTo === enchantedId && getExecutorTypeLineLower(perm).includes('aura');
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds.length > 0 ? targetIds : [enchantedId]);
    return finalizeAppliedResult(result);
  }

  if (parsedSingleCardExiledWithIt && step.to === 'graveyard') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No card exiled with source: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(nextState, chosen.playerId, chosen.cardId, 'any', 'graveyard');
    return finalizeAppliedResult(result);
  }

  if (parsedDiscardedCardFromYourGy && step.to === 'hand') {
    const discardedId = String(
      ctx.lastDiscardedCardId ||
        ctx.selectorContext?.lastDiscardedCardId ||
        getChosenObjectIds(ctx)[0] ||
        'gy-discarded-1'
    ).trim();
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, discardedId, { cardType: 'any' }, 'hand');
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No discarded card in graveyard: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedReturnThisVehicleToOwnersHand && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [sourceId || 'bf-vehicle-1']);
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberGyWithCardTypesAmong && step.to === 'exile') {
    const cardIds = selectGraveyardCardsWithMinDistinctTypes(
      nextState,
      controllerId,
      parsedAnyNumberGyWithCardTypesAmong.minDistinctTypes,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(workingState, controllerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled graveyard cards by card types: ${step.raw}`],
    });
  }

  if (parsedCloakCardFromHand && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = getChosenObjectIds(ctx);
    const card =
      (preferred.length > 0 ? hand.find((entry: any) => preferred.includes(String(entry?.id || '').trim())) : hand[0]) ||
      hand[0];
    const cardId = String((card as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No hand card to cloak: ${step.raw}`] });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      'any',
      'battlefield',
      controllerId,
      false,
      true,
      effectiveWithCounters,
      undefined,
      { setTypeLine: 'Creature', loseAllAbilities: true }
    );
    return finalizeAppliedResult(result);
  }

  if (parsedUpToOneNoncreatureNonlandFromTargetPlayerGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      targetPlayerId,
      1,
      { cardType: 'noncreature_nonland_permanent' },
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching target graveyard card: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedMechtitanReturnExiledExceptSelf && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' }).filter(
      match => match.cardId !== sourceId
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        'any',
        'battlefield',
        match.playerId,
        true,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned exiled cards except source: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfThemFromYourGraveyard && step.to === 'exile') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime).filter(id => {
      const location = findBoundCardZoneLocation(nextState, id);
      return location?.zone === 'graveyard' && location.playerId === controllerId;
    });
    const cardId = candidateIds[0] || resolveFirstMatchingCardIdFromPlayerGraveyard(nextState, controllerId, { cardType: 'any' }, getChosenObjectIds(ctx));
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No one-of-them graveyard card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, cardId, { cardType: 'any' }, 'exile');
    return finalizeAppliedResult(result);
  }

  if (parsedExileItFromTheirGyWithStash && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const cardId =
      String(ctx.targetPermanentId || ctx.targetCreatureId || getChosenObjectIds(ctx)[0] || 'gy-target-1').trim();
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const index = graveyard.findIndex((card: any) => String(card?.id || '').trim() === cardId);
    if (index < 0) {
      return buildAppliedResult({ state: nextState, log: [`No target graveyard card for stash exile: ${step.raw}`] });
    }
    const [card] = graveyard.splice(index, 1);
    const exileOwner = nextState.players.find(p => p.id === targetPlayerId) as any;
    const exile = Array.isArray(exileOwner?.exile) ? [...exileOwner.exile] : [];
    exile.push({ ...card, counters: { ...(card?.counters || {}), stash: 1 } });
    const updatedPlayers = nextState.players.map(p =>
      p.id === targetPlayerId ? ({ ...(p as any), graveyard, exile } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`Exiled ${cardId} from ${targetPlayerId}'s graveyard with a stash counter`],
    });
  }

  if (parsedOneOfThoseCardsWithThatNameToHand && step.to === 'hand') {
    const referenceName = String(ctx.referenceCardName || ctx.selectorContext?.referenceCardName || '').trim();
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'graveyard', 'hand']);
    const preferred = getChosenObjectIds(ctx);
    let cardId = preferred.find(id => candidateIds.includes(id)) || candidateIds[0] || '';
    if (referenceName && cardId) {
      const location = findBoundCardZoneLocation(nextState, cardId);
      const zoneCards =
        location?.zone === 'graveyard'
          ? ((nextState.players.find(p => p.id === location.playerId) as any)?.graveyard || [])
          : location?.zone === 'exile'
            ? ((nextState.players.find(p => p.id === location.playerId) as any)?.exile || [])
            : [];
      const sameName = zoneCards.find(
        (card: any) =>
          String(card?.name || '').trim().toLowerCase() === referenceName.toLowerCase() &&
          (preferred.length === 0 || preferred.includes(String(card?.id || '').trim()))
      );
      if (sameName) cardId = String(sameName?.id || '').trim();
    }
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No matching named card: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : { kind: 'impossible' as const };
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No matching named card: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedRandomFromEachOpponentGraveyard && step.to === 'exile') {
    const opponents = (nextState.players || [])
      .map(p => String((p as any)?.id || '').trim())
      .filter(id => id && id !== controllerId);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const opponentId of opponents) {
      const selection = selectRandomMatchingCardIdFromGraveyard(workingState, opponentId, { cardType: 'any' });
      if (selection.kind !== 'selected') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        opponentId,
        selection.cardId,
        { cardType: 'any' },
        'exile'
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled random cards from opponent graveyards: ${step.raw}`],
    });
  }

  if (parsedPutThatCardBfShuffleRestRevealed && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand']);
    const cardId = preferredIds.find(id => candidateIds.includes(id)) || candidateIds[0] || '';
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (cardId) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      const moveResult =
        location?.zone === 'exile'
          ? moveTargetedCardFromExile(
              workingState,
              location.playerId,
              cardId,
              'any',
              'battlefield',
              controllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            )
          : location?.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : { kind: 'impossible' as const };
      if (moveResult.kind !== 'impossible') {
        workingState = moveResult.state;
        combinedLog.push(...(moveResult.log || []));
      }
    }
    const restIds = candidateIds.filter(id => id !== cardId);
    const shuffleResult = shuffleContextualCardsIntoLibrary(workingState, controllerId, restIds);
    workingState = shuffleResult.state;
    combinedLog.push(...shuffleResult.log);
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Put revealed creature onto battlefield and shuffled rest: ${step.raw}`],
    });
  }

  if (parsedThemToOwnersGraveyard) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'exile'
          ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard')
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
            : { kind: 'impossible' as const };
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved them to owners' graveyards: ${step.raw}`],
    });
  }

  return {
    applied: false,
    message: `Skipped move zone (unsupported selector): ${step.raw}`,
    reason: 'unsupported_selector',
  };
}
