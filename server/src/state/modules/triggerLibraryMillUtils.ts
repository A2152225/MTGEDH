import type { GameContext } from '../context.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import type { PlayerID } from '../../../../shared/src/index.js';

export function getOrCreatePlayerZones(stateAny: any, playerId: PlayerID): any {
  stateAny.zones = stateAny.zones || {};
  stateAny.zones[playerId] = stateAny.zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };

  const zones = stateAny.zones[playerId];
  zones.library = Array.isArray(zones.library) ? zones.library : [];
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
  zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
  zones.handCount = zones.hand.length;
  zones.libraryCount = zones.library.length;
  zones.graveyardCount = zones.graveyard.length;
  zones.exileCount = zones.exile.length;
  return zones;
}

export function millCardsFromLibrary(
  stateAny: any,
  playerId: PlayerID,
  count: number,
  ctx?: GameContext,
): number {
  const zones = getOrCreatePlayerZones(stateAny, playerId);
  let milled = 0;

  for (let idx = 0; idx < Math.max(0, count | 0); idx += 1) {
    if (zones.library.length === 0) break;
    const card = zones.library.shift();
    if (!card) break;
    if (ctx) {
      pushCardToPlayerGraveyardWithReplacements(ctx, playerId, card, zones.graveyard);
    } else {
      zones.graveyard.push({ ...card, zone: 'graveyard' });
    }
    milled += 1;
  }

  zones.libraryCount = zones.library.length;
  zones.graveyardCount = zones.graveyard.length;
  return milled;
}
