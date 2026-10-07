import { describe, expect, it } from 'vitest';
import {
  applyBattlefieldTypeEntryCounterGrants,
  parseBattlefieldTypeEntryCounterGrant,
} from '../src/state/modules/battlefieldTypeEntryCounterBonus.js';

const GIADA_ORACLE =
  'Flying, vigilance\nEach other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.\n{T}: Add {W}. Spend this mana only to cast an Angel spell.';

describe('battlefield type entry counter grants (Giada-style)', () => {
  it('parses Giada for-each-already-controlled grant', () => {
    expect(parseBattlefieldTypeEntryCounterGrant(GIADA_ORACLE)).toEqual({
      creatureType: 'Angel',
      mode: 'for_each_already_controlled',
    });
  });

  it('does not steal Metallic Mimic chosen-type wording', () => {
    expect(
      parseBattlefieldTypeEntryCounterGrant(
        'As Metallic Mimic enters, choose a creature type.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.',
      ),
    ).toBeNull();
  });

  it('puts +1/+1 on an entering Angel equal to Angels already controlled', () => {
    const entering = {
      id: 'serra',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Serra Avenger',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying, vigilance',
      },
    };
    const state = {
      battlefield: [
        {
          id: 'giada',
          controller: 'p1',
          card: {
            name: 'Giada, Font of Hope',
            type_line: 'Legendary Creature — Angel',
            oracle_text: GIADA_ORACLE,
          },
        },
        {
          id: 'angel2',
          controller: 'p1',
          card: {
            name: 'Bishop of Wings',
            type_line: 'Creature — Human Cleric',
            oracle_text: '',
          },
        },
        {
          id: 'angel3',
          controller: 'p1',
          card: {
            name: 'Youthful Valkyrie',
            type_line: 'Creature — Angel',
            oracle_text: 'Flying',
          },
        },
        entering,
      ],
    };

    applyBattlefieldTypeEntryCounterGrants(state, entering, 'p1');
    // Giada + Youthful Valkyrie already controlled (Bishop is not an Angel)
    expect(entering.counters['+1/+1']).toBe(2);
  });

  it('does not grant when entering creature is not the printed type', () => {
    const entering = {
      id: 'bear',
      controller: 'p1',
      counters: {},
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const state = {
      battlefield: [
        {
          id: 'giada',
          controller: 'p1',
          card: {
            name: 'Giada, Font of Hope',
            type_line: 'Legendary Creature — Angel',
            oracle_text: GIADA_ORACLE,
          },
        },
        entering,
      ],
    };
    applyBattlefieldTypeEntryCounterGrants(state, entering, 'p1');
    expect(entering.counters['+1/+1'] || 0).toBe(0);
  });

  it('does not grant from an opponent Giada', () => {
    const entering = {
      id: 'serra',
      controller: 'p1',
      counters: {},
      card: { name: 'Serra Avenger', type_line: 'Creature — Angel', oracle_text: '' },
    };
    const state = {
      battlefield: [
        {
          id: 'giada',
          controller: 'p2',
          card: {
            name: 'Giada, Font of Hope',
            type_line: 'Legendary Creature — Angel',
            oracle_text: GIADA_ORACLE,
          },
        },
        entering,
      ],
    };
    applyBattlefieldTypeEntryCounterGrants(state, entering, 'p1');
    expect(entering.counters['+1/+1'] || 0).toBe(0);
  });
});
