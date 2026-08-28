import { describe, expect, it } from 'vitest';

import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { KNOWN_ETB_TRIGGERS } from '../src/state/modules/triggers/card-data-tables.js';

/**
 * P4b: creature_etb life/damage pack was removed from KNOWN_ETB_TRIGGERS.
 * Generic detectETBTriggers must still fire using real oracle + synthetic names
 * that cannot substring-match remaining table keys.
 */
const RETIRED_CREATURE_ETB_PACK: Array<{
  label: string;
  oracle: string;
  expectTypes: string[];
  optional?: boolean;
  /** When true, at least one of expectTypes must match (not all). */
  anyOfTypes?: boolean;
}> = [
  {
    label: 'Impact Tremors',
    oracle: 'Whenever a creature you control enters, Impact Tremors deals 1 damage to each opponent.',
    expectTypes: ['creature_etb'],
  },
  {
    label: 'Purphoros, God of the Forge',
    oracle: 'Whenever another creature you control enters, Purphoros deals 2 damage to each opponent.',
    expectTypes: ['creature_etb'],
  },
  {
    label: 'Soul Warden',
    oracle: 'Whenever another creature enters the battlefield, you gain 1 life.',
    expectTypes: ['creature_etb'],
  },
  {
    label: "Soul's Attendant",
    oracle: 'Whenever another creature enters the battlefield, you may gain 1 life.',
    expectTypes: ['creature_etb'],
    optional: true,
  },
  {
    label: 'Essence Warden',
    oracle: 'Whenever another creature enters the battlefield, you gain 1 life.',
    expectTypes: ['creature_etb'],
  },
  {
    label: "Ajani's Welcome",
    oracle: 'Whenever a creature you control enters, you gain 1 life.',
    expectTypes: ['creature_etb'],
  },
  {
    label: 'Corpse Knight',
    oracle: 'Whenever another creature you control enters, each opponent loses 1 life and you gain 1 life.',
    expectTypes: ['creature_etb'],
  },
  {
    label: 'Blood Seeker',
    oracle: 'Whenever a creature controlled by an opponent enters, that player loses 1 life.',
    // Generic detector may classify as creature_etb and/or opponent_creature_etb.
    expectTypes: ['creature_etb', 'opponent_creature_etb'],
    anyOfTypes: true,
  },
  {
    label: 'Suture Priest',
    oracle:
      'Whenever another creature you control enters, you gain 1 life. Whenever a creature controlled by an opponent enters, that player loses 1 life.',
    expectTypes: ['creature_etb', 'opponent_creature_etb'],
    anyOfTypes: true,
  },
  {
    label: 'Impassioned Orator',
    oracle: 'Whenever another creature you control enters, you gain 1 life.',
    expectTypes: ['creature_etb'],
  },
];

describe('KNOWN_ETB_TRIGGERS redundancy (P4b creature_etb pack)', () => {
  it('no longer lists the retired creature_etb life/damage pack keys', () => {
    const retiredKeys = [
      'impact tremors',
      'purphoros, god of the forge',
      'soul warden',
      "soul's attendant",
      'essence warden',
      "ajani's welcome",
      'corpse knight',
      'blood seeker',
      'suture priest',
      'impassioned orator',
      'dina, soul steeper',
      "cathar's crusade",
      'altar of the brood',
    ];
    for (const key of retiredKeys) {
      expect(KNOWN_ETB_TRIGGERS[key]).toBeUndefined();
    }
  });

  it('no longer lists Bojuka Bog; generic self-ETB targeting covers it', () => {
    expect(KNOWN_ETB_TRIGGERS['bojuka bog']).toBeUndefined();
  });

  it('keeps tutor searchFilter metadata rows', () => {
    expect(KNOWN_ETB_TRIGGERS['imperial recruiter']?.searchFilter?.maxPower).toBe(2);
    expect(KNOWN_ETB_TRIGGERS['wood elves']?.searchFilter?.subtypes).toBeTruthy();
  });

  it('generic detectETBTriggers still fires Altar millAmount from effect text', () => {
    const card = {
      id: 'synthetic_altar_of_the_brood',
      name: 'Synthetic Altar of the Brood Probe',
      type_line: 'Artifact',
      oracle_text: 'Whenever another permanent you control enters, each opponent mills a card.',
    };
    const permanent = { id: `${card.id}_perm`, controller: 'p1', card };
    const triggers = detectETBTriggers(card, permanent);
    const altar = triggers.find((entry) => entry.triggerType === 'another_permanent_etb');
    expect(altar).toBeTruthy();
    expect(altar?.millAmount).toBe(1);
  });

  for (const sample of RETIRED_CREATURE_ETB_PACK) {
    it(`generic detectETBTriggers still fires for ${sample.label}`, () => {
      // Synthetic name avoids accidental remaining-table substring matches.
      const card = {
        id: `synthetic_${sample.label.replace(/\W+/g, '_').toLowerCase()}`,
        name: `Synthetic ${sample.label} Probe`,
        type_line: 'Creature — Test',
        oracle_text: sample.oracle,
      };
      const permanent = { id: `${card.id}_perm`, controller: 'p1', card };

      const triggers = detectETBTriggers(card, permanent);
      const types = new Set(triggers.map((entry) => String(entry.triggerType || '')));

      if (sample.anyOfTypes) {
        expect(sample.expectTypes.some((expected) => types.has(expected))).toBe(true);
      } else {
        for (const expected of sample.expectTypes) {
          expect(types.has(expected)).toBe(true);
        }
      }

      if (sample.optional) {
        const optional = triggers.find((entry) => entry.triggerType === 'creature_etb');
        expect(optional?.mandatory).toBe(false);
        expect(optional?.requiresChoice).toBe(true);
      }
    });
  }
});
