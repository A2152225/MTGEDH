import { describe, expect, it } from 'vitest';

import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities.js';
import { applyGraveyardTypeEntryCounterGrants } from '../src/state/modules/graveyardTypeEntryCounterBonus.js';

const RIFTSTONE_ORACLE = '{T}: Add {C}.\nAs long as this card is in your graveyard, lands you control have "{T}: Add {G} or {W}."';
const DEARLY_DEPARTED_ORACLE = 'Flying\nAs long as this creature is in your graveyard, each Human creature you control enters with an additional +1/+1 counter on it.';

describe('graveyard-functioning static grants', () => {
  it('lets a Forest tap for G or W while Riftstone Portal is in the graveyard', () => {
    const forest = {
      id: 'forest_1',
      controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
    };
    const state = {
      battlefield: [forest],
      zones: {
        p1: {
          graveyard: [{
            id: 'riftstone_gy',
            name: 'Riftstone Portal',
            type_line: 'Land',
            oracle_text: RIFTSTONE_ORACLE,
          }],
        },
      },
    };

    const abilities = getManaAbilitiesForPermanent(state, forest, 'p1');
    const granted = abilities.filter((ability) => ability.isGranted);
    expect(granted.some((ability) => (
      ability.produces.includes('G') && ability.produces.includes('W') && ability.producesAllAtOnce === false
    ))).toBe(true);
  });

  it('does not grant G/W while Riftstone Portal is on the battlefield', () => {
    const forest = {
      id: 'forest_1',
      controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
    };
    const state = {
      battlefield: [
        {
          id: 'riftstone_bf',
          controller: 'p1',
          card: {
            name: 'Riftstone Portal',
            type_line: 'Land',
            oracle_text: RIFTSTONE_ORACLE,
          },
        },
        forest,
      ],
      zones: { p1: { graveyard: [] } },
    };

    const abilities = getManaAbilitiesForPermanent(state, forest, 'p1');
    expect(abilities.some((ability) => ability.isGranted && ability.produces.includes('W'))).toBe(false);
  });

  it('gives Humans an extra +1/+1 counter when Dearly Departed is in the graveyard', () => {
    const human = {
      id: 'human_1',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Champion of the Parish',
        type_line: 'Creature — Human Soldier',
        oracle_text: '',
      },
    };
    const bear = {
      id: 'bear_1',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
    };
    const state = {
      battlefield: [],
      zones: {
        p1: {
          graveyard: [{
            id: 'dearly_gy',
            name: 'Dearly Departed',
            type_line: 'Creature — Spirit',
            oracle_text: DEARLY_DEPARTED_ORACLE,
          }],
        },
      },
    };

    applyGraveyardTypeEntryCounterGrants(state, human, 'p1');
    applyGraveyardTypeEntryCounterGrants(state, bear, 'p1');
    expect(human.counters['+1/+1']).toBe(1);
    expect(bear.counters['+1/+1'] || 0).toBe(0);
  });

  it('does not add ETB counters while Dearly Departed is only on the battlefield', () => {
    const human = {
      id: 'human_1',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Champion of the Parish',
        type_line: 'Creature — Human Soldier',
        oracle_text: '',
      },
    };
    const state = {
      battlefield: [{
        id: 'dearly_bf',
        controller: 'p1',
        card: {
          name: 'Dearly Departed',
          type_line: 'Creature — Spirit',
          oracle_text: DEARLY_DEPARTED_ORACLE,
        },
      }],
      zones: { p1: { graveyard: [] } },
    };

    applyGraveyardTypeEntryCounterGrants(state, human, 'p1');
    expect(human.counters['+1/+1'] || 0).toBe(0);
  });

  it('still grants Riftstone mana when the graveyard card has no instance id', () => {
    const forest = {
      id: 'forest_1',
      controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
    };
    const state = {
      battlefield: [forest],
      zones: {
        p1: {
          graveyard: [{
            name: 'Riftstone Portal',
            type_line: 'Land',
            oracle_text: RIFTSTONE_ORACLE,
          }],
        },
      },
    };

    const abilities = getManaAbilitiesForPermanent(state, forest, 'p1');
    expect(abilities.some((ability) => (
      ability.isGranted && ability.produces.includes('G') && ability.produces.includes('W')
    ))).toBe(true);
  });
});
