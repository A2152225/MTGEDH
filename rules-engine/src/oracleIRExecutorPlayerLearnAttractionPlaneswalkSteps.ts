// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: isLessonCard, applySelectedLearn*, applyLearnStep,
// applyOpenAttractionStep, applyPlaneswalkStep, applyAssembleStep.
// Public entries: applyLearnStep, applyOpenAttractionStep, applyPlaneswalkStep,
// applyAssembleStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from './oracleIRExecutionTypes';
import { getNormalizedChosenIds } from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  drawCardsForPlayer,
  normalizeOracleText,
  resolvePlayers,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
} from './oracleIRExecutorZoneOps';

export function isLessonCard(card: any): boolean {
  return /\blesson\b/i.test(String(card?.type_line || ''));
}

function applySelectedLearnDiscard(
  state: GameState,
  playerId: string,
  cardId: string
): PlayerStepHandlerResult {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${playerId}`,
      reason: 'failed_to_apply',
    };
  }

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const discardIndex = hand.findIndex((card: any) => String(card?.id || '').trim() === cardId);
  if (discardIndex < 0) {
    return {
      applied: false,
      message: `Skipped learn (selected discard card not in hand): ${cardId}`,
      reason: 'failed_to_apply',
    };
  }

  const [discardedCard] = hand.splice(discardIndex, 1);
  const stampedDiscardedCards = stampCardsPutIntoGraveyardThisTurn(state, [discardedCard]);
  const graveyard = [...(Array.isArray(player.graveyard) ? player.graveyard : []), ...stampedDiscardedCards];
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, hand, graveyard }
      : entry
  ));

  const discardState = {
    ...(state as any),
    players: updatedPlayers as any,
  } as GameState;
  const drawResult = drawCardsForPlayer(discardState, playerId as PlayerID, 1);

  return {
    applied: true,
    state: drawResult.state,
    log: [`${playerId} learns by discarding 1 card`, ...drawResult.log],
    lastDiscardedCardCount: 1,
    lastDiscardedCards: stampedDiscardedCards,
    lastMovedCards: stampedDiscardedCards,
  };
}

function applySelectedLearnLesson(
  state: GameState,
  playerId: string,
  lessonCardId: string
): PlayerStepHandlerResult {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${playerId}`,
      reason: 'failed_to_apply',
    };
  }

  const sideboard = Array.isArray(player.sideboard) ? [...player.sideboard] : [];
  const lessonIndex = sideboard.findIndex((card: any) => String(card?.id || '').trim() === lessonCardId);
  if (lessonIndex < 0) {
    return {
      applied: false,
      message: `Skipped learn (selected Lesson not outside the game): ${lessonCardId}`,
      reason: 'failed_to_apply',
    };
  }

  const [lessonCard] = sideboard.splice(lessonIndex, 1);
  const hand = [...(Array.isArray(player.hand) ? player.hand : []), lessonCard];
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, hand, sideboard }
      : entry
  ));

  return {
    applied: true,
    state: {
      ...(state as any),
      players: updatedPlayers as any,
    } as GameState,
    log: [`${playerId} learns by revealing a Lesson from outside the game`],
    lastMovedCards: [lessonCard],
  };
}

export function applyLearnStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'learn' }>,
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped learn (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const hand = Array.isArray(player.hand) ? player.hand : [];
  const lessons = (Array.isArray(player.sideboard) ? player.sideboard : []).filter(isLessonCard);
  const chosenIds = new Set(getNormalizedChosenIds(ctx));
  const chosenHand = hand.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));
  const chosenLessons = lessons.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));

  if (chosenHand.length > 1 || chosenLessons.length > 1 || (chosenHand.length > 0 && chosenLessons.length > 0)) {
    return {
      applied: false,
      message: `Skipped learn (requires a single discard card or Lesson choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (chosenHand.length === 1) {
    return applySelectedLearnDiscard(state, playerId, String(chosenHand[0]?.id || '').trim());
  }

  if (chosenLessons.length === 1) {
    return applySelectedLearnLesson(state, playerId, String(chosenLessons[0]?.id || '').trim());
  }

  if (!options.allowOptional) {
    return {
      applied: true,
      state,
      log: ['Learn had no auto-selected optional branch'],
      lastMovedCards: [],
    };
  }

  if (hand.length === 1) {
    return applySelectedLearnDiscard(state, playerId, String(hand[0]?.id || '').trim());
  }

  if (lessons.length === 1) {
    return applySelectedLearnLesson(state, playerId, String(lessons[0]?.id || '').trim());
  }

  if (hand.length === 0 && lessons.length === 0) {
    return {
      applied: true,
      state,
      log: ['Learn had no discard or Lesson option available'],
      lastMovedCards: [],
    };
  }

  return {
    applied: false,
    message: `Skipped learn (requires player choice): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      metadata: {
        handCount: hand.length,
        lessonCount: lessons.length,
      },
    },
  };
}

export function applyOpenAttractionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'open_attraction' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped open Attraction (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped open Attraction (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const attractionDeck = Array.isArray(player.attractionDeck) ? [...player.attractionDeck] : [];
  if (attractionDeck.length === 0) {
    return {
      applied: true,
      state,
      log: ['Open an Attraction had no Attraction available'],
      lastMovedCards: [],
    };
  }

  const [openedAttraction, ...remainingAttractionDeck] = attractionDeck;
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, attractionDeck: remainingAttractionDeck }
      : entry
  ));
  const attractionCard = {
    ...(openedAttraction || {}),
    type_line: String((openedAttraction as any)?.type_line || 'Artifact - Attraction'),
    zone: 'battlefield',
  };
  const newPermanent = createBattlefieldPermanentsFromCards(
    [attractionCard],
    playerId as PlayerID,
    playerId as PlayerID,
    false,
    false,
    undefined,
    'attraction'
  );

  return {
    applied: true,
    state: addBattlefieldPermanentsToState(
      { ...(state as any), players: updatedPlayers as any } as GameState,
      newPermanent
    ),
    log: [`${playerId} opens an Attraction`],
    lastMovedCards: [attractionCard],
  };
}

export function applyRollVisitAttractionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'roll_visit_attractions' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped roll to visit Attractions (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const dieRoll = Math.min(6, Math.max(1, Number(ctx.dieRollResult) || 1));
  const visitedAttractions = ((state.battlefield || []) as any[]).filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== playerId) return false;
    const typeLine = String(perm?.card?.type_line || perm?.cardType || '').toLowerCase();
    if (!typeLine.includes('attraction')) return false;
    const litUpNumbers = Array.isArray(perm?.card?.litUpNumbers) ? perm.card.litUpNumbers : [];
    return litUpNumbers.includes(dieRoll);
  });

  return {
    applied: true,
    state,
    log: [
      `${playerId} rolls ${dieRoll} to visit Attractions`,
      ...(visitedAttractions.length > 0
        ? [`Visited ${visitedAttractions.length} Attraction(s)`]
        : ['No Attractions were visited'])
    ],
    lastVisitedAttractions: visitedAttractions,
    lastMovedCards: visitedAttractions.map((perm: any) => perm?.card).filter(Boolean),
  };
}

export function applyTakeInitiativeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'take_initiative' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped take initiative (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  return {
    applied: true,
    state: {
      ...(state as any),
      initiative: playerId,
    } as GameState,
    log: [`${playerId} takes the initiative`],
  };
}

export function applyBecomeMonarchStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'become_monarch' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped become monarch (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  return {
    applied: true,
    state: {
      ...(state as any),
      monarch: playerId,
    } as GameState,
      log: [`${playerId} becomes the monarch`],
    };
  }

export function applyPlaneswalkStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'planeswalk' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped planeswalk (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if ((state as any)?.houseRules?.enablePlanechase !== true) {
    return {
      applied: false,
      message: `Skipped planeswalk (Planechase is not enabled): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const playerId = players[0];
  const stateAny = state as any;
  const faceDownDeck = Array.isArray(stateAny.planarDeckFaceDown) ? [...stateAny.planarDeckFaceDown] : [];
  const previousPlane = stateAny.currentPlane ?? null;
  if (previousPlane) {
    faceDownDeck.push(previousPlane);
  }

  if (faceDownDeck.length <= 0) {
    return {
      applied: false,
      message: `Skipped planeswalk (no planar deck card available): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const [nextPlane, ...remainingDeck] = faceDownDeck;
  const nextPlaneName = String((nextPlane as any)?.name || nextPlane || '').trim();
  const normalizedNextPlaneName = normalizeOracleText(nextPlaneName);
  const previousPlaneName = String((previousPlane as any)?.name || previousPlane || '').trim();
  const planeswalkedToThisTurn = {
    ...((stateAny.planeswalkedToThisTurn || {}) as Record<string, string[]>),
  };
  const existingEntries = Array.isArray(planeswalkedToThisTurn[playerId]) ? [...planeswalkedToThisTurn[playerId]] : [];
  if (normalizedNextPlaneName) {
    existingEntries.push(normalizedNextPlaneName);
  }
  planeswalkedToThisTurn[playerId] = existingEntries;

  return {
    applied: true,
    state: {
      ...stateAny,
      currentPlane: nextPlane,
      planarDeckFaceDown: remainingDeck,
      planeswalkedThisTurn: true,
      planeswalksAttempted: Math.max(0, Number(stateAny.planeswalksAttempted) || 0) + 1,
      planeswalkedToThisTurn,
      planeswalkedToPlanesThisTurn: planeswalkedToThisTurn,
    } as GameState,
    log: [
      previousPlaneName
        ? `${playerId} planeswalked away from ${previousPlaneName} to ${nextPlaneName || 'a plane'}`
        : `${playerId} planeswalked to ${nextPlaneName || 'a plane'}`,
    ],
  };
}

export function applyAssembleStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'assemble' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped assemble (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped assemble (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const contraptionDeck = Array.isArray(player.contraptionDeck) ? [...player.contraptionDeck] : [];
  if (contraptionDeck.length === 0) {
    return {
      applied: true,
      state,
      log: ['Assemble had no Contraption available'],
      lastMovedCards: [],
    };
  }

  const [assembledContraption, ...remainingContraptionDeck] = contraptionDeck;
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, contraptionDeck: remainingContraptionDeck }
      : entry
  ));
  const contraptionCard = {
    ...(assembledContraption || {}),
    type_line: String((assembledContraption as any)?.type_line || 'Artifact - Contraption'),
    zone: 'battlefield',
  };
  const newPermanent = createBattlefieldPermanentsFromCards(
    [contraptionCard],
    playerId as PlayerID,
    playerId as PlayerID,
    false,
    false,
    undefined,
    'contraption'
  );

  return {
    applied: true,
    state: addBattlefieldPermanentsToState(
      { ...(state as any), players: updatedPlayers as any } as GameState,
      newPermanent
    ),
    log: [`${playerId} assembles a Contraption`],
    lastMovedCards: [contraptionCard],
  };
}
