import type { Server } from 'socket.io';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { buildTapTriggeredStackItem, collectTapTriggersForTapEvent, serializeTapTriggeredStackItem } from './triggers/tap-untap.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';

function pushTapTriggerOntoStackCore(
  state: any,
  gameId: string,
  seq: number,
  trigger: any,
  tappedPermanentId: string,
  extras?: { optionalTriggeredAbilityDecisionApplied?: boolean },
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
  if (extras?.optionalTriggeredAbilityDecisionApplied) {
    (stackItem as any).optionalTriggeredAbilityDecisionApplied = true;
  }

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
  extras?: { optionalTriggeredAbilityDecisionApplied?: boolean },
): void {
  pushTapTriggerOntoStackCore(game.state, gameId, (game as any).seq ?? 0, trigger, tappedPermanentId, extras);

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

  // Optional tap triggers go straight onto the stack. Resolve-time optional
  // deferral owns the single may prompt (no pre-stack mayAbilityPrompt).
  let addedStackTrigger = false;
  for (const entry of orderedTapTriggerEntries) {
    pushTapTriggerOntoStack(io, game, gameId, entry.trigger, entry.tappedPermanentId);
    addedStackTrigger = true;
  }

  if (addedStackTrigger && typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
}
