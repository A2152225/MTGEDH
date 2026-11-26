/**
 * Origin parent: server/src/socket/interaction.ts
 * Cluster: Room other-door unlock special action (CR 709.5e / 116.2m).
 * Pay a locked door's mana cost as a sorcery; unlock without using the stack.
 * Public: tryHandleActivateRoomDoorUnlock.
 */

import { appendEvent } from '../../db';
import { broadcastGame, getPlayerName } from '../util';
import type { ActivateBattlefieldAbilityContext } from './interactionActivateBattlefieldAbilityContext.js';
import {
  listLockedRoomDoors,
  matchLockedDoorByAbilityText,
  parseRoomUnlockDoorFaceIndex,
  payToUnlockRoomDoor,
} from '../../state/modules/roomOtherDoorUnlock.js';
import { isRoomPermanent, unlockRoomDoorPermanent } from '../../state/modules/triggers/room.js';

function looksLikeRoomUnlockAbility(abilityId: string, abilityText: string): boolean {
  if (/room-unlock-door/i.test(abilityId)) return true;
  return /^\{[^}]+\}(?:\{[^}]+\})*\s*:\s*Unlock\s+/i.test(String(abilityText || '').trim())
    && /Activate only as a sorcery/i.test(String(abilityText || ''));
}

export async function tryHandleActivateRoomDoorUnlock(
  ctx: ActivateBattlefieldAbilityContext,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    permanent,
    cardName,
    scopedAbilityFullText,
    scopedAbilityText,
  } = ctx;

  if (!permanent || !isRoomPermanent(permanent)) return false;
  const abilityText = String(scopedAbilityFullText || scopedAbilityText || '').trim();
  if (!looksLikeRoomUnlockAbility(String(abilityId || ''), abilityText)) return false;

  let faceIndex = parseRoomUnlockDoorFaceIndex(String(abilityId || ''), abilityText);
  if (faceIndex == null) {
    const matched = matchLockedDoorByAbilityText(permanent, abilityText);
    if (matched) faceIndex = matched.faceIndex;
  }
  if (faceIndex == null) {
    const locked = listLockedRoomDoors(permanent);
    if (locked.length === 1) faceIndex = locked[0].faceIndex;
  }
  if (faceIndex == null) {
    socket.emit('error', {
      code: 'ROOM_DOOR_NOT_FOUND',
      message: 'Could not determine which Room door to unlock.',
    });
    return true;
  }

  const gameCtx = ((game as any).ctx || game) as any;
  const paid = payToUnlockRoomDoor(gameCtx, permanent, pid as any, faceIndex);
  if (paid.ok === false) {
    // Server tsconfig is non-strict, so the boolean discriminant does not narrow.
    const reason = (paid as { ok: false; reason: string }).reason;
    const code =
      reason === 'insufficient mana' ? 'INSUFFICIENT_MANA'
        : reason === 'sorcery speed only' ? 'SORCERY_SPEED_ONLY'
          : reason === 'not your turn' ? 'NOT_YOUR_TURN'
            : 'ROOM_DOOR_UNLOCK_FAILED';
    socket.emit('error', { code, message: reason });
    return true;
  }

  const unlocked = unlockRoomDoorPermanent(gameCtx, permanent, pid as any, faceIndex);
  if (!unlocked) {
    socket.emit('error', {
      code: 'ROOM_DOOR_UNLOCK_FAILED',
      message: 'Door could not be unlocked.',
    });
    return true;
  }

  if (typeof game.bumpSeq === 'function') game.bumpSeq();

  appendEvent(gameId, (game as any).seq ?? 0, 'unlockRoomDoorPaid', {
    playerId: pid,
    permanentId,
    faceIndex,
    cardName,
    faceName: paid.faceName,
    abilityId,
    manaCost: paid.manaCost,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `🚪 ${getPlayerName(game, pid)} unlocked ${paid.faceName || cardName}.`,
    ts: Date.now(),
  });

  broadcastGame(io, game, gameId);
  return true;
}
