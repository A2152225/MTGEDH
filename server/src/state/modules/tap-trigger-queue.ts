import type { Server } from 'socket.io';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { broadcastGame, getPlayerName } from '../../socket/util.js';
import { queueMayAbilityStep } from '../../socket/may-ability-prompts.js';
import { buildTapTriggeredStackItem, getTapTriggers, serializeTapTriggeredStackItem } from './triggers/tap-untap.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';

function pushTapTriggerOntoStack(
  io: Server,
  game: any,
  gameId: string,
  trigger: any,
  tappedPermanentId: string,
): void {
  game.state.stack = game.state.stack || [];
  const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tappedPermanent = Array.isArray(game.state?.battlefield)
    ? game.state.battlefield.find((perm: any) => String(perm?.id || '') === String(tappedPermanentId || ''))
    : undefined;
  const sourcePermanent = Array.isArray(game.state?.battlefield)
    ? game.state.battlefield.find((perm: any) => String(perm?.id || '') === String(trigger?.permanentId || ''))
    : undefined;
  const stackItem = buildTapTriggeredStackItem(trigger, tappedPermanentId, triggerId, tappedPermanent, sourcePermanent);

  game.state.stack.push(stackItem);

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeTapTriggeredStackItem(stackItem));
  } catch (err) {
    debugWarn(1, '[tap-trigger-queue] appendEvent(pushTriggeredAbility tap trigger) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${trigger.cardName} triggers: ${trigger.description}`,
    ts: Date.now(),
  });
}

export function queueTapTriggersForTappedPermanents(
  io: Server,
  game: any,
  gameId: string,
  tappedPermanentIds: string[],
  tappedByPlayerId: string,
): void {
  const uniqueTappedIds = Array.from(new Set(tappedPermanentIds.map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueTappedIds.length === 0) return;

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const ctx = {
    state: game.state,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
  } as any;

  const orderedTapTriggerEntries = orderTriggersByAPNAP(
    ctx,
    uniqueTappedIds.flatMap((tappedPermanentId) => {
      const tappedPermanent = battlefield.find((perm: any) => perm && String(perm.id) === tappedPermanentId);
      if (!tappedPermanent) return [];

      const tappedPermanentController = String(tappedPermanent.controller || tappedByPlayerId || '').trim();
      return getTapTriggers(ctx, tappedPermanent, tappedPermanentController).map((trigger) => ({
        controllerId: String(trigger.controllerId || tappedPermanentController),
        trigger,
        tappedPermanentId,
      }));
    }),
  );

  let addedStackTrigger = false;
  for (const entry of orderedTapTriggerEntries) {
    const trigger = entry.trigger;
    const tappedPermanentId = entry.tappedPermanentId;

    if (trigger.mandatory === false) {
      queueMayAbilityStep(
        io,
        gameId,
        game,
        String(trigger.controllerId),
        String(trigger.cardName || 'Triggered ability'),
        String(trigger.effect || trigger.description || '').trim(),
        String(trigger.description || trigger.effect || '').trim() || undefined,
        async () => {
          pushTapTriggerOntoStack(io, game, gameId, trigger, tappedPermanentId);
          if (typeof game.bumpSeq === 'function') game.bumpSeq();
          broadcastGame(io, game, gameId);
        },
      );
      continue;
    }

    pushTapTriggerOntoStack(io, game, gameId, trigger, tappedPermanentId);
    addedStackTrigger = true;
  }

  if (addedStackTrigger && typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
}
