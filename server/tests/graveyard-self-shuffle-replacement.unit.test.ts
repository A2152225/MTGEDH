import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { destroyPermanent } from '../src/state/modules/counters_tokens.js';
import { applySurveil } from '../src/state/modules/zones.js';
import { pushCardToPlayerGraveyardWithReplacements } from '../src/state/modules/graveyardEntryUtils.js';
import {
  hasGraveyardMassShuffleIntoLibraryTrigger,
  hasGraveyardSelfShuffleIntoLibraryReplacement,
  tryApplyGraveyardSelfShuffleReplacementForCard,
} from '../src/state/modules/zone-manipulation.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';

function createSelfShuffleTestCtx(playerId: PlayerID): GameContext {
  const ctx = createContext('self-shuffle-test') as GameContext;
  (ctx as any).state = {
    players: [{ id: playerId, name: 'P1' }],
    battlefield: [],
    zones: {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    },
  };
  ctx.libraries.set(playerId, []);
  return ctx;
}

describe('graveyard self-shuffle replacement (batch 180)', () => {
  it('detects Blightsteel-style replacement without mass graveyard shuffle', () => {
    const card = lookupLocalCardByNameSync('Blightsteel Colossus');
    expect(card?.oracle_text).toMatch(/would be put into a graveyard from anywhere/i);
    expect(hasGraveyardSelfShuffleIntoLibraryReplacement(card)).toBe(true);
    expect(hasGraveyardMassShuffleIntoLibraryTrigger(card)).toBe(false);
  });

  it('detects Nexus of Fate self-shuffle replacement', () => {
    const card = lookupLocalCardByNameSync('Nexus of Fate');
    expect(card?.oracle_text).toMatch(/would be put into a graveyard from anywhere/i);
    expect(hasGraveyardSelfShuffleIntoLibraryReplacement(card)).toBe(true);
    expect(hasGraveyardMassShuffleIntoLibraryTrigger(card)).toBe(false);
  });

  it('shuffles Blightsteel into library instead of graveyard when destroyed', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createSelfShuffleTestCtx(playerId);
    const blightsteel = lookupLocalCardByNameSync('Blightsteel Colossus');
    expect(blightsteel).toBeTruthy();

    (ctx as any).state.battlefield = [{
      id: 'blightsteel_1',
      controller: playerId,
      owner: playerId,
      card: blightsteel,
    }];

    const destroyed = destroyPermanent(ctx, 'blightsteel_1');
    expect(destroyed).toBe(true);
    expect((ctx as any).state.battlefield).toHaveLength(0);
    expect((ctx as any).state.zones[playerId].graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.some((card) => card.name === 'Blightsteel Colossus')).toBe(true);
    expect((ctx as any).state.creaturesDiedThisTurnByController?.[playerId]).toBeUndefined();
  });

  it('shuffles Nexus of Fate into library when it would enter graveyard from stack resolution', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createSelfShuffleTestCtx(playerId);
    const nexus = lookupLocalCardByNameSync('Nexus of Fate');
    expect(nexus).toBeTruthy();

    const applied = tryApplyGraveyardSelfShuffleReplacementForCard(ctx, nexus, playerId);
    expect(applied).toBe(true);
    expect((ctx as any).state.zones[playerId].graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.some((card) => card.name === 'Nexus of Fate')).toBe(true);
  });

  it('self-shuffles Nexus of Fate when surveiled into graveyard', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createSelfShuffleTestCtx(playerId);
    const nexus = lookupLocalCardByNameSync('Nexus of Fate');
    expect(nexus).toBeTruthy();

    ctx.libraries.set(playerId, [{ ...(nexus as any), id: 'nexus_lib', zone: 'library' }]);
    applySurveil(ctx, playerId, ['nexus_lib'], []);

    expect((ctx as any).state.zones[playerId].graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.some((card) => card.name === 'Nexus of Fate')).toBe(true);
  });

  it('self-shuffles Nexus of Fate when discarded from hand', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createSelfShuffleTestCtx(playerId);
    const nexus = lookupLocalCardByNameSync('Nexus of Fate');
    expect(nexus).toBeTruthy();

    const hand = [{ ...(nexus as any), id: 'nexus_hand', zone: 'hand' }];
    (ctx as any).state.zones[playerId].hand = hand;
    const graveyard = (ctx as any).state.zones[playerId].graveyard as any[];

    pushCardToPlayerGraveyardWithReplacements(ctx, playerId, hand[0], graveyard, {
      extraFields: { discardedByPlayerId: playerId },
    });

    expect(graveyard).toHaveLength(0);
    expect(ctx.libraries.get(playerId)?.some((card) => card.name === 'Nexus of Fate')).toBe(true);
  });

  it('exiles discarded cards when Rest in Peace is on the battlefield', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createSelfShuffleTestCtx(playerId);
    const rip = lookupLocalCardByNameSync('Rest in Peace');
    const bolt = lookupLocalCardByNameSync('Lightning Bolt');
    expect(rip).toBeTruthy();
    expect(bolt).toBeTruthy();

    (ctx as any).state.battlefield = [{
      id: 'rip_1',
      controller: 'p2',
      card: rip,
    }];

    const handCard = { ...(bolt as any), id: 'bolt_hand', zone: 'hand' };
    const graveyard = (ctx as any).state.zones[playerId].graveyard as any[];
    const exiled = pushCardToPlayerGraveyardWithReplacements(ctx, playerId, handCard, graveyard, {
      sourceZone: 'hand',
    });

    expect(exiled).toBe(false);
    expect(graveyard).toHaveLength(0);
    expect((ctx as any).state.zones[playerId].exile.some((card: any) => card.name === 'Lightning Bolt')).toBe(true);
  });
});
