import { describe, expect, it } from 'vitest';

import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall';

describe('landfall detection', () => {
  it('does not treat Aura Shards creature ETB as landfall', () => {
    const card = {
      name: 'Aura Shards',
      oracle_text:
        'Whenever a creature you control enters, you may destroy target artifact or enchantment.',
    };
    const permanent = { id: 'perm-aura-shards', controller: 'p1', card };

    expect(detectLandfallTriggers(card, permanent)).toEqual([]);
  });

  it('still detects typed land subtypes like forest', () => {
    const card = {
      name: 'Test Forest Landfall',
      oracle_text:
        'Whenever a Forest you control enters, create a 1/1 green Saproling creature token.',
    };
    const permanent = { id: 'perm-forest-landfall', controller: 'p1', card };

    expect(detectLandfallTriggers(card, permanent)).toEqual([
      expect.objectContaining({
        cardName: 'Test Forest Landfall',
        effect: 'create a 1/1 green Saproling creature token',
        triggerType: 'typed_land_enter',
      }),
    ]);
  });
});
