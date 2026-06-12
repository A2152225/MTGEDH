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

  it('does not grant Svyelun indestructible when alone on the battlefield', () => {
    const battlefield: any[] = [
      {
        id: 'svyelun_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'svyelun_card',
          name: 'Svyelun of Sea and Sky',
          type_line: 'Legendary Creature — Merfolk God',
          oracle_text:
            'Svyelun has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    const svyelunEffects = result.perPermanent.get('svyelun_1');

    expect(svyelunEffects?.abilities.has('indestructible')).toBe(false);
    expect(result.permanentAbilities.get('svyelun_1')?.has('indestructible')).toBe(false);
  });

  it('does not count ETB chosen creature types on lands toward Svyelun indestructible', () => {
    const battlefield: any[] = [
      {
        id: 'svyelun_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'svyelun_card',
          name: 'Svyelun of Sea and Sky',
          type_line: 'Legendary Creature — Merfolk God',
          oracle_text:
            'Svyelun has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.',
        },
      },
      {
        id: 'ut_1',
        controller: 'p1',
        owner: 'p1',
        chosenCreatureType: 'Merfolk',
        card: {
          id: 'ut_card',
          name: 'Unclaimed Territory',
          type_line: 'Land',
          oracle_text: 'As Unclaimed Territory enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.',
        },
      },
      {
        id: 'eclipsed_1',
        controller: 'p1',
        owner: 'p1',
        chosenCreatureType: 'Merfolk',
        card: {
          id: 'eclipsed_card',
          name: 'Eclipsed Realms',
          type_line: 'Land',
          oracle_text: 'As this land enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\n{T}: Add {C}.',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);

    expect(result.perPermanent.get('svyelun_1')?.abilities.has('indestructible')).toBe(false);
    expect(result.permanentAbilities.get('svyelun_1')?.has('indestructible')).toBe(false);
  });

  it('counts kindred Merfolk permanents toward Svyelun indestructible when the effect does not say creatures', () => {
    const battlefield: any[] = [
      {
        id: 'svyelun_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'svyelun_card',
          name: 'Svyelun of Sea and Sky',
          type_line: 'Legendary Creature — Merfolk God',
          oracle_text:
            'Svyelun has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.',
        },
      },
      {
        id: 'merfolk_creature_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'tidebinder_card',
          name: "Tishana's Tidebinder",
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk_kindred_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'merrow_card',
          name: 'Merrow Commerce',
          type_line: 'Kindred Enchantment — Merfolk',
          oracle_text: '',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    expect(result.perPermanent.get('svyelun_1')?.abilities.has('indestructible')).toBe(true);
  });

  it('does not count kindred Merfolk when the condition specifies creatures', () => {
    const battlefield: any[] = [
      {
        id: 'test_legend_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'test_legend_card',
          name: 'Test Legend',
          type_line: 'Legendary Creature — Merfolk',
          oracle_text: 'Test Legend has indestructible as long as you control at least two other Merfolk creatures.',
        },
      },
      {
        id: 'merfolk_creature_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'merfolk_creature_card',
          name: 'Merfolk Scout',
          type_line: 'Creature — Merfolk',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk_kindred_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'merrow_card',
          name: 'Merrow Commerce',
          type_line: 'Kindred Enchantment — Merfolk',
          oracle_text: '',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    expect(result.perPermanent.get('test_legend_1')?.abilities.has('indestructible')).toBe(false);
  });

  it('grants Svyelun indestructible with two other Merfolk creatures', () => {
    const merfolk = (id: string) => ({
      id,
      controller: 'p1',
      owner: 'p1',
      card: {
        id: `${id}_card`,
        name: `Merfolk ${id}`,
        type_line: 'Creature — Merfolk',
        oracle_text: '',
      },
    });

    const battlefield: any[] = [
      {
        id: 'svyelun_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'svyelun_card',
          name: 'Svyelun of Sea and Sky',
          type_line: 'Legendary Creature — Merfolk God',
          oracle_text:
            'Svyelun has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.',
        },
      },
      merfolk('merfolk_a'),
      merfolk('merfolk_b'),
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    const svyelunEffects = result.perPermanent.get('svyelun_1');

    expect(svyelunEffects?.abilities.has('indestructible')).toBe(true);
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