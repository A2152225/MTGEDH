/**
 * Room unlock-door triggered abilities.
 *
 * "When you unlock this door, …" fires when that door becomes unlocked — including
 * when the corresponding half is cast and the door unlocks on the battlefield.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext, RegisteredTrigger } from './types.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { uid } from '../../utils.js';
import { debug } from '../../../utils/debug.js';
import { buildTriggerSourcePermanentSnapshot } from '../triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata } from '../inferTriggeredAbilityTargetMetadata.js';

export interface RoomUnlockDoorTrigger {
  permanentId: string;
  cardName: string;
  triggerType: 'unlock_door';
  description: string;
  effect: string;
  mandatory: boolean;
}

const UNLOCK_DOOR_TIMING_PATTERN = /when you unlock this door,?\s*([^.]+)/i;

export function extractRoomUnlockDoorEffect(oracleText: string): string | null {
  const source = String(oracleText || '');
  const match = source.match(UNLOCK_DOOR_TIMING_PATTERN);
  if (!match) return null;
  const effect = timingTriggerEffect(source, match, 1).trim();
  return effect || null;
}

export function permanentHasUnlockDoorTrigger(card: any): boolean {
  return extractRoomUnlockDoorEffect(String(card?.oracle_text || '')) != null;
}

export function buildRoomUnlockDoorRegisteredTrigger(
  card: any,
  permanentId: string,
  controllerId: string,
): RegisteredTrigger | null {
  const effect = extractRoomUnlockDoorEffect(String(card?.oracle_text || ''));
  if (!effect) return null;

  return {
    id: `${permanentId}_unlock_door`,
    permanentId,
    controllerId,
    cardName: card?.name || 'Unknown',
    timing: 'unlock_door',
    condition: 'unlock_door',
    effect,
    mandatory: !effect.toLowerCase().includes('you may'),
  };
}

export function detectRoomUnlockDoorTriggers(card: any, permanent?: any): RoomUnlockDoorTrigger[] {
  const effect = extractRoomUnlockDoorEffect(String(card?.oracle_text || ''));
  if (!effect) return [];

  const cardName = String(card?.name || 'Unknown');
  return [{
    permanentId: String(permanent?.id || ''),
    cardName,
    triggerType: 'unlock_door',
    description: effect,
    effect,
    mandatory: !effect.toLowerCase().includes('you may'),
  }];
}

/** @deprecated Use detectRoomUnlockDoorTriggers */
export const detectRoomTriggers = detectRoomUnlockDoorTriggers;

function shouldFireUnlockDoorTriggerOnEnter(permanent: any): boolean {
  if (permanent?.doorLocked === true) return false;
  if (permanent?.skipUnlockDoorTriggerOnEnter === true) return false;
  return true;
}

export function queueRoomUnlockDoorTriggersOnEnter(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  const state = (ctx as any).state;
  if (!state || !permanent?.card) return;
  if (!shouldFireUnlockDoorTriggerOnEnter(permanent)) return;

  const triggers = detectRoomUnlockDoorTriggers(permanent.card, permanent);
  if (triggers.length === 0) return;

  state.stack = state.stack || [];

  for (const trigger of triggers) {
    const effectText = String(trigger.effect || trigger.description || '').trim();
    const enrichedMetadata = inferTriggeredAbilityTargetMetadata(effectText, {
      gameState: state,
      controllerId: String(controller),
      sourceName: String(trigger.cardName || permanent.card?.name || ''),
      sourcePermanent: permanent,
    } as any);

    const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(permanent);
    const stackItem = {
      id: uid('trigger'),
      type: 'triggered_ability',
      controller,
      source: permanent.id,
      sourceName: trigger.cardName || permanent.card?.name,
      description: `When you unlock this door, ${effectText}`,
      triggerType: 'unlock_door',
      mandatory: trigger.mandatory,
      permanentId: permanent.id,
      effect: effectText,
      requiresTarget: enrichedMetadata.requiresTarget === true,
      targetType: enrichedMetadata.targetType,
      targetConstraint: enrichedMetadata.targetConstraint,
      needsTargetSelection: enrichedMetadata.requiresTarget === true,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    } as any;

    state.stack.push(stackItem);
    debug(2, `[queueRoomUnlockDoorTriggersOnEnter] queued ${trigger.cardName}: ${effectText}`);
  }
}
