// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: exileContextualThatCardFromPlayerZones through normalizeExileTargetReferenceText.
// Public entries: exileContextualThatCardFromPlayerZones, exileTheChosenCardsFromPlayerZones,
// exileCardFromZoneLocation, exileContextualSourceCardFromZone, normalizeExileTargetReferenceText.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  StepApplyResult,
} from './oracleIRExecutorBattlefieldStepTypes';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import {
  findCardZoneLocation,
  getChosenObjectIdsFromContext,
  pickArtifactOrCreatureFromPlayerZone,
  resolveTargetOpponentPlayerId,
  type CardZoneLocation,
} from './oracleIRExecutorBattlefieldCardZoneLocation';
import { moveTargetedCardFromGraveyard, moveTargetedCardFromHand } from './oracleIRExecutorZoneOps';

export function exileContextualThatCardFromPlayerZones(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const opponentId = resolveTargetOpponentPlayerId(ctx);
  const chosenName = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
  const preferredIds = getChosenObjectIdsFromContext(ctx);

  for (const cardId of preferredIds) {
    const location = findCardZoneLocation(state, cardId);
    if (!location || location.playerId !== opponentId) continue;
    if (location.zone !== 'hand' && location.zone !== 'graveyard') continue;
    const opponentPlayer = (state.players || []).find(
      (entry: any) => String(entry?.id || '').trim() === opponentId
    ) as any;
    const sourceCard =
      location.zone === 'hand'
        ? (Array.isArray(opponentPlayer?.hand) ? opponentPlayer.hand : []).find(
            (card: any) => String(card?.id || '').trim() === cardId
          )
        : (Array.isArray(opponentPlayer?.graveyard) ? opponentPlayer.graveyard : []).find(
            (card: any) => String(card?.id || '').trim() === cardId
          );
    const exiled = exileCardFromZoneLocation(state, location, cardId);
    if (exiled) {
      const movedCard = sourceCard ?? { id: cardId };
      return {
        ...exiled,
        lastMovedCards: [movedCard],
        lastExiledCards: [movedCard],
        lastExiledCardCount: 1,
      };
    }
  }

  if (chosenName) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const named = hand.find(
      (card: any) => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosenName
    );
    const namedId = String(named?.id || '').trim();
    if (namedId) {
      const exiled = exileCardFromZoneLocation(state, { playerId: opponentId, zone: 'hand' }, namedId);
      if (exiled) {
        return {
          ...exiled,
          lastMovedCards: [named],
          lastExiledCards: [named],
          lastExiledCardCount: 1,
        };
      }
    }
  }

  const fallbackId = pickArtifactOrCreatureFromPlayerZone(state, opponentId, 'hand');
  if (!fallbackId) return null;
  const exiled = exileCardFromZoneLocation(state, { playerId: opponentId, zone: 'hand' }, fallbackId);
  return exiled
    ? {
        ...exiled,
        lastExiledCards: [{ id: fallbackId }],
        lastExiledCardCount: 1,
      }
    : null;
}

export function exileTheChosenCardsFromPlayerZones(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const opponentId = resolveTargetOpponentPlayerId(ctx);
  const preferredIds = getChosenObjectIdsFromContext(ctx).filter(cardId => {
    const location = findCardZoneLocation(state, cardId);
    return Boolean(
      location &&
        location.playerId === opponentId &&
        (location.zone === 'hand' || location.zone === 'graveyard')
    );
  });

  const cardIds = [...preferredIds];
  if (cardIds.length === 0) {
    const handId = pickArtifactOrCreatureFromPlayerZone(state, opponentId, 'hand');
    if (handId) cardIds.push(handId);
    const gyId = pickArtifactOrCreatureFromPlayerZone(state, opponentId, 'graveyard', new Set(cardIds));
    if (gyId) cardIds.push(gyId);
  }

  if (cardIds.length === 0) return null;

  let workingState = state;
  const combinedLog: string[] = [];
  const exiledCards: any[] = [];
  for (const cardId of cardIds) {
    const location = findCardZoneLocation(workingState, cardId);
    if (!location) continue;
    const exiled = exileCardFromZoneLocation(workingState, location, cardId);
    if (!exiled) continue;
    workingState = exiled.state;
    combinedLog.push(...(exiled.log || []));
    exiledCards.push({ id: cardId });
  }

  if (exiledCards.length === 0) return null;
  return {
    applied: true,
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [`Exiled ${exiledCards.length} chosen card(s)`],
    lastExiledCards: exiledCards,
    lastExiledCardCount: exiledCards.length,
    lastMovedCards: exiledCards,
  };
}

function exileCardFromZoneLocation(
  state: GameState,
  location: CardZoneLocation,
  cardId: string
): StepApplyResult | null {
  if (location.zone === 'exile') {
    return { applied: true, state, log: [`${cardId} is already exiled`] };
  }

  const result =
    location.zone === 'graveyard'
      ? moveTargetedCardFromGraveyard(state, location.playerId, cardId, { cardType: 'any' }, 'exile')
      : location.zone === 'hand'
        ? moveTargetedCardFromHand(state, location.playerId, cardId, 'any', 'exile')
        : null;

  if (!result || result.kind !== 'applied') return null;
  return { applied: true, state: result.state, log: result.log };
}

export function exileContextualSourceCardFromZone(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const sourceId = String(ctx.sourceId || '').trim();
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const sourceName = normalizeSelfReferenceText(String(ctx.sourceName || ''));

  const candidateIds = Array.from(
    new Set([sourceId, 'gy-source-self', 'exile-source-self'].map(id => String(id || '').trim()).filter(Boolean))
  );

  for (const cardId of candidateIds) {
    const location = findCardZoneLocation(state, cardId);
    if (!location) continue;
    const exiled = exileCardFromZoneLocation(state, location, cardId);
    if (exiled) return exiled;
  }

  if (!sourceName) return null;
  const controller = (state.players || []).find(
    (player: any) => String(player?.id || '').trim() === String(controllerId || '').trim()
  ) as any;
  if (!controller) return null;

  for (const zone of ['graveyard', 'hand', 'exile'] as const) {
    const cards = Array.isArray(controller?.[zone]) ? controller[zone] : [];
    const namedMatches = cards.filter((card: any) => {
      const cardName = normalizeSelfReferenceText(String(card?.name || card?.card?.name || ''));
      return cardName && cardName === sourceName;
    });
    if (namedMatches.length !== 1) continue;
    const cardId = String((namedMatches[0] as any)?.id || '').trim();
    if (!cardId) continue;
    const exiled = exileCardFromZoneLocation(state, { playerId: controllerId, zone }, cardId);
    if (exiled) return exiled;
  }

  return null;
}

export function normalizeExileTargetReferenceText(value: string): string {
  return normalizeBattlefieldTargetReferenceText(value)
    .replace(/^exile\s+/i, '')
    .replace(
      /\s+with\s+(?:\d+|a|an|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+time\s+counters?\s+on\s+it$/i,
      ''
    )
    .replace(/\s+if\s+it(?:'s| is)\s+an?\s+(?:instant|sorcery)(?:\s+or\s+(?:instant|sorcery))?\s+card$/i, '')
    .replace(/\s+until\s+this\s+(?:creature|permanent|card|aura|enchantment|artifact)\s+leaves\s+the\s+battlefield$/i, '')
    .replace(/\s+instead\s+of\s+putting\s+it\s+into\s+(?:its owner's|your|a)\s+graveyard(?:\s+as\s+it\s+resolves)?$/i, '')
    .replace(/\s+instead\s+of\s+putting\s+(?:it|that spell)\s+into\s+(?:its owner's|your|a)\s+graveyard(?:\s+as\s+it\s+resolves)?$/i, '')
    .replace(/\s+instead\s+of\s+putting\s+it\s+anywhere\s+else$/i, '')
    .replace(/\s+unless\s+you\s+sacrifice\s+another\s+creature$/i, '')
    .replace(/\s+face\s+down$/i, '')
    .trim();
}

