import { describe, expect, it } from 'vitest';

import { applyStateBasedActions } from '../src/rules-engine/index.js';

describe('applyStateBasedActions dynamic toughness', () => {
  it('does not destroy Omnath when floating green mana raises toughness above marked damage', () => {
    const state = {
      battlefield: [
        {
          id: 'omnath_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          counters: {},
          damageMarked: 2,
          card: {
            id: 'omnath_card_1',
            name: 'Omnath, Locus of Mana',
            type_line: 'Legendary Creature — Elemental',
            oracle_text: 'Green mana doesn\'t empty from your mana pool as steps and phases end.\nOmnath, Locus of Mana gets +1/+1 for each green mana in your mana pool.',
            power: '1',
            toughness: '1',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 11, colorless: 0 },
      },
      players: [{ id: 'p1', name: 'P1', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 } },
      life: { p1: 40 },
      commandZone: {},
      emblems: [],
      conspiracies: [],
    } as any;

    const result = applyStateBasedActions(state);
    expect(result.destroys).not.toContain('omnath_1');
  });

  it('respects anthem-style toughness bonuses when checking lethal damage', () => {
    const state = {
      battlefield: [
        {
          id: 'bear_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          counters: {},
          damageMarked: 2,
          card: {
            id: 'bear_card_1',
            name: 'Silvercoat Lion',
            type_line: 'Creature — Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'anthem_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          counters: {},
          card: {
            id: 'anthem_card_1',
            name: 'Glorious Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control get +1/+1.',
          },
        },
      ],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      players: [{ id: 'p1', name: 'P1', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 } },
      life: { p1: 40 },
      commandZone: {},
      emblems: [],
      conspiracies: [],
    } as any;

    const result = applyStateBasedActions(state);
    expect(result.destroys).not.toContain('bear_1');
  });
});