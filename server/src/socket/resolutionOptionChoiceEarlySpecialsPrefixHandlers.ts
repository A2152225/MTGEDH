/**
 * socket/resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts
 *
 * Early special-case PREFIX of handleOptionChoiceResponse (~legend rule through
 * cast-revealed-from-library). Extracted behind resolutionHandlerDeps so cast
 * helpers stay injectable without blunt-cutting the four cores.
 *
 * Returns true when the response was fully handled.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../shared/src/types.js";
import { appendEvent } from "../db/index.js";
import type { GameContext } from "../state/context.js";
import { resolveLegendRuleChoice } from "../state/modules/counters_tokens.js";
import { applyMyriadTokenCopies } from "../state/modules/triggerMyriadTokenUtils.js";
import {
  applyDredgeDrawReplacementChoice,
  applyZursWeirdingOpponentChoice,
} from "../state/modules/zones.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  createResolutionStep,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { uid } from "../state/utils.js";
import { debugWarn } from "../utils/debug.js";
import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";
import { handlePlayLandRequest, requestCastSpellForSocket } from "./game-actions.js";
import {
  buildExertTriggeredGraveyardSelectionData,
  cloneResolutionPermanentSnapshot,
  pushExertTriggeredAbilityOntoStack,
} from "./resolutionKeywordChoiceHandlers.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

/**
 * Attempt early special handling for OPTION_CHOICE.
 * @returns true if handled (caller should return)
 */
export async function tryHandleOptionChoiceEarlySpecialsPrefix(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;
  // Lazy deps read avoids static cycle: deps factory defaults import this module.
  const { getResolutionHandlerDeps } = await import("./resolutionHandlerDeps.js");
  const deps = getResolutionHandlerDeps();
  const appendCastSpellContinuationEvent = deps.appendCastSpellContinuationEvent;
  const createForwardingGameActionSocket = deps.createForwardingGameActionSocket;
  const restartPlayerCastRequest = deps.restartPlayerCastRequest;

﻿  if (stepData?.legendRuleChoice === true) {
    const selectedPermanentId = String(extractId(selectedOption) || '').trim();
    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as unknown as GameContext;
    const result = resolveLegendRuleChoice(ctx, {
      batchId: String(stepData.legendRuleBatchId || ''),
      groupKey: String(stepData.legendRuleGroupKey || ''),
      playerId: String(playerId || ''),
      selectedPermanentId,
    });
    if (!result.accepted) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INVALID_LEGEND_RULE_CHOICE',
        message: result.error || 'Unable to apply that legend-rule choice.',
      });
      return true;
    }

    const selectedPermanent = (game.state.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '') === selectedPermanentId,
    ) as any;
    const selectedName = String(selectedPermanent?.card?.name || stepData?.sourceName || 'legendary permanent');
    const tokenLabel = selectedPermanent?.isToken || selectedPermanent?.isCopy
      || selectedPermanent?.card?.isToken || selectedPermanent?.card?.isCopy
      ? ' token copy'
      : ' card';
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} keeps the ${selectedName}${tokenLabel} for the legend rule.`,
      ts: Date.now(),
    });
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    return true;
  }

  if (
    String(stepData?.oracleIrChoiceStepJson || '').trim()
    && stepData?.optionalPaymentPrompt !== true
  ) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
    if (resumed) {
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }
  }

  if (stepData?.spellBeholdCastPrompt === true) {
    const cardId = String(stepData?.spellBeholdCastCardId || stepData?.sourceId || '').trim();
    const castArgs = stepData?.castSpellFromHandArgs || {};
    const choiceId = String(extractId(selectedOption) || '').trim().toLowerCase();
    const zones = (game.state as any)?.zones?.[playerId];
    const hand = Array.isArray(zones?.hand) ? zones.hand : [];
    const spellCard = hand.find((card: any) => card && String(card.id || '') === cardId);
    if (!spellCard) {
      debugWarn(1, `[Resolution] spellBeholdCastPrompt: card ${cardId} not found in hand`);
      return true;
    }

    const resumeCastAfterBeholdChoice = async (updates: Record<string, unknown>) => {
      Object.assign(spellCard as any, updates);
      appendCastSpellContinuationEvent(gameId, game, {
        playerId,
        cardId,
        cardUpdates: updates,
      });
      const { socket: restartCastSocket } = createForwardingGameActionSocket(io, gameId, String(playerId));
      await requestCastSpellForSocket(
        io,
        restartCastSocket as any,
        {
          gameId,
          cardId,
          faceIndex: Number.isFinite(castArgs?.faceIndex) ? Number(castArgs.faceIndex) : undefined,
          fromZone: 'hand',
        },
        {
          xValue: Number.isFinite(castArgs?.xValue) ? Number(castArgs.xValue) : undefined,
          forcedAlternateCostId: String(castArgs?.alternateCostId || '').trim() || undefined,
          castWithoutPayingManaCost: castArgs?.castWithoutPayingManaCost === true,
          bypassExilePermissionCheck: castArgs?.bypassExilePermissionCheck === true,
          ignoreTimingRestrictions: castArgs?.ignoreTimingRestrictions === true,
        },
      );
    };

    if (response.cancelled || !choiceId || choiceId === 'skip') {
      await resumeCastAfterBeholdChoice({
        beholdResolved: true,
        wasBeheld: false,
        additionalCostPaid: false,
      });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} declines the behold additional cost for ${spellCard.name || stepData?.sourceName || 'this spell'}.`,
        ts: Date.now(),
      });
      return true;
    }

    if (choiceId === 'behold') {
      const beholdCount = Math.max(1, Number(stepData?.spellBeholdCount || 2));
      const typeStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: playerId as any,
        sourceId: cardId,
        sourceName: spellCard.name || stepData?.sourceName,
        sourceImage: stepData?.sourceImage,
        description: `Choose a creature type to behold for ${spellCard.name || 'this spell'}`,
        mandatory: true,
        beholdCastCardId: cardId,
        spellBeholdCount: beholdCount,
        cardName: spellCard.name,
        castSpellFromHandArgs: castArgs,
      } as any);
      appendCastSpellContinuationEvent(gameId, game, {
        playerId,
        cardId,
        queuedResolutionStep: {
          ...(typeStep as any),
        },
      });
      return true;
    }

    debugWarn(1, `[Resolution] spellBeholdCastPrompt: unexpected choice '${choiceId}'`);
    return true;
  }

  if (stepData.zursWeirdingOpponentChoice === true) {
    const rawChoiceId = String(extractId(selectedOption) || 'decline').trim();
    const normalizedChoiceId = rawChoiceId.toLowerCase();
    const resolvedStepId = String((step as any).id || '').trim();
    const drawingPlayerId = String(stepData?.drawingPlayerId || '').trim();
    const decidingOpponentId = String(stepData?.decidingOpponentId || playerId || '').trim();
    const opponentIndex = Math.max(0, Math.floor(Number(stepData?.opponentIndex || 0)));
    const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(stepData?.remainingDrawCountAfterChoice || 0)));
    const opponents = Array.isArray(stepData?.opponents) ? stepData.opponents : [];
    const revealedCardName = String(stepData?.revealedCard?.name || 'a card').trim() || 'a card';

    if (response.cancelled || normalizedChoiceId === 'decline') {
      const result = applyZursWeirdingOpponentChoice(game as any, {
        drawingPlayerId,
        decidingOpponentId,
        opponentIndex,
        choiceId: 'decline',
        remainingDrawCountAfterChoice,
        opponents,
      });

      if (!result.applied) {
        emitToPlayer(io, playerId as any, 'error', {
          code: 'ZURS_WEIRDING_REPLACEMENT_FAILED',
          message: 'Unable to apply Zur\'s Weirding replacement choice.',
        });
        return true;
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, decidingOpponentId)} declines to pay 2 life for Zur's Weirding (${revealedCardName}).`,
        ts: Date.now(),
      });

      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'zursWeirdingDrawReplacementResolve', {
          playerId: decidingOpponentId,
          drawingPlayerId,
          resolvedStepId,
          choiceId: 'decline',
          opponentIndex,
          remainingDrawCountAfterChoice,
          revealedCardId: String(stepData?.revealedCard?.id || '').trim() || undefined,
          revealedCardName,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] Failed to persist zursWeirdingDrawReplacementResolve event:', err);
      }

      broadcastGame(io, game, gameId);
      return true;
    }

    if (normalizedChoiceId === 'pay_2_life' || normalizedChoiceId === 'pay') {
      const result = applyZursWeirdingOpponentChoice(game as any, {
        drawingPlayerId,
        decidingOpponentId,
        opponentIndex,
        choiceId: 'pay_2_life',
        remainingDrawCountAfterChoice,
        opponents,
      });

      if (!result.applied) {
        emitToPlayer(io, playerId as any, 'error', {
          code: 'ZURS_WEIRDING_REPLACEMENT_FAILED',
          message: result.reason === 'insufficient_life'
            ? 'Not enough life to pay 2.'
            : 'Unable to apply Zur\'s Weirding replacement choice.',
        });
        return true;
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, decidingOpponentId)} pays 2 life. Zur's Weirding puts ${revealedCardName} into ${getPlayerName(game, drawingPlayerId)}'s graveyard.`,
        ts: Date.now(),
      });

      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'zursWeirdingDrawReplacementResolve', {
          playerId: decidingOpponentId,
          drawingPlayerId,
          resolvedStepId,
          choiceId: 'pay_2_life',
          opponentIndex,
          remainingDrawCountAfterChoice,
          revealedCardId: String(stepData?.revealedCard?.id || '').trim() || undefined,
          revealedCardName,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] Failed to persist zursWeirdingDrawReplacementResolve event:', err);
      }

      broadcastGame(io, game, gameId);
      return true;
    }

    emitToPlayer(io, playerId as any, 'error', {
      code: 'INVALID_CHOICE',
      message: 'Invalid Zur\'s Weirding choice.',
    });
    return true;
  }

  if (stepData.dredgeDrawReplacementChoice === true) {
    const rawChoiceId = String(extractId(selectedOption) || 'draw').trim();
    const normalizedChoiceId = rawChoiceId.toLowerCase();
    const resolvedStepId = String((step as any).id || '').trim();
    const dredgeCardId = normalizedChoiceId.startsWith('dredge:') ? rawChoiceId.slice(rawChoiceId.indexOf(':') + 1).trim() : '';
    const dredgeOption = dredgeCardId
      ? (Array.isArray(stepData?.dredgeOptions) ? stepData.dredgeOptions : [])
        .find((option: any) => String(option?.cardId || '').trim() === dredgeCardId)
      : null;
    const dredgeAmount = Math.max(0, Math.floor(Number(dredgeOption?.dredge || 0)));
    const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(stepData?.remainingDrawCountAfterChoice || 0)));

    const result = applyDredgeDrawReplacementChoice(game as any, {
      playerId,
      choiceId: dredgeCardId ? 'dredge' : 'draw',
      dredgeCardId,
      dredgeAmount,
      remainingDrawCountAfterChoice,
    });

    if (!result.applied) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'DREDGE_REPLACEMENT_FAILED',
        message: 'Unable to apply dredge replacement choice.',
      });
      return true;
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'dredgeDrawReplacementResolve', {
        playerId,
        resolvedStepId,
        choiceId: dredgeCardId ? 'dredge' : 'draw',
        ...(dredgeCardId ? { dredgeCardId } : {}),
        ...(dredgeAmount > 0 ? { dredgeAmount } : {}),
        remainingDrawCountAfterChoice,
        ...(Array.isArray(result.milledCards) ? { milledCardIds: result.milledCards.map((card: any) => String(card?.id || '')).filter(Boolean) } : {}),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist dredgeDrawReplacementResolve event:', err);
    }

    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.exertChoice === true) {
    const attackerId = String(stepData.exertAttackerId || stepData.permanentId || step.sourceId || '').trim();
    const choiceId = String(extractId(selectedOption) || '').trim().toLowerCase();
    const sourceName = String(step.sourceName || 'Exert').trim() || 'Exert';
    const resolvedStepId = String((step as any).id || '').trim();
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const attacker = battlefield.find((permanent: any) => String(permanent?.id || '') === attackerId);

    if (response.cancelled || choiceId === 'normal' || choiceId === 'decline' || !attackerId) {
      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'exertChoice', {
          playerId,
          attackerId,
          resolvedStepId,
          exerted: false,
          cancelled: response.cancelled === true || choiceId === 'decline',
        });
      } catch (err) {
        debugWarn(1, '[Resolution] Failed to persist declined exertChoice event:', err);
      }
      broadcastGame(io, game, gameId);
      return true;
    }

    if (choiceId !== 'exert') {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INVALID_EXERT_CHOICE',
        message: 'Choose whether to exert the attacking creature.',
      });
      return true;
    }

    if (!attacker || String(attacker?.controller || '') !== String(playerId) || !attacker?.attacking) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INVALID_EXERT_ATTACKER',
        message: 'That creature is no longer attacking and cannot be exerted.',
      });
      return true;
    }

    const oracleText = String(attacker?.card?.oracle_text || '');
    if (/hasn't been exerted this turn/i.test(oracleText) && (attacker as any).exertedThisTurn === true) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'ALREADY_EXERTED_THIS_TURN',
        message: `${sourceName} has already been exerted this turn.`,
      });
      return true;
    }

    if (typeof (game as any).applyEvent === 'function') {
      (game as any).applyEvent({
        type: 'exertChoice',
        playerId,
        attackerId,
        resolvedStepId,
        exerted: true,
      });
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'exertChoice', {
        playerId,
        attackerId,
        resolvedStepId,
        exerted: true,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist exertChoice event:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} exerts ${String(attacker?.card?.name || sourceName)}.`,
      ts: Date.now(),
    });

    pushWheneverYouExertTriggersOntoStack(game, gameId, String(playerId), String(attackerId));

    const rewardDescription = String(stepData.exertRewardDescription || '').trim();
    if (rewardDescription) {
      if (/target creature can't block this turn/i.test(rewardDescription)) {
        const validTargets = battlefield
          .filter((permanent: any) => {
            if (!permanent) return false;
            const typeLine = String(permanent.card?.type_line || '').toLowerCase();
            return typeLine.includes('creature');
          })
          .map((permanent: any) => ({
            id: String(permanent.id),
            label: String(permanent.card?.name || 'Creature'),
            description: String(permanent.card?.type_line || 'Creature'),
            imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
          }));

        if (validTargets.length > 0) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: playerId as any,
            sourceId: attackerId,
            sourceName: String(attacker?.card?.name || sourceName),
            sourceImage: attacker?.card?.image_uris?.small || attacker?.card?.image_uris?.normal,
            description: `${String(attacker?.card?.name || sourceName)}: choose target creature that can't block this turn.`,
            mandatory: true,
            validTargets,
            targetTypes: ['creature'],
            minTargets: 1,
            maxTargets: 1,
            targetDescription: 'target creature',
            exertTargetChoice: true,
            exertAttackerId: attackerId,
            exertRewardDescription: rewardDescription,
            sourcePermanentSnapshot: cloneResolutionPermanentSnapshot(attacker),
          } as any);

          broadcastGame(io, game, gameId);
          return true;
        }
      }

      const graveyardSelectionData = buildExertTriggeredGraveyardSelectionData(
        game,
        String(playerId),
        attacker,
        rewardDescription,
      );
      if (graveyardSelectionData && graveyardSelectionData.validTargets.length > 0) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.GRAVEYARD_SELECTION,
          playerId: playerId as any,
          sourceId: attackerId,
          sourceName: String(attacker?.card?.name || sourceName),
          sourceImage: attacker?.card?.image_uris?.small || attacker?.card?.image_uris?.normal,
          description: `${String(attacker?.card?.name || sourceName)}: choose target card from your graveyard.`,
          mandatory: true,
          validTargets: graveyardSelectionData.validTargets,
          minTargets: Number(graveyardSelectionData.metadata.minTargets ?? 1),
          maxTargets: Number(graveyardSelectionData.metadata.maxTargets ?? 1),
          targetPlayerId: graveyardSelectionData.graveyardOwners.length === 1 ? String(graveyardSelectionData.graveyardOwners[0] || '') : '',
          destination: String(graveyardSelectionData.metadata.targetDestination || '').toLowerCase() || 'battlefield',
          destinationUsesSelectedCardOwner: graveyardSelectionData.metadata.destinationUsesSelectedCardOwner === true,
          battlefieldControllerMode: graveyardSelectionData.metadata.battlefieldControllerMode,
          battlefieldCounters: graveyardSelectionData.metadata.battlefieldCounters,
          exertGraveyardTargetChoice: true,
          exertAttackerId: attackerId,
          exertRewardDescription: rewardDescription,
          sourcePermanentSnapshot: cloneResolutionPermanentSnapshot(attacker),
        } as any);

        broadcastGame(io, game, gameId);
        return true;
      }

      pushExertTriggeredAbilityOntoStack(
        game,
        gameId,
        attacker,
        String(playerId),
        rewardDescription,
      );
    }

    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.roomDoorLockOrUnlock === true) {
    const roomPermanentId = String(stepData.roomPermanentId || stepData.sourceId || '').trim();
    const choiceId = String(extractId(selectedOption) || '').trim().toLowerCase();
    const resolvedStepId = String((step as any).id || '').trim();
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const room = battlefield.find((permanent: any) => String(permanent?.id || '') === roomPermanentId);

    if (response.cancelled || !roomPermanentId || !choiceId) {
      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'roomDoorChoice', {
          playerId,
          roomPermanentId,
          resolvedStepId,
          cancelled: true,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] Failed to persist cancelled roomDoorChoice event:', err);
      }
      broadcastGame(io, game, gameId);
      return true;
    }

    if (choiceId !== 'lock' && choiceId !== 'unlock') {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INVALID_ROOM_DOOR_CHOICE',
        message: 'Choose whether to lock or unlock the Room door.',
      });
      return true;
    }

    if (!room || !/\broom\b/i.test(String(room?.card?.type_line || ''))) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INVALID_ROOM_DOOR_TARGET',
        message: 'That Room is no longer on the battlefield.',
      });
      return true;
    }

    if (typeof (game as any).applyEvent === 'function') {
      (game as any).applyEvent({
        type: 'roomDoorChoice',
        playerId,
        roomPermanentId,
        choiceId,
        resolvedStepId,
      });
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'roomDoorChoice', {
        playerId,
        roomPermanentId,
        choiceId,
        resolvedStepId,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist roomDoorChoice event:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} ${choiceId === 'unlock' ? 'unlocks' : 'locks'} a door of ${String(room?.card?.name || 'Room')}.`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.myriadChoice === true) {
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const sourcePermanentId = String(stepData.permanentId || step.sourceId || '').trim();
    const resolvedStepId = String((step as any).id || '').trim();
    const sourcePermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === sourcePermanentId);
    if (!sourcePermanent) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'PERMANENT_NOT_FOUND',
        message: 'Myriad source is no longer on the battlefield.',
      });
      return true;
    }

    const validOptionIds = new Set(
      (Array.isArray(stepData.options) ? stepData.options : [])
        .map((option: any) => String(option?.id || option?.value || option || '').trim())
        .filter(Boolean),
    );
    const activeOpponentIds = new Set(
      (Array.isArray((game.state as any)?.players) ? (game.state as any).players : [])
        .filter((entry: any) => entry && entry.spectator !== true && entry.hasLost !== true)
        .map((entry: any) => String(entry.id || '').trim())
        .filter((id: string) => Boolean(id) && id !== String(playerId)),
    );
    const requestedSelections = (Array.isArray(selectedOption)
      ? selectedOption
      : selectedOption == null
        ? []
        : [selectedOption]
    ) as any[];
    const selectedOpponentIds = Array.from(new Set(
      requestedSelections
        .map((value: any) => String(extractId(value) || '').trim())
        .filter((value: string) => validOptionIds.has(value) && activeOpponentIds.has(value)),
    ));
    const sourceName = String(step.sourceName || sourcePermanent?.card?.name || 'Myriad');
    const sourcePermanentSnapshot = cloneResolutionPermanentSnapshot(sourcePermanent);
    const generatedPermanentIds = selectedOpponentIds.map(() => uid('token_myriad'));
    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as unknown as GameContext;
    const createdPermanentIds = applyMyriadTokenCopies(
      ctx,
      sourcePermanentSnapshot,
      String(sourcePermanent?.controller || playerId) as PlayerID,
      selectedOpponentIds,
      generatedPermanentIds,
      sourceName,
    );

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'myriadChoice', {
        playerId,
        permanentId: sourcePermanentId,
        resolvedStepId,
        sourceName,
        sourcePermanentSnapshot,
        selectedOpponentIds,
        createdPermanentIds,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist myriadChoice event:', err);
    }

    const attackedPlayers = selectedOpponentIds.map((id: string) => getPlayerName(game, id));
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: createdPermanentIds.length > 0
        ? `${getPlayerName(game, playerId)} creates ${createdPermanentIds.length} Myriad token cop${createdPermanentIds.length === 1 ? 'y' : 'ies'} of ${sourceName} attacking ${attackedPlayers.join(', ')}.`
        : `${getPlayerName(game, playerId)} declines to create Myriad token copies for ${sourceName}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.giftCastChoice === true) {
    const choiceId = extractId(selectedOption) || 'gift:none';
    const cardId = String(stepData.giftCardId || step.sourceId || '').trim();
    const faceIndex = typeof stepData.giftFaceIndex === 'number' ? stepData.giftFaceIndex : undefined;
    const fromZone = stepData.giftFromZone === 'exile' || stepData.giftFromZone === 'graveyard' ? stepData.giftFromZone : 'hand';
    const zones = (game.state as any)?.zones?.[playerId];
    const sourceArr: any[] = fromZone === 'exile'
      ? (Array.isArray((zones as any)?.exile) ? (zones as any).exile : [])
      : fromZone === 'graveyard'
        ? (Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [])
        : (Array.isArray((zones as any)?.hand) ? (zones as any).hand : []);
    const cardObj = sourceArr.find((entry: any) => entry && String(entry.id || '') === cardId);
    if (!cardObj) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'CARD_NOT_FOUND',
        message: 'Card not found for Gift choice.',
      });
      return true;
    }

    const promised = choiceId.startsWith('gift:') && choiceId !== 'gift:none';
    const recipientId = promised ? String(choiceId.slice('gift:'.length)).trim() : '';
    (cardObj as any).giftChoiceResolved = true;
    (cardObj as any).giftPromised = promised;
    if (recipientId) {
      (cardObj as any).giftRecipient = recipientId;
    } else {
      delete (cardObj as any).giftRecipient;
    }
    if (stepData.giftType) {
      (cardObj as any).giftType = String(stepData.giftType);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: promised && recipientId
        ? `${getPlayerName(game, playerId)} promises ${String(stepData.giftType || 'a gift')} to ${getPlayerName(game, recipientId)} while casting ${String(stepData.giftCardName || step.sourceName || 'that spell')}.`
        : `${getPlayerName(game, playerId)} casts ${String(stepData.giftCardName || step.sourceName || 'that spell')} without promising a gift.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);

    await restartPlayerCastRequest(io, gameId, String(playerId), {
      cardId,
      faceIndex,
      fromZone: fromZone === 'exile' || fromZone === 'graveyard' || fromZone === 'library' ? fromZone : 'hand',
    });
    return true;
  }

  if (stepData.spellBottomRevealUntilNonlandChoice === true) {
    const choiceId = extractId(selectedOption) || 'no';
    const controllerId = String(stepData.revealFromLibraryPlayerId || playerId);
    const triggeringStackItemId = String(stepData.triggeringStackItemId || '');
    const triggeringSpellCard = stepData.triggeringSpellCard || null;
    const sourceName = String(stepData.sourceName || step.sourceName || 'Ability');
    const resolvedStepId = String((step as any)?.id || '').trim();

    const snapshotLibraryCards = (cards: any[]) =>
      (Array.isArray(cards) ? cards : []).map((card: any) => ({ ...card, zone: 'library' }));

    if (choiceId !== 'yes') {
      appendEvent(gameId, (game as any).seq ?? 0, 'spellBottomRevealUntilNonlandResolve', {
        playerId,
        resolvedStepId,
        choice: 'no',
        triggeringStackItemId,
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} declines to use ${sourceName}.`,
        ts: Date.now(),
      });
      return true;
    }

    const stackItems = Array.isArray(game.state?.stack) ? game.state.stack : [];
    const stackIndex = stackItems.findIndex((item: any) => String(item?.id || '') === triggeringStackItemId);
    const stackItem = stackIndex >= 0 ? stackItems[stackIndex] : null;

    if (!stackItem || !triggeringSpellCard) {
      appendEvent(gameId, (game as any).seq ?? 0, 'spellBottomRevealUntilNonlandResolve', {
        playerId,
        resolvedStepId,
        choice: 'yes',
        triggeringStackItemId,
      });

      debugWarn(2, `[Resolution] Spell-bottom reveal trigger: stack item ${triggeringStackItemId} no longer exists`);
      return true;
    }

    stackItems.splice(stackIndex, 1);

    const spellOwner = String(
      stackItem?.card?.owner ||
      stackItem?.owner ||
      triggeringSpellCard?.owner ||
      stackItem?.controller ||
      playerId
    );

    const ownerLibrary = (game as any).libraries?.get(spellOwner) || [];
    ownerLibrary.push({ ...(stackItem.card || triggeringSpellCard), zone: 'library' });
    (game as any).libraries?.set?.(spellOwner, ownerLibrary);

    const revealLibrary = (game as any).libraries?.get(controllerId) || [];
    const revealedCards: any[] = [];
    let hitCard: any | null = null;
    while (revealLibrary.length > 0) {
      const card = revealLibrary.shift();
      if (!card) break;
      revealedCards.push(card);
      const typeLine = String(card.type_line || '').toLowerCase();
      if (!typeLine.includes('land')) {
        hitCard = card;
        break;
      }
    }
    (game as any).libraries?.set?.(controllerId, revealLibrary);

    const zones = game.state.zones = game.state.zones || {};
    const ownerZones = zones[spellOwner] = zones[spellOwner] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    ownerZones.libraryCount = ownerLibrary.length;
    const revealZones = zones[controllerId] = zones[controllerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    revealZones.libraryCount = revealLibrary.length;

    const bottomRandom = (cards: any[]) => {
      const randomized = [...cards];
      for (let i = randomized.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
      }
      for (const card of randomized) {
        revealLibrary.push({ ...card, zone: 'library' });
      }
      revealZones.libraryCount = revealLibrary.length;
    };

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} puts ${stackItem.card?.name || triggeringSpellCard?.name || 'that spell'} on the bottom of its owner's library for ${sourceName}.`,
      ts: Date.now(),
    });

    if (!hitCard) {
      bottomRandom(revealedCards);
      appendEvent(gameId, (game as any).seq ?? 0, 'spellBottomRevealUntilNonlandResolve', {
        playerId,
        resolvedStepId,
        choice: 'yes',
        triggeringStackItemId,
        spellOwnerId: spellOwner,
        revealFromLibraryPlayerId: controllerId,
        ownerLibraryAfter: snapshotLibraryCards(ownerLibrary),
        revealLibraryAfter: snapshotLibraryCards(revealLibrary),
      });

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      return true;
    }

    // Cards not cast this way bottom now. Stage the hit in exile and reuse the
    // generic free-cast-from-exile prompt (targets / modes / payment pipeline).
    const nonHitCards = revealedCards.filter((card: any) => String(card?.id || '') !== String(hitCard?.id || ''));
    bottomRandom(nonHitCards);

    const revealZonesExile = Array.isArray(revealZones.exile) ? revealZones.exile : (revealZones.exile = []);
    const stagedHit = { ...hitCard, zone: 'exile' };
    revealZonesExile.push(stagedHit);
    revealZones.exileCount = revealZonesExile.length;

    const queuedRevealCastChoiceStep = createResolutionStep({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controllerId as any,
      description: `${sourceName}: Cast ${hitCard.name} without paying its mana cost?`,
      mandatory: false,
      sourceName,
      sourceId: stepData.revealSourcePermanentId,
      options: [
        { id: 'cast', label: `Cast ${hitCard.name}` },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: String(hitCard.id || ''),
      castFromExileCard: stagedHit,
      castFromExileCastWithoutPayingManaCost: true,
      castFromExileForcedAlternateCostId: 'free',
      castFromExileBypassExilePermissionCheck: true,
      castFromExileIgnoreTimingRestrictions: true,
      castFromExileDeclineDestination: 'library_bottom_random',
    } as any);

    appendEvent(gameId, (game as any).seq ?? 0, 'spellBottomRevealUntilNonlandResolve', {
      playerId,
      resolvedStepId,
      choice: 'yes',
      triggeringStackItemId,
      spellOwnerId: spellOwner,
      revealFromLibraryPlayerId: controllerId,
      ownerLibraryAfter: snapshotLibraryCards(ownerLibrary),
      revealLibraryAfter: snapshotLibraryCards(revealLibrary),
      revealExileAfter: revealZonesExile.map((card: any) => ({ ...card })),
      queuedResolutionStep: queuedRevealCastChoiceStep,
    });

    ResolutionQueueManager.addStep(gameId, queuedRevealCastChoiceStep as any);

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return true;
  }

  if (stepData.mdfcFaceChoice === true) {
    const choiceId = extractId(selectedOption);
    const selectedFace = choiceId == null ? NaN : Number(choiceId);
    const cardId = String(stepData.cardId || stepData.sourceId || '');
    const responderSocket = Array.from((io as any)?.sockets?.sockets?.values?.() || []).find(
      (candidate: any) => candidate?.data?.playerId === playerId && candidate?.rooms?.has?.(gameId)
    ) || {
      data: { playerId, gameId },
      rooms: new Set([gameId]),
      emit: (event: string, payload: any) => emitToPlayer(io, playerId as any, event as any, payload),
    };

    if (!Number.isInteger(selectedFace) || selectedFace < 0) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INVALID_SELECTION',
        message: 'Invalid card face selection',
      });
      return true;
    }

    handlePlayLandRequest(io, responderSocket as any, {
      gameId,
      cardId,
      selectedFace,
      fromZone: stepData.fromZone === 'graveyard' || stepData.fromZone === 'exile' ? stepData.fromZone : 'hand',
    });
    return true;
  }

  if (stepData.castRevealedFromLibraryChoice === true && stepData.castRevealedFromLibraryCard) {
    const choiceId = extractId(selectedOption) || 'decline';
    const controllerId = String(stepData.castRevealedFromLibraryPlayerId || playerId);
    const hitCard = stepData.castRevealedFromLibraryCard;
    const otherCards = Array.isArray(stepData.castRevealedFromLibraryOtherCards)
      ? [...stepData.castRevealedFromLibraryOtherCards]
      : [];
    const sourceName = String(stepData.sourceName || step.sourceName || 'Ability');
    const resolvedStepId = String((step as any)?.id || '').trim();
    const hitCardId = String(hitCard?.id || '').trim();
    const lib = (game as any).libraries?.get(controllerId) || [];
    const zones = game.state.zones = game.state.zones || {};
    const z = zones[controllerId] = zones[controllerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    const player = Array.isArray(game.state.players)
      ? game.state.players.find((entry: any) => String(entry?.id || '') === controllerId)
      : undefined;
    const spliceFrom = (cards: any[]) => {
      if (!Array.isArray(cards) || !hitCardId) return;
      const index = cards.findIndex((card: any) => String(card?.id || '').trim() === hitCardId);
      if (index >= 0) cards.splice(index, 1);
    };
    spliceFrom(lib);
    if (Array.isArray(player?.library)) spliceFrom(player.library);
    if (Array.isArray(z.library)) spliceFrom(z.library);
    z.libraryCount = lib.length;
    const remainingLibraryIds = (Array.isArray(lib) ? lib : [])
      .map((card: any) => String(card?.id || ''))
      .filter(Boolean);
    let bottomCardIds: string[] = [];
    let bottomCards: any[] = [];

    const bottomRandom = (cards: any[]) => {
      const randomized = [...cards];
      for (let i = randomized.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
      }
      bottomCards = randomized.map((card: any) => ({ ...card, zone: 'library' }));
      bottomCardIds = bottomCards.map((card: any) => String(card?.id || '')).filter(Boolean);
      for (const card of bottomCards) {
        lib.push({ ...card, zone: 'library' });
      }
      z.libraryCount = lib.length;
    };

    let revealedCastStackItem: any | undefined;

    if (choiceId === 'cast') {
      revealedCastStackItem = {
        id: uid('reveal_cast_spell'),
        type: 'spell',
        card: { ...hitCard, zone: 'stack' },
        controller: controllerId,
        targets: [],
        castFromHand: false,
        castWithoutPayingManaCost: true,
      };
      game.state.stack = game.state.stack || [];
      game.state.stack.push(revealedCastStackItem);
      bottomRandom(otherCards);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, controllerId)} casts ${hitCard.name} without paying its mana cost (${sourceName}).`,
        ts: Date.now(),
      });
    } else {
      bottomRandom([...otherCards, hitCard]);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, controllerId)} declines to cast ${hitCard.name} (${sourceName}).`,
        ts: Date.now(),
      });
    }

    (game as any).libraries?.set?.(controllerId, lib);
    if (Array.isArray(player?.library)) {
      player.library = [...lib];
    }
    z.libraryCount = lib.length;
    appendEvent(gameId, (game as any).seq ?? 0, 'castRevealedFromLibraryResolve', {
      playerId: controllerId,
      resolvedStepId,
      choice: choiceId === 'cast' ? 'cast' : 'decline',
      sourceName,
      cardId: String(hitCard?.id || ''),
      remainingLibraryIds,
      bottomCardIds,
      bottomCards,
      libraryAfter: lib.map((card: any) => ({ ...card })),
      stackItem: revealedCastStackItem,
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return true;
  }


  return false;
}
