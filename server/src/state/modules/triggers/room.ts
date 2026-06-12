/**
 * Room unlock-door triggered abilities and door lock state.
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
import { ResolutionStepType } from '../../resolution/index.js';
import { queueResolveTopOfStackPrompt } from '../resolutionPromptEvents.js';

export interface RoomUnlockDoorTrigger {
  permanentId: string;
  cardName: string;
  triggerType: 'unlock_door';
  description: string;
  effect: string;
  mandatory: boolean;
}

const UNLOCK_DOOR_TIMING_PATTERN = /when you unlock this door,?\s*([^.]+)/i;

const ROOM_UNLOCK_EFFECT_PATTERNS = [
  /unlock a locked door of up to one target room you control/i,
  /unlock a locked door of target room you control/i,
  /lock or unlock a door of target room you control/i,
] as const;

export function isRoomPermanent(permanent: any): boolean {
  return /\broom\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || ''));
}

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

export function isRoomDoorLocked(permanent: any): boolean {
  return permanent?.doorLocked === true;
}

/**
 * Initialize door lock state when a Room permanent enters.
 * Doors with unlock triggers start locked unless already stamped.
 */
export function initializeRoomDoorStateForEnter(permanent: any): void {
  if (!isRoomPermanent(permanent)) return;
  if (permanent.doorLocked != null) return;

  if (permanentHasUnlockDoorTrigger(permanent.card)) {
    permanent.doorLocked = true;
    return;
  }

  permanent.doorLocked = false;
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

function findBattlefieldPermanent(ctx: GameContext, permanentId: string): any | null {
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((entry: any) => String(entry?.id || '') === String(permanentId || '')) || null;
}

function resolveRoomTargetPermanentId(
  ctx: GameContext,
  triggerItem?: any,
): string | null {
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const targetIds = Array.isArray(triggerItem?.targets)
    ? triggerItem.targets.map((target: unknown) => String(target || '').trim()).filter(Boolean)
    : [];

  for (const targetId of targetIds) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === targetId);
    if (permanent && isRoomPermanent(permanent)) {
      return targetId;
    }
  }

  const sourceId = String(triggerItem?.permanentId || triggerItem?.source || '').trim();
  if (!sourceId) return null;
  const sourcePermanent = battlefield.find((entry: any) => String(entry?.id || '') === sourceId);
  if (sourcePermanent && isRoomPermanent(sourcePermanent)) {
    return sourceId;
  }

  return null;
}

function queueRoomUnlockDoorTriggers(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  const state = (ctx as any).state;
  if (!state || !permanent?.card) return;

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
    debug(2, `[queueRoomUnlockDoorTriggers] queued ${trigger.cardName}: ${effectText}`);
  }
}

/**
 * Unlock a Room door and queue its "When you unlock this door" triggers once.
 * Returns true when the door transitioned from locked to unlocked.
 */
export function unlockRoomDoorPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): boolean {
  if (!permanent || !isRoomPermanent(permanent)) return false;
  if (!permanentHasUnlockDoorTrigger(permanent.card)) {
    permanent.doorLocked = false;
    return false;
  }

  if (permanent.doorLocked === false) {
    return false;
  }

  permanent.doorLocked = false;
  queueRoomUnlockDoorTriggers(ctx, permanent, controller);
  return true;
}

export function unlockRoomDoor(
  ctx: GameContext,
  permanentId: string,
  controller: PlayerID,
): boolean {
  const permanent = findBattlefieldPermanent(ctx, permanentId);
  if (!permanent) return false;
  return unlockRoomDoorPermanent(ctx, permanent, controller);
}

/**
 * Lock a Room door. Does not fire unlock-door triggers.
 * Returns true when the door transitioned from unlocked to locked.
 */
export function lockRoomDoorPermanent(
  ctx: GameContext,
  permanent: any,
): boolean {
  if (!permanent || !isRoomPermanent(permanent)) return false;
  if (permanent.doorLocked === true) return false;
  permanent.doorLocked = true;
  return true;
}

export function lockRoomDoor(
  ctx: GameContext,
  permanentId: string,
): boolean {
  const permanent = findBattlefieldPermanent(ctx, permanentId);
  if (!permanent) return false;
  return lockRoomDoorPermanent(ctx, permanent);
}

export function applyRoomDoorLockOrUnlockChoice(
  ctx: GameContext,
  controller: PlayerID,
  roomPermanentId: string,
  choiceId: string,
): boolean {
  const normalizedChoice = String(choiceId || '').trim().toLowerCase();
  if (normalizedChoice === 'unlock') {
    return unlockRoomDoor(ctx, roomPermanentId, controller);
  }
  if (normalizedChoice === 'lock') {
    return lockRoomDoor(ctx, roomPermanentId);
  }
  return false;
}

export function queueRoomDoorLockOrUnlockChoice(
  ctx: GameContext,
  controller: PlayerID,
  roomPermanentId: string,
  sourceName?: string,
): boolean {
  const permanent = findBattlefieldPermanent(ctx, roomPermanentId);
  if (!permanent || !isRoomPermanent(permanent)) return false;
  if ((ctx as any).isReplaying) return true;

  const roomName = String(permanent?.card?.name || sourceName || 'target Room').trim() || 'target Room';
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller,
    sourceId: roomPermanentId,
    sourceName: sourceName || roomName,
    description: `Lock or unlock a door of ${roomName}?`,
    mandatory: true,
    options: [
      { id: 'lock', label: 'Lock door' },
      { id: 'unlock', label: 'Unlock door' },
    ],
    minSelections: 1,
    maxSelections: 1,
    roomDoorLockOrUnlock: true,
    roomPermanentId,
  } as any);
  return true;
}

/**
 * Called when a Room enters. Cast-half entry unlocks the door and fires triggers.
 */
export function handleRoomDoorStateOnEnter(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  if (!isRoomPermanent(permanent)) return;

  initializeRoomDoorStateForEnter(permanent);

  if (permanent.skipUnlockDoorTriggerOnEnter === true) {
    permanent.doorLocked = true;
    return;
  }

  if (permanentHasUnlockDoorTrigger(permanent.card)) {
    unlockRoomDoorPermanent(ctx, permanent, controller);
  }
}

/** @deprecated Use handleRoomDoorStateOnEnter */
export function queueRoomUnlockDoorTriggersOnEnter(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  handleRoomDoorStateOnEnter(ctx, permanent, controller);
}

function isRoomDoorLockOrUnlockEffect(effectText: string): boolean {
  return /^lock or unlock a door of target room you control\.?$/i.test(String(effectText || '').trim());
}

function effectUnlocksRoomDoor(effectText: string): boolean {
  const text = String(effectText || '').trim();
  if (!text || isRoomDoorLockOrUnlockEffect(text)) return false;
  return ROOM_UNLOCK_EFFECT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * After a spell/trigger effect resolves, apply Room door lock/unlock state when
 * the effect text is a standard door instruction (unlock-only or lock-or-unlock choice).
 */
export function tryApplyRoomDoorStateFromResolvedEffect(
  ctx: GameContext,
  controller: PlayerID,
  effectText: string,
  triggerItem?: any,
): boolean {
  const text = String(effectText || '').trim();
  if (!text) return false;

  const targetId = resolveRoomTargetPermanentId(ctx, triggerItem);
  if (!targetId) return false;

  if (isRoomDoorLockOrUnlockEffect(text)) {
    return queueRoomDoorLockOrUnlockChoice(
      ctx,
      controller,
      targetId,
      String(triggerItem?.sourceName || triggerItem?.card?.name || '').trim() || undefined,
    );
  }

  if (!effectUnlocksRoomDoor(text)) return false;
  return unlockRoomDoor(ctx, targetId, controller);
}

/** @deprecated Use tryApplyRoomDoorStateFromResolvedEffect */
export const tryApplyRoomDoorUnlockFromResolvedEffect = tryApplyRoomDoorStateFromResolvedEffect;
