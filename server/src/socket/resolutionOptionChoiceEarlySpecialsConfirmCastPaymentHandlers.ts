/**
 * socket/resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.ts
 *
 * Option-choice specials immediately after the PREFIX peel: deck-import / judge
 * confirms, Forbidden Orchard, commander-zone, Miracle / Mutate cast mode,
 * Mirrormind Crown token replacement, reflexive payment / convert-when-you-do,
 * and optional-payment prompts.
 *
 * Kept under the ~40KB soft ceiling (PREFIX handlers are already near limit).
 * May / optional-triggered prompts stay in resolution.ts (shared with
 * handleStepResponse helpers). Returns true when fully handled.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import type { GameContext } from "../state/context.js";
import {
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { uid, validateLifePayment } from "../state/utils.js";
import { debugWarn } from "../utils/debug.js";
import {
  consumeReflexiveManaAmountFromPool,
  formatReflexiveFixedPaymentLabel,
  formatReflexiveManaAmount,
  getAvailableReflexiveManaAmountFromPool,
  materializeReflexiveFollowupText,
  materializeReflexiveSourceText,
  parseReflexivePaymentChoiceAmount,
} from "../state/modules/reflexive-triggers.js";
import {
  resolveOracleIrOptionalPaymentPromptFromResolution,
  syncAllOracleIRPlayerZonesAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../state/modules/oracleIrDeferredStackFinalize.js";
import { transformPermanentToFace } from "../state/modules/day-night.js";
import { queueLifePaymentTriggers } from "../state/modules/triggers/pay-life.js";
import { inferFollowupTargetMetadata } from "./resolutionDiscardTriggerUtils.js";
import { triggerETBEffectsForToken } from "../state/modules/triggerEtbEntryEffects.js";
import { handleImportWipeConfirmVote } from "./deck.js";
import { handleJudgeConfirmVote } from "./judge.js";
import { requestCastSpellForSocket } from "./game-actions.js";
import {
  consumeOptionalPaymentCallback,
  isOptionalPaymentPayChoice,
  isOptionalPaymentPromptStep,
} from "./optional-payment-prompts.js";
import { handleCommanderZoneResponse } from "./resolutionCommanderZoneResponseHandlers.js";
import {
  buildTriggeredAbilitySourceContext,
  getResolutionSourcePermanentSnapshot,
} from "./resolutionKeywordChoiceHandlers.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  emitToPlayer,
  getOrInitManaPool,
  getPlayerName,
  validateAndConsumeManaCostFromPool,
} from "./util.js";
import { stampPermanentEntryTimestamp } from '../../../rules-engine/src/permanentTimestamps.js';

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

/**
 * Attempt confirm / cast-mode / reflexive-payment / optional-payment specials.
 * @returns true if handled (caller should return)
 */
export async function tryHandleOptionChoiceEarlySpecialsConfirmCastPayment(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;
// ===== DECK IMPORT WIPE CONFIRM =====
  if (stepData?.importWipeConfirm === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'decline' : null) || 'decline';
    const confirmId = String(stepData?.confirmId || '').trim();
    if (!confirmId) {
      debugWarn(1, '[Resolution] importWipeConfirm: missing confirmId');
      return true;
    }

    const accept = !response.cancelled && choiceId === 'accept';
    handleImportWipeConfirmVote(io, gameId, confirmId, playerId as any, accept);
    return true;
  }

  // ===== JUDGE CONFIRM =====
  if (stepData?.judgeConfirm === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'decline' : null) || 'decline';
    const confirmId = String(stepData?.confirmId || '').trim();
    if (!confirmId) {
      debugWarn(1, '[Resolution] judgeConfirm: missing confirmId');
      return true;
    }

    const accept = !response.cancelled && choiceId === 'accept';
    handleJudgeConfirmVote(io, game, gameId, confirmId, String(playerId), accept);
    return true;
  }

  // ===== FORBIDDEN ORCHARD: choose opponent to receive a Spirit token =====
  if (stepData?.forbiddenOrchardTargetChoice === true) {
    const targetOpponentId = extractId(selectedOption) || '';
    const options = Array.isArray(stepData?.options) ? stepData.options : [];
    const isValid = options.some((option: any) => String(option?.id || '') === String(targetOpponentId));
    if (!isValid) {
      debugWarn(1, `[Resolution] forbiddenOrchardTargetChoice: invalid target ${targetOpponentId}`);
      return true;
    }

    const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.battlefield = game.state.battlefield || [];
    const spiritToken = {
      id: tokenId,
      controller: targetOpponentId,
      owner: targetOpponentId,
      tapped: false,
      summoningSickness: true,
      counters: {},
      card: {
        id: tokenId,
        name: 'Spirit',
        type_line: 'Token Creature — Spirit',
        oracle_text: '',
        mana_cost: '',
        cmc: 0,
        colors: [],
      },
      basePower: 1,
      baseToughness: 1,
      isToken: true,
    };
    game.state.battlefield.push(spiritToken);
    stampPermanentEntryTimestamp(game.state, game.state.battlefield[game.state.battlefield.length - 1]);

    const ctx = {
      state: game.state,
      bumpSeq: game.bumpSeq?.bind(game) || (() => {
        debugWarn(2, '[Forbidden Orchard] bumpSeq not available, state updates may not propagate');
      }),
    };
    triggerETBEffectsForToken(ctx as any, spiritToken as any, targetOpponentId);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `Forbidden Orchard: ${getPlayerName(game, targetOpponentId)} creates a 1/1 colorless Spirit token.`,
      ts: Date.now(),
    });

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'confirmForbiddenOrchardTarget', {
        playerId,
        stepId: step.id,
        permanentId: String(stepData.permanentId || step.sourceId || ''),
        targetOpponentId,
      });
    } catch (e) {
      debugWarn(1, '[Resolution] appendEvent(confirmForbiddenOrchardTarget) failed:', e);
    }

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData?.commanderZoneChoice === true) {
    const commanderSelection = extractId(selectedOption);
    handleCommanderZoneResponse(io, game, gameId, step, {
      ...response,
      selections: commanderSelection ? [commanderSelection] : (response.cancelled ? ['stay'] : response.selections),
    });
    return true;
  }

  if (stepData?.miraclePrompt === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'decline' : null) || 'decline';
    const miracleCardId = String(stepData?.miracleCardId || step.sourceId || '').trim();
    const accepted = !response.cancelled && choiceId === 'cast_miracle';

    if (!miracleCardId) {
      debugWarn(1, `[Resolution] miraclePrompt: missing miracleCardId/sourceId`);
      return true;
    }

    // Find card in hand and clear first-drawn flags if declined.
    const zones = (game.state as any)?.zones?.[playerId];
    const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
    const cardInHand = hand.find((c: any) => c && String(c.id) === miracleCardId);

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'miraclePromptResolve', {
        playerId,
        sourceId: miracleCardId,
        sourceName: String(stepData?.sourceName || step.sourceName || cardInHand?.name || 'Miracle'),
        resolvedStepId: String(step.id || '').trim() || undefined,
        miracleCardId,
        miracleCost: String(stepData?.miracleCost || '').trim(),
        choiceId: accepted ? 'cast_miracle' : 'decline',
        accepted,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(miraclePromptResolve) failed:', err);
    }

    if (!accepted) {
      if (cardInHand) {
        delete (cardInHand as any).isFirstDrawnThisTurn;
        delete (cardInHand as any).drawnAt;
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} declines to cast ${String(stepData?.sourceName || step.sourceName || 'a card')} for its miracle cost.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    // Accept: start normal cast flow, but force miracle cost.
    const fakeSocket: any = {
      data: { playerId, spectator: false },
      emit: (event: string, payload: unknown) => {
        emitToPlayer(io, playerId as any, event as any, payload);
      },
    };

    await requestCastSpellForSocket(
      io,
      fakeSocket,
      { gameId, cardId: miracleCardId },
      { skipPriorityCheck: true, forcedAlternateCostId: 'miracle' }
    );

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  // ===== MUTATE CAST MODE (Rule 702.140a) =====
  // Some mutate creatures need an explicit cast-mode selection: cast normally vs cast for mutate.
  if (stepData?.mutateCastModeChoice === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'cancel' : null) || 'cancel';
    const mutateCardId = String(stepData?.mutateCardId || step.sourceId || '').trim();
    const faceIndex = stepData?.mutateFaceIndex != null ? Number(stepData.mutateFaceIndex) : undefined;

    if (!mutateCardId) {
      debugWarn(1, `[Resolution] mutateCastModeChoice: missing mutateCardId/sourceId`);
      return true;
    }

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'mutateCastModeChoiceResolve', {
        playerId,
        sourceId: mutateCardId,
        sourceName: String(stepData?.sourceName || step.sourceName || 'Mutate spell'),
        resolvedStepId: String(step.id || '').trim() || undefined,
        mutateCardId,
        ...(faceIndex != null && Number.isFinite(faceIndex) ? { mutateFaceIndex: faceIndex } : {}),
        choiceId,
        castMode: choiceId === 'cast_mutate' ? 'mutate' : (choiceId === 'cast_normal' ? 'normal' : 'cancel'),
        accepted: !response.cancelled && choiceId !== 'cancel',
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(mutateCastModeChoiceResolve) failed:', err);
    }

    if (response.cancelled || choiceId === 'cancel') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} cancelled casting ${String(stepData?.sourceName || step.sourceName || 'a card')}.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    const fakeSocket: any = {
      data: { playerId, spectator: false },
      emit: (event: string, payload: unknown) => {
        emitToPlayer(io, playerId as any, event as any, payload);
      },
    };

    if (choiceId === 'cast_mutate') {
      await requestCastSpellForSocket(
        io,
        fakeSocket,
        { gameId, cardId: mutateCardId, faceIndex },
        { skipPriorityCheck: true, forcedAlternateCostId: 'mutate', skipMutateModePrompt: true }
      );
    } else {
      await requestCastSpellForSocket(
        io,
        fakeSocket,
        { gameId, cardId: mutateCardId, faceIndex },
        { skipPriorityCheck: true, skipMutateModePrompt: true }
      );
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  // ===== MIRRORMIND CROWN (Token replacement) =====
  // Queued from token creation when a Mirrormind Crown is attached and unused this turn.
  // Choice: create the normal tokens, or replace with that many tokens that are copies of the equipped creature.
  if (stepData?.mirrormindCrownTokenReplacementChoice === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'normal' : null) || 'normal';
    const original = stepData?.mirrormindCrownOriginalTokenCreate;
    const equippedCard = stepData?.mirrormindCrownEquippedCreatureCard;

    const controllerId = String(original?.controller || playerId || '').trim();
    const tokenName = String(original?.name || 'Token');
    const tokenCount = Math.max(0, Number(original?.count ?? 0));
    const basePower = original?.basePower;
    const baseToughness = original?.baseToughness;
    const options = original?.options;
    let createdTokenIds: string[] = [];
    let resolvedChoiceId = 'normal';

    if (!controllerId || tokenCount <= 0) {
      debugWarn(1, '[Resolution] mirrormindCrownTokenReplacementChoice: missing controllerId/count');
      return true;
    }

    const ctx: any = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      gameId,
    };

    try {
      if (!response.cancelled && choiceId === 'replace' && equippedCard) {
        const { createCopyTokensOfCard } = await import('../state/modules/counters_tokens.js');
        createdTokenIds = createCopyTokensOfCard(ctx as any, controllerId as any, equippedCard, tokenCount, true);
        resolvedChoiceId = 'replace';

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, controllerId)} uses Mirrormind Crown to create ${tokenCount} token(s) that are copies of ${String(equippedCard?.name || 'the equipped creature')}.`,
          ts: Date.now(),
        });
      } else {
        const { createToken } = await import('../state/modules/counters_tokens.js');
        createdTokenIds = createToken(ctx as any, controllerId as any, tokenName, tokenCount, basePower, baseToughness, options, true);
        resolvedChoiceId = 'normal';

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, controllerId)} creates ${tokenCount} ${tokenName} token(s).`,
          ts: Date.now(),
        });
      }
    } catch (err) {
      debugWarn(1, '[Resolution] mirrormindCrownTokenReplacementChoice failed:', err);
    }

    try {
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const createdTokenIdSet = new Set(createdTokenIds.map((id) => String(id)));
      const createdTokenPermanents = battlefield
        .filter((permanent: any) => permanent && createdTokenIdSet.has(String(permanent.id || '')))
        .map((permanent: any) => JSON.parse(JSON.stringify(permanent)));

      await appendEvent(gameId, (game as any).seq || 0, 'mirrormindCrownTokenReplacementChoiceResolve', {
        playerId: controllerId,
        sourceId: String(stepData?.mirrormindCrownEquipmentId || step.sourceId || '').trim() || undefined,
        sourceName: 'Mirrormind Crown',
        resolvedStepId: String(step.id || '').trim() || undefined,
        choiceId: resolvedChoiceId,
        replaced: resolvedChoiceId === 'replace',
        mirrormindCrownEquipmentId: String(stepData?.mirrormindCrownEquipmentId || step.sourceId || '').trim() || undefined,
        mirrormindCrownEquippedCreatureId: String(stepData?.mirrormindCrownEquippedCreatureId || '').trim() || undefined,
        mirrormindCrownEquippedCreatureCard: equippedCard ? JSON.parse(JSON.stringify(equippedCard)) : undefined,
        mirrormindCrownOriginalTokenCreate: original ? JSON.parse(JSON.stringify(original)) : undefined,
        createdTokenIds,
        createdTokenPermanents,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(mirrormindCrownTokenReplacementChoiceResolve) failed:', err);
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  // ===== COMBAT: OPTIONAL ATTACK TRIGGER MANA PAYMENT (Casal, etc.) =====
  // This is queued from server/socket/combat.ts when an attack trigger has "you may pay {..}. If you do, ...".
  if (stepData?.reflexiveManaPaymentChoice === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'decline' : null) || 'decline';
    const paidAmount = parseReflexivePaymentChoiceAmount(choiceId);
    const paymentUnit = (String(stepData?.reflexiveManaPaymentUnit || 'mana').trim() || 'mana') as any;
    const controllerId = String(stepData?.reflexiveManaPaymentController || playerId);
    const sourceName = String(stepData?.reflexiveManaPaymentSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String(stepData?.reflexiveManaPaymentSourcePermanentId || step.sourceId || '').trim();
    const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const followupText = String(stepData?.reflexiveManaPaymentFollowupText || '').trim();
    const resolvedStepId = String((step as any)?.id || '').trim();

    if (response.cancelled || choiceId === 'decline' || paidAmount <= 0) {
      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveManaPaymentResolve', {
          playerId: controllerId,
          sourceId: sourcePermanentId || undefined,
          sourceName,
          resolvedStepId: resolvedStepId || undefined,
          choiceId,
          paidAmount: 0,
          paymentUnit,
          followupText: followupText || undefined,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(reflexiveManaPaymentResolve decline) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} declined to pay.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    const maxTimes = Math.floor(Number(stepData?.reflexiveManaPaymentMaxTimes || 0));
    if (maxTimes > 0 && paidAmount > maxTimes) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_CHOICE', message: `${sourceName}: you may pay at most ${maxTimes} time(s).` });
      return true;
    }
    const available = getAvailableReflexiveManaAmountFromPool(game.state, controllerId, paymentUnit);
    if (paidAmount > available) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INSUFFICIENT_MANA',
        message: `Cannot pay ${formatReflexiveManaAmount(paidAmount, paymentUnit)}: only ${available} available.`,
      });
      return true;
    }

    consumeReflexiveManaAmountFromPool(game.state, controllerId, paymentUnit, paidAmount);

    const effectText = materializeReflexiveFollowupText(followupText, sourceName, paidAmount);
    const triggerId = uid('trigger');
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const effectData = {
      reflexivePaymentAmount: paidAmount,
      paidManaAmount: paidAmount,
      paymentUnit,
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_mana_payment',
      mandatory: true,
      ...targetMetadata,
      ...sourceContext,
      effectData,
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveManaPaymentResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: resolvedStepId || undefined,
        choiceId,
        paidAmount,
        paymentUnit,
        followupText,
        effect: effectText,
        triggerId,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveManaPaymentResolve) failed:', err);
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_mana_payment',
        mandatory: true,
        ...targetMetadata,
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive mana payment) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} paid ${formatReflexiveManaAmount(paidAmount, paymentUnit)}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData?.reflexiveFixedPaymentChoice === true) {
    const choiceId = extractId(selectedOption) || (response.cancelled ? 'decline' : null) || 'decline';
    const normalizedChoiceId = String(choiceId || '').toLowerCase();
    const controllerId = String(stepData?.reflexiveFixedPaymentController || playerId);
    const sourceName = String(stepData?.reflexiveFixedPaymentSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String(stepData?.reflexiveFixedPaymentSourcePermanentId || step.sourceId || '').trim();
    const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const manaCost = String(stepData?.reflexiveFixedPaymentManaCost || '').trim();
    const lifeAmount = Math.max(0, Math.floor(Number(stepData?.reflexiveFixedPaymentLifeAmount || 0)));
    const paymentText = String(stepData?.reflexiveFixedPaymentText || '').trim();
    const followupText = String(stepData?.reflexiveFixedPaymentFollowupText || '').trim();
    const resolvedStepId = String((step as any)?.id || '').trim();
    const paymentLabel = formatReflexiveFixedPaymentLabel({ paymentText, manaCost, lifeAmount });

    if (response.cancelled || normalizedChoiceId === 'decline' || normalizedChoiceId === 'dont' || normalizedChoiceId === 'no') {
      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveFixedPaymentResolve', {
          playerId: controllerId,
          sourceId: sourcePermanentId || undefined,
          sourceName,
          resolvedStepId: resolvedStepId || undefined,
          choiceId,
          paid: false,
          manaCost: manaCost || undefined,
          lifeAmount: lifeAmount || undefined,
          paymentText: paymentText || undefined,
          followupText: followupText || undefined,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(reflexiveFixedPaymentResolve decline) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} declined to pay.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    if (normalizedChoiceId !== 'pay') {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INVALID_CHOICE',
        message: 'Invalid fixed payment choice.',
      });
      return true;
    }

    if (manaCost) {
      const pool = getOrInitManaPool(game.state, controllerId) as any;
      const payment = validateAndConsumeManaCostFromPool(pool, manaCost, { logPrefix: `[reflexiveFixedPayment:${sourceName}]` });
      if (!payment.ok) {
        const paymentError = String(Reflect.get(payment as object, 'error') || 'Insufficient mana.');
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'INSUFFICIENT_MANA',
          message: paymentError,
        });
        return true;
      }
      broadcastManaPoolUpdate(io, gameId, controllerId, pool as any, `Paid ${manaCost} for ${sourceName}`, game);
    }

    if (lifeAmount > 0) {
      const startingLife = Number((game.state as any)?.startingLife ?? 40);
      const currentLife = Number((game.state as any)?.life?.[controllerId] ?? startingLife);
      const lifeValidationError = validateLifePayment(currentLife, lifeAmount, sourceName, game as GameContext, controllerId);
      if (lifeValidationError) {
        emitToPlayer(io, controllerId as any, 'error', { code: 'INSUFFICIENT_LIFE', message: lifeValidationError });
        return true;
      }

      (game.state as any).life = (game.state as any).life || {};
      const newLife = currentLife - lifeAmount;
      (game.state as any).life[controllerId] = newLife;
      const playerObj = ((game.state as any).players || []).find((entry: any) => String(entry?.id || '') === controllerId);
      if (playerObj) playerObj.life = newLife;
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[controllerId] = Number((game.state as any).lifeLostThisTurn[controllerId] || 0) + lifeAmount;
      queueLifePaymentTriggers(game as any, controllerId, lifeAmount, { sourceId: sourcePermanentId || undefined, sourceName });
    }

    const effectText = materializeReflexiveSourceText(followupText, sourceName);
    const triggerId = uid('trigger');
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const effectData = {
      paidManaCost: manaCost || undefined,
      paidLifeAmount: lifeAmount || undefined,
      paymentText: paymentText || paymentLabel,
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_fixed_payment',
      mandatory: true,
      ...targetMetadata,
      ...sourceContext,
      effectData,
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveFixedPaymentResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: resolvedStepId || undefined,
        choiceId,
        paid: true,
        manaCost: manaCost || undefined,
        lifeAmount: lifeAmount || undefined,
        paymentText: paymentText || undefined,
        followupText,
        effect: effectText,
        triggerId,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveFixedPaymentResolve) failed:', err);
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_fixed_payment',
        mandatory: true,
        ...targetMetadata,
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive fixed payment) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} paid ${paymentLabel}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData?.reflexiveConvertWhenYouDo === true) {
    const convertIsMandatory = (step as any)?.mandatory === true;
    const defaultChoiceId = response.cancelled || !convertIsMandatory ? 'decline' : 'convert';
    const choiceId = String(extractId(selectedOption) || defaultChoiceId).trim().toLowerCase();
    const controllerId = String(stepData?.reflexiveConvertWhenYouDoController || playerId);
    const sourceName = String(stepData?.reflexiveConvertWhenYouDoSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String(stepData?.reflexiveConvertWhenYouDoSourcePermanentId || step.sourceId || '').trim();
    const followupText = String(stepData?.reflexiveConvertWhenYouDoFollowupDescription || '').trim();
    const subjectLabel = String(stepData?.reflexiveConvertWhenYouDoSubject || sourceName).trim() || sourceName;
    const resolvedStepId = String((step as any)?.id || '').trim();
    const queuedSourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);

    if (response.cancelled || choiceId === 'decline' || choiceId === 'no' || choiceId === 'dont') {
      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveConvertResolve', {
          playerId: controllerId,
          sourceId: sourcePermanentId || undefined,
          sourceName,
          resolvedStepId: resolvedStepId || undefined,
          choiceId,
          converted: false,
          followupText: followupText || undefined,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(reflexiveConvertResolve decline) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} declined to convert ${subjectLabel}.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    if (choiceId !== 'convert') {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INVALID_CHOICE',
        message: 'Invalid convert choice.',
      });
      return true;
    }

    const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
    const sourcePermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === sourcePermanentId);
    const cardFaces = Array.isArray(sourcePermanent?.card?.card_faces) ? sourcePermanent.card.card_faces : [];
    if (!sourcePermanent || cardFaces.length < 2) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'SOURCE_NOT_CONVERTIBLE',
        message: `${sourceName} cannot be converted because its source permanent is missing or has no alternate face.`,
      });
      return true;
    }

    const fromFaceIndex = sourcePermanent.transformed === true ? 1 : 0;
    const faceIndex = fromFaceIndex === 1 ? 0 : 1;
    const sourceSnapshot = { ...(sourcePermanent as any), card: { ...((sourcePermanent as any).card || {}) } };
    transformPermanentToFace(sourcePermanent, faceIndex as 0 | 1, ((game as any).ctx || game) as any);

    const effectText = materializeReflexiveSourceText(followupText, sourceName);
    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = queuedSourcePermanentSnapshot || sourceSnapshot;
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const battlefieldTapped = /\bto\s+the\s+battlefield\s+tapped\b/i.test(effectText);
    const effectData = {
      converted: true,
      convertedFromFaceIndex: fromFaceIndex,
      convertedToFaceIndex: faceIndex,
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_convert',
      mandatory: true,
      ...targetMetadata,
      ...(battlefieldTapped ? { battlefieldTapped: true } : null),
      ...sourceContext,
      effectData,
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveConvertResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: resolvedStepId || undefined,
        choiceId,
        converted: true,
        fromFaceIndex,
        faceIndex,
        followupText,
        effect: effectText,
        triggerId,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveConvertResolve) failed:', err);
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_convert',
        mandatory: true,
        ...targetMetadata,
        ...(battlefieldTapped ? { battlefieldTapped: true } : null),
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive convert) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} converted ${subjectLabel}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (isOptionalPaymentPromptStep(stepData)) {
    const choiceId = extractId(selectedOption);
    const oracleIrPaymentCtx = ((game as any).ctx || game) as unknown as GameContext & { io?: Server };
    oracleIrPaymentCtx.gameId = gameId;
    oracleIrPaymentCtx.state = game.state;
    oracleIrPaymentCtx.io = io;
    // Live GameContext already has bumpSeq. Replacing it with game.bumpSeq.bind(game)
    // used to cycle (game.bumpSeq → ctx.bumpSeq → game.bumpSeq) on shock-land pay-2-life.
    if (typeof oracleIrPaymentCtx.bumpSeq !== 'function' && typeof game.bumpSeq === 'function') {
      oracleIrPaymentCtx.bumpSeq = game.bumpSeq.bind(game);
    }
    if (
      resolveOracleIrOptionalPaymentPromptFromResolution(oracleIrPaymentCtx, {
        step: { ...step, ...stepData },
        choiceId: String(choiceId || ''),
        cancelled: Boolean(response.cancelled),
      })
    ) {
      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'optionalPaymentPromptResolve', {
          playerId,
          sourceId: String(stepData?.sourceId || step.sourceId || '').trim() || undefined,
          resolvedStepId: String(step.id || '').trim() || undefined,
          choiceId: String(choiceId || '').trim() || undefined,
          optionalPaymentValidationKind: String(stepData?.optionalPaymentValidationKind || '').trim() || undefined,
          manaCost: String(stepData?.optionalPaymentManaCost || stepData?.manaCost || '').trim() || undefined,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(optionalPaymentPromptResolve oracleIR) failed:', err);
      }
      broadcastGame(io, game, gameId);
      maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
      syncAllOracleIRPlayerZonesAfterResolution(oracleIrPaymentCtx);
      return true;
    }

    const callbackId = String(stepData?.pendingOptionalPaymentCallbackId || '').trim();
    const callback = consumeOptionalPaymentCallback(gameId, callbackId);
    if (!callback) {
      debugWarn(1, `[Resolution] optionalPaymentPrompt: missing callback (${callbackId || 'none'})`);
      return true;
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'optionalPaymentPromptResolve', {
        playerId,
        sourceId: String(stepData?.sourceId || step.sourceId || '').trim() || undefined,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choiceId: String(choiceId || '').trim() || undefined,
        echoChoice: stepData?.echoChoice === true || undefined,
        cumulativeUpkeepChoice: stepData?.cumulativeUpkeepChoice === true || undefined,
        lifeCost: Number(stepData?.lifeCost || 0) || undefined,
        cumulativeUpkeepAddMana: String(stepData?.cumulativeUpkeepAddMana || '').trim() || undefined,
        optionalPaymentValidationKind: String(stepData?.optionalPaymentValidationKind || '').trim() || undefined,
        manaCost: String(stepData?.optionalPaymentManaCost || stepData?.manaCost || '').trim() || undefined,
        energyCost: Number(stepData?.optionalPaymentEnergyAmount || stepData?.energyCost || 0) || undefined,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(optionalPaymentPromptResolve) failed:', err);
    }

    if (!response.cancelled && isOptionalPaymentPayChoice(stepData, choiceId)) {
      await callback.onPay();
      return true;
    }

    await callback.onDecline?.();
    return true;
  }
  return false;
}