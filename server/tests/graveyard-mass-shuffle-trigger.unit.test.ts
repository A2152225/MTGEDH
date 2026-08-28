import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { destroyPermanent } from '../src/state/modules/counters_tokens.js';
import { checkGraveyardTrigger } from '../src/state/modules/triggered-abilities.js';
import { millCardsFromLibrary } from '../src/state/modules/triggerLibraryMillUtils.js';
import { pushCardToPlayerGraveyardWithReplacements } from '../src/state/modules/graveyardEntryUtils.js';
import {
  hasGraveyardMassShuffleIntoLibraryTrigger,
  hasGraveyardSelfShuffleIntoLibraryReplacement,
  hasGraveyardShuffleFromLibraryTrigger,
  hasGraveyardShuffleTrigger,
} from '../src/state/modules/zone-manipulation.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';

function createGraveyardShuffleCtx(playerId: PlayerID): GameContext {
  const ctx = createContext('gy-shuffle-test') as GameContext;
  const titan = {
    id: 'titan_1',
    name: 'Unnamed Eldrazi Titan',
    type_line: 'Legendary Creature — Eldrazi',
    oracle_text:
      'When Unnamed Eldrazi Titan is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.',
    zone: 'graveyard',
  };
  const other = { id: 'other_gy_1', name: 'Lightning Bolt', type_line: 'Instant', zone: 'graveyard' };
  const library = [{ id: 'lib_1', name: 'Island', type_line: 'Instant', zone: 'library' }];

  (ctx as any).state = {
    players: [{ id: playerId, name: 'P1' }],
    zones: {
      [playerId]: {
        graveyard: [titan, other],
        graveyardCount: 2,
        library: [...library],
        libraryCount: 1,
        hand: [],
        handCount: 0,
      },
    },
  };
  ctx.libraries.set(playerId, [...library]);
  return ctx;
}

describe('graveyard mass shuffle triggers (batch 179)', () => {
  it('detects Eldrazi-style oracle without card-name table', () => {
    const card = {
      name: 'Custom Titan',
      oracle_text:
        'When Custom Titan is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.',
    };
    expect(hasGraveyardShuffleTrigger(card)).toBe(true);
    expect(hasGraveyardMassShuffleIntoLibraryTrigger(card)).toBe(true);
  });

  it('does not treat Blightsteel replacement as mass graveyard shuffle', () => {
    const card = lookupLocalCardByNameSync('Blightsteel Colossus');
    expect(hasGraveyardSelfShuffleIntoLibraryReplacement(card)).toBe(true);
    expect(hasGraveyardShuffleTrigger(card)).toBe(false);
    expect(hasGraveyardMassShuffleIntoLibraryTrigger(card)).toBe(false);
  });

  it('shuffles graveyard into library when Kozilek oracle enters graveyard', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createGraveyardShuffleCtx(playerId);
    const kozilek = lookupLocalCardByNameSync('Kozilek, Butcher of Truth');
    expect(kozilek?.oracle_text).toMatch(/shuffles their graveyard into their library/i);

    const cardInGy = {
      ...(kozilek || {}),
      id: 'kozilek_gy',
      zone: 'graveyard',
    };
    (ctx as any).state.zones[playerId].graveyard.push(cardInGy);

    const handled = checkGraveyardTrigger(ctx, cardInGy, playerId);
    expect(handled).toBe(true);
    expect((ctx as any).state.zones[playerId].graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.length).toBeGreaterThan(1);
  });

  it('shuffles graveyard into library when Kozilek is destroyed on the battlefield', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createGraveyardShuffleCtx(playerId);
    const kozilek = lookupLocalCardByNameSync('Kozilek, Butcher of Truth');
    expect(kozilek).toBeTruthy();

    (ctx as any).state.battlefield = [{
      id: 'kozilek_bf',
      controller: playerId,
      owner: playerId,
      card: kozilek,
    }];

    const destroyed = destroyPermanent(ctx, 'kozilek_bf');
    expect(destroyed).toBe(true);
    expect((ctx as any).state.zones[playerId].graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.length).toBeGreaterThan(1);
  });

  it('does not treat Reminisce-style spell text as a GY-entry shuffle trigger', () => {
    const reminisce = lookupLocalCardByNameSync('Reminisce');
    expect(hasGraveyardMassShuffleIntoLibraryTrigger(reminisce)).toBe(false);
    expect(hasGraveyardShuffleFromLibraryTrigger(reminisce)).toBe(false);
    expect(hasGraveyardShuffleTrigger(reminisce)).toBe(false);
  });

  it('detects Gaea\'s Blessing as library-only, not from-anywhere', () => {
    const blessing = lookupLocalCardByNameSync("Gaea's Blessing");
    expect(blessing).toBeTruthy();
    expect(hasGraveyardShuffleFromLibraryTrigger(blessing)).toBe(true);
    expect(hasGraveyardMassShuffleIntoLibraryTrigger(blessing)).toBe(false);
    expect(hasGraveyardShuffleTrigger(blessing)).toBe(true);
  });

  it('shuffles the graveyard when Gaea\'s Blessing is milled', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createGraveyardShuffleCtx(playerId);
    const blessing = lookupLocalCardByNameSync("Gaea's Blessing");
    expect(blessing).toBeTruthy();
    const milled = { ...(blessing || {}), id: 'blessing_lib', zone: 'library' };
    ctx.libraries.set(playerId, [milled]);
    (ctx as any).state.zones[playerId].library = [milled];

    const milledCount = millCardsFromLibrary((ctx as any).state, playerId, 1, ctx, {
      skipEventPersistence: true,
    });
    expect(milledCount).toBe(1);
    expect((ctx as any).state.zones[playerId].graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.some((card: any) => String(card?.name) === "Gaea's Blessing")).toBe(true);
  });

  it('does not shuffle when Gaea\'s Blessing goes to the graveyard from the stack', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createGraveyardShuffleCtx(playerId);
    const blessing = lookupLocalCardByNameSync("Gaea's Blessing");
    const resolved = { ...(blessing || {}), id: 'blessing_stack', zone: 'stack' };
    const gyBefore = (ctx as any).state.zones[playerId].graveyard.length;

    const entered = pushCardToPlayerGraveyardWithReplacements(
      ctx,
      playerId,
      resolved,
      (ctx as any).state.zones[playerId].graveyard,
      { sourceZone: 'stack' },
    );
    expect(entered).toBe(true);
    expect((ctx as any).state.zones[playerId].graveyard.length).toBe(gyBefore + 1);
  });
});
