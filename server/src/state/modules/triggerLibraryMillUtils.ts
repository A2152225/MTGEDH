import type { GameContext } from '../context.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';

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

export type MillCardsOptions = {
  skipEventPersistence?: boolean;
};

function persistMillEvent(
  ctx: GameContext | undefined,
  stateAny: any,
  playerId: string,
  milled: number,
  options?: MillCardsOptions,
): void {
  if (options?.skipEventPersistence) return;
  if ((ctx as any)?.isReplaying || stateAny?.isReplaying) return;
  const gameId = String((ctx as any)?.gameId || stateAny?.gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;
  if (milled <= 0) return;
  try {
    appendEvent(
      gameId,
      Number((ctx as any)?.seq?.value ?? (ctx as any)?.seq ?? stateAny?.seq ?? 0),
      'mill',
      { playerId, count: milled },
    );
  } catch (err) {
    debugWarn(1, '[millCardsFromLibrary] appendEvent(mill) failed:', err);
  }
}

export function millCardsFromLibrary(
  stateAny: any,
  playerId: PlayerID,
  count: number,
  ctx?: GameContext,
  options?: MillCardsOptions,
): number {
  const zones = getOrCreatePlayerZones(stateAny, playerId);
  const libraries =
    ctx && (ctx as any).libraries && typeof (ctx as any).libraries.get === 'function'
      ? ((ctx as any).libraries as Map<string, any[]>)
      : undefined;
  let milled = 0;

  for (let idx = 0; idx < Math.max(0, count | 0); idx += 1) {
    // Prefer the libraries Map when it actually has cards. An empty Map is not
    // more authoritative than a populated `state.zones[player].library` (tests
    // and some socket paths only seed the zone store).
    let card: any = null;
    if (libraries) {
      const lib = libraries.get(String(playerId)) || [];
      if (Array.isArray(lib) && lib.length > 0) {
        card = lib.shift();
        libraries.set(String(playerId), lib);
        zones.library = lib;
        zones.libraryCount = lib.length;
      }
    }
    if (!card) {
      if (zones.library.length === 0) break;
      card = zones.library.shift();
      zones.libraryCount = zones.library.length;
      if (libraries) {
        libraries.set(String(playerId), zones.library);
      }
    }
    if (!card) break;
    if (ctx) {
      pushCardToPlayerGraveyardWithReplacements(ctx, playerId, card, zones.graveyard);
    } else {
      zones.graveyard.push({ ...card, zone: 'graveyard' });
    }
    milled += 1;
  }

  if (libraries) {
    const lib = libraries.get(String(playerId)) || [];
    if (Array.isArray(lib) && lib.length > 0) {
      zones.library = lib;
      zones.libraryCount = lib.length;
    } else if (zones.library.length > 0) {
      libraries.set(String(playerId), zones.library);
      zones.libraryCount = zones.library.length;
    } else {
      zones.library = Array.isArray(lib) ? lib : [];
      zones.libraryCount = zones.library.length;
    }
  } else {
    zones.libraryCount = zones.library.length;
  }
  zones.graveyardCount = zones.graveyard.length;
  persistMillEvent(ctx, stateAny, String(playerId), milled, options);
  return milled;
}
