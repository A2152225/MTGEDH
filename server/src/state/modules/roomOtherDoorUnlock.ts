/**
 * Room other-door unlock (CR 709.5 / 116.2m):
 * Dual-door Rooms track which halves are unlocked. Casting a half unlocks that
 * door on ETB. As a sorcery, the controller may pay a locked door's mana cost
 * to unlock it (special action — no stack).
 *
 * Origin companion to triggers/room.ts.
 * Public: isDualDoorRoomCard, getRoomCastFaceIndex, listLockedRoomDoors,
 * syncRoomDoorGrantedUnlockAbilities, payToUnlockRoomDoor,
 * initializeDualRoomDoorsOnEnter, unlockSpecificRoomDoor,
 * roomHasLockedDoor, countUnlockedRoomDoors.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  canPayManaCostStringWithAvailableSources,
  consumeManaFromPool,
  getOrInitManaPool,
  payManaCostWithAvailableSources,
  resolveManaCostForPoolPayment,
} from '../../socket/util.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { isInMainPhase } from './can-respond-handlers/canRespondMainPhase.js';

export type LockedRoomDoor = {
  faceIndex: 0 | 1;
  name: string;
  manaCost: string;
  oracleText: string;
  abilityText: string;
};

function typeLineOf(value: any): string {
  return String(value?.type_line || value?.typeLine || '').toLowerCase();
}

export function isDualDoorRoomCard(card: any): boolean {
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  if (faces.length < 2) return false;
  return faces.slice(0, 2).every((face: any) => /\broom\b/.test(typeLineOf(face)));
}

export function getRoomCastFaceIndex(permanentOrCard: any): 0 | 1 {
  const card = permanentOrCard?.card && typeof permanentOrCard.card === 'object'
    ? permanentOrCard.card
    : permanentOrCard;
  const direct = Number(card?.faceIndex ?? permanentOrCard?.faceIndex);
  if (direct === 1) return 1;
  if (direct === 0) return 0;
  // Infer from name match against faces when faceIndex was not stamped.
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const name = String(card?.name || '').trim().toLowerCase();
  if (faces[1] && String(faces[1].name || '').trim().toLowerCase() === name) return 1;
  return 0;
}

export function roomHasLockedDoor(permanent: any): boolean {
  if (Array.isArray(permanent?.unlockedDoors) && isDualDoorRoomCard(permanent?.card)) {
    return permanent.unlockedDoors.length < 2;
  }
  return permanent?.doorLocked === true;
}

export function countUnlockedRoomDoors(permanent: any): number {
  if (Array.isArray(permanent?.unlockedDoors)) return permanent.unlockedDoors.length;
  if (Number.isFinite(Number(permanent?.unlockedDoorCount))) {
    return Math.max(0, Number(permanent.unlockedDoorCount));
  }
  if (permanent?.doorLocked === false) return isDualDoorRoomCard(permanent?.card) ? 2 : 1;
  if (permanent?.doorLocked === true) return isDualDoorRoomCard(permanent?.card) ? 1 : 0;
  return 0;
}

function normalizeUnlockedDoors(permanent: any): number[] {
  if (Array.isArray(permanent?.unlockedDoors)) {
    return permanent.unlockedDoors
      .map((entry: unknown) => Number(entry))
      .filter((n: number) => n === 0 || n === 1);
  }
  return [];
}

export function listLockedRoomDoors(permanent: any): LockedRoomDoor[] {
  const card = permanent?.card;
  if (!isDualDoorRoomCard(card)) return [];
  const faces = card.card_faces as any[];
  const unlocked = new Set(normalizeUnlockedDoors(permanent));
  // Legacy single-boolean: doorLocked false means both treated unlocked.
  if (!Array.isArray(permanent?.unlockedDoors) && permanent?.doorLocked === false) {
    return [];
  }
  if (!Array.isArray(permanent?.unlockedDoors) && permanent?.doorLocked === true) {
    // Only the cast face is unlocked.
    unlocked.clear();
    unlocked.add(getRoomCastFaceIndex(permanent));
  }

  const locked: LockedRoomDoor[] = [];
  for (const faceIndex of [0, 1] as const) {
    if (unlocked.has(faceIndex)) continue;
    const face = faces[faceIndex];
    if (!face) continue;
    const manaCost = String(face.mana_cost ?? face.manaCost ?? '').trim();
    if (!manaCost) continue;
    const name = String(face.name || `door ${faceIndex + 1}`).trim() || `door ${faceIndex + 1}`;
    const oracleText = String(face.oracle_text || face.oracleText || '').trim();
    const abilityText = `${manaCost}: Unlock ${name}. Activate only as a sorcery.`;
    locked.push({ faceIndex, name, manaCost, oracleText, abilityText });
  }
  return locked;
}

/**
 * Keep grantedAbilities in sync so client/server parsers surface pay-to-unlock.
 */
export function syncRoomDoorGrantedUnlockAbilities(permanent: any): void {
  if (!permanent || !isDualDoorRoomCard(permanent.card)) return;
  const existing = Array.isArray(permanent.grantedAbilities) ? permanent.grantedAbilities : [];
  const withoutRoomUnlock = existing.filter((entry: any) => {
    const text = typeof entry === 'string' ? entry : String(entry?.ability || entry?.text || '');
    if (/^\{[^}]+\}(?:\{[^}]+\})*\s*:\s*Unlock\s+.+\.\s*Activate only as a sorcery\.?$/i.test(text.trim())) {
      return false;
    }
    return true;
  });

  const locked = listLockedRoomDoors(permanent);
  const grants = locked.map((door) => door.abilityText);
  permanent.grantedAbilities = [...withoutRoomUnlock, ...grants];
  if (permanent.grantedAbilities.length === 0) delete permanent.grantedAbilities;
}

/**
 * Stamp dual-door state when a Room enters from casting a half.
 * Returns the face index that was unlocked on enter.
 */
export function initializeDualRoomDoorsOnEnter(permanent: any): 0 | 1 | null {
  if (!permanent || !isDualDoorRoomCard(permanent.card)) return null;
  const castFace = getRoomCastFaceIndex(permanent);
  permanent.unlockedDoors = [castFace];
  permanent.unlockedDoorCount = 1;
  permanent.doorLocked = true; // other door still locked
  syncRoomDoorGrantedUnlockAbilities(permanent);
  return castFace;
}

export function unlockSpecificRoomDoor(
  permanent: any,
  faceIndex: 0 | 1,
): { unlocked: boolean; becameFullyUnlocked: boolean; faceOracleText: string; faceName: string } {
  const card = permanent?.card;
  if (!permanent || !isDualDoorRoomCard(card)) {
    return { unlocked: false, becameFullyUnlocked: false, faceOracleText: '', faceName: '' };
  }
  const faces = card.card_faces as any[];
  const face = faces[faceIndex];
  const faceOracleText = String(face?.oracle_text || face?.oracleText || '').trim();
  const faceName = String(face?.name || '').trim();

  let unlocked = normalizeUnlockedDoors(permanent);
  if (!Array.isArray(permanent.unlockedDoors) && permanent.doorLocked === true) {
    unlocked = [getRoomCastFaceIndex(permanent)];
  }
  if (!Array.isArray(permanent.unlockedDoors) && permanent.doorLocked === false) {
    unlocked = [0, 1];
  }

  if (unlocked.includes(faceIndex)) {
    return { unlocked: false, becameFullyUnlocked: false, faceOracleText, faceName };
  }

  const beforeCount = unlocked.length;
  unlocked = [...unlocked, faceIndex].sort();
  permanent.unlockedDoors = unlocked;
  permanent.unlockedDoorCount = unlocked.length;
  permanent.doorLocked = unlocked.length < 2;
  syncRoomDoorGrantedUnlockAbilities(permanent);

  const becameFullyUnlocked = beforeCount < 2 && unlocked.length >= 2;
  return { unlocked: true, becameFullyUnlocked, faceOracleText, faceName };
}

/**
 * Pay a locked door's mana cost (sorcery-speed special action). Does not unlock —
 * caller should call unlockRoomDoorPermanent afterward to unlock + fire triggers.
 */
export function payToUnlockRoomDoor(
  ctx: GameContext,
  permanent: any,
  playerId: PlayerID,
  faceIndex: 0 | 1,
): { ok: true; faceIndex: 0 | 1; faceName: string; manaCost: string } | { ok: false; reason: string } {
  const state = (ctx as any)?.state;
  if (!state || !permanent) return { ok: false, reason: 'missing state' };
  if (String(permanent.controller || '') !== String(playerId)) {
    return { ok: false, reason: 'not controller' };
  }
  if (!isDualDoorRoomCard(permanent.card)) {
    return { ok: false, reason: 'not a dual-door Room' };
  }

  const turnPlayer = String(state.turnPlayer || state.activePlayer || '');
  if (turnPlayer !== String(playerId)) {
    return { ok: false, reason: 'not your turn' };
  }
  if (!isInMainPhase(ctx) || (Array.isArray(state.stack) && state.stack.length > 0)) {
    return { ok: false, reason: 'sorcery speed only' };
  }

  const locked = listLockedRoomDoors(permanent).find((door) => door.faceIndex === faceIndex);
  if (!locked) return { ok: false, reason: 'door not locked' };

  // Prefer floating pool payment; fall back to tapping available sources.
  const pool = getOrInitManaPool(state, playerId) as any;
  let paidFromPool = false;
  try {
    const resolved = resolveManaCostForPoolPayment(pool, locked.manaCost);
    if (resolved?.ok === true) {
      consumeManaFromPool(
        pool,
        (resolved as any).coloredCost || {},
        (resolved as any).genericCost || 0,
        '[payToUnlockRoomDoor]',
      );
      paidFromPool = true;
    }
  } catch {
    paidFromPool = false;
  }

  if (!paidFromPool) {
    if (!canPayManaCostStringWithAvailableSources(state, playerId, locked.manaCost)) {
      return { ok: false, reason: 'insufficient mana' };
    }
    try {
      const sourcePay = payManaCostWithAvailableSources(state, playerId, locked.manaCost);
      if ((sourcePay as any)?.ok === false) {
        return { ok: false, reason: 'insufficient mana' };
      }
    } catch (err) {
      debugWarn(1, '[payToUnlockRoomDoor] mana payment failed:', err);
      return { ok: false, reason: 'mana payment failed' };
    }
  }

  debug(1, `[payToUnlockRoomDoor] ${permanent.card?.name}: paid ${locked.manaCost} to unlock ${locked.name}`);
  return { ok: true, faceIndex, faceName: locked.name, manaCost: locked.manaCost };
}

/** Parse face index from ability id like `room-unlock-door-1` or ability text. */
export function parseRoomUnlockDoorFaceIndex(abilityId: string, abilityText?: string): 0 | 1 | null {
  const idMatch = String(abilityId || '').match(/room-unlock-door-([01])(?:-|$)/i);
  if (idMatch) return Number(idMatch[1]) as 0 | 1;
  const text = String(abilityText || '');
  if (/^\{[^}]+\}(?:\{[^}]+\})*\s*:\s*Unlock\s+/i.test(text) && /Activate only as a sorcery/i.test(text)) {
    // Face resolved by caller via name match when needed.
    return null;
  }
  return null;
}

export function matchLockedDoorByAbilityText(permanent: any, abilityText: string): LockedRoomDoor | null {
  const needle = String(abilityText || '').trim().toLowerCase();
  if (!needle) return null;
  return listLockedRoomDoors(permanent).find((door) => door.abilityText.trim().toLowerCase() === needle) || null;
}
