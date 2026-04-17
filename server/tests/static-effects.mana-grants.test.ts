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

  it('grants Ozai its conditional flying and indestructible only at six or more unspent mana', () => {
    const battlefield: any[] = [
      {
        id: 'ozai_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'ozai_card',
          name: 'Ozai, the Phoenix King',
          type_line: 'Legendary Creature — Human Noble',
          oracle_text: 'Trample, firebending 4, haste\nIf you would lose unspent mana, that mana becomes red instead.\nOzai has flying and indestructible as long as you have six or more unspent mana.',
          power: '7',
          toughness: '7',
        },
      },
    ];

    const belowThreshold = computeContinuousEffects({
      battlefield,
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 5, green: 0, colorless: 0 },
      },
    } as any);
    expect(belowThreshold.perPermanent.get('ozai_1')?.abilities.has('flying')).toBe(false);
    expect(belowThreshold.perPermanent.get('ozai_1')?.abilities.has('indestructible')).toBe(false);

    const atThreshold = computeContinuousEffects({
      battlefield,
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 6, green: 0, colorless: 0 },
      },
    } as any);
    expect(atThreshold.perPermanent.get('ozai_1')?.abilities.has('flying')).toBe(true);
    expect(atThreshold.perPermanent.get('ozai_1')?.abilities.has('indestructible')).toBe(true);
  });
});