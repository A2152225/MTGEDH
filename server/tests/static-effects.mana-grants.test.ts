import { describe, expect, it } from 'vitest';

import { computeContinuousEffects } from '../src/rules-engine/staticEffects.js';

describe('Static effect mana-grant abilities', () => {
  it('grants Cryptolith Rite mana text to creatures you control, not the enchantment', () => {
    const battlefield: any[] = [
      {
        id: 'cryptolith_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'cryptolith_card',
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      },
      {
        id: 'bear_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    const creatureEffects = result.perPermanent.get('bear_1');

    expect(creatureEffects?.abilities.has('tap_for_any_color')).toBe(true);
    expect(result.permanentAbilities.get('cryptolith_1')?.has('tap_for_any_color')).toBe(false);
  });

  it('grants Citanul Hierophants mana text to creatures you control', () => {
    const battlefield: any[] = [
      {
        id: 'citanul_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'citanul_card',
          name: 'Citanul Hierophants',
          type_line: 'Creature — Human Druid',
          oracle_text: 'Creatures you control have "{T}: Add {G}."',
        },
      },
      {
        id: 'bear_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    const creatureEffects = result.perPermanent.get('bear_1');

    expect(creatureEffects?.abilities.has('tap_for_green')).toBe(true);
  });
});