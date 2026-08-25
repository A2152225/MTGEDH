/**
 * socket/resolution-handlers/manaPaymentChoicePrefixHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse, MANA_PAYMENT_CHOICE case).
 * Cluster moved: the two self-contained prompt shapes that open that case - ward payment
 * (`wardPayment`) and "sacrifice this unless you pay" (`sacrificeUnlessPayChoice`).
 * Public entry symbols: tryHandleManaPaymentChoiceWardAndSacrificePrefix.
 *
 * Returns true when the original switch case would have hit `break` here, false when the
 * remaining MANA_PAYMENT_CHOICE branches in resolution.ts still need to run.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { emitWardCounterOutcome, tryCounterByWard } from "../resolutionWardUtils.js";
import { broadcastGame, broadcastManaPoolUpdate, emitToPlayer, getPlayerName } from "../util.js";
import {
  applySelectedManaPaymentForResolutionCost,
  applyWardManaPaymentSelection,
  extractResolutionPaymentItems,
} from "./resolutionManaPaymentApplication.js";

/** MANA_PAYMENT_CHOICE prefix: ward payment and sacrifice-unless-pay prompts. */
export async function tryHandleManaPaymentChoiceWardAndSacrificePrefix(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const pid = response.playerId;
  const stepData = step as any;

  if (stepData.wardPayment === true) {
    const triggeredBy = String(stepData?.wardTriggeredBy || stepData?.sourceId || '').trim();
    const wardController = String(stepData?.wardPermanentController || 'system');
    const wardName = String(stepData?.wardPermanentName || step.sourceName || 'Ward');
    const wardCost = String(stepData?.wardCost || stepData?.manaCost || '').trim();
    const paymentType = String(stepData?.wardPaymentType || '').trim().toLowerCase() || (/\{[^}]+\}/.test(wardCost) ? 'mana' : '');

    if (response.cancelled) {
      const outcome = tryCounterByWard(game, gameId, triggeredBy, wardController);
      emitWardCounterOutcome(io, game, gameId, wardName, pid, outcome, 'declined to pay ward');
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    if (paymentType === 'mana') {
      const payment = extractResolutionPaymentItems(response.selections as any);
      const applied = applyWardManaPaymentSelection(game, pid, wardCost, payment);
      if (!applied.ok) {
        const appliedError = applied as { ok: false; code: string; message: string };
        emitToPlayer(io, pid, 'error', {
          code: appliedError.code,
          message: appliedError.message,
        });

        const outcome = tryCounterByWard(game, gameId, triggeredBy, wardController);
        emitWardCounterOutcome(io, game, gameId, wardName, pid, outcome, "couldn't pay ward");
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        broadcastGame(io, game, gameId);
        return true;
      }

      try {
        // Tap/mana-pool mutations already persisted by applyWardManaPaymentSelection
        // (permanent_tapped + addManaToPool/removeManaFromPool). Parent keeps sacrifice evidence only.
        appendEvent(gameId, (game as any).seq ?? 0, 'wardPaymentResolve', {
          playerId: pid,
          stepId: String((step as any)?.id || ''),
          sourceId: triggeredBy,
          wardCost,
          wardPermanentId: String(stepData?.wardPermanentId || ''),
          wardPermanentName: wardName,
          wardPaymentType: 'mana',
          sacrificedPermanents: applied.sacrificedPermanents,
          paymentMutationsPersistedSeparately: true,
        });
      } catch {
        // ignore persistence failures for ward payment resolution
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${wardName}: ${getPlayerName(game, pid)} paid ward ${wardCost}.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }
  }

  if (stepData.sacrificeUnlessPayChoice === true) {
    const permanentId = String(stepData?.permanentId || step.sourceId || '').trim();
    const manaCost = String(stepData?.manaCost || '{1}').trim();
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const permanentIndex = battlefield.findIndex((entry: any) => entry && String(entry.id) === permanentId);
    if (permanentIndex === -1) {
      debugWarn(1, `[Resolution] sacrificeUnlessPayChoice: permanent not found (${permanentId})`);
      return true;
    }

    const permanent = battlefield[permanentIndex];
    const cardName = String(stepData?.cardName || permanent?.card?.name || step.sourceName || 'Permanent');

    if (response.cancelled) {
      sacrificePermanent(game as any, permanentId, pid);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} sacrifices ${cardName} (didn't pay ${manaCost}).`,
        ts: Date.now(),
      });

      try {
        await appendEvent(gameId, (game as any).seq || 0, 'sacrificeUnlessPayChoice', {
          playerId: pid,
          resolvedStepId: String((step as any).id || '').trim(),
          permanentId,
          payMana: false,
          manaCost,
          cardName,
        });
      } catch (e) {
        debugWarn(1, '[Resolution] Failed to persist sacrificeUnlessPayChoice event:', e);
      }

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return true;
    }

    const payment = extractResolutionPaymentItems(response.selections as any);
    const applied = applySelectedManaPaymentForResolutionCost(game, pid, manaCost, payment);
    if (!applied.ok) {
      const appliedError = applied as { ok: false; code: string; message: string };
      emitToPlayer(io, pid as any, 'error', {
        code: appliedError.code,
        message: appliedError.message,
      });
      return true;
    }

    broadcastManaPoolUpdate(io, gameId, pid, ((game.state as any)?.manaPool?.[pid] || {}) as any, `Paid ${manaCost} for ${cardName}`, game);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} pays ${manaCost} for ${cardName}.`,
      ts: Date.now(),
    });

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'sacrificeUnlessPayChoice', {
        playerId: pid,
        resolvedStepId: String((step as any).id || '').trim(),
        permanentId,
        payMana: true,
        manaCost,
        cardName,
        sacrificedPaymentPermanents: applied.sacrificedPermanents,
        paymentMutationsPersistedSeparately: true,
      });
    } catch (e) {
      debugWarn(1, '[Resolution] Failed to persist sacrificeUnlessPayChoice event:', e);
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
