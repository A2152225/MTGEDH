import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { destroyPermanent } from '../src/state/modules/counters_tokens.js';
import { checkGraveyardTrigger } from '../src/state/modules/triggered-abilities.js';
import {
  hasGraveyardMassShuffleIntoLibraryTrigger,
  hasGraveyardSelfShuffleIntoLibraryReplacement,
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
});
