import { describe, expect, it } from 'vitest';

import {
  applyStashedIgnoredCardsIfMatch,
  ignoredCardsFromViewMap,
  payloadMatchesViewer,
  shouldSeedIgnoredCardsFromView,
  stashIgnoredCardsPayload,
} from '../src/utils/ignoredCardsSync';

const solRing = {
  permanentId: 'perm1',
  cardId: 'card1',
  cardName: 'Sol Ring',
  imageUrl: 'http://example/sol.png',
  zone: 'battlefield',
};

const ownPayload = {
  gameId: 'g1',
  playerId: 'p1',
  ignoredCards: [solRing],
};

describe('ignored cards join/refresh sync', () => {
  it('keeps a join emit that arrives before you and safeView.id exist', () => {
    const stash = { current: null };
    stashIgnoredCardsPayload(stash, ownPayload);
    expect(applyStashedIgnoredCardsIfMatch(stash, null, null)).toBeNull();
    expect(applyStashedIgnoredCardsIfMatch(stash, 'g1', null)).toBeNull();
    expect(applyStashedIgnoredCardsIfMatch(stash, null, 'p1')).toBeNull();
    expect(applyStashedIgnoredCardsIfMatch(stash, 'g1', 'p1')).toEqual([solRing]);
  });

  it('applies immediately when viewer identity already matches', () => {
    const stash = { current: null };
    const stashed = stashIgnoredCardsPayload(stash, ownPayload);
    expect(payloadMatchesViewer(stashed, 'g1', 'p1')).toBe(true);
    expect(applyStashedIgnoredCardsIfMatch(stash, 'g1', 'p1')).toEqual([solRing]);
  });

  it('ignores events for other players or other games', () => {
    const stash = { current: null };
    stashIgnoredCardsPayload(stash, {
      gameId: 'g1',
      playerId: 'p2',
      ignoredCards: [solRing],
    });
    expect(applyStashedIgnoredCardsIfMatch(stash, 'g1', 'p1')).toBeNull();

    stashIgnoredCardsPayload(stash, {
      gameId: 'g2',
      playerId: 'p1',
      ignoredCards: [solRing],
    });
    expect(applyStashedIgnoredCardsIfMatch(stash, 'g1', 'p1')).toBeNull();
  });

  it('maps view leftover cards to the emit array shape', () => {
    expect(
      ignoredCardsFromViewMap({
        oid: {
          permanentId: 'perm1',
          cardId: 'card1',
          cardName: 'Sol Ring',
          imageUrl: 'http://example/sol.png',
          zone: 'hand',
        },
      }),
    ).toEqual([
      {
        permanentId: 'perm1',
        cardId: 'card1',
        cardName: 'Sol Ring',
        imageUrl: 'http://example/sol.png',
        zone: 'hand',
      },
    ]);
  });

  it('seeds from the view only when the rail is empty and no live emit won', () => {
    const viewMap = {
      perm1: { cardName: 'Sol Ring', cardId: 'card1' },
    };
    expect(
      shouldSeedIgnoredCardsFromView({
        gameId: 'g1',
        playerId: 'p1',
        railEmpty: true,
        appliedLiveForGameId: null,
        viewMap,
      }),
    ).toEqual([
      {
        permanentId: 'perm1',
        cardId: 'card1',
        cardName: 'Sol Ring',
        imageUrl: undefined,
        zone: 'battlefield',
      },
    ]);

    expect(
      shouldSeedIgnoredCardsFromView({
        gameId: 'g1',
        playerId: 'p1',
        railEmpty: true,
        appliedLiveForGameId: 'g1',
        viewMap,
      }),
    ).toBeNull();

    expect(
      shouldSeedIgnoredCardsFromView({
        gameId: 'g1',
        playerId: 'p1',
        railEmpty: false,
        appliedLiveForGameId: null,
        viewMap,
      }),
    ).toBeNull();
  });
});
