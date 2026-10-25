/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: playing a land - resolving which land the request meant,
 * top-of-library play permission, the playLand socket request itself, and
 * finalizing the land onto the battlefield including its ETB shape (tapped,
 * shock, bounce, scry, conditional) and the prompts that follow.
 *
 * Public entry symbols: handlePlayLandRequest, finalizePlayedLand,
 * PlayLandRequestPayload.
 */
import type { Server, Socket } from "socket.io";
import { GameManager } from "../../GameManager.js";
import { appendEvent } from "../../db";
import { getPlayableLandCandidates, type SharedPlayableLandCandidate } from "../../state/modules/can-respond.js";
import { buildPersistedCastPermissionFields } from "../../state/modules/castIntent.js";
import { calculateMaxLandsPerTurn, canPlayLandsFromTop } from "../../state/modules/game-state-effects";
import { getEffectiveBasicLandTypes } from "../../state/modules/mana-abilities.js";
import {
  cardAllowsPlayerToPlayFromExile,
  cardMeetsPlayFromExileConditions,
  findPlayableExileCardForPlayer,
  getPlayableExileCardsForPlayer,
  getPlayableFromExileDurablePermissionForCard,
} from "../../state/modules/playable-from-exile.js";
import { resolveLandCardFaceForBattlefieldEntry } from "../../state/modules/stackPlayLandUtils.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import {
  detectETBTappedPattern,
  detectSacrificeUnlessPayETB,
  detectScryOnETB,
  evaluateConditionalLandETB,
  getLandSubtypes,
  isBounceLand,
  isShockLand,
} from "../land-helpers";
import { queueShockLandPaymentStep } from "../optional-payment-prompts.js";
import { enterUntappedOverrideSourceName } from "../../state/modules/landsEnterUntappedOverride.js";
import {
  LAND_PLAY_AUTOMATION_SUPPRESSION_MS,
  broadcastGame,
  clearHumanAutoPassPauseOnAction,
  ensureGame,
  getPlayerName,
  suppressAutomationOnNextBroadcast,
} from "../util";
import {
  checkColorChoiceForNewPermanents,
  checkCreatureTypeSelectionForNewPermanents,
  checkEnchantmentETBTriggers,
  checkPlayerSelectionForNewPermanents,
} from "./gameActionsPermanentEntryPrompts.js";
import { checkAsEntersCopyChoiceForNewPermanents } from "../../state/modules/asEntersCopyChoice.js";
import { getPlayerLibraryCards, getTopLibraryCard } from "./gameActionsPlayerZoneCards.js";
import { isOracleIrTriggerPrimaryEnabled } from "../../state/modules/oracleIrFeatureFlags.js";

export function getRequestedLandPlayCandidate(
  game: any,
  playerId: string,
  cardId: string,
  sourceZone: 'hand' | 'graveyard' | 'exile' | 'library',
  selectedFaceIndex?: number,
): SharedPlayableLandCandidate | undefined {
  const state = game?.state;
  if (!state || !playerId || !cardId) return undefined;

  const sharedCandidates = getPlayableLandCandidates({
    state,
    libraries: game?.libraries,
  } as any, playerId as any);

  return sharedCandidates.find((candidate) => {
    if (candidate.sourceZone !== sourceZone) return false;
    if (String(candidate.card?.id || '') !== String(cardId)) return false;
    if (selectedFaceIndex !== undefined && Number(candidate.selectedFaceIndex ?? -1) !== Number(selectedFaceIndex)) {
      return false;
    }
    return true;
  });
}

export function validateTopOfLibraryLandAccess(
  game: any,
  playerId: string,
  cardId: string,
): { ok: true } | { ok: false; code: string; message: string } {
  const topCard = getTopLibraryCard(game, playerId);
  if (!topCard) {
    return {
      ok: false,
      code: 'CARD_NOT_IN_LIBRARY',
      message: 'Your library is empty.',
    };
  }

  if (String(topCard.id || '') !== String(cardId || '')) {
    return {
      ok: false,
      code: 'NO_PERMISSION',
      message: 'Only the top card of your library can be played this way.',
    };
  }

  const topLandPermission = canPlayLandsFromTop({ state: game.state } as any, playerId, topCard);
  if (!topLandPermission.canPlay) {
    return {
      ok: false,
      code: 'NO_PERMISSION',
      message: "You don't have permission to play lands from the top of your library.",
    };
  }

  return { ok: true };
}

export function finalizePlayedLand(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  cardId: string,
  cardInZone: any,
  sourceZone: 'hand' | 'graveyard' | 'exile' | 'library' = 'hand',
  eventExtras?: Record<string, unknown>,
): void {
  const cardName = (cardInZone as any)?.name || "";
  const cardImageUrl = (cardInZone as any)?.image_uris?.small || (cardInZone as any)?.image_uris?.normal;
  const cardOracleText = (cardInZone as any)?.oracle_text || '';
  const zones = game.state?.zones?.[playerId];
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const createdPermanent = [...battlefield].reverse().find((entry: any) =>
    entry && entry.controller === playerId && entry.card?.id === cardId
  );

  try {
    appendEvent(gameId, (game as any).seq ?? 0, "playLand", {
      playerId,
      cardId,
      fromZone: sourceZone,
      card: cardInZone,
      ...(createdPermanent?.id ? { permanentId: String(createdPermanent.id) } : {}),
      ...(eventExtras || {}),
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(playLand) failed:', e);
  }

  // "Lands you control enter untapped" (Spelunking, The Wandering Minstrel): skip shock/reveal prompts.
  const enterUntappedOverride = enterUntappedOverrideSourceName(battlefield, playerId, cardInZone);
  const isShockLandCard = isShockLand(cardName, cardOracleText);
  if (isShockLandCard && !enterUntappedOverride) {
    const permanent = battlefield.find((p: any) =>
      p.card?.id === cardId &&
      p.controller === playerId
    );

    if (permanent) {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) => (s as any)?.shockLandChoice === true && String((s as any)?.permanentId || '') === String(permanent.id));
      if (!existing) {
        queueShockLandPaymentStep(io, game, gameId, String(playerId), permanent, cardName, cardImageUrl);
      }
    }
  }

  if (!isShockLandCard && !isBounceLand(cardName) && !enterUntappedOverride) {
    const oracleText = (cardInZone as any)?.oracle_text || '';
    const etbPattern = detectETBTappedPattern(oracleText);

    const permanent = battlefield.find((p: any) =>
      p.card?.id === cardId &&
      p.controller === playerId
    );

    if (etbPattern === 'always' && permanent && !permanent.tapped) {
      permanent.tapped = true;
      debug(2, `[playLand] ${cardName} enters tapped (ETB-tapped pattern detected)`);
    } else if (etbPattern === 'conditional' && permanent) {
      const otherLandCount = battlefield.filter((p: any) => {
        if (p.id === permanent.id) return false;
        if (p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        return typeLine.includes('land');
      }).length;

      const controlledLandTypes: string[] = [];
      let basicLandCount = 0;
      for (const p of battlefield) {
        if (p.id === permanent.id) continue;
        if (p.controller !== playerId) continue;
        const typeLine = (p.card?.type_line || '').toLowerCase();

        if (typeLine.includes('basic')) {
          basicLandCount++;
        }

        const staticSubtypes = getLandSubtypes(typeLine).filter(subtype => !['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(subtype));
        const effectiveBasicTypes = getEffectiveBasicLandTypes(game.state, p).map(subtype => subtype.charAt(0).toUpperCase() + subtype.slice(1));
        controlledLandTypes.push(...staticSubtypes, ...effectiveBasicTypes);
      }

      const hasBattleLandPattern = oracleText.toLowerCase().includes('two or more basic lands');
      const playerHand = Array.isArray(zones?.hand) ? zones.hand : [];
      const allPlayers = (game.state as any)?.players || [];
      const opponentCount = allPlayers.filter((p: any) => p.id !== playerId).length;

      let evaluation;
      if (hasBattleLandPattern) {
        const shouldTap = basicLandCount < 2;
        evaluation = {
          shouldEnterTapped: shouldTap,
          reason: shouldTap
            ? `Enters tapped (you control only ${basicLandCount} basic land${basicLandCount !== 1 ? 's' : ''})`
            : `Enters untapped (you control ${basicLandCount} basic lands)`,
        };
      } else {
        const controlledPermanents = battlefield.filter((p: any) =>
          p.id !== permanent.id && p.controller === playerId
        );

        const opponentLandCount = battlefield.filter((p: any) => {
          if (p.id === permanent.id) return false;
          if (p.controller === playerId) return false;
          const typeLine = (p.card?.type_line || '').toLowerCase();
          return typeLine.includes('land');
        }).length;

        evaluation = evaluateConditionalLandETB(
          oracleText,
          otherLandCount,
          controlledLandTypes,
          playerHand,
          basicLandCount,
          opponentCount,
          controlledPermanents,
          opponentLandCount,
        );
      }

      debug(2, `[playLand] ${cardName} conditional ETB: ${evaluation.reason}`);

      if (evaluation.requiresRevealPrompt && evaluation.canReveal) {
        const revealTypes: string[] = Array.isArray(evaluation.revealTypes) ? evaluation.revealTypes : [];
        const eligible = playerHand
          .filter((c: any) => {
            const typeLine = String(c?.type_line || '');
            if (!/\bland\b/i.test(typeLine)) return false;
            if (revealTypes.length === 0) return true;
            return revealTypes.some((t) => new RegExp(`\\b${String(t).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(typeLine));
          })
          .map((c: any) => ({
            id: String(c?.id || ''),
            label: String(c?.name || 'Card'),
            description: String(c?.type_line || ''),
            imageUrl: c?.image_uris?.small || c?.image_uris?.normal,
          }))
          .filter((o: any) => o.id);

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => (s as any)?.revealLandChoice === true && String((s as any)?.permanentId || '') === String(permanent.id));
        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceName: cardName,
            sourceId: permanent.id,
            sourceImage: cardImageUrl,
            description: `You may reveal a ${revealTypes.join(' or ')} card from your hand. If you don't, ${cardName} enters tapped.`,
            mandatory: true,
            options: [
              ...eligible,
              { id: 'decline_reveal', label: "Don't reveal (enter tapped)" },
            ],
            minSelections: 1,
            maxSelections: 1,
            revealLandChoice: true,
            permanentId: permanent.id,
            cardName,
            revealTypes,
          } as any);
        }
      } else if (evaluation.shouldEnterTapped && !permanent.tapped) {
        permanent.tapped = true;

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)}'s ${cardName} enters tapped. (${evaluation.reason})`,
          ts: Date.now(),
        });
      }
    }
  }

  const oracleText = (cardInZone as any)?.oracle_text || '';
  const scryAmount = detectScryOnETB(oracleText);
  if (scryAmount && scryAmount > 0) {
    (game.state as any).pendingScry = (game.state as any).pendingScry || {};
    (game.state as any).pendingScry[playerId] = ((game.state as any).pendingScry[playerId] || 0) + scryAmount;

    debug(2, `[playLand] ${cardName} has "scry ${scryAmount}" ETB trigger`);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${cardName} enters the battlefield. ${getPlayerName(game, playerId)} scries ${scryAmount}.`,
      ts: Date.now(),
    });
  }

  if (!isOracleIrTriggerPrimaryEnabled()) {
    const sacrificeCost = detectSacrificeUnlessPayETB(cardName, oracleText);
    if (sacrificeCost) {
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) =>
        p.card?.id === cardId &&
        p.controller === playerId
      );

      if (permanent) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => (s as any)?.sacrificeUnlessPayChoice === true && String((s as any)?.permanentId || '') === String(permanent.id));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_PAYMENT_CHOICE,
            playerId: playerId as any,
            sourceId: permanent.id,
            sourceName: cardName,
            sourceImage: cardImageUrl,
            description: `${cardName}: Pay ${sacrificeCost} to keep it. Cancel to sacrifice it.`,
            mandatory: false,
            activationPaymentChoice: true,
            confirmLabel: `Pay ${sacrificeCost}`,
            permanentId: permanent.id,
            cardName,
            manaCost: sacrificeCost,
            sacrificeUnlessPayChoice: true,
          } as any);
        }
        debug(2, `[playLand] ${cardName} has "sacrifice unless you pay ${sacrificeCost}" ETB trigger`);
      }
    }
  }

  checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
  checkColorChoiceForNewPermanents(io, game, gameId);
  checkAsEntersCopyChoiceForNewPermanents(game, gameId);
  checkPlayerSelectionForNewPermanents(io, game, gameId);
  checkEnchantmentETBTriggers(io, game, gameId);

  broadcastGame(io, game, gameId);
}

export type PlayLandRequestPayload = {
  gameId?: unknown;
  cardId?: unknown;
  selectedFace?: unknown;
  fromZone?: unknown;
  bypassGraveyardPermissionCheck?: unknown;
};

export function handlePlayLandRequest(io: Server, socket: Socket, payload?: PlayLandRequestPayload): void {
  const gameId = payload?.gameId;
  const cardId = payload?.cardId;
  const selectedFace = payload?.selectedFace;
  const fromZone = payload?.fromZone;
  const bypassGraveyardPermissionCheck = payload?.bypassGraveyardPermissionCheck === true;

  const ignoreInvalidRequest = (reason: string): void => {
    debugWarn(1, `[playLand] Ignored request from ${String((socket.data as any)?.playerId || 'unknown')}: ${reason}`, {
      gameId,
      cardId,
      selectedFace,
      fromZone,
    });
  };

  if (!gameId || typeof gameId !== 'string') { ignoreInvalidRequest('missing or invalid gameId'); return; }
  if (!cardId || typeof cardId !== 'string') { ignoreInvalidRequest('missing or invalid cardId'); return; }
  if (!(selectedFace === undefined || typeof selectedFace === 'number')) { ignoreInvalidRequest('invalid selectedFace'); return; }
  if (!(fromZone === undefined || fromZone === 'hand' || fromZone === 'graveyard' || fromZone === 'exile' || fromZone === 'library')) {
    ignoreInvalidRequest(`unsupported fromZone "${String(fromZone)}"`);
    return;
  }

  // Every rejection after this point is logged server-side as well as emitted to the client,
  // so a failed land play is never silent in the server log.
  const emitPlayLandError = (errorPayload: { code: string; message: string }): void => {
    debugWarn(1, `[playLand] Rejected (${errorPayload.code}) for player ${String((socket.data as any)?.playerId || 'unknown')}, card ${cardId}, fromZone ${String(fromZone || 'hand')}: ${errorPayload.message}`);
    socket.emit("error", errorPayload);
  };

  const ensureInGameRoom = (
    targetGameId: string,
    {
      code = "NOT_IN_GAME",
      message = "You are not in this game.",
    }: { code?: string; message?: string } = {}
  ): boolean => {
    const socketGameId = (socket.data as any)?.gameId as string | undefined;
    if (socketGameId && socketGameId !== targetGameId) {
      emitPlayLandError({ code, message });
      return false;
    }

    if (!(socket as any)?.rooms?.has?.(targetGameId)) {
      emitPlayLandError({ code, message });
      return false;
    }

    return true;
  };

  const selectedFaceIndex = selectedFace as number | undefined;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) {
      debugWarn(1, `[playLand] Ignored request: ${!game ? `game ${gameId} not found` : 'socket has no playerId'}`, { cardId, fromZone });
      return;
    }

    if (!ensureInGameRoom(gameId)) return;

    const landsPlayed = (game.state?.landsPlayedThisTurn?.[playerId] || 0);
    const maxLands = calculateMaxLandsPerTurn(game as any, playerId);
    debug(2, `[playLand] Player ${playerId} has played ${landsPlayed} lands this turn, max is ${maxLands}`);
    if (landsPlayed >= maxLands) {
      emitPlayLandError({
        code: "LAND_LIMIT_REACHED",
        message: maxLands > 1
          ? `You have already played ${landsPlayed} land(s) this turn (max ${maxLands})`
          : "You have already played a land this turn",
      });
      return;
    }

    const sourceZone = (fromZone as 'hand' | 'graveyard' | 'exile' | 'library' | undefined) || 'hand';
    let requestedLandCandidate: SharedPlayableLandCandidate | undefined;

    if (sourceZone === 'graveyard') {
      requestedLandCandidate = getRequestedLandPlayCandidate(game, String(playerId), String(cardId), 'graveyard', selectedFaceIndex);

      if (!requestedLandCandidate && !bypassGraveyardPermissionCheck) {
        emitPlayLandError({
          code: "NO_PERMISSION",
          message: "You don't have permission to play lands from your graveyard",
        });
        return;
      }
    }

    if (sourceZone === 'exile') {
      const stateAny: any = game.state as any;
      const turnNumber = Number(stateAny?.turnNumber ?? 0);
      const pfe = stateAny?.playableFromExile?.[playerId];
      const entry = Array.isArray(pfe) ? (pfe.includes(cardId) ? true : undefined) : pfe?.[cardId];
      const exiledCard = findPlayableExileCardForPlayer(game.state, String(playerId) as any, String(cardId));
      const pfeAllows = (typeof entry === 'number' ? entry >= turnNumber : Boolean(entry))
        && cardMeetsPlayFromExileConditions(game.state, exiledCard, String(playerId) as any);
      const cardAllows = cardAllowsPlayerToPlayFromExile(exiledCard, String(playerId) as any, turnNumber, game.state);
      const durablePermission = getPlayableFromExileDurablePermissionForCard(game.state, String(playerId) as any, exiledCard, 'play');
      if (!pfeAllows && !cardAllows && !durablePermission) {
        emitPlayLandError({
          code: "NO_PERMISSION",
          message: "You don't have permission to play that land from exile",
        });
        return;
      }
    }

    if (sourceZone === 'library') {
      const validation = validateTopOfLibraryLandAccess(game, String(playerId), String(cardId));
      if (validation.ok === false) {
        emitPlayLandError({
          code: validation.code,
          message: validation.message,
        });
        return;
      }
    }

    const zones = game.state?.zones?.[playerId];
    const zone = sourceZone === 'graveyard'
      ? (Array.isArray(zones?.graveyard) ? zones.graveyard : [])
      : sourceZone === 'exile'
        ? getPlayableExileCardsForPlayer(game.state, String(playerId) as any)
        : sourceZone === 'library'
          ? getPlayerLibraryCards(game, String(playerId))
        : (Array.isArray(zones?.hand) ? zones.hand : []);
    const cardInZone = zone.find((c: any) => c?.id === cardId);
    const cardName = (cardInZone as any)?.name || "";
    const cardImageUrl = (cardInZone as any)?.image_uris?.small || (cardInZone as any)?.image_uris?.normal;
    if (!cardInZone) {
      debugWarn(2, `[playLand] Card ${cardId} not found in ${sourceZone} for player ${playerId}`);
      emitPlayLandError({
        code: sourceZone === 'graveyard'
          ? "CARD_NOT_IN_GRAVEYARD"
          : sourceZone === 'exile'
            ? "CARD_NOT_IN_EXILE"
            : sourceZone === 'library'
              ? "CARD_NOT_IN_LIBRARY"
              : "CARD_NOT_IN_HAND",
        message: `Card not found in ${sourceZone}. It may have already been played or moved.`,
      });
      return;
    }

    if (requestedLandCandidate?.graveyardPermissionId || requestedLandCandidate?.castPermissionId) {
      const permissionId = String(
        requestedLandCandidate.castPermissionId
        || requestedLandCandidate.graveyardPermissionId
        || '',
      ).trim();
      (cardInZone as any).graveyardPermissionId = permissionId;
      (cardInZone as any).castPermissionId = permissionId;
    }
    if (requestedLandCandidate?.graveyardPermissionSourceName) {
      (cardInZone as any).graveyardPermissionSourceName = requestedLandCandidate.graveyardPermissionSourceName;
    }
    if (requestedLandCandidate?.leaveBattlefieldReplacementDestination === 'exile') {
      (cardInZone as any).leaveBattlefieldReplacementDestination = 'exile';
    }
    if (requestedLandCandidate?.leaveBattlefieldReplacementSourceName) {
      (cardInZone as any).leaveBattlefieldReplacementSourceName = requestedLandCandidate.leaveBattlefieldReplacementSourceName;
    }
    if (typeof requestedLandCandidate?.leaveBattlefieldReplacementLifeGain === 'number' && requestedLandCandidate.leaveBattlefieldReplacementLifeGain > 0) {
      (cardInZone as any).leaveBattlefieldReplacementLifeGain = requestedLandCandidate.leaveBattlefieldReplacementLifeGain;
    }

    let layout = (cardInZone as any)?.layout;
    let cardFaces = (cardInZone as any)?.card_faces;
    const isMDFC = layout === 'modal_dfc' && Array.isArray(cardFaces) && cardFaces.length >= 2;
    let selectedFaceName: string | undefined;

    if (isMDFC && selectedFaceIndex === undefined) {
      const face0 = cardFaces[0];
      const face1 = cardFaces[1];
      const face0IsLand = /\bland\b/i.test(face0?.type_line || '');
      const face1IsLand = /\bland\b/i.test(face1?.type_line || '');

      if (face0IsLand && !face1IsLand) {
        (cardInZone as any).selectedMDFCFace = 0;
      } else if (!face0IsLand && face1IsLand) {
        (cardInZone as any).selectedMDFCFace = 1;
      } else if (face0IsLand && face1IsLand) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.OPTION_CHOICE && (s as any)?.mdfcFaceChoice === true && String((s as any)?.cardId || '') === String(cardId));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardName,
            sourceImage: cardImageUrl,
            description: `${cardName} is a Modal Double-Faced Card. Choose which land to play.`,
            mandatory: true,
            minSelections: 1,
            maxSelections: 1,
            cardId,
            cardName,
            fromZone: sourceZone,
            mdfcFaceChoice: true,
            options: [
              {
                id: '0',
                label: face0.name,
                description: [face0.type_line, face0.oracle_text].filter(Boolean).join(' - '),
                imageUrl: face0.image_uris?.small || face0.image_uris?.normal,
              },
              {
                id: '1',
                label: face1.name,
                description: [face1.type_line, face1.oracle_text].filter(Boolean).join(' - '),
                imageUrl: face1.image_uris?.small || face1.image_uris?.normal,
              },
            ],
          } as any);
        }

        debug(1, `[playLand] Queued MDFC face selection for ${cardName} (fromZone ${sourceZone}); waiting for the player's choice`);
        return;
      } else {
        emitPlayLandError({
          code: "NOT_A_LAND",
          message: `Neither side of ${cardName} is a land.`,
        });
        return;
      }
    }

    if (isMDFC && selectedFaceIndex !== undefined) {
      const selectedCardFace = cardFaces[selectedFaceIndex];
      if (selectedCardFace) {
        (cardInZone as any).name = selectedCardFace.name;
        (cardInZone as any).type_line = selectedCardFace.type_line;
        (cardInZone as any).oracle_text = selectedCardFace.oracle_text;
        (cardInZone as any).mana_cost = selectedCardFace.mana_cost;
        if (selectedCardFace.image_uris) {
          (cardInZone as any).image_uris = selectedCardFace.image_uris;
        }
        (cardInZone as any).selectedMDFCFace = selectedFaceIndex;
        selectedFaceName = String(selectedCardFace.name || `Face ${selectedFaceIndex}`);
        debug(2, `[playLand] Playing MDFC ${cardName} as ${selectedFaceName} (face ${selectedFaceIndex})`);
      }
    }

    const typeLine = (cardInZone as any)?.type_line || "";
    const cardOracleText = (cardInZone as any)?.oracle_text || "";
    layout = (cardInZone as any)?.layout;
    cardFaces = (cardInZone as any)?.card_faces;

    if (/\(transforms from [^)]+\)/i.test(cardOracleText)) {
      debugWarn(2, `[playLand] Card ${cardName} is a transform back face and cannot be played from hand`);
      emitPlayLandError({
        code: "TRANSFORM_BACK_FACE",
        message: `${cardName || "This card"} is a transform back face and cannot be played from your hand. Only the front face of a transform card can be played.`,
      });
      return;
    }

    let isLand = false;

    if ((layout === 'transform' || layout === 'double_faced_token') && Array.isArray(cardFaces) && cardFaces.length >= 2) {
      const frontFace = cardFaces[0];
      const frontTypeLine = frontFace?.type_line || "";
      isLand = /\bland\b/i.test(frontTypeLine);

      if (!isLand) {
        debugWarn(2, `[playLand] Transform card ${cardName} front face is not a land. Front face type: ${frontTypeLine}`);
        emitPlayLandError({
          code: "NOT_A_LAND",
          message: `${cardName || "This card"} must be cast as a spell, not played as a land. Its back face transforms into a land.`,
        });
        return;
      }
    } else {
      isLand = /\bland\b/i.test(typeLine);
    }

    if (!isLand) {
      debugWarn(2, `[playLand] Card ${cardName} (${cardId}) is not a land. Type line: ${typeLine}`);
      emitPlayLandError({
        code: "NOT_A_LAND",
        message: `${cardName || "This card"} is not a land and cannot be played with playLand.`,
      });
      return;
    }

    const bridge = (GameManager as any).syncRulesBridge?.(gameId, game.state)
      || (GameManager as any).getRulesBridge(gameId);

    // The rules-engine mirror does not know about static/effect-based zone permissions
    // (Conduit/Crucible of Worlds, Ramunap, impulse exile windows, ...). Those were already
    // verified above, so tell the engine not to re-derive them.
    const serverVerifiedZonePermission = sourceZone === 'graveyard'
      ? Boolean(requestedLandCandidate) || bypassGraveyardPermissionCheck
      : sourceZone === 'exile';

    if (bridge) {
      const validation = bridge.validateAction({
        type: 'playLand',
        playerId,
        cardId,
        fromZone: sourceZone,
        serverVerifiedZonePermission,
      });

      if (!validation.legal) {
        emitPlayLandError({
          code: "INVALID_ACTION",
          message: validation.reason || "Cannot play land",
        });
        return;
      }

      const result = bridge.executeAction({
        type: 'playLand',
        playerId,
        cardId,
        fromZone: sourceZone,
        serverVerifiedZonePermission,
      });

      if (!result.success) {
        emitPlayLandError({
          code: "EXECUTION_ERROR",
          message: result.error || "Failed to play land",
        });
        return;
      }
    }

    clearHumanAutoPassPauseOnAction(game as any, playerId, 'playLand');

    try {
      if (typeof game.playLand === 'function') {
        const landCardForEntry = resolveLandCardFaceForBattlefieldEntry(cardInZone);
        game.playLand(playerId, landCardForEntry);
        if (zone.some((c: any) => c?.id === cardId) && sourceZone !== 'exile' && sourceZone !== 'library') {
          debugWarn(1, `[playLand] ${cardName || cardId} is still in ${sourceZone} after playLand for player ${playerId}`);
        }
      }
    } catch (e) {
      debugWarn(1, 'Legacy playLand failed:', e);
    }

    suppressAutomationOnNextBroadcast(game as any, LAND_PLAY_AUTOMATION_SUPPRESSION_MS);
    finalizePlayedLand(
      io,
      game,
      gameId,
      String(playerId),
      cardId,
      cardInZone,
      sourceZone,
      requestedLandCandidate
        ? {
            ...buildPersistedCastPermissionFields(requestedLandCandidate as any),
            ...(requestedLandCandidate.graveyardPermissionSourceName
              ? { graveyardPermissionSourceName: requestedLandCandidate.graveyardPermissionSourceName }
              : {}),
          }
        : undefined,
    );

    if (selectedFaceName) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} plays ${selectedFaceName} (from ${cardName}).`,
        ts: Date.now(),
      });
    }
  } catch (err: any) {
    debugError(1, `playLand error for game ${gameId}:`, err);
    emitPlayLandError({
      code: "PLAY_LAND_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
