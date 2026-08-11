import type { Server } from 'socket.io';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { broadcastGame } from '../../socket/util.js';
import { queueMayAbilityStep } from '../../socket/may-ability-prompts.js';
import { buildTapTriggeredStackItem, collectTapTriggersForTapEvent, serializeTapTriggeredStackItem } from './triggers/tap-untap.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';

function pushTapTriggerOntoStackCore(
  state: any,
  gameId: string,
  seq: number,
  trigger: any,
  tappedPermanentId: string,
): void {
  state.stack = state.stack || [];
  const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tappedPermanent = Array.isArray(state?.battlefield)
    ? state.battlefield.find((perm: any) => String(perm?.id || '') === String(tappedPermanentId || ''))
    : undefined;
  const sourcePermanent = Array.isArray(state?.battlefield)
    ? state.battlefield.find((perm: any) => String(perm?.id || '') === String(trigger?.permanentId || ''))
    : undefined;
  const stackItem = buildTapTriggeredStackItem(trigger, tappedPermanentId, triggerId, tappedPermanent, sourcePermanent);

  state.stack.push(stackItem);

  if (gameId && gameId !== 'unknown') {
    try {
      appendEvent(gameId, seq, 'pushTriggeredAbility', serializeTapTriggeredStackItem(stackItem));
    } catch (err) {
      debugWarn(1, '[tap-trigger-queue] appendEvent(pushTriggeredAbility tap trigger) failed:', err);
    }
  }
}

function pushTapTriggerOntoStack(
  io: Server,
  game: any,
  gameId: string,
  trigger: any,
  tappedPermanentId: string,
): void {
  pushTapTriggerOntoStackCore(game.state, gameId, (game as any).seq ?? 0, trigger, tappedPermanentId);

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${trigger.cardName} triggers: ${trigger.description}`,
    ts: Date.now(),
  });
}

/**
 * Context-based tap trigger queue for Oracle IR / non-socket paths.
 * Optional "may" triggers are pushed as mandatory=false stack items (no UI prompt).
 */
export function queueTapTriggersForTappedPermanentsOnContext(
  ctx: GameContext,
  tappedPermanentIds: string[],
  tappedByPlayerId: string,
): void {
  if ((ctx as any)?.isReplaying) return;

  const uniqueTappedIds = Array.from(new Set(tappedPermanentIds.map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueTappedIds.length === 0) return;

  const state = (ctx as any).state;
  if (!state) return;

  const orderedTapTriggerEntries = orderTriggersByAPNAP(
    ctx,
    collectTapTriggersForTapEvent(ctx, uniqueTappedIds, tappedByPlayerId).map((entry) => ({
      controllerId: String(entry.trigger.controllerId || tappedByPlayerId),
      trigger: entry.trigger,
      tappedPermanentId: entry.tappedPermanentId,
    })),
  );

  const gameId = String((ctx as any).gameId || '').trim();
  let added = false;
  for (const entry of orderedTapTriggerEntries) {
    pushTapTriggerOntoStackCore(
      state,
      gameId,
      Number(state.seq ?? (ctx as any).seq?.value ?? 0),
      entry.trigger,
      entry.tappedPermanentId,
    );
    added = true;
  }
  if (added) {
    try {
      (ctx as any).bumpSeq?.();
    } catch {
      // best-effort
    }
  }
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
    collectTapTriggersForTapEvent(ctx, uniqueTappedIds, tappedByPlayerId).map((entry) => ({
      controllerId: String(entry.trigger.controllerId || tappedByPlayerId),
      trigger: entry.trigger,
      tappedPermanentId: entry.tappedPermanentId,
    })),
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
