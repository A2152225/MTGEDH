/**
 * Batch 13: let the controller order an evoke sacrifice trigger against the same
 * permanent's other ETB triggers (e.g. evoke Mulldrifter / Solitude) through the
 * existing TRIGGER_ORDER resolution step. The UI already renders TRIGGER_ORDER.
 */
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { persistTurnStepTriggerOrderStep } from './turn-handlers/turnStepTriggerPersist.js';
import { EVOKE_SACRIFICE_TRIGGER_TYPE } from './evokeKeyword.js';

/** Stack items (top-down order irrelevant) the controller may order together with the evoke trigger. */
export function collectEvokeOrderableTriggers(state: any, permanentId: string, controller: string): any[] {
  const stack: any[] = Array.isArray(state?.stack) ? state.stack : [];
  const evokeIdx = stack.findIndex(
    (s: any) => s?.triggerType === EVOKE_SACRIFICE_TRIGGER_TYPE && String(s?.source || '') === permanentId,
  );
  if (evokeIdx < 0) return [];
  const out: any[] = [];
  for (let i = evokeIdx; i < stack.length; i++) {
    const s = stack[i];
    if (!s || s.type !== 'triggered_ability') continue;
    if (String(s.controller || '') !== controller) continue;
    out.push(s);
  }
  return out;
}

export function maybeQueueEvokeTriggerOrderStep(ctx: GameContext, permanent: any, controller: string): boolean {
  try {
    const state = ctx.state as any;
    const permanentId = String(permanent?.id || '');
    if (!permanentId || !controller) return false;
    const items = collectEvokeOrderableTriggers(state, permanentId, controller);
    if (items.length < 2) return false;
    const gameId = String((ctx as any).gameId || '').trim();
    if (!gameId || gameId === 'unknown') return false;
    if ((ctx as any).isReplaying) return false;

    const ids = new Set(items.map((s: any) => String(s.id)));
    const queue: any = ResolutionQueueManager.getQueue(gameId);
    const existing = (queue?.steps || []).some(
      (st: any) =>
        st?.type === ResolutionStepType.TRIGGER_ORDER &&
        String(st.playerId) === controller &&
        Array.isArray(st.triggers) &&
        st.triggers.some((t: any) => ids.has(String(t?.id))),
    );
    if (existing) return false;

    const triggers = items.map((s: any) => ({
      id: String(s.id),
      sourceName: String(s.sourceName || s.card?.name || 'Trigger'),
      effect: String(s.description || s.effect || ''),
      ...(s.card?.image_uris?.small ? { imageUrl: s.card.image_uris.small } : {}),
    }));
    const description = `Order ${triggers.length} triggers from ${permanent?.card?.name || 'the evoked permanent'} (evoke sacrifice and enter triggers)`;
    const step: any = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TRIGGER_ORDER,
      playerId: controller,
      description,
      mandatory: true,
      triggers,
      requireAll: true,
    } as any);
    persistTurnStepTriggerOrderStep(ctx, {
      ...(step || {}),
      type: ResolutionStepType.TRIGGER_ORDER,
      playerId: controller,
      description,
      mandatory: true,
      triggers,
      requireAll: true,
    }, 'evoke');
    debug(2, `[evoke] queued TRIGGER_ORDER for ${triggers.length} triggers (${permanentId})`);
    return true;
  } catch (err) {
    debugWarn(1, '[evoke] failed to queue trigger order step:', err);
    return false;
  }
}