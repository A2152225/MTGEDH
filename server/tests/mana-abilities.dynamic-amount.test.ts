import { describe, expect, it } from 'vitest';

import { getCreatureCountManaAmount } from '../src/state/modules/mana-abilities.js';

describe('dynamic mana ability helpers', () => {
  it('uses boosted creature power for Bighorner Rancher mana', () => {
    const state: any = {
      battlefield: [
        {
          id: 'rancher',
          controller: 'p1',
          card: {
            name: 'Bighorner Rancher',
            type_line: 'Creature — Ox Mount',
            oracle_text: '{T}: Add an amount of {G} equal to the greatest power among creatures you control.',
          },
        },
        {
          id: 'hydra',
          controller: 'p1',
          basePower: 4,
          counters: { plusOne: 6 },
          modifiers: [{ type: 'powerToughness', power: 6, toughness: 6 }],
          card: {
            name: 'Mossborn Hydra',
            type_line: 'Creature — Hydra',
            power: '4',
            toughness: '4',
            oracle_text: '',
          },
        },
      ],
    };

    expect(getCreatureCountManaAmount(state, state.battlefield[0], 'p1')).toEqual({
      color: 'G',
      amount: 16,
    });
  });

  it('uses boosted creature power for Selvala mana', () => {
    const state: any = {
      battlefield: [
        {
          id: 'selvala',
          controller: 'p1',
          card: {
            name: 'Selvala, Heart of the Wilds',
            type_line: 'Legendary Creature — Elf Scout',
            oracle_text: '{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control.',
          },
        },
        {
          id: 'hydra',
          controller: 'p1',
          basePower: 4,
          counters: { plusOne: 6 },
          modifiers: [{ type: 'POWER_TOUGHNESS', power: 6, toughness: 6 }],
          card: {
            name: 'Mossborn Hydra',
            type_line: 'Creature — Hydra',
            power: '4',
            toughness: '4',
            oracle_text: '',
          },
        },
      ],
    };

    expect(getCreatureCountManaAmount(state, state.battlefield[0], 'p1')).toEqual({
      color: 'any_combination',
      amount: 16,
    });
  });

  it("uses Vivi Ornitier's power for U/R combination mana", () => {
    const vivi: any = {
      id: 'vivi_1',
      controller: 'p1',
      basePower: 0,
      baseToughness: 3,
      counters: { '+1/+1': 4 },
      card: {
        name: 'Vivi Ornitier',
        type_line: 'Legendary Creature — Wizard',
        power: '0',
        toughness: '3',
        oracle_text:
          "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.\n" +
          'Whenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.',
      },
    };
    const state: any = { battlefield: [vivi] };

    expect(getCreatureCountManaAmount(state, vivi, 'p1')).toEqual({
      color: 'combination:U,R',
      amount: 4,
    });
  });

  it('parses Three Tree City as any_one_color based on chosen creature type count', () => {
    const city: any = {
      id: 'city_1',
      controller: 'p1',
      chosenCreatureType: 'Rabbit',
      card: {
        name: 'Three Tree City',
        type_line: 'Legendary Land',
        oracle_text:
          'As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.',
      },
    };
    const state: any = {
      battlefield: [
        city,
        { id: 'r1', controller: 'p1', card: { name: 'Valley Questcaller', type_line: 'Creature — Rabbit Warrior' } },
      ],
    };

    expect(getCreatureCountManaAmount(state, city, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 1,
      activationCost: '{2}',
    });
  });

  it("uses this creature's power for Add X mana of any one color (Heronblade / Kami)", () => {
    const elite: any = {
      id: 'elite_1',
      controller: 'p1',
      basePower: 1,
      counters: { '+1/+1': 4 },
      card: {
        name: 'Heronblade Elite',
        type_line: 'Creature — Human Warrior',
        power: '1',
        toughness: '1',
        oracle_text: "{T}: Add X mana of any one color, where X is this creature's power.",
      },
    };

    expect(getCreatureCountManaAmount({ battlefield: [elite] }, elite, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 5,
    });
  });

  it("uses Helga's power for restricted any-one-color mana", () => {
    const helga: any = {
      id: 'helga_1',
      controller: 'p1',
      basePower: 2,
      counters: { '+1/+1': 3 },
      card: {
        name: 'Helga, Skittish Seer',
        type_line: 'Legendary Creature — Frog Druid',
        power: '2',
        toughness: '2',
        oracle_text:
          "{T}: Add X mana of any one color, where X is Helga's power. Spend this mana only to cast creature spells with mana value 4 or greater or creature spells with {X} in their mana costs.",
      },
    };

    expect(getCreatureCountManaAmount({ battlefield: [helga] }, helga, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 5,
    });
  });

  it('parses fixed-amount specific color combinations', () => {
    const twoMana: any = {
      id: 'filter_1',
      controller: 'p1',
      card: {
        name: 'Two-Color Filter',
        type_line: 'Artifact',
        oracle_text: '{T}: Add two mana in any combination of {W} and/or {U}.',
      },
    };

    expect(getCreatureCountManaAmount({ battlefield: [twoMana] }, twoMana, 'p1')).toEqual({
      color: 'combination:W,U',
      amount: 2,
    });
  });
});
