/**
 * triggerUntapAllUtils.ts
 *
 * Generic trigger-effect execute for "untap all lands/creatures/permanents you control"
 * (Bear Umbra granted attack text, Nature's Will, Wilderness Reclamation, etc.)
 * and "untap all creatures" with no controller restriction (Intruder Alarm).
 * Entry: tryApplyUntapAllYouControlTrigger
 *
 * Same-clause rider: "tap all lands that player / defending player / they control"
 * (Nature's Will official: tap the damaged player's lands, then untap yours).
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { executeUntapTrigger, queueBecomesUntappedTriggers } from './triggers/tap-untap.js';

function resolveReferencedPlayerId(triggerItem: any): string {
  return String(
    triggerItem?.damagedPlayerId
    || triggerItem?.defendingPlayer
    || triggerItem?.targetPlayer
    || triggerItem?.thatPlayerId
    || triggerItem?.effectData?.damagedPlayerId
    || ''
  ).trim();
}

function tapLandsForPlayer(ctx: GameContext, playerId: string): void {
  const battlefield = ((ctx.state as any)?.battlefield || []) as any[];
  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== playerId) continue;
    const typeLine = String(permanent.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('land') || permanent.tapped) continue;
    permanent.tapped = true;
  }
}

export function tryApplyUntapAllYouControlTrigger(
  ctx: GameContext,
  controller: PlayerID,
  description: string,
  triggerItem?: any,
): boolean {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  let untapType: 'lands' | 'creatures' | 'all' | null = null;
  let untapAllCreatures = false;
  if (/untap all lands you control/i.test(text)) {
    untapType = 'lands';
  } else if (/untap all creatures you control/i.test(text)) {
    untapType = 'creatures';
  } else if (/untap all permanents you control/i.test(text)) {
    untapType = 'all';
  } else if (/untap all creatures\b/i.test(text)) {
    untapAllCreatures = true;
  }
  if (!untapType && !untapAllCreatures) return false;

  if (untapAllCreatures) {
    const battlefield = ((ctx.state as any)?.battlefield || []) as any[];
    for (const permanent of battlefield) {
      if (!permanent || !permanent.tapped) continue;
      const typeLine = String(permanent.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      permanent.tapped = false;
      queueBecomesUntappedTriggers(ctx, permanent);
    }
    if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
  } else if (untapType) {
    executeUntapTrigger(ctx, {
      permanentId: '',
      cardName: '',
      controllerId: String(controller || ''),
      triggerOn: 'attack',
      untapType,
      effect: untapType === 'all'
        ? 'Untap all permanents you control'
        : `Untap all ${untapType} you control`,
    });
  }

  if (/tap all lands (?:that player|the defending player|defending player|they) controls/i.test(text)) {
    const thatPlayerId = resolveReferencedPlayerId(triggerItem);
    if (thatPlayerId) tapLandsForPlayer(ctx, thatPlayerId);
  }
  return true;
}
