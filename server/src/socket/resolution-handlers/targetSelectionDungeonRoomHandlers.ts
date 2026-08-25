/**
 * socket/resolution-handlers/targetSelectionDungeonRoomHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two dungeon-room branches - a room whose cost is a sacrifice
 * (`dungeonRoomPayment.paymentType === 'sacrifice'`, which sacrifices every chosen permanent and
 * persists one sacrificePermanent event each) and `dungeonTargetCreatureEffect` (Forge, Storeroom,
 * Fungi Cavern, Twisted Caverns, Arena; applies through applyEvent when available, otherwise the
 * direct effect, and picks the room-specific chat line).
 * Public entry symbols: handleDungeonRoomSacrificePayment, handleDungeonTargetCreatureEffect.
 *
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import { applyDungeonTargetCreatureEffect } from "../../state/modules/dungeon-effects.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { broadcastGame, getPlayerName } from "../util.js";

/** Dungeon room whose cost is "sacrifice a permanent": apply the chosen sacrifices. */
export async function handleDungeonRoomSacrificePayment(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const controllerId = String(pid || '').trim();
  const sourceName = String(stepAny?.dungeonRoomPayment?.sourceName || step.sourceName || 'Dungeon').trim() || 'Dungeon';
  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as unknown as GameContext;

  const sacrificedNames: string[] = [];
  for (const permanentId of selections) {
    const sacrificedName = sacrificePermanent(ctx, String(permanentId), controllerId);
    if (sacrificedName) {
      sacrificedNames.push(sacrificedName);
    }
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'sacrificePermanent', {
        permanentId: String(permanentId),
        playerId: controllerId,
        resolvedStepId: String(step.id || '').trim(),
        sourceId: String(step.sourceId || '').trim(),
        dungeonRoomPayment: { ...(stepAny.dungeonRoomPayment as Record<string, any>) },
      });
    } catch (err) {
      debugWarn(1, '[resolution] appendEvent(sacrificePermanent) failed for dungeon room payment:', err);
    }
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, controllerId)} sacrifices ${sacrificedNames.join(', ') || 'a permanent'} for ${sourceName}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

/** Dungeon room that targets a creature (Forge, Storeroom, Fungi Cavern, Twisted Caverns, Arena). */
export async function handleDungeonTargetCreatureEffect(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const selectedPermanentId = String(selections[0] || '').trim();
  if (!selectedPermanentId) {
    return;
  }

  const effectData = stepAny.dungeonTargetCreatureEffect;
  const resolvePayload = {
    playerId: String(pid || '').trim(),
    selectedPermanentId,
    resolvedStepId: String(step.id || '').trim(),
    sourceId: String(step.sourceId || '').trim(),
    sourceName: String(step.sourceName || '').trim(),
    dungeonId: String(effectData?.dungeonId || '').trim(),
    currentRoomId: String(effectData?.roomId || '').trim(),
    amount: Number(effectData?.amount || 0),
    counterType: String(effectData?.counterType || '').trim() || undefined,
    powerDelta: Number(effectData?.powerDelta || 0),
    toughnessDelta: Number(effectData?.toughnessDelta || 0),
    grantText: String(effectData?.grantText || '').trim() || undefined,
    goadedByPlayerId: String(pid || '').trim() || undefined,
  };

  let applied = false;
  if (typeof (game as any).applyEvent === 'function') {
    (game as any).applyEvent({ type: 'dungeonTargetCreatureResolve', ...resolvePayload } as any);
    applied = true;
  } else {
    applied = applyDungeonTargetCreatureEffect(game as any, selectedPermanentId, pid as PlayerID, effectData);
  }

  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const targetPermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === selectedPermanentId);
  const targetName = String(targetPermanent?.card?.name || 'target creature');

  try {
    await appendEvent(
      gameId,
      Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
      'dungeonTargetCreatureResolve',
      resolvePayload,
    );
  } catch (err) {
    debugWarn(1, '[resolution] appendEvent(dungeonTargetCreatureResolve) failed:', err);
  }

  const roomId = String(effectData?.roomId || '').trim().toLowerCase();
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: roomId === 'forge'
      ? (applied
          ? `${targetName} gets two +1/+1 counters from ${String(step.sourceName || 'Forge')}.`
          : `${getPlayerName(game, pid)} chose ${targetName} for ${String(step.sourceName || 'Forge')}.`)
      : roomId === 'storeroom'
        ? (applied
            ? `${targetName} gets a +1/+1 counter from ${String(step.sourceName || 'Storeroom')}.`
            : `${getPlayerName(game, pid)} chose ${targetName} for ${String(step.sourceName || 'Storeroom')}.`)
        : roomId === 'fungi_cavern'
          ? (applied
              ? `${targetName} gets -4/-0 until your next turn from ${String(step.sourceName || 'Fungi Cavern')}.`
              : `${getPlayerName(game, pid)} chose ${targetName} for ${String(step.sourceName || 'Fungi Cavern')}.`)
          : roomId === 'twisted_caverns'
            ? (applied
                ? `${targetName} can't attack until your next turn because of ${String(step.sourceName || 'Twisted Caverns')}.`
                : `${getPlayerName(game, pid)} chose ${targetName} for ${String(step.sourceName || 'Twisted Caverns')}.`)
            : (applied
                ? `${targetName} is goaded by ${getPlayerName(game, pid)} from ${String(step.sourceName || 'Arena')}.`
                : `${getPlayerName(game, pid)} chose ${targetName} for ${String(step.sourceName || 'Arena')}.`),
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function' && typeof (game as any).applyEvent !== 'function') {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
