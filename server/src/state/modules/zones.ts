// server/src/state/modules/zones.ts
// Zones module: handles libraries/hands/graveyards/exile, search/select, scry/surveil,
// shuffles/draws, hand reorder, and the server-authoritative applyPreGameReset helper.
//
// Exports a complete set of named helpers used throughout the server state surface.

import type { PlayerID, KnownCardRef } from "../../../../shared/src/types.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../context.js";
import { uid } from "../utils.js";
import { checkEmptyLibraryDraw, hasDrawWinReplacement, hasCantLoseEffect } from "./game-state-effects.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager } from "../resolution/index.js";
import { ResolutionStepType } from "../resolution/types.js";
import { recordCardPutIntoGraveyardThisTurn, recordPermanentPutIntoHandFromBattlefieldThisTurn } from "./turn-tracking.js";
import { cleanupCardLeavingExile } from "./playable-from-exile.js";
import { clearPreparedPermanent } from "./prepared.js";
import { getCounterLeaveBattlefieldReplacement } from "./counter-common-effects.js";
import { processLinkedExileReturns } from "./triggers/linked-exile.js";
import { queueExiledFromBattlefieldTriggers } from "./triggers/zone-change.js";
import { getCardDrawTriggers } from "./triggers/card-draw.js";
import { getMillTriggers } from "./triggers/mill.js";
import { orderTriggersByAPNAP } from "./triggers/ordering.js";
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from "./triggers/target-metadata.js";
import { evaluateDrawReplacementEvent } from "./replacement-effects.js";
import { updateCounters } from "./counters_tokens.js";

function clearPreparedStateOnBattlefieldExit(state: any, permanent: any): void {
  if (!permanent) {
    return;
  }

  const hasPreparedState =
    permanent?.prepared === true ||
    permanent?.isPrepared === true ||
    Boolean(String(permanent?.preparedExileCopyCardId || '').trim()) ||
    permanent?.card?.prepared === true ||
    permanent?.card?.isPrepared === true ||
    Boolean(String(permanent?.card?.preparedExileCopyCardId || '').trim());

  if (!hasPreparedState) {
    return;
  }

  clearPreparedPermanent(state, permanent);
}

export function moveRemovedPermanentToExile(
  ctx: GameContext,
  permanent: any,
  removedPermanentId?: string,
  options?: {
    exiledWithSourceId?: string;
    exiledWithOracleId?: string;
    exiledWithSourceName?: string;
  },
): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const zones = state.zones = state.zones || {};
  const normalizedRemovedPermanentId = String(removedPermanentId || permanent?.id || '').trim();
  const owner = ((permanent as any)?.owner || (permanent as any)?.controller) as PlayerID;
  const zoneCard = ((permanent as any)?.isFaceDown === true && (permanent as any)?.faceUpCard)
    ? (permanent as any).faceUpCard
    : (permanent as any)?.card;
  const exileTag = {
    ...(String(options?.exiledWithSourceId || (permanent as any)?.leaveBattlefieldReplacementSourceId || '').trim()
      ? { exiledWithSourceId: String(options?.exiledWithSourceId || (permanent as any)?.leaveBattlefieldReplacementSourceId).trim() }
      : {}),
    ...(String(options?.exiledWithOracleId || (permanent as any)?.leaveBattlefieldReplacementOracleId || '').trim()
      ? { exiledWithOracleId: String(options?.exiledWithOracleId || (permanent as any)?.leaveBattlefieldReplacementOracleId).trim() }
      : {}),
    ...(String(options?.exiledWithSourceName || (permanent as any)?.leaveBattlefieldReplacementSourceName || '').trim()
      ? { exiledWithSourceName: String(options?.exiledWithSourceName || (permanent as any)?.leaveBattlefieldReplacementSourceName).trim() }
      : {}),
  };

  if (!owner) {
    if (normalizedRemovedPermanentId) {
      processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
    }
    bumpSeq();
    return true;
  }

  if ((permanent as any)?.isToken === true) {
    const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] } as any);
    z.exile = z.exile || [];
    if (zoneCard) {
      z.exile.push({
        id: zoneCard.id,
        name: zoneCard.name,
        type_line: zoneCard.type_line,
        oracle_text: zoneCard.oracle_text,
        image_uris: zoneCard.image_uris,
        mana_cost: zoneCard.mana_cost,
        power: zoneCard.power,
        toughness: zoneCard.toughness,
        isToken: true,
        zone: 'exile',
        ...exileTag,
      });
    }
    if (normalizedRemovedPermanentId) {
      processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
    }
    queueExiledFromBattlefieldTriggers(ctx, permanent);
    bumpSeq();
    return true;
  }

  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (zoneCard?.id && commanderIds.includes(zoneCard.id)) || (permanent as any)?.isCommander === true;

  if (isCommander && zoneCard) {
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: permanent.id,
      sourceName: zoneCard.name,
      sourceImage: zoneCard.image_uris?.small || zoneCard.image_uris?.normal,
      description: `Your commander ${zoneCard.name} would be put into exile. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      commanderZoneFromBattlefield: true,
      commanderZoneOriginalPermanent: {
        id: permanent.id,
        controller: (permanent as any)?.controller || owner,
        owner,
        tapped: (permanent as any)?.tapped === true,
        counters: (permanent as any)?.counters && typeof (permanent as any).counters === 'object'
          ? { ...((permanent as any).counters as any) }
          : undefined,
        card: zoneCard ? {
          id: zoneCard.id,
          name: zoneCard.name,
          type_line: zoneCard.type_line,
          oracle_text: zoneCard.oracle_text,
          image_uris: zoneCard.image_uris,
          mana_cost: zoneCard.mana_cost,
          power: zoneCard.power,
          toughness: zoneCard.toughness,
        } : undefined,
      },
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it be exiled' },
      ],
      commanderId: zoneCard.id,
      commanderName: zoneCard.name,
      fromZone: 'exile',
      exileTag,
      card: {
        id: zoneCard.id,
        name: zoneCard.name,
        type_line: zoneCard.type_line,
        oracle_text: zoneCard.oracle_text,
        image_uris: zoneCard.image_uris,
        mana_cost: zoneCard.mana_cost,
        power: zoneCard.power,
        toughness: zoneCard.toughness,
        ...(buildZoneObjectWithRetainedCounters(zoneCard, permanent, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(zoneCard, permanent, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[moveRemovedPermanentToExile] Commander ${zoneCard.name} would go to exile - queued commander zone choice step`);
    if (normalizedRemovedPermanentId) {
      processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
    }
    bumpSeq();
    return true;
  }

  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] } as any);
  const exiledCard = {
    id: zoneCard?.id,
    name: zoneCard?.name,
    type_line: zoneCard?.type_line,
    oracle_text: zoneCard?.oracle_text,
    image_uris: zoneCard?.image_uris,
    mana_cost: zoneCard?.mana_cost,
    power: zoneCard?.power,
    toughness: zoneCard?.toughness,
    ...exileTag,
    ...buildZoneObjectWithRetainedCounters(zoneCard, permanent, 'exile'),
  };
  z.exile = z.exile || [];
  z.exile.push(exiledCard);
  if (normalizedRemovedPermanentId) {
    processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
  }
  queueExiledFromBattlefieldTriggers(ctx, permanent);
  bumpSeq();
  return true;
}

/* ===== core zone operations ===== */

/**
 * importDeckResolved
 * Populate ctx.libraries[playerId] with resolved KnownCardRef objects.
 * Clears all existing zones (hand, graveyard, exile, commander zone) for a clean import.
 */
export function importDeckResolved(
  ctx: GameContext,
  playerId: PlayerID,
  cards: Array<
    Pick<
      KnownCardRef,
      "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness" | "card_faces" | "layout" | "loyalty"
    > & { color_identity?: string[] }
  >
) {
  const { libraries, state, bumpSeq } = ctx as any;
  const zones = state.zones = state.zones || {};

  // If this player currently has any cards in true exile, ensure impulse-style permissions/tags
  // are cleaned up before we wipe zones for a fresh deck import.
  try {
    const prevExile = Array.isArray(zones?.[playerId]?.exile) ? (zones[playerId] as any).exile : [];
    for (const c of prevExile) cleanupCardLeavingExile(state, c);
    state.playableFromExile = state.playableFromExile || {};
    state.playableFromExile[playerId] = {};
  } catch {
    // ignore
  }
  
  debug(2, `[importDeckResolved] Importing ${cards.length} cards for player ${playerId}`);
  
  // Clear all existing zones for this player to ensure clean deck import
  // This prevents issues with loading a new deck over an existing one
  zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
  
  // Clear commander zone if it exists
  if (state.commandZone && state.commandZone[playerId]) {
    state.commandZone[playerId] = {
      commanderIds: [],
      commanderCards: [],
    };
  }
  
  // Clear battlefield of player's permanents
  if (Array.isArray(state.battlefield)) {
    state.battlefield = state.battlefield.filter((p: any) => 
      p.controller !== playerId && p.owner !== playerId
    );
  }
  
  // Now import the new deck
  const mappedCards = cards.map((c) => ({
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: c.image_uris,
    mana_cost: (c as any).mana_cost,
    cmc: (c as any).cmc, // Converted mana cost - needed for cost calculations
    power: (c as any).power,
    toughness: (c as any).toughness,
    loyalty: (c as any).loyalty, // Planeswalker starting loyalty - CRITICAL for planeswalkers
    card_faces: (c as any).card_faces,
    layout: (c as any).layout,
    color_identity: (c as any).color_identity,
    colors: (c as any).colors, // Card colors - needed for color detection
    zone: "library",
  }));
  
  debug(2, `[importDeckResolved] Mapped ${mappedCards.length} cards. First card: ${mappedCards[0]?.name} (${mappedCards[0]?.id})`);
  
  libraries.set(playerId, mappedCards);
  const libLen = libraries.get(playerId)?.length ?? 0;
  zones[playerId]!.libraryCount = libLen;
  
  debug(2, `[importDeckResolved] Library set for player ${playerId}. Final library size: ${libLen}`);
  
  bumpSeq();
}

/**
 * shuffleLibrary
 */
export function shuffleLibrary(ctx: GameContext, playerId: PlayerID) {
  const lib = ctx.libraries.get(playerId) || [];
  for (let i = lib.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [lib[i], lib[j]] = [lib[j], lib[i]];
  }
  ctx.libraries.set(playerId, lib);
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  ctx.bumpSeq();
}

/**
 * drawCards
 * 
 * Draws cards from the library into the player's hand.
 * Also tracks first draw of the turn for miracle abilities and triggers draw effects.
 * Handles empty library draw according to Rule 704.5b:
 * - If a player attempts to draw from an empty library, they lose the game
 * - Unless they have Laboratory Maniac/Jace (win instead) or Platinum Angel (can't lose)
 * 
 * @param ctx Game context
 * @param playerId Player drawing the cards
 * @param count Number of cards to draw
 * @returns Object with drawn cards and any win/loss result
 */
export interface DrawResult {
  cards: KnownCardRef[];
  emptyLibraryAttempt: boolean;
  playerWins: boolean;
  playerLoses: boolean;
  reason?: string;
}

function getOpponentsForPlayer(state: any, playerId: string): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players
    .map((player: any) => String(player?.id || '').trim())
    .filter((id: string) => id.length > 0 && id !== String(playerId || '').trim());
}

function queueZursWeirdingOpponentStep(
  ctx: GameContext,
  playerId: string,
  revealedCard: any,
  remainingDrawCountAfterChoice: number,
  opponentIndex: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const pending = (ctx.state as any).zursWeirdingPendingDraw;
  const opponents = Array.isArray(pending?.opponents) ? pending.opponents : getOpponentsForPlayer(ctx.state, playerId);
  const decidingOpponentId = String(opponents[opponentIndex] || '').trim();
  if (!decidingOpponentId) {
    return false;
  }

  const cardName = String(revealedCard?.name || 'the top card of the library').trim() || 'the top card of the library';
  ResolutionQueueManager.addStep(gameId, {
    id: uid('zurs_weirding'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: decidingOpponentId as PlayerID,
    sourceId: String(pending?.sourceName || "Zur's Weirding"),
    sourceName: String(pending?.sourceName || "Zur's Weirding"),
    description: `Zur's Weirding: ${getPlayerNameFromState(ctx.state, playerId)} would draw ${cardName}. You may pay 2 life to put it into their graveyard.`,
    mandatory: false,
    minSelections: 0,
    maxSelections: 1,
    zursWeirdingOpponentChoice: true,
    drawingPlayerId: playerId,
    decidingOpponentId,
    opponentIndex,
    revealedCard: {
      id: String(revealedCard?.id || '').trim(),
      name: cardName,
    },
    remainingDrawCountAfterChoice,
    opponents,
    options: [
      { id: 'pay_2_life', label: 'Pay 2 life (put card in graveyard)' },
      { id: 'decline', label: 'Decline' },
    ],
  } as any);
  return true;
}

function getPlayerNameFromState(state: any, playerId: string): string {
  const players = Array.isArray(state?.players) ? state.players : [];
  const player = players.find((entry: any) => String(entry?.id || '') === String(playerId || ''));
  return String(player?.name || playerId || 'Player');
}

function queueZursWeirdingDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const library = ctx.libraries.get(playerId as PlayerID) || [];
  if (library.length === 0) return false;

  const topCard = library[0];
  const opponents = getOpponentsForPlayer(ctx.state, playerId);
  (ctx.state as any).zursWeirdingPendingDraw = {
    drawingPlayerId: playerId,
    sourceName: String(metadata?.sourceName || "Zur's Weirding"),
    revealedCard: {
      id: String(topCard?.id || '').trim(),
      name: String(topCard?.name || 'Card').trim() || 'Card',
    },
    remainingDrawCountAfterChoice,
    opponents,
    nextOpponentIndex: 0,
  };

  if (opponents.length === 0) {
    return false;
  }

  return queueZursWeirdingOpponentStep(ctx, playerId, topCard, remainingDrawCountAfterChoice, 0);
}

export interface ZursWeirdingDrawReplacementResult {
  applied: boolean;
  reason?: string;
  revealedCard?: any;
  drawnCards?: any[];
  milledCard?: any;
}

export function applyZursWeirdingOpponentChoice(ctx: GameContext, event: {
  drawingPlayerId: string;
  decidingOpponentId: string;
  opponentIndex: number;
  choiceId?: string;
  remainingDrawCountAfterChoice?: number;
  opponents?: string[];
}): ZursWeirdingDrawReplacementResult {
  const drawingPlayerId = String(event?.drawingPlayerId || '').trim() as PlayerID;
  const decidingOpponentId = String(event?.decidingOpponentId || '').trim();
  const choiceId = String(event?.choiceId || '').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const opponents = Array.isArray(event?.opponents) ? event.opponents.map((id) => String(id || '').trim()).filter(Boolean) : getOpponentsForPlayer(ctx.state, drawingPlayerId);
  const opponentIndex = Math.max(0, Math.floor(Number(event?.opponentIndex || 0)));

  if (!drawingPlayerId) return { applied: false, reason: 'missing_drawing_player' };

  const library = ctx.libraries.get(drawingPlayerId) || [];
  if (library.length === 0) return { applied: false, reason: 'empty_library' };

  const pending = (ctx.state as any).zursWeirdingPendingDraw;
  const revealedCard = pending?.revealedCard || library[0];

  if (choiceId === 'pay_2_life' || choiceId === 'pay') {
    const currentLife = Number((ctx.state as any)?.life?.[decidingOpponentId] ?? (ctx.state as any)?.startingLife ?? 40);
    if (currentLife < 2) return { applied: false, reason: 'insufficient_life' };

    (ctx.state as any).life = (ctx.state as any).life || {};
    (ctx.state as any).life[decidingOpponentId] = currentLife - 2;
    const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
    const player = players.find((entry: any) => String(entry?.id || '') === decidingOpponentId);
    if (player) (player as any).life = currentLife - 2;
    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[decidingOpponentId] =
      Number((ctx.state as any).lifeLostThisTurn[decidingOpponentId] || 0) + 2;

    const [milledCard] = library.splice(0, 1);
    const zones = ctx.state.zones = ctx.state.zones || {};
    const z = zones[drawingPlayerId] || (zones[drawingPlayerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
    z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
    const graveyardCard = { ...milledCard, zone: 'graveyard' };
    (z.graveyard as any[]).push(graveyardCard);
    z.graveyardCount = (z.graveyard as any[]).length;
    z.libraryCount = library.length;
    ctx.libraries.set(drawingPlayerId, library);
    delete (ctx.state as any).zursWeirdingPendingDraw;

    recordCardPutIntoGraveyardThisTurn(ctx as any, drawingPlayerId, graveyardCard, { fromBattlefield: false });
    ctx.bumpSeq();

    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, drawingPlayerId, remainingDrawCountAfterChoice);
    }

    return { applied: true, revealedCard, milledCard: graveyardCard };
  }

  const nextOpponentIndex = opponentIndex + 1;
  if (nextOpponentIndex < opponents.length) {
    (ctx.state as any).zursWeirdingPendingDraw = {
      ...(pending || {}),
      nextOpponentIndex,
    };
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying) {
      queueZursWeirdingOpponentStep(ctx, drawingPlayerId, library[0], remainingDrawCountAfterChoice, nextOpponentIndex);
    }
    return { applied: true, revealedCard, reason: 'queued_next_opponent' };
  }

  const previousSuppress = (ctx as any)._suppressZursWeirdingReplacement === true;
  (ctx as any)._suppressZursWeirdingReplacement = true;
  try {
    const drawnCards = drawCards(ctx, drawingPlayerId, 1);
    delete (ctx.state as any).zursWeirdingPendingDraw;
    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, drawingPlayerId, remainingDrawCountAfterChoice);
    }
    return { applied: true, revealedCard, drawnCards };
  } finally {
    if (previousSuppress) {
      (ctx as any)._suppressZursWeirdingReplacement = true;
    } else {
      delete (ctx as any)._suppressZursWeirdingReplacement;
    }
  }
}

function queueDredgeDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  drawIndex: number,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const dredgeOptions = Array.isArray(metadata?.dredgeOptions) ? metadata.dredgeOptions : [];
  if (dredgeOptions.length === 0) return false;

  const firstOption = dredgeOptions[0] || {};
  ResolutionQueueManager.addStep(gameId, {
    id: uid('dredge_choice'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    sourceId: String(firstOption.cardId || 'dredge'),
    sourceName: String(firstOption.cardName || 'Dredge'),
    description: 'Replace this draw with dredge?',
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    dredgeDrawReplacementChoice: true,
    drawIndex,
    remainingDrawCountAfterChoice,
    dredgeOptions: dredgeOptions.map((option: any) => ({
      cardId: String(option?.cardId || '').trim(),
      cardName: String(option?.cardName || 'Dredge card').trim() || 'Dredge card',
      dredge: Math.max(0, Math.floor(Number(option?.dredge || 0))),
    })).filter((option: any) => option.cardId && option.dredge > 0),
    options: [
      { id: 'draw', label: 'Draw a card' },
      ...dredgeOptions
        .map((option: any) => {
          const cardId = String(option?.cardId || '').trim();
          const cardName = String(option?.cardName || 'Dredge card').trim() || 'Dredge card';
          const dredge = Math.max(0, Math.floor(Number(option?.dredge || 0)));
          if (!cardId || dredge <= 0) return null;
          return {
            id: `dredge:${cardId}`,
            label: `${cardName} - Dredge ${dredge}`,
            description: `Mill ${dredge} cards, then return ${cardName} from your graveyard to your hand.`,
          };
        })
        .filter(Boolean),
    ],
  } as any);
  return true;
}

function findDredgeAmount(card: any): number {
  const match = String(card?.oracle_text || '').match(/\bdredge\s+(\d+)\b/i);
  const amount = match ? parseInt(match[1], 10) : 0;
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export interface DredgeDrawReplacementResult {
  applied: boolean;
  declined?: boolean;
  reason?: string;
  dredgeCard?: any;
  milledCards?: any[];
  drawnCards?: any[];
}

export function applyDredgeDrawReplacementChoice(ctx: GameContext, event: {
  playerId: PlayerID | string;
  choiceId?: string;
  dredgeCardId?: string;
  dredgeAmount?: number;
  remainingDrawCountAfterChoice?: number;
}): DredgeDrawReplacementResult {
  const playerId = String(event?.playerId || '').trim() as PlayerID;
  if (!playerId) return { applied: false, reason: 'missing_player' };

  const choiceId = String(event?.choiceId || '').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));

  if (!choiceId || choiceId === 'draw' || choiceId === 'decline') {
    const previousSuppress = (ctx as any)._suppressDredgeReplacement === true;
    (ctx as any)._suppressDredgeReplacement = true;
    try {
      const drawnCards = drawCards(ctx, playerId, 1);
      if (!previousSuppress) delete (ctx as any)._suppressDredgeReplacement;
      if (remainingDrawCountAfterChoice > 0) {
        drawCards(ctx, playerId, remainingDrawCountAfterChoice);
      }
      return { applied: true, declined: true, drawnCards };
    } finally {
      if (previousSuppress) {
        (ctx as any)._suppressDredgeReplacement = true;
      } else {
        delete (ctx as any)._suppressDredgeReplacement;
      }
    }
  }

  const dredgeCardId = String(event?.dredgeCardId || choiceId.replace(/^dredge:/, '')).trim();
  if (!dredgeCardId) return { applied: false, reason: 'missing_dredge_card' };

  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.hand = Array.isArray(z.hand) ? z.hand : [];
  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

  const graveyard = z.graveyard as any[];
  const dredgeIndex = graveyard.findIndex((card: any) => String(card?.id || '').trim() === dredgeCardId);
  if (dredgeIndex < 0) return { applied: false, reason: 'dredge_card_not_in_graveyard' };

  const dredgeCard = graveyard[dredgeIndex];
  const dredgeAmount = Math.max(0, Math.floor(Number(event?.dredgeAmount || findDredgeAmount(dredgeCard))));
  if (dredgeAmount <= 0) return { applied: false, reason: 'invalid_dredge_amount' };

  const library = ctx.libraries.get(playerId) || [];
  if (library.length < dredgeAmount) return { applied: false, reason: 'insufficient_library' };

  const milledCards = library.splice(0, dredgeAmount).map((card: any) => ({ ...card, zone: 'graveyard' }));
  for (const milledCard of milledCards) {
    graveyard.push(milledCard);
    recordCardPutIntoGraveyardThisTurn(ctx as any, String(playerId), milledCard, { fromBattlefield: false });
  }

  const [returnedCard] = graveyard.splice(dredgeIndex, 1);
  const returnedToHand = { ...returnedCard, zone: 'hand' };
  (z.hand as any[]).push(returnedToHand);
  ctx.libraries.set(playerId, library);
  z.handCount = (z.hand as any[]).length;
  z.libraryCount = library.length;
  z.graveyardCount = graveyard.length;

  processMillTriggers(ctx, playerId, milledCards, playerId);
  ctx.bumpSeq();

  if (remainingDrawCountAfterChoice > 0) {
    drawCards(ctx, playerId, remainingDrawCountAfterChoice);
  }

  return { applied: true, dredgeCard: returnedToHand, milledCards };
}

export function drawCards(ctx: GameContext, playerId: PlayerID, count: number): KnownCardRef[] {
  const zones = ctx.state.zones = ctx.state.zones || {};
  const drawn: KnownCardRef[] = [];
  const normalizedCount = Math.max(0, Math.floor(Number(count || 0)));
  
  // Track draws this turn for miracle abilities (Rule 702.94)
  (ctx.state as any).cardsDrawnThisTurn = (ctx.state as any).cardsDrawnThisTurn || {};
  const previousDrawCounts: Record<string, number> = {};
  const drawnByPlayer: Record<string, KnownCardRef[]> = {};
  const emptyDrawByPlayer: Record<string, boolean> = {};
  const drawReplacementChoices: any[] = [];
  const getPreviousDrawCount = (pid: string) => {
    if (previousDrawCounts[pid] === undefined) {
      previousDrawCounts[pid] = Number((ctx.state as any).cardsDrawnThisTurn?.[pid] || 0);
    }
    return previousDrawCounts[pid];
  };
  const getZone = (pid: string) => {
    return zones[pid] || (zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  };
  const drawOneForPlayer = (pid: string, returnToOriginal: boolean): boolean => {
    const lib = ctx.libraries.get(pid as PlayerID) || [];
    const z = getZone(pid);
    if (lib.length <= 0) {
      emptyDrawByPlayer[pid] = true;
      debug(2, `[drawCards] Player ${pid} attempted to draw from empty library`);
      return false;
    }

    const c = lib.shift()!;
    drawnByPlayer[pid] = drawnByPlayer[pid] || [];
    const drawNumber = getPreviousDrawCount(pid) + drawnByPlayer[pid].length + 1;
    if (drawNumber === 1) {
      (c as any).isFirstDrawnThisTurn = true;
      (c as any).drawnAt = Date.now();
    }

    (z.hand as any[]).push(c);
    drawnByPlayer[pid].push(c);
    if (returnToOriginal) drawn.push(c);
    ctx.libraries.set(pid as PlayerID, lib);
    z.handCount = (z.hand as any[]).length;
    z.libraryCount = lib.length;
    return true;
  };

  if (normalizedCount >= 2) {
    const batchReplacement = evaluateDrawReplacementEvent({
      state: ctx.state,
      playerId: String(playerId),
      count: normalizedCount,
    });

    if (batchReplacement.effectId === 'draw-replaced-by-shared-draw') {
      const originalPlayerId = String(playerId);
      drawOneForPlayer(originalPlayerId, true);
      for (const additionalDraw of ((batchReplacement.metadata as any)?.additionalDraws || [])) {
        const additionalPlayerId = String(additionalDraw?.playerId || '').trim();
        const additionalCount = Math.max(0, Math.floor(Number(additionalDraw?.count || 0)));
        if (!additionalPlayerId || additionalCount <= 0) continue;
        for (let i = 0; i < additionalCount; i++) {
          if (!drawOneForPlayer(additionalPlayerId, false)) break;
        }
      }
    }
  }

  if (drawn.length === 0 && Object.keys(drawnByPlayer).length === 0) {
  
    for (let i = 0; i < normalizedCount; i++) {
      const originalPlayerId = String(playerId);
      const currentStep = String((ctx.state as any).step || (ctx.state as any).phase || '').toLowerCase();
      const drawNumber = getPreviousDrawCount(originalPlayerId) + (drawnByPlayer[originalPlayerId]?.length || 0) + 1;
      const replacement = evaluateDrawReplacementEvent({
        state: ctx.state,
        playerId: originalPlayerId,
        count: 1,
        drawIndex: drawNumber,
        metadata: {
          isFirstDrawStepDraw: currentStep.includes('draw') && drawNumber === 1,
          skipDredgeReplacement: (ctx as any)._suppressDredgeReplacement === true,
          skipZursWeirdingReplacement: (ctx as any)._suppressZursWeirdingReplacement === true,
          remainingDrawCountAfterChoice: Math.max(0, normalizedCount - i - 1),
        },
      });

      if (replacement.choiceRequired && replacement.effectId === 'zurs-weirding-draw-replacement') {
        drawReplacementChoices.push(replacement.metadata);
        const queued = queueZursWeirdingDrawReplacementStep(
          ctx,
          originalPlayerId,
          replacement.metadata,
          Math.max(0, normalizedCount - i - 1),
        );
        const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
        if (queued || ((ctx as any).isReplaying && replayNextEventType === 'zursWeirdingDrawReplacementResolve')) {
          break;
        }
      }

      if (replacement.choiceRequired && replacement.effectId === 'dredge-draw-replacement-choice') {
        drawReplacementChoices.push(replacement.metadata);
        const queued = queueDredgeDrawReplacementStep(
          ctx,
          originalPlayerId,
          replacement.metadata,
          drawNumber,
          Math.max(0, normalizedCount - i - 1),
        );
        const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
        if (queued || ((ctx as any).isReplaying && replayNextEventType === 'dredgeDrawReplacementResolve')) {
          break;
        }
      }

      if (replacement.effectId === 'draw-replaced-by-opponent') {
        const replacementPlayerId = String((replacement.metadata as any)?.replacementPlayerId || '').trim();
        if (replacementPlayerId) {
          if (!drawOneForPlayer(replacementPlayerId, false)) break;
          continue;
        }
      }

      if (!drawOneForPlayer(originalPlayerId, true)) {
        break;
      }
    }
  }

  if (drawReplacementChoices.length > 0) {
    (ctx.state as any).lastDrawReplacementChoices = drawReplacementChoices;
  }
  
  // Update draw count for this turn
  for (const [pid, cards] of Object.entries(drawnByPlayer)) {
    (ctx.state as any).cardsDrawnThisTurn[pid] = getPreviousDrawCount(pid) + cards.length;
  }
  
  // Process draw triggers (Psychosis Crawler, etc.)
  for (const [pid, cards] of Object.entries(drawnByPlayer)) {
    if (cards.length > 0) {
      processDrawTriggers(ctx, pid as PlayerID, cards.length);
    }
  }
  
  // Handle empty library draw (Rule 704.5b)
  for (const pid of Object.keys(emptyDrawByPlayer)) {
    // Check for win/lose replacement effects
    const result = checkEmptyLibraryDraw(ctx, pid as PlayerID);
    
    if (result.wins) {
      debug(2, `[drawCards] Player ${pid} WINS: ${result.reason}`);
      
      // Mark the game as won
      (ctx.state as any).gameOver = true;
      (ctx.state as any).winner = pid;
      (ctx.state as any).winReason = result.reason;
    } else if (result.loses) {
      debug(2, `[drawCards] Player ${pid} LOSES: ${result.reason}`);
      
      // Track that this player attempted to draw from empty library
      // State-based actions will check this
      (ctx.state as any).attemptedEmptyLibraryDraw = (ctx.state as any).attemptedEmptyLibraryDraw || {};
      (ctx.state as any).attemptedEmptyLibraryDraw[pid] = true;
    } else {
      // Can't lose the game (Platinum Angel, etc.)
      debug(2, `[drawCards] Player ${pid} attempted empty library draw but can't lose: ${result.reason}`);
    }
  }
  
  ctx.bumpSeq();
  return drawn;
}

/**
 * Process draw triggers - called when a player draws cards
 * Handles:
 * - Psychosis Crawler: "Whenever you draw a card, each opponent loses 1 life"
 * - Niv-Mizzet: "Whenever you draw a card, deal 1 damage to any target"
 */
export function processDrawTriggers(ctx: GameContext, drawingPlayerId: PlayerID, cardsDrawn: number) {
  if ((ctx as any)?.isReplaying) return;

  const battlefield = ctx.state.battlefield || [];
  const players = (ctx.state as any).players || [];
  const gameId = String((ctx as any).gameId || '').trim();

  const snapshotPermanentForTriggerContext = (permanent: any): any | undefined => {
    if (!permanent || typeof permanent !== 'object') return undefined;
    return {
      id: String(permanent?.id || ''),
      controller: String(permanent?.controller || ''),
      owner: String(permanent?.owner || permanent?.controller || ''),
      tapped: permanent?.tapped === true,
      counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
      card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
    };
  };

  const sourcePermanentSnapshotFor = (permanentId: string): any | undefined => {
    const normalizedPermanentId = String(permanentId || '').trim();
    if (!normalizedPermanentId) return undefined;
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === normalizedPermanentId);
    return snapshotPermanentForTriggerContext(permanent);
  };

  const drawTriggers = orderTriggersByAPNAP(ctx, getCardDrawTriggers(ctx, String(drawingPlayerId)));
  const queueGenericDrawTrigger = (trigger: any, drawIndex: number) => {
    const effect = String(trigger?.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    const sourceName = String(trigger?.cardName || '').trim();
    const sourceNameLower = sourceName.toLowerCase();
    const effectLower = effect.toLowerCase();
    if (!effect) {
      return;
    }
    if (sourceNameLower.includes('smothering tithe') || /\bmay pay \{[^}]+\}/i.test(effectLower)) {
      return;
    }
    if (hasUnsupportedTargetRequirement(targetMetadata)) {
      return;
    }

    ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = sourcePermanentSnapshotFor(trigger.permanentId);
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: drawingPlayerId,
      targetPlayer: drawingPlayerId,
      effectData: {
        drawingPlayerId,
        drawIndex,
      },
    } as any;

    (ctx.state.stack as any[]).push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          targetPlayer: drawingPlayerId,
          triggeringPlayer: drawingPlayerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[drawTrigger] Failed to persist generic draw trigger:', err);
      }
    }
  };

  if (cardsDrawn > 0 && drawTriggers.length > 0) {
    for (let index = 0; index < cardsDrawn; index++) {
      for (const trigger of drawTriggers) {
        queueGenericDrawTrigger(trigger, index + 1);
      }
    }
  }
  
  const smotheringTithePermanents = orderTriggersByAPNAP(
    ctx,
    battlefield
      .filter((perm: any) => {
        if (!perm || !perm.card || perm.controller === drawingPlayerId) return false;
        const permName = String(perm.card.name || '').toLowerCase();
        const oracleText = String(perm.card.oracle_text || '').toLowerCase();
        return permName.includes('smothering tithe') ||
          (oracleText.includes('whenever an opponent draws a card') &&
            oracleText.includes('may pay {2}') &&
            oracleText.includes('treasure token'));
      })
      .map((perm: any) => ({ controllerId: perm.controller, permanent: perm })),
  );

  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const permName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Niv-Mizzet: triggers for damage (would need stack implementation for targeting)
    if (permName.includes('niv-mizzet') && 
        oracleText.includes('whenever you draw') && 
        perm.controller === drawingPlayerId) {
      debug(2, `[drawTrigger] Niv-Mizzet: ${cardsDrawn} damage trigger(s)`);
    }

  }

  for (const { permanent: perm } of smotheringTithePermanents) {
      ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];

      for (let index = 0; index < cardsDrawn; index++) {
        const triggerId = uid('trigger');
        const sourcePermanentSnapshot = snapshotPermanentForTriggerContext(perm);
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: perm.controller,
          source: perm.id,
          sourceName: perm.card?.name || 'Smothering Tithe',
          description: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
          effect: 'Create a Treasure token',
          triggerType: 'smothering_tithe',
          mandatory: true,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          targetPlayer: drawingPlayerId,
          triggeringPlayer: drawingPlayerId,
          effectData: {
            drawingPlayerId,
            paymentCost: '{2}',
            benefitIfNotPaid: 'Create a Treasure token',
          },
        } as any;

        (ctx.state.stack as any[]).push(stackItem);

        if (gameId && gameId !== 'unknown') {
          try {
            appendEvent(gameId, Number((ctx as any).seq?.value ?? 0), 'pushTriggeredAbility', {
              triggerId,
              sourceId: perm.id,
              permanentId: perm.id,
              sourceName: perm.card?.name || 'Smothering Tithe',
              controllerId: perm.controller,
              description: stackItem.description,
              triggerType: 'smothering_tithe',
              effect: 'Create a Treasure token',
              mandatory: true,
              targetPlayer: drawingPlayerId,
              triggeringPlayer: drawingPlayerId,
              ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
              ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
              effectData: stackItem.effectData,
            });
          } catch (err) {
            debugWarn(1, '[drawTrigger] Failed to persist Smothering Tithe trigger:', err);
          }
        }
      }
  }
}

export function processMillTriggers(
  ctx: GameContext,
  millingPlayerId: PlayerID | string,
  milledCards: any[],
  sourcePlayerId?: PlayerID | string,
): void {
  if ((ctx as any)?.isReplaying) return;

  const cards = Array.isArray(milledCards) ? milledCards.filter((card: any) => card) : [];
  if (cards.length === 0) {
    return;
  }

  const triggers = orderTriggersByAPNAP(ctx, getMillTriggers(ctx, String(millingPlayerId)));
  if (triggers.length === 0) {
    return;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];

  const snapshotPermanentForTriggerContext = (permanent: any): any | undefined => {
    if (!permanent || typeof permanent !== 'object') return undefined;
    return {
      id: String(permanent?.id || ''),
      controller: String(permanent?.controller || ''),
      owner: String(permanent?.owner || permanent?.controller || ''),
      tapped: permanent?.tapped === true,
      counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
      card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
    };
  };

  const sourcePermanentSnapshotFor = (permanentId: string): any | undefined => {
    const normalizedPermanentId = String(permanentId || '').trim();
    if (!normalizedPermanentId) return undefined;
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === normalizedPermanentId);
    return snapshotPermanentForTriggerContext(permanent);
  };

  const isPermanentCard = (typeLine: string): boolean => {
    const normalized = String(typeLine || '').toLowerCase();
    return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some((type) => normalized.includes(type));
  };

  const matchesMillTriggerFilter = (card: any, filter: string): boolean => {
    const typeLine = String(card?.type_line || '').toLowerCase();
    const isLand = typeLine.includes('land');
    const isCreature = typeLine.includes('creature');
    const isArtifact = typeLine.includes('artifact');
    switch (filter) {
      case 'land':
        return isLand;
      case 'nonland':
        return !isLand;
      case 'creature':
        return isCreature;
      case 'noncreature_nonland':
        return !isCreature && !isLand;
      case 'artifact':
        return isArtifact;
      case 'permanent':
        return isPermanentCard(typeLine);
      case 'any':
      default:
        return true;
    }
  };

  const pushMillTrigger = (trigger: any, matchingCards: any[]) => {
    if (matchingCards.length === 0) {
      return;
    }
    const effect = String(trigger?.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      return;
    }

    const primaryCard = matchingCards[0];
    const primaryCardId = String(primaryCard?.id || '').trim();
    const primaryCardName = String(primaryCard?.name || 'that card').trim() || 'that card';
    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = sourcePermanentSnapshotFor(String(trigger.permanentId || ''));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: String(trigger.controllerId),
      source: String(trigger.permanentId || triggerId),
      permanentId: String(trigger.permanentId || triggerId),
      sourceName: String(trigger.cardName || 'Mill trigger'),
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: String(millingPlayerId),
      targetPlayer: String(millingPlayerId),
      effectData: {
        millingPlayerId: String(millingPlayerId),
        ...(sourcePlayerId ? { sourcePlayerId: String(sourcePlayerId) } : null),
        milledCardsCount: matchingCards.length,
        milledCardIds: matchingCards.map((card: any) => String(card?.id || '')).filter(Boolean),
        ...(primaryCardId ? { milledCardId: primaryCardId } : null),
        ...(primaryCardName ? { milledCardName: primaryCardName } : null),
      },
      ...(primaryCard && typeof primaryCard === 'object'
        ? { milledCard: { ...(primaryCard as any) } }
        : null),
    } as any;

    stateAny.stack.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: String(trigger.permanentId || triggerId),
          permanentId: String(trigger.permanentId || triggerId),
          sourceName: String(trigger.cardName || 'Mill trigger'),
          controllerId: String(trigger.controllerId),
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          targetPlayer: String(millingPlayerId),
          triggeringPlayer: String(millingPlayerId),
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          ...(stackItem.milledCard && typeof stackItem.milledCard === 'object' ? { milledCard: stackItem.milledCard } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[millTrigger] Failed to persist generic mill trigger:', err);
      }
    }
  };

  for (const trigger of triggers) {
    const matchingCards = cards.filter((card: any) => matchesMillTriggerFilter(card, String(trigger.cardFilter || 'any')));
    if (matchingCards.length === 0) {
      continue;
    }

    if (trigger.frequency === 'per_event') {
      pushMillTrigger(trigger, matchingCards);
      continue;
    }

    for (const matchingCard of matchingCards) {
      pushMillTrigger(trigger, [matchingCard]);
    }
  }
}

/**
 * moveHandToLibrary: Move the player's whole hand onto top of library
 */
export function moveHandToLibrary(ctx: GameContext, playerId: PlayerID) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return 0;
  const hand = (z.hand as any[]) || [];
  const lib = ctx.libraries.get(playerId) || [];
  while (hand.length) {
    const c = hand.shift()!;
    lib.unshift(c);
  }
  ctx.libraries.set(playerId, lib);
  z.hand = [];
  z.handCount = 0;
  z.libraryCount = lib.length;
  ctx.bumpSeq();
  return z.handCount;
}

/**
 * shuffleHand
 */
export function shuffleHand(ctx: GameContext, playerId: PlayerID) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return;
  const hand = (z.hand as any[]) || [];
  for (let i = hand.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [hand[i], hand[j]] = [hand[j], hand[i]];
  }
  z.hand = hand as any;
  z.handCount = hand.length;
  ctx.bumpSeq();
}

/**
 * peekTopN: non-mutating snapshot of top N of library
 */
export function peekTopN(ctx: GameContext, playerId: PlayerID, n: number) {
  const lib = ctx.libraries.get(playerId) || [];
  return lib.slice(0, Math.max(0, n | 0)).map((c) => ({
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: (c as any).image_uris,
    card_faces: (c as any).card_faces,
    layout: (c as any).layout,
  }));
}

/* ===== selection / movement helpers ===== */

/**
 * selectFromLibrary
 *
 * Remove card(s) with given ids from player's library and move them to a zone.
 * - moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'
 * Returns array of moved KnownCardRef objects (for non-battlefield) or ids moved.
 */
export function selectFromLibrary(ctx: GameContext, playerId: PlayerID, cardIds: string[], moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield') {
  const lib = ctx.libraries.get(playerId) || [];
  if (!Array.isArray(cardIds)) cardIds = [];

  const byId = new Map<string, KnownCardRef>();
  // extract matching cards from library
  for (let i = lib.length - 1; i >= 0; i--) {
    const c = lib[i] as any;
    if (cardIds.includes(c?.id)) {
      const [removed] = lib.splice(i, 1);
      byId.set(removed.id, removed);
    }
  }

  ctx.libraries.set(playerId, lib);

  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  const moved: KnownCardRef[] = [];

  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) continue;
    if (moveTo === 'hand') {
      (z.hand as any[]).push({ ...c, zone: 'hand' });
      moved.push(c);
    } else if (moveTo === 'graveyard') {
      (z as any).graveyard = (z as any).graveyard || [];
      (z as any).graveyard.push({ ...c, zone: 'graveyard', faceDown: false });
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), c, { fromBattlefield: false });
      moved.push(c);
    } else if (moveTo === 'exile') {
      (z as any).exile = (z as any).exile || [];
      (z as any).exile.push({ ...c, zone: 'exile', faceDown: false });
      moved.push(c);
    } else if (moveTo === 'battlefield') {
      // caller should convert these to permanents; return minimal objects
      moved.push({ id: c.id, name: c.name } as any);
    }
  }

  // update counts
  z.handCount = (z.hand as any[]).length;
  (z as any).graveyardCount = ((z as any).graveyard || []).length;
  (z as any).libraryCount = lib.length;

  ctx.bumpSeq();

  return moved;
}

/**
 * reorderHand: reorder the player's hand according to index array
 */
export function reorderHand(ctx: GameContext, playerId: PlayerID, order: number[]) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return false;
  const hand = (z.hand as any[]) || [];
  const n = hand.length;
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set<number>();
  for (const v of order) {
    if (typeof v !== "number" || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  const next: any[] = new Array(n);
  for (let i = 0; i < n; i++) next[i] = hand[order[i]];
  z.hand = next as any;
  z.handCount = next.length;
  ctx.bumpSeq();
  return true;
}

/* ===== scry / surveil helpers ===== */

export function applyScry(ctx: GameContext, playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!Array.isArray(keepTopOrder)) keepTopOrder = [];
  if (!Array.isArray(bottomOrder)) bottomOrder = [];
  if (keepTopOrder.length + bottomOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...keepTopOrder, ...bottomOrder]) {
    const idx = lib.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  for (const id of bottomOrder) {
    const c = byId.get(id);
    if (c) lib.push({ ...c, zone: "library" });
  }
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    const id = keepTopOrder[i];
    const c = byId.get(id);
    if (c) lib.unshift({ ...c, zone: "library" });
  }
  const zones = ctx.state.zones = ctx.state.zones || {};
  zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any;
  zones[playerId]!.libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

export function applySurveil(ctx: GameContext, playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!Array.isArray(toGraveyard)) toGraveyard = [];
  if (!Array.isArray(keepTopOrder)) keepTopOrder = [];
  if (toGraveyard.length + keepTopOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...toGraveyard, ...keepTopOrder]) {
    const idx = lib.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z =
    zones[playerId] ||
    (zones[playerId] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    } as any);
  (z as any).graveyard = (z as any).graveyard || [];
  for (const id of toGraveyard) {
    const c = byId.get(id);
    if (c) {
      (z as any).graveyard.push({ ...c, zone: "graveyard", faceDown: false });
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), c, { fromBattlefield: false });
    }
  }
  (z as any).graveyardCount = ((z as any).graveyard || []).length;
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    const id = keepTopOrder[i];
    const c = byId.get(id);
    if (c) lib.unshift({ ...c, zone: "library" });
  }
  (z as any).libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

/**
 * applyExplore
 * Rule 701.44: A permanent explores. Reveal top card of library.
 * - If land: put in hand
 * - If not land: put +1/+1 counter on the exploring permanent, 
 *   and you may put the revealed card into graveyard (else leave on top)
 */
export function applyExplore(
  ctx: GameContext,
  playerId: PlayerID,
  permanentId: string,
  revealedCardId: string,
  isLand: boolean,
  toGraveyard: boolean
): void {
  const lib = ctx.libraries.get(playerId) || [];
  if (lib.length === 0) return;
  
  // Find the revealed card at top of library
  const topCard = lib[0];
  if (!topCard || topCard.id !== revealedCardId) {
    // Card mismatch - state has changed, ignore
    return;
  }
  
  // Remove from top of library
  lib.shift();
  
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any);
  
  if (isLand) {
    // Land goes to hand
    (z as any).hand = (z as any).hand || [];
    (z as any).hand.push({ ...topCard, zone: "hand", faceDown: false });
    (z as any).handCount = ((z as any).hand || []).length;
  } else {
    // Not a land - add +1/+1 counter to exploring permanent (respects Branching Evolution, Hardened Scales, etc.)
    const battlefield = ctx.state.battlefield || [];
    const perm = battlefield.find((p: any) => p.id === permanentId && p.controller === playerId);
    if (perm) {
      updateCounters(ctx, permanentId, { '+1/+1': 1 });
    }
    
    if (toGraveyard) {
      // Put revealed card in graveyard
      (z as any).graveyard = (z as any).graveyard || [];
      (z as any).graveyard.push({ ...topCard, zone: "graveyard", faceDown: false });
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), topCard, { fromBattlefield: false });
      (z as any).graveyardCount = ((z as any).graveyard || []).length;
    }
    // If not toGraveyard, card is already removed from library top and we just
    // don't add it back - wait, that's wrong. It should stay on top if not to graveyard.
    // Let me fix this: if not toGraveyard, put it back on top
    if (!toGraveyard) {
      lib.unshift({ ...topCard, zone: "library" });
    }
  }
  
  (z as any).libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

/* ===== search helper ===== */

/**
 * searchLibrary
 * Simple substring search by card name within the player's library. Case-insensitive.
 * Returns up to `limit` simplified KnownCardRef-like objects.
 */
export function searchLibrary(ctx: GameContext, playerId: PlayerID, query: string, limit = 20) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!query || typeof query !== "string") {
    return lib.slice(0, Math.max(0, limit)).map(c => ({ 
      id: c.id, 
      name: c.name, 
      type_line: c.type_line, 
      oracle_text: c.oracle_text, 
      image_uris: (c as any).image_uris, 
      card_faces: (c as any).card_faces, 
      layout: (c as any).layout,
      mana_cost: (c as any).mana_cost,
      cmc: (c as any).cmc,
      colors: (c as any).colors,
      power: (c as any).power,
      toughness: (c as any).toughness,
      loyalty: (c as any).loyalty,
      color_identity: (c as any).color_identity,
    }));
  }
  const q = query.trim().toLowerCase();
  const res: any[] = [];
  for (const c of lib) {
    if (res.length >= limit) break;
    const name = (c.name || "").toLowerCase();
    if (name.includes(q)) {
      res.push({ 
        id: c.id, 
        name: c.name, 
        type_line: c.type_line, 
        oracle_text: c.oracle_text, 
        image_uris: (c as any).image_uris, 
        card_faces: (c as any).card_faces, 
        layout: (c as any).layout,
        mana_cost: (c as any).mana_cost,
        cmc: (c as any).cmc,
        colors: (c as any).colors,
        power: (c as any).power,
        toughness: (c as any).toughness,
        loyalty: (c as any).loyalty,
        color_identity: (c as any).color_identity,
      });
    }
  }
  return res;
}

/**
 * putCardsOnTopOfLibrary
 * Adds card objects to the top of the player's library.
 * Used for effects like "search your library, shuffle, then put the card on top"
 * (e.g., Vampiric Tutor, Mystical Tutor).
 * Also useful for Chaos Warp (shuffle permanent into library, then reveal top).
 * 
 * @param cards - Array of card objects to put on top (in order, first card will be on top)
 */
export function putCardsOnTopOfLibrary(ctx: GameContext, playerId: PlayerID, cards: any[]) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  
  const lib = ctx.libraries.get(playerId) || [];
  
  // Add cards to the top of the library (first card in array = top of library)
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    lib.unshift({ ...card, zone: 'library' });
  }
  
  ctx.libraries.set(playerId, lib);
  
  // Update library count
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  ctx.bumpSeq();
}

/**
 * putCardsOnBottomOfLibrary
 * Adds card objects to the bottom of the player's library.
 * Used for effects like Condemn (put attacking creature on bottom of owner's library).
 * 
 * @param cards - Array of card objects to put on bottom
 */
export function putCardsOnBottomOfLibrary(ctx: GameContext, playerId: PlayerID, cards: any[]) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  
  const lib = ctx.libraries.get(playerId) || [];
  
  // Add cards to the bottom of the library
  for (const card of cards) {
    lib.push({ ...card, zone: 'library' });
  }
  
  ctx.libraries.set(playerId, lib);
  
  // Update library count
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  ctx.bumpSeq();
}

/**
 * putCardAtPositionInLibrary
 * Inserts a card at a specific position in the player's library.
 * Used for effects like Approach of the Second Sun (put 7th from top when cast from hand).
 * 
 * @param card - Card object to insert
 * @param position - 0-indexed position from top (0 = top, 6 = 7th from top)
 */
export function putCardAtPositionInLibrary(ctx: GameContext, playerId: PlayerID, card: any, position: number) {
  if (!card) return;
  
  const lib = ctx.libraries.get(playerId) || [];
  
  // Clamp position to valid range
  const insertAt = Math.max(0, Math.min(position, lib.length));
  
  // Insert card at the specified position
  lib.splice(insertAt, 0, { ...card, zone: 'library' });
  
  ctx.libraries.set(playerId, lib);
  
  // Update library count
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  ctx.bumpSeq();
}

/**
 * movePermanentToLibrary
 * Moves a permanent from battlefield to owner's library (top, bottom, or shuffled).
 * Handles Commander Replacement Effect (Rule 903.9a) - offers choice to put in command zone instead.
 * 
 * @param permanentId - ID of the permanent to move
 * @param position - 'top', 'bottom', or 'shuffle'
 * @returns true if moved (or deferred for commander choice), false if permanent not found
 */
export function movePermanentToLibrary(
  ctx: GameContext, 
  permanentId: string, 
  position: 'top' | 'bottom' | 'shuffle' = 'shuffle'
): boolean {
  const { state, bumpSeq, commandZone, libraries } = ctx;
  const battlefield = state.battlefield || [];
  
  const idx = battlefield.findIndex((p: any) => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = battlefield.splice(idx, 1)[0];
  const removedPermanentId = String((perm as any)?.id || permanentId || '').trim();
  const owner = perm.owner as PlayerID;
  const card = perm.card;

  clearPreparedStateOnBattlefieldExit(state, perm);

  // Revolt-style per-turn tracking: a permanent left the battlefield under its controller's control.
  try {
    const controllerAtLeave = String((perm as any)?.controller || owner || '').trim();
    if (controllerAtLeave) {
      (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
      (state as any).permanentLeftBattlefieldThisTurn[controllerAtLeave] = true;
    }
  } catch {
    // best-effort only
  }

  if (getCounterLeaveBattlefieldReplacement(perm, 'library') === 'exile') {
    return moveRemovedPermanentToExile(ctx, perm, removedPermanentId);
  }

  // Tokens cease to exist when they leave the battlefield instead of entering a library.
  if ((perm as any).isToken === true) {
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    debug(2, `[movePermanentToLibrary] Token ${card?.name || permanentId} left battlefield -> ceased to exist (not moved to library)`);
    bumpSeq();
    return true;
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into its owner's library from anywhere,
  // its owner may put it into the command zone instead.
  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Cast card as any to access properties safely
    const cardAny = card as any;
    // Defer zone change - let player choose command zone or library via Resolution Queue
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: permanentId,
      sourceName: cardAny.name || 'Unknown Commander',
      sourceImage: cardAny.image_uris?.small || cardAny.image_uris?.normal,
      description: `Your commander ${cardAny.name || 'Unknown Commander'} would be put into your library (${position}). Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: position === 'top' ? 'Put on top of library' : position === 'bottom' ? 'Put on bottom of library' : 'Shuffle into library' },
      ],
      commanderId: cardAny.id,
      commanderName: cardAny.name || 'Unknown Commander',
      fromZone: 'library',
      libraryPosition: position,
      card: {
        id: cardAny.id,
        name: cardAny.name || 'Unknown Commander',
        type_line: cardAny.type_line,
        oracle_text: cardAny.oracle_text,
        image_uris: cardAny.image_uris,
        mana_cost: cardAny.mana_cost,
        power: cardAny.power,
        toughness: cardAny.toughness,
        ...(buildZoneObjectWithRetainedCounters(cardAny, perm, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(cardAny, perm, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[movePermanentToLibrary] Commander ${cardAny.name || 'Unknown'} would go to library (${position}) - queued commander zone choice step`);
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    bumpSeq();
    return true;
  }
  
  // Non-commander - move directly to library
  const lib = libraries.get(owner) || [];
  const cardCopy = { ...(card as any), zone: 'library' };
  
  if (position === 'top') {
    lib.unshift(cardCopy);
  } else if (position === 'bottom') {
    lib.push(cardCopy);
  } else {
    // Shuffle into library using deterministic RNG
    lib.push(cardCopy);
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
  }
  
  libraries.set(owner, lib);
  
  // Update library count
  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  if (removedPermanentId) {
    processLinkedExileReturns(ctx, removedPermanentId);
  }

  debug(2, `[movePermanentToLibrary] ${(card as any)?.name || permanentId} put ${position} of ${owner}'s library`);
  bumpSeq();
  return true;
}

/**
 * movePermanentToHand
 * Moves a permanent from battlefield to owner's hand (bounce effect).
 * Handles Commander Replacement Effect (Rule 903.9a) - offers choice to put in command zone instead.
 * 
 * @param permanentId - ID of the permanent to move
 * @returns true if moved (or deferred for commander choice), false if permanent not found
 */
export function movePermanentToHand(ctx: GameContext, permanentId: string): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const battlefield = state.battlefield || [];
  
  const idx = battlefield.findIndex((p: any) => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = battlefield.splice(idx, 1)[0];
  const removedPermanentId = String((perm as any)?.id || permanentId || '').trim();
  const owner = perm.owner as PlayerID;
  const card = perm.card;

  clearPreparedStateOnBattlefieldExit(state, perm);

  // Revolt-style per-turn tracking: a permanent left the battlefield under its controller's control.
  try {
    const controllerAtLeave = String((perm as any)?.controller || owner || '').trim();
    if (controllerAtLeave) {
      (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
      (state as any).permanentLeftBattlefieldThisTurn[controllerAtLeave] = true;
    }
  } catch {
    // best-effort only
  }

  if (getCounterLeaveBattlefieldReplacement(perm, 'hand') === 'exile') {
    return moveRemovedPermanentToExile(ctx, perm, removedPermanentId);
  }

  // Tokens cease to exist when they leave the battlefield (Rule 111.7).
  if ((perm as any).isToken === true) {
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    debug(2, `[movePermanentToHand] Token ${card?.name || permanentId} left battlefield -> ceased to exist (not moved to hand)`);
    bumpSeq();
    return true;
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into its owner's hand from anywhere,
  // its owner may put it into the command zone instead.
  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Defer zone change - let player choose command zone or hand
    // Defer zone change - let player choose command zone or hand via Resolution Queue
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: permanentId,
      sourceName: card.name,
      sourceImage: card.image_uris?.small || card.image_uris?.normal,
      description: `Your commander ${card.name} would be returned to your hand. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it go to hand' },
      ],
      commanderId: card.id,
      commanderName: card.name,
      fromZone: 'hand',
      card: {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
        ...(buildZoneObjectWithRetainedCounters(card, perm, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(card, perm, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[movePermanentToHand] Commander ${card.name} would go to hand - queued commander zone choice step`);
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    bumpSeq();
    return true;
  }
  
  // Non-commander - move directly to hand
  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.hand = z.hand || [];
  z.hand.push({ ...card, zone: 'hand' });
  z.handCount = z.hand.length;

  recordPermanentPutIntoHandFromBattlefieldThisTurn(ctx, String(owner));

  if (removedPermanentId) {
    processLinkedExileReturns(ctx, removedPermanentId);
  }
  
  debug(2, `[movePermanentToHand] ${card?.name || permanentId} returned to ${owner}'s hand`);
  bumpSeq();
  return true;
}

/* ===== consistency helper (exported) ===== */

export function reconcileZonesConsistency(ctx: GameContext, playerId?: PlayerID) {
  const players: PlayerID[] =
    typeof playerId !== "undefined"
      ? [playerId]
      : ((ctx.state.players as any as { id: PlayerID }[]) || []).map((p) => p.id);

  const zones = ctx.state.zones = ctx.state.zones || {};
  
  for (const pid of players) {
    try {
      if (!zones[pid]) {
        zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;
      }
      const z = zones[pid] as any;

      if (!ctx.libraries.has(pid)) ctx.libraries.set(pid, []);
      const lib = ctx.libraries.get(pid) || [];

      // normalize library entries
      for (let i = 0; i < lib.length; i++) {
        const entry = lib[i] as any;
        if (!entry || typeof entry !== "object") {
          lib[i] = { id: String(entry ?? uid("c")), zone: "library" } as any;
        } else {
          if (!("id" in entry)) entry.id = uid("c");
          if (!("zone" in entry)) entry.zone = "library";
        }
      }

      z.hand = z.hand || [];
      z.graveyard = z.graveyard || [];
      z.exile = z.exile || [];

      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;
      z.libraryCount = lib.length;

      ctx.libraries.set(pid, lib);
      // Do not bump seq automatically for silent repairs to avoid noisy diffs; callers may bump if they need visible change.
    } catch (err) {
      debugWarn(1, "reconcileZonesConsistency failed for player", pid, err);
    }
  }
}

/* ===== NEW: apply per-player PRE_GAME reset (wipe + reset defaults) ===== */

/**
 * applyPreGameReset(ctx, playerId)
 *
 * Authoritative server-side routine to wipe a player's current in-game assets and
 * reset to pre-game defaults, preserving the player's resolved library (import buffer)
 * that was placed by importDeckResolved or stored in _lastImportedDecks.
 */
export function applyPreGameReset(ctx: GameContext, playerId: PlayerID) {
  const { state, libraries, bumpSeq, life, poison, experience, commandZone } = ctx as any;
  const zones = state.zones = state.zones || {};

  // If this player currently has any cards in true exile, clean up impulse permissions/tags
  // so they can't leak across a wipe/reset.
  try {
    const prevExile = Array.isArray(zones?.[playerId]?.exile) ? (zones[playerId] as any).exile : [];
    for (const c of prevExile) cleanupCardLeavingExile(state, c);
    state.playableFromExile = state.playableFromExile || {};
    state.playableFromExile[playerId] = {};
  } catch {
    // ignore
  }

  // If libraries map doesn't contain the imported deck but an import buffer exists, use it.
  try {
    const hasLib = libraries && (typeof libraries.get === "function") && Array.isArray(libraries.get(playerId)) && (libraries.get(playerId).length > 0);
    if (!hasLib && (ctx as any)._lastImportedDecks && typeof (ctx as any)._lastImportedDecks.get === "function") {
      const buf = (ctx as any)._lastImportedDecks.get(playerId);
      if (Array.isArray(buf) && buf.length > 0) {
        // populate libraries with a shallow copy to avoid aliasing buffers
        libraries.set(playerId, buf.map((c: any) => ({ ...c, zone: "library" })));
      }
    }
  } catch (err) {
    // ignore; proceed with whatever libraries currently hold
  }

  // Remove battlefield permanents controlled by playerId
  if (Array.isArray(state.battlefield)) {
    state.battlefield = state.battlefield.filter((p: any) => p.controller !== playerId);
  }

  // Reset zones: clear hand, graveyard, exile; library is preserved (importDeckResolved or buffer set it)
  const lib = libraries.get(playerId) || [];
  zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: lib.length,
    graveyard: [],
    graveyardCount: 0,
    exile: []
  } as any;

  // Reset life and counters to defaults
  const starting = state.startingLife ?? 40;
  life[playerId] = starting;
  poison[playerId] = 0;
  experience[playerId] = 0;
  
  // Reset energy counters
  const energy = (ctx as any).energy = (ctx as any).energy || {};
  energy[playerId] = 0;

  // Ensure commandZone entry exists (create an empty holder instead of deleting)
  if (!commandZone) (ctx as any).commandZone = {};
  commandZone[playerId] = {
    commanderIds: (commandZone[playerId] && commandZone[playerId].commanderIds) || [],
    commanderCards: (commandZone[playerId] && commandZone[playerId].commanderCards) || null,
  };

  // Reset any lands played this turn / mana pools if stored on ctx (conservative)
  if ((ctx as any).landsPlayedThisTurn) {
    (ctx as any).landsPlayedThisTurn[playerId] = 0;
  }
  if ((ctx as any).manaPool && (ctx as any).manaPool[playerId]) {
    (ctx as any).manaPool[playerId] = { white:0, blue:0, black:0, red:0, green:0, colorless:0, generic:0 };
  }

  // Set global phase to pre_game (authoritative)
  (state as any).phase = "pre_game";

  // ensure consistency and bump sequence
  reconcileZonesConsistency(ctx, playerId);
  bumpSeq();
}

/* Export default convenience object for legacy callers */
export default {
  importDeckResolved,
  moveHandToLibrary,
  shuffleLibrary,
  drawCards,
  shuffleHand,
  peekTopN,
  selectFromLibrary,
  reorderHand,
  applyScry,
  applySurveil,
  applyExplore,
  searchLibrary,
  putCardsOnTopOfLibrary,
  putCardsOnBottomOfLibrary,
  putCardAtPositionInLibrary,
  reconcileZonesConsistency,
  applyPreGameReset
};
