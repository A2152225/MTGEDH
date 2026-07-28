import { describe, expect, it } from 'vitest';

import { detectLandfallTriggers, getLandfallTriggers } from '../src/state/modules/triggers/landfall';
import { getETBTriggersForPermanent } from '../src/state/modules/triggered-abilities';

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
        effect: expect.stringMatching(/create a 1\/1 green Saproling creature token\.?/i),
        triggerType: 'typed_land_enter',
        requiredLandType: 'forest',
      }),
    ]);
  });

  it('does not treat permanent/artifact/enchantment ETB templates as typed landfall', () => {
    for (const noun of ['permanent', 'artifact', 'enchantment', 'planeswalker']) {
      const card = {
        name: `Fake ${noun}`,
        oracle_text: `Whenever a ${noun} you control enters, draw a card.`,
      };
      expect(detectLandfallTriggers(card, { id: 'p', controller: 'p1', card })).toEqual([]);
    }
  });

  it('filters typed Forest landfall against the entering land subtype', () => {
    const titania = {
      id: 'titania',
      controller: 'p1',
      card: {
        name: "Titania, Nature's Force",
        oracle_text: 'Whenever a Forest you control enters, create a 5/3 green Elemental creature token.',
      },
    };
    const forest = {
      id: 'forest_1',
      controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest' },
    };
    const island = {
      id: 'island_1',
      controller: 'p1',
      card: { name: 'Island', type_line: 'Basic Land — Island' },
    };

    expect(getLandfallTriggers({ state: { battlefield: [titania, forest] } } as any, 'p1', forest)).toEqual([
      expect.objectContaining({ cardName: "Titania, Nature's Force", requiredLandType: 'forest' }),
    ]);
    expect(getLandfallTriggers({ state: { battlefield: [titania, island] } } as any, 'p1', island)).toEqual([]);
  });

  it('does not dual-classify landfall cards as creature_etb (inverse of Aura Shards)', () => {
    const landfallCards = [
      {
        name: 'Scute Swarm',
        oracle_text: 'Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token.',
      },
      {
        name: 'Lotus Cobra',
        oracle_text: 'Landfall — Whenever a land you control enters, add one mana of any color.',
      },
      {
        name: "Titania, Nature's Force",
        oracle_text: 'Whenever a Forest you control enters, create a 5/3 green Elemental creature token.',
      },
    ];

    for (const card of landfallCards) {
      const permanent = { id: 'src', controller: 'p1', card };
      expect(detectLandfallTriggers(card, permanent).length).toBeGreaterThan(0);
      expect(
        getETBTriggersForPermanent(card, permanent).filter((t) => t.triggerType === 'creature_etb'),
      ).toEqual([]);
    }
  });

  it('keeps Aura Shards as creature_etb only (not landfall)', () => {
    const card = {
      name: 'Aura Shards',
      oracle_text:
        'Whenever a creature you control enters, you may destroy target artifact or enchantment.',
    };
    const permanent = { id: 'aura', controller: 'p1', card };
    expect(detectLandfallTriggers(card, permanent)).toEqual([]);
    expect(getETBTriggersForPermanent(card, permanent).some((t) => t.triggerType === 'creature_etb')).toBe(true);
  });
});
