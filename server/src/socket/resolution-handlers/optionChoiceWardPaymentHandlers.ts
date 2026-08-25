/**
 * socket/resolution-handlers/optionChoiceWardPaymentHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the whole `wardPayment` OPTION_CHOICE branch - the pay/decline prompt a player gets
 * when they target a permanent with ward. Declining (or cancelling, or being unable to pay) counters
 * the spell or ability; paying either consumes mana / life on the spot, or queues the follow-up
 * DISCARD_SELECTION or sacrifice TARGET_SELECTION that carries the ward metadata forward.
 * Public entry symbols: handleWardPaymentOptionChoice.
 *
 * The branch always returned, so the call site is `await handler(...); return;`. The nested
 * `parseCountToken` closure came along; it only served this branch.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { GameContext } from "../../state/context.js";
import { counterStackItem } from "../../state/modules/stack-mechanics.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import {
  ResolutionQueueManager,
  ResolutionStepStatus,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** Ward: pay the ward cost (mana + common non-mana) or let the spell/ability be countered. */
export async function handleWardPaymentOptionChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(selectedOption);
  const wardCost = String(stepData?.wardCost || '').trim().replace(/[\s\t]+/g, ' ').replace(/[.;,]+$/g, '').trim();
  const paymentTypeRaw = String(stepData?.wardPaymentType || '').trim().toLowerCase();
  const paymentType = paymentTypeRaw || (/\{[^}]+\}/.test(wardCost) ? 'mana' : '');
  const wardPermanentName = String(stepData?.wardPermanentName || step.sourceName || 'Ward');
  const wardPermanentController = String(stepData?.wardPermanentController || 'system');
  const triggeredBy = String(stepData?.wardTriggeredBy || step.sourceId || '').trim();

  // Treat cancellation like declining to pay ward.
  if (response.cancelled) {
    if (!triggeredBy) {
      debugWarn(1, `[Resolution] wardPayment: cancelled but missing triggeredBy/sourceId`);
      return;
    }

    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as unknown as GameContext;

    counterStackItem(ctx, triggeredBy, wardPermanentController);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${wardPermanentName}: ${getPlayerName(game, playerId)} declined to pay ward and the spell/ability was countered.`,
      ts: Date.now(),
    });
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const parseCountToken = (token: string): number | null => {
    const raw = String(token || '').trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'a' || raw === 'an' || raw === 'one') return 1;
    if (raw === 'two') return 2;
    if (raw === 'three') return 3;
    if (raw === 'four') return 4;
    if (raw === 'five') return 5;
    if (raw === 'six') return 6;
    if (raw === 'seven') return 7;
    if (raw === 'eight') return 8;
    if (raw === 'nine') return 9;
    if (raw === 'ten') return 10;
    if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
    return null;
  };

  if (!choiceId) {
    debugWarn(1, `[Resolution] wardPayment: missing choice id`);
    return;
  }

  if (!triggeredBy) {
    debugWarn(1, `[Resolution] wardPayment: missing triggeredBy/sourceId`);
    return;
  }

  // If the spell/ability was already countered/removed, this ward payment is moot.
  const stackItem = (game.state?.stack || []).find((s: any) => s && s.id === triggeredBy);
  if (!stackItem) {
    debug(2, `[Resolution] wardPayment: stack item missing (${triggeredBy}); skipping`);
    return;
  }

  const ctx = {
    state: game.state,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    zones: game.state?.zones,
    gameId,
  } as unknown as GameContext;

  if (choiceId === 'decline_ward_cost') {
    counterStackItem(ctx, triggeredBy, wardPermanentController);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${wardPermanentName}: ${getPlayerName(game, playerId)} declined to pay ward and the spell/ability was countered.`,
      ts: Date.now(),
    });
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (choiceId !== 'pay_ward_cost') {
    debugWarn(1, `[Resolution] wardPayment: unexpected choice '${choiceId}'`);
    return;
  }

  if (paymentType === 'mana') {
    if (!/\{[^}]+\}/.test(wardCost)) {
      emitToPlayer(io, playerId, 'error', {
        code: 'UNSUPPORTED_COST',
        message: `Unsupported ward cost (${wardCost || 'unknown'}).`,
      });
      counterStackItem(ctx, triggeredBy, wardPermanentController);
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    try {
      const { parseManaCost, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, consumeManaFromPool } = await import('../util.js');
      const parsed = parseManaCost(wardCost);
      const pool = getOrInitManaPool(game.state, playerId) as any;
      const totalAvailable = calculateTotalAvailableMana(pool, undefined);
      const validationError = validateManaPayment(totalAvailable, parsed.colors, parsed.generic);

      if (validationError) {
        emitToPlayer(io, playerId, 'error', {
          code: 'INSUFFICIENT_MANA',
          message: validationError,
        });
        counterStackItem(ctx, triggeredBy, wardPermanentController);
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${wardPermanentName}: ${getPlayerName(game, playerId)} couldn't pay ward and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        broadcastGame(io, game, gameId);
        return;
      }

      consumeManaFromPool(pool, parsed.colors, parsed.generic);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${wardPermanentName}: ${getPlayerName(game, playerId)} paid ward ${wardCost}.`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
    } catch (err) {
      debugError(1, `[Resolution] wardPayment: failed to process mana payment`, err);
      emitToPlayer(io, playerId, 'error', {
        code: 'UNSUPPORTED_COST',
        message: `Failed to process ward payment (${wardCost || 'unknown'}).`,
      });
      counterStackItem(ctx, triggeredBy, wardPermanentController);
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
    }

    return;
  }

  if (paymentType === 'life') {
    const lifeAmount = Number(stepData?.wardLifeAmount || 0) || ((): number => {
      const m = wardCost.toLowerCase().match(/\bpay\s+(\w+)\s+life\b/);
      const parsed = m ? parseCountToken(m[1]) : null;
      return parsed || 0;
    })();

    if (!lifeAmount || lifeAmount <= 0) {
      emitToPlayer(io, playerId, 'error', {
        code: 'UNSUPPORTED_COST',
        message: `Unsupported ward cost (${wardCost || 'unknown'}).`,
      });
      counterStackItem(ctx, triggeredBy, wardPermanentController);
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    const startingLife = game.state.startingLife || 40;
    game.state.life = game.state.life || {};
    const currentLife = game.state.life?.[playerId] ?? startingLife;
    if (currentLife < lifeAmount) {
      emitToPlayer(io, playerId, 'error', {
        code: 'INSUFFICIENT_LIFE',
        message: `Not enough life to pay ${lifeAmount}.`,
      });
      counterStackItem(ctx, triggeredBy, wardPermanentController);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${wardPermanentName}: ${getPlayerName(game, playerId)} couldn't pay ward and the spell/ability was countered.`,
        ts: Date.now(),
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    game.state.life[playerId] = currentLife - lifeAmount;

    // Track life lost this turn.
    try {
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(playerId)] =
        ((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + Number(lifeAmount || 0);
    } catch {}
    queueLifePaymentTriggers(game as any, String(playerId), Number(lifeAmount || 0), { sourceName: wardPermanentName || 'Ward' });
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${wardPermanentName}: ${getPlayerName(game, playerId)} paid ward—${wardCost}.`,
      ts: Date.now(),
    });
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (paymentType === 'discard') {
    const discardCount = Number(stepData?.wardDiscardCount || 0) || ((): number => {
      const m = wardCost.toLowerCase().match(/\bdiscard\s+(\w+)\s+cards?\b/);
      const parsed = m ? parseCountToken(m[1]) : null;
      return parsed || 0;
    })();

    const zones = game.state?.zones?.[playerId];
    const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
    if (!discardCount || discardCount <= 0 || hand.length < discardCount) {
      emitToPlayer(io, playerId, 'error', {
        code: 'INSUFFICIENT_CARDS',
        message: `Not enough cards in hand to discard ${discardCount || 1}.`,
      });
      counterStackItem(ctx, triggeredBy, wardPermanentController);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${wardPermanentName}: ${getPlayerName(game, playerId)} couldn't pay ward and the spell/ability was countered.`,
        ts: Date.now(),
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    const toHandCards = (cards: any[]) =>
      cards.map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
        colors: c.colors,
      }));

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: `${wardPermanentName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'} to pay ward`,
      mandatory: true,
      sourceName: wardPermanentName,
      discardCount,
      hand: toHandCards(hand),
      wardPayment: true,
      wardPaymentType: 'discard',
      wardCost: wardCost,
      wardTriggeredBy: triggeredBy,
      wardPermanentName,
      wardPermanentController,
    } as any);

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (paymentType === 'sacrifice') {
    const sacCount = Number(stepData?.wardSacrificeCount || 0) || 0;
    const sacKind = String(stepData?.wardSacrificeKind || '').trim().toLowerCase();
    const battlefield = (game.state?.battlefield || []) as any[];
    const eligible = battlefield
      .filter((p: any) => p && String(p.controller || '') === playerId)
      .filter((p: any) => {
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (sacKind === 'permanent') return true;
        if (sacKind === 'nonland permanent') return !tl.includes('land');
        return sacKind ? tl.includes(sacKind) : false;
      })
      .map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Permanent',
        description: p.card?.type_line || 'permanent',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (!sacCount || sacCount <= 0 || eligible.length < sacCount) {
      emitToPlayer(io, playerId, 'error', {
        code: 'INSUFFICIENT_PERMANENTS',
        message: `Not enough permanents to sacrifice to pay ward.`,
      });
      counterStackItem(ctx, triggeredBy, wardPermanentController);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${wardPermanentName}: ${getPlayerName(game, playerId)} couldn't pay ward and the spell/ability was countered.`,
        ts: Date.now(),
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: playerId as any,
      status: ResolutionStepStatus.PENDING,
      sourceId: triggeredBy,
      sourceName: wardPermanentName,
      description: `${wardPermanentName}: Sacrifice ${sacCount} ${sacKind} to pay ward (required)`,
      mandatory: true,
      createdAt: Date.now(),
      priority: 0,
      validTargets: eligible,
      targetTypes: ['permanent'],
      minTargets: sacCount,
      maxTargets: sacCount,
      targetDescription: sacKind,
      action: 'sacrifice_selected_permanents',
      wardPayment: true,
      wardPaymentType: 'sacrifice',
      wardCost: wardCost,
      wardTriggeredBy: triggeredBy,
      wardPermanentName,
      wardPermanentController,
    } as any);

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  emitToPlayer(io, playerId, 'error', {
    code: 'UNSUPPORTED_COST',
    message: `Unsupported ward cost (${wardCost || 'unknown'}).`,
  });
  counterStackItem(ctx, triggeredBy, wardPermanentController);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
