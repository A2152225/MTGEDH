/**
 * "Whenever ~ becomes unattached from a permanent, ..." (Grafted Exoskeleton, Stitcher's Graft,
 * Captain's Hook, ...). Detected by diffing each watching attachment's host between SBA passes,
 * so every path that changes attachment (re-equip, unattach, host leaving, the attachment itself
 * leaving - CR 603.10a looks back in time) triggers without per-path hooks.
 */
import type { GameContext } from '../context.js';
import { queueGenericTriggeredAbility } from './triggerEmissionFamilyUtils.js';
import { permanentHasTriggeredAbilities } from './triggers/triggeredAbilitySuppression.js';

type Watch = { hostId: string; hostName: string; controller: string; cardName: string; effect: string; mandatory: boolean };

const UNATTACHED_RE = /\b(?:when|whenever)\s+(?:this (?:equipment|aura|permanent|artifact)|~|(.+?))\s+becomes unattached from (?:a|that) (?:permanent|creature),?\s*([^.]+)/i;

export function becomesUnattachedEffect(card: any): string | null {
  const oracle = String(card?.oracle_text || '');
  if (!/becomes unattached/i.test(oracle)) return null;
  const m = UNATTACHED_RE.exec(oracle);
  if (!m) return null;
  const name = String(card?.name || '').trim().toLowerCase();
  if (m[1] && name && m[1].trim().toLowerCase() !== name && !name.startsWith(m[1].trim().toLowerCase())) return null;
  return m[2].trim();
}

function hostIdOf(perm: any): string {
  return String(perm?.attachedTo || '').trim();
}

/** Returns the number of triggers queued. Always refreshes the watch map (also while replaying). */
export function queueBecomesUnattachedTriggers(ctx: GameContext): number {
  const state = (ctx as any)?.state;
  if (!state) return 0;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const prev: Record<string, Watch> = state._attachmentHostWatch || {};
  const next: Record<string, Watch> = {};
  const onBattlefield = new Map<string, any>();
  let hasWatcher = Object.keys(prev).length > 0;
  for (const perm of battlefield) {
    const id = String(perm?.id || '');
    if (!id) continue;
    onBattlefield.set(id, perm);
    if (!hasWatcher && perm?.card && /becomes unattached/i.test(String(perm.card.oracle_text || ''))) hasWatcher = true;
  }
  if (!hasWatcher) return 0;

  const fired: Array<{ id: string; watch: Watch }> = [];
  for (const [id, watch] of Object.entries(prev)) {
    const perm = onBattlefield.get(id);
    const nowHost = perm ? hostIdOf(perm) : '';
    const hostStillThere = nowHost && onBattlefield.has(nowHost);
    if (!perm || !hostStillThere || nowHost !== watch.hostId) fired.push({ id, watch });
  }
  for (const [id, perm] of onBattlefield) {
    const hostId = hostIdOf(perm);
    if (!hostId || !onBattlefield.has(hostId)) continue;
    const effect = becomesUnattachedEffect(perm.card);
    if (!effect) continue;
    next[id] = {
      hostId,
      hostName: String(onBattlefield.get(hostId)?.card?.name || ''),
      controller: String(perm.controller || ''),
      cardName: String(perm.card?.name || ''),
      effect,
      mandatory: !/\byou may\b/i.test(effect),
    };
  }
  state._attachmentHostWatch = next;
  if ((ctx as any)?.isReplaying) return 0;

  let queued = 0;
  for (const { id, watch } of fired) {
    const perm = onBattlefield.get(id);
    if (perm && !permanentHasTriggeredAbilities(perm, state, { event: 'other' } as any)) continue;
    const item = queueGenericTriggeredAbility(ctx, {
      permanentId: id,
      cardName: watch.cardName,
      controllerId: watch.controller,
      description: watch.effect,
      effect: watch.effect,
      mandatory: watch.mandatory,
      ...(perm ? {} : { _sourceSnapshot: { id, controller: watch.controller, card: { name: watch.cardName } } }),
    }, 'equipment_unattached', {
      equipmentId: id,
      attachedToId: watch.hostId,
      attachedToName: watch.hostName,
      unattachedFromId: watch.hostId,
    });
    if (item) queued++;
  }
  return queued;
}