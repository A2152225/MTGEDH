// Origin parent: server/src/state/modules/manualActionApply.ts
// Cluster: find/remove card objects across zones for kitchen-table manual actions.
// Public entry symbols: ManualFoundObject, findManualObject, removeManualObject,
//   getOrInitPlayerZones, cardIdOf, isTokenObject, ownerIdOf.

import type { GameContext } from '../../context.js';
import type { ManualZone } from '../../../../../shared/src/manualAction.js';
import {
  pickMutablePlayerLibrary,
  writePlayerLibrary,
} from '../applyEventReplayCardMoveLibraryHelpers.js';

export type ManualFoundObject = {
  objectId: string;
  zone: ManualZone;
  ownerId: string;
  card: any;
  permanent?: any;
  stackItem?: any;
};

export function cardIdOf(card: any): string {
  return String(card?.id || '').trim();
}

export function isTokenObject(entry: any): boolean {
  if (!entry) return false;
  if (entry.isToken === true || entry.card?.isToken === true || entry.card?.token === true) return true;
  const typeLine = String(entry.card?.type_line || entry.type_line || '').toLowerCase();
  return /\btoken\b/.test(typeLine);
}

export function ownerIdOf(entry: any, fallback: string): string {
  return String(entry?.owner || entry?.card?.owner || fallback || '').trim();
}

export function getOrInitPlayerZones(ctx: GameContext, playerId: string): any {
  const state = ctx.state as any;
  state.zones = state.zones || {};
  const zones = (state.zones[playerId] = state.zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
  return zones;
}

function playerIds(ctx: GameContext): string[] {
  const fromPlayers = Array.isArray(ctx.state?.players)
    ? ctx.state.players.map((p: any) => String(p?.id || '').trim()).filter(Boolean)
    : [];
  const fromZones = Object.keys((ctx.state as any)?.zones || {});
  return [...new Set([...fromPlayers, ...fromZones])];
}

export function findManualObject(ctx: GameContext, objectId: string): ManualFoundObject | null {
  const id = String(objectId || '').trim();
  if (!id) return null;

  const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
  const permanent = battlefield.find((p: any) => String(p?.id || '') === id || cardIdOf(p?.card) === id);
  if (permanent) {
    const ownerId = ownerIdOf(permanent, String(permanent.controller || ''));
    return {
      objectId: String(permanent.id),
      zone: 'battlefield',
      ownerId,
      card: permanent.card || permanent,
      permanent,
    };
  }

  const stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
  const stackItem = stack.find((item: any) =>
    String(item?.id || '') === id || cardIdOf(item?.card) === id || String(item?.sourceId || '') === id,
  );
  if (stackItem) {
    const ownerId = ownerIdOf(stackItem, String((stackItem as any).controller || (stackItem as any).controllerId || ''));
    return {
      objectId: String(stackItem.id || id),
      zone: 'stack',
      ownerId,
      card: stackItem.card || stackItem,
      stackItem,
    };
  }

  for (const pid of playerIds(ctx)) {
    const z = getOrInitPlayerZones(ctx, pid);
    const hand = z.hand.find((c: any) => cardIdOf(c) === id);
    if (hand) return { objectId: id, zone: 'hand', ownerId: pid, card: hand };
    const gy = z.graveyard.find((c: any) => cardIdOf(c) === id);
    if (gy) return { objectId: id, zone: 'graveyard', ownerId: pid, card: gy };
    const ex = z.exile.find((c: any) => cardIdOf(c) === id);
    if (ex) return { objectId: id, zone: 'exile', ownerId: pid, card: ex };
    const lib = pickMutablePlayerLibrary(ctx, pid);
    const libCard = Array.isArray(lib) ? lib.find((c: any) => cardIdOf(c) === id) : null;
    if (libCard) return { objectId: id, zone: 'library', ownerId: pid, card: libCard };

    const cz = (ctx.state as any).commandZone?.[pid] || (ctx as any).commandZone?.[pid];
    const commanders = Array.isArray(cz?.commanderCards) ? cz.commanderCards : [];
    const commander = commanders.find((c: any) => cardIdOf(c) === id || String(c?.id || '') === id);
    if (commander) return { objectId: cardIdOf(commander) || id, zone: 'command', ownerId: pid, card: commander };
  }

  return null;
}

function spliceById(list: any[], id: string): any | null {
  const index = list.findIndex((c: any) => cardIdOf(c) === id || String(c?.id || '') === id);
  if (index < 0) return null;
  const [removed] = list.splice(index, 1);
  return removed || null;
}

export function removeManualObject(ctx: GameContext, found: ManualFoundObject): any {
  if (found.zone === 'battlefield') {
    const battlefield = Array.isArray(ctx.state.battlefield) ? (ctx.state.battlefield as any[]) : [];
    ctx.state.battlefield = battlefield as any;
    const removedPerm = spliceById(battlefield, found.objectId) || spliceById(battlefield, cardIdOf(found.card));
    dropAttachmentsFromHost(ctx, found.objectId);
    return removedPerm?.card ? { ...removedPerm.card } : found.card;
  }

  if (found.zone === 'stack') {
    const stack = Array.isArray(ctx.state.stack) ? (ctx.state.stack as any[]) : [];
    ctx.state.stack = stack as any;
    spliceById(stack, found.objectId);
    return found.card;
  }

  if (found.zone === 'library') {
    const lib = pickMutablePlayerLibrary(ctx, found.ownerId);
    const removed = spliceById(lib, found.objectId);
    writePlayerLibrary(ctx, found.ownerId, lib);
    return removed || found.card;
  }

  if (found.zone === 'command') {
    const state = ctx.state as any;
    state.commandZone = state.commandZone || {};
    const cz = state.commandZone[found.ownerId] = state.commandZone[found.ownerId] || {};
    cz.commanderCards = Array.isArray(cz.commanderCards) ? cz.commanderCards : [];
    spliceById(cz.commanderCards, found.objectId);
    if (Array.isArray(cz.inCommandZone)) {
      cz.inCommandZone = cz.inCommandZone.filter((id: any) => String(id) !== found.objectId);
    }
    return found.card;
  }

  const z = getOrInitPlayerZones(ctx, found.ownerId);
  const list = found.zone === 'hand' ? z.hand : found.zone === 'graveyard' ? z.graveyard : z.exile;
  const removed = spliceById(list, found.objectId);
  if (found.zone === 'hand') z.handCount = z.hand.length;
  if (found.zone === 'graveyard') z.graveyardCount = z.graveyard.length;
  if (found.zone === 'exile') z.exileCount = z.exile.length;
  return removed || found.card;
}

function dropAttachmentsFromHost(ctx: GameContext, hostId: string): void {
  const battlefield = Array.isArray(ctx.state.battlefield) ? (ctx.state.battlefield as any[]) : [];
  const fallingAuras: any[] = [];
  for (const perm of battlefield) {
    if (String(perm?.attachedTo || '') !== hostId) continue;
    perm.attachedTo = undefined;
    const typeLine = String(perm?.card?.type_line || '').toLowerCase();
    if (typeLine.includes('aura') && !isTokenObject(perm)) {
      fallingAuras.push(perm);
    }
  }
  for (const aura of fallingAuras) {
    const idx = battlefield.findIndex((p: any) => p === aura);
    if (idx >= 0) battlefield.splice(idx, 1);
    const ownerId = ownerIdOf(aura, String(aura.controller || ''));
    const z = getOrInitPlayerZones(ctx, ownerId);
    z.graveyard.push({ ...(aura.card || aura), zone: 'graveyard' });
    z.graveyardCount = z.graveyard.length;
  }
  for (const perm of battlefield) {
    if (!Array.isArray(perm?.attachedEquipment)) continue;
    perm.attachedEquipment = perm.attachedEquipment.filter((id: any) => String(id) !== hostId);
  }
}
