// Origin parent: applyEventStackCoreEvents.ts
// Cluster: Oracle IR counter_spell replay. Live IR already removed the object;
// this event is how reload puts the spell in its zone or drops an ability.
// Public entry: applyCounterStackObjectReplay

import type { GameContext } from '../../context';
import type { GameEvent } from '../../types';
import { recordCardPutIntoGraveyardThisTurn } from '../turn-tracking.js';

function cardIdOf(card: any): string {
  return String(card?.id || '').trim();
}

function placeCounteredCard(
  ctx: GameContext,
  ownerId: string,
  zoneName: 'graveyard' | 'exile',
  card: any,
): boolean {
  const id = cardIdOf(card);
  if (!ownerId || !id) return false;

  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
  const playerZones = (zones[ownerId] = zones[ownerId] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  const list = (playerZones[zoneName] = Array.isArray(playerZones[zoneName]) ? playerZones[zoneName] : []);
  const alreadyInZone = list.some((entry: any) => cardIdOf(entry) === id);

  const players = Array.isArray((ctx.state as any).players) ? (ctx.state as any).players : [];
  const player = players.find((entry: any) => String(entry?.id || '') === ownerId);
  if (player) {
    const playerList = Array.isArray(player[zoneName]) ? player[zoneName] : [];
    if (!playerList.some((entry: any) => cardIdOf(entry) === id)) {
      player[zoneName] = [...playerList, { ...card, zone: zoneName }];
    }
  }

  if (alreadyInZone) return false;

  const stamped = { ...card, zone: zoneName };
  list.push(stamped);
  playerZones[`${zoneName}Count`] = list.length;
  if (zoneName === 'graveyard') {
    recordCardPutIntoGraveyardThisTurn(ctx as any, ownerId, stamped, { fromBattlefield: false });
  }
  return true;
}

/** Replay (and a second apply) of an IR counter. Already-moved cards are left alone. */
export function applyCounterStackObjectReplay(ctx: GameContext, event: GameEvent): void {
  const stackItemId = String((event as any).stackItemId || '').trim();
  const ownerId = String((event as any).ownerId || (event as any).playerId || '').trim();
  const destination = String((event as any).destination || 'graveyard').trim().toLowerCase();
  const wasSpell = (event as any).wasSpell !== false;
  let card = (event as any).card && typeof (event as any).card === 'object' && !Array.isArray((event as any).card)
    ? { ...((event as any).card as any) }
    : null;
  const cardId = cardIdOf(card);

  const stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
  for (let index = stack.length - 1; index >= 0; index--) {
    const entry = stack[index];
    const entryId = String(entry?.id || '').trim();
    const entryCardId = cardIdOf(entry?.card);
    const matchesStack = Boolean(stackItemId) && (entryId === stackItemId || entryCardId === stackItemId);
    const matchesCard = Boolean(cardId) && (entryCardId === cardId || entryId === cardId);
    if (!matchesStack && !matchesCard) continue;
    const [removed] = stack.splice(index, 1);
    if (!card && removed?.card && typeof removed.card === 'object') {
      card = { ...removed.card };
    }
  }

  if (!wasSpell || destination === 'cease') {
    ctx.bumpSeq?.();
    return;
  }

  const zoneName = destination === 'exile' ? 'exile' : 'graveyard';
  if (card) {
    placeCounteredCard(ctx, ownerId, zoneName, card);
  }
  ctx.bumpSeq?.();
}
