// CR 800.4a: when a player leaves the game, objects they own leave the game
// and any effects that gave them control end (stolen cards revert). Then
// objects they still control are exiled. Tokens cease to exist; other cards
// go to exile as the existing concede-cleanup path does.
// Public entry symbols: removeLeavingPlayerGameObjects.

import { playerHasLeftTheGame } from '../../../../rules-engine/src/playerInGameStatus.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { syncPreparedPermanentAfterControlChange } from './prepared.js';

function playerStillInGame(state: any, playerId: string): boolean {
  const id = String(playerId || '').trim();
  if (!id) return false;
  const players = state?.players;
  if (!Array.isArray(players) || players.length === 0) return true;
  const player = players.find((entry: any) => String(entry?.id || '').trim() === id);
  if (!player) return false;
  return !playerHasLeftTheGame(player);
}

function permanentOwnerId(permanent: any): string {
  return String(permanent?.owner || permanent?.ownerId || '').trim();
}

function permanentControllerId(permanent: any): string {
  return String(permanent?.controller || permanent?.controllerId || '').trim();
}

function restorePermanentController(state: any, permanent: any, nextController: string): void {
  const previous = permanentControllerId(permanent);
  if (!nextController || nextController === previous) return;
  permanent.controller = nextController;
  syncPreparedPermanentAfterControlChange(state, permanent, previous);
}

/**
 * End control-change effects that currently give the leaving player control
 * (Act of Treason, Threaten, Mind Control spells that recorded an effect).
 */
function revertControlEffectsHeldByLeavingPlayer(state: any, playerId: string): void {
  const effects = Array.isArray(state.controlChangeEffects) ? state.controlChangeEffects : [];
  if (effects.length === 0) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const remaining: any[] = [];

  for (const effect of effects) {
    const newController = String(effect?.newController || '').trim();
    if (newController !== playerId) {
      remaining.push(effect);
      continue;
    }

    const permanentId = String(effect?.permanentId || '').trim();
    const permanent = battlefield.find(
      (entry: any) => entry && String(entry.id || '').trim() === permanentId,
    );
    if (!permanent) continue;

    const owner = permanentOwnerId(permanent);
    if (owner === playerId) continue;

    const originalController = String(effect?.originalController || '').trim();
    const revertTo = playerStillInGame(state, originalController)
      ? originalController
      : (playerStillInGame(state, owner) ? owner : '');
    if (revertTo) restorePermanentController(state, permanent, revertTo);
  }

  if (remaining.length > 0) {
    state.controlChangeEffects = remaining;
  } else {
    delete state.controlChangeEffects;
  }
}

/**
 * Untracked steals (IR gain_control that only flipped `controller`) still
 * have owner !== controller. Return those to a living owner so they are not
 * exiled with the leaving player.
 */
function returnUnownedControlledPermanentsToLivingOwners(state: any, playerId: string): void {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (permanentControllerId(permanent) !== playerId) continue;
    const owner = permanentOwnerId(permanent);
    if (!owner || owner === playerId) continue;
    if (!playerStillInGame(state, owner)) continue;
    restorePermanentController(state, permanent, owner);
  }
}

function permanentLeavesWithPlayer(permanent: any, playerId: string): boolean {
  const owner = permanentOwnerId(permanent);
  const controller = permanentControllerId(permanent);
  return owner === playerId || controller === playerId;
}

const ATTACH_TARGET_KEYS = [
  'attachedTo',
  'enchanting',
  'enchantedPermanentId',
  'enchantedPlayerId',
  'equippedCreatureId',
  'attachedToId',
  'wasAttachedTo',
] as const;

function readAttachTargetIds(permanent: any): string[] {
  const ids: string[] = [];
  for (const key of ATTACH_TARGET_KEYS) {
    const value = String(permanent?.[key] || '').trim();
    if (value && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

function clearAttachTargets(permanent: any): void {
  for (const key of ATTACH_TARGET_KEYS) {
    if (permanent?.[key] != null && permanent[key] !== '') {
      delete permanent[key];
    }
  }
}

function stripRemovedAttachments(permanent: any, removedIds: Set<string>): void {
  if (readAttachTargetIds(permanent).some((targetId) => removedIds.has(targetId))) {
    clearAttachTargets(permanent);
  }
  if (Array.isArray(permanent?.attachedEquipment)) {
    permanent.attachedEquipment = permanent.attachedEquipment.filter(
      (entry: unknown) => !removedIds.has(String(entry || '').trim()),
    );
    if (permanent.attachedEquipment.length === 0) {
      permanent.isEquipped = false;
    }
  }
  if (Array.isArray(permanent?.attachments)) {
    permanent.attachments = permanent.attachments.filter(
      (entry: unknown) => !removedIds.has(String(entry || '').trim()),
    );
  }
}

function pushCardToOwnerExile(state: any, permanent: any, fallbackOwnerId: string): void {
  const owner = String(permanent?.owner || permanent?.controller || fallbackOwnerId).trim();
  if (!owner) return;
  const zones = state.zones = state.zones || {};
  const playerZones = zones[owner] = zones[owner] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
  playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];
  playerZones.exile.push({
    id: permanent.id,
    ...permanent.card,
    zone: 'exile',
  });
  playerZones.exileCount = playerZones.exile.length;
}

/**
 * Remove battlefield / stack / emblem objects belonging to a player who has
 * lost or been eliminated so their global effects stop applying.
 * Other players' cards this player only controlled are returned first.
 * Auras/Equipment/Fortifications attached to those leaving objects (or to the
 * player) become unattached so they no longer have a legal target.
 * Idempotent: a second call is a no-op once those objects are gone.
 */
export function removeLeavingPlayerGameObjects(
  state: any,
  playerId: string,
  options?: { gameId?: string },
): string[] {
  const id = String(playerId || '').trim();
  if (!id || !state) return [];

  revertControlEffectsHeldByLeavingPlayer(state, id);
  returnUnownedControlledPermanentsToLivingOwners(state, id);

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const remaining: any[] = [];
  const removedIds: string[] = [];
  const toExile: any[] = [];

  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (!permanentLeavesWithPlayer(permanent, id)) {
      remaining.push(permanent);
      continue;
    }
    const permanentId = String(permanent.id || '').trim();
    if (permanentId) removedIds.push(permanentId);
    if (permanent.isToken !== true) toExile.push(permanent);
  }

  const removedIdSet = new Set(removedIds);
  const illegalAttachTargets = new Set(removedIdSet);
  illegalAttachTargets.add(id);
  for (const permanent of remaining) {
    stripRemovedAttachments(permanent, illegalAttachTargets);
  }
  state.battlefield = remaining;

  for (const permanent of toExile) {
    pushCardToOwnerExile(state, permanent, id);
  }

  if (Array.isArray(state.controlChangeEffects)) {
    state.controlChangeEffects = state.controlChangeEffects.filter((effect: any) => {
      const permanentId = String(effect?.permanentId || '').trim();
      if (permanentId && removedIdSet.has(permanentId)) return false;
      if (String(effect?.newController || '').trim() === id) return false;
      return true;
    });
    if (state.controlChangeEffects.length === 0) {
      delete state.controlChangeEffects;
    }
  }

  if (Array.isArray(state.stack)) {
    state.stack = state.stack.filter((item: any) => {
      const controller = String(item?.controller || item?.controllerId || '').trim();
      const owner = String(item?.owner || item?.ownerId || '').trim();
      if (controller === id) return false;
      if (owner === id) return false;
      return true;
    });
  }

  if (Array.isArray(state.emblems)) {
    state.emblems = state.emblems.filter(
      (emblem: any) => String(emblem?.controller || '').trim() !== id,
    );
  }

  if (Array.isArray(state.staticAbilityGrantEffects)) {
    state.staticAbilityGrantEffects = state.staticAbilityGrantEffects.filter((effect: any) => {
      const controller = String(effect?.controllerId || effect?.controller || '').trim();
      const sourceId = String(effect?.sourceId || '').trim();
      if (controller === id) return false;
      if (sourceId && removedIdSet.has(sourceId)) return false;
      return true;
    });
    if (state.staticAbilityGrantEffects.length === 0) {
      delete state.staticAbilityGrantEffects;
    }
  }

  const gameId = String(options?.gameId || state?.gameId || '').trim();
  if (gameId && gameId !== 'unknown') {
    ResolutionQueueManager.clearStepsForPlayer(gameId, id);
  }

  return removedIds;
}
