import { describe, expect, it } from 'vitest';
import {
  cardHasGraveyardBestow,
  cardHasGraveyardBlitz,
  parseBlitzAdditionalCosts,
  parseGraveyardBestowCollectEvidence,
} from '../src/state/modules/blitzAdditionalCosts.js';

describe('parseBlitzAdditionalCosts', () => {
  it('parses Tenacious Underdog pay-life blitz', () => {
    const costs = parseBlitzAdditionalCosts(
      'Blitz—{1}{B}, Pay 2 life.\nYou may cast Tenacious Underdog from your graveyard using its blitz ability.',
    );
    expect(costs).toEqual([
      { type: 'pay_life', amount: 2, mandatory: true, label: 'Pay 2 life' },
    ]);
    expect(cardHasGraveyardBlitz(
      'You may cast Tenacious Underdog from your graveyard using its blitz ability.',
    )).toBe(true);
  });

  it('parses a blitz cost that also discards a card (Sabin)', () => {
    const costs = parseBlitzAdditionalCosts(
      'Blitz — {2}{R}{R}, Discard a card.\nHaste',
    );
    expect(costs).toEqual([
      { type: 'discard', count: 1, mandatory: true, label: 'Discard a card' },
    ]);
  });

  it('returns no extras for a mana-only blitz cost', () => {
    expect(parseBlitzAdditionalCosts('Blitz {2}{R} (If you cast this spell for its blitz cost...')).toEqual([]);
  });
});

describe('parseGraveyardBestowCollectEvidence', () => {
  const phoenix =
    'Bestow {1}{R}{R}\nFlying, haste\nYou may cast Detective\'s Phoenix from your graveyard using its bestow ability. If you do, it also requires collect evidence 6.';

  it('detects Detective\'s Phoenix graveyard bestow plus evidence 6', () => {
    expect(cardHasGraveyardBestow(phoenix)).toBe(true);
    expect(parseGraveyardBestowCollectEvidence(phoenix)).toEqual({ required: 6, mandatory: true });
  });

  it('is silent for ordinary bestow creatures', () => {
    expect(parseGraveyardBestowCollectEvidence('Bestow {3}{W} (If you cast this card for its bestow cost...)')).toBeNull();
  });
});
