import { describe, expect, it } from 'vitest';

import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  getContinuousPTBonusForPermanent,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';

const BORG_QUEEN_ORACLE =
  'Artifact creatures you control get +2/+2.\n' +
  "Whenever The Borg Queen enters or attacks, target opponent exiles cards from the top of their library until they exile a creature card. Assimilate that card. They put the rest on the bottom in a random order. (To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)";

const TYPE_03_ORACLE =
  'Artifact spells you cast cost {1} less to cast.\n' +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 7+.)\n" +
  '7+ | Flying\n' +
  'Whenever you cast a spell, create a 1/1 colorless Borg artifact creature token.';

const QUEENS_DIAMOND_ORACLE =
  "{T}: Choose a color. Add one mana of that color for each charge counter on Queen's Diamond. Spend this mana only to cast your commander.\n" +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n" +
  '8+ | Flying, vigilance, haste';

function perm(id, name, typeLine, oracle, extras = {}) {
  const { card: cardExtras, ...rest } = extras;
  return {
    id,
    controller: 'p1',
    card: {
      name,
      type_line: typeLine,
      oracle_text: oracle,
      ...(cardExtras || {}),
    },
    ...rest,
  };
}

describe('The Borg Queen artifact-creature lord (#98)', () => {
  it('parses a single +2/+2 artifact-creature anthem, not a static rest-on-bottom grant', () => {
    const queen = perm(
      'queen_1',
      'The Borg Queen',
      'Legendary Artifact Creature — Borg Noble',
      BORG_QUEEN_ORACLE,
      { card: { power: '4', toughness: '4' } },
    );
    const specs = parseStaticEffectSpecsFromOraclePermanent(queen);
    const anthems = specs.filter((spec) => spec.grant.power === 2 && spec.grant.toughness === 2);
    expect(anthems).toHaveLength(1);
    expect(anthems[0].scope.kind).toBe('creatures_you_control');
    expect(anthems[0].condition).toEqual({ kind: 'target_has_type', cardType: 'artifact' });
    expect(specs.some((spec) => /put the rest on the bottom/i.test(String((spec.grant.abilities || []).join(' '))))).toBe(false);
  });

  it('gives +2/+2 once to the Queen and to stationed artifact creatures, not below threshold', () => {
    const queen = perm(
      'queen_1',
      'The Borg Queen',
      'Legendary Artifact Creature — Borg Noble',
      BORG_QUEEN_ORACLE,
      { card: { power: '4', toughness: '4' }, basePower: 4, baseToughness: 4 },
    );
    const vesselOn = perm(
      'vessel_1',
      'Type-03 Borg Vessel',
      'Artifact — Spacecraft',
      TYPE_03_ORACLE,
      { counters: { charge: 11 }, card: { power: '5', toughness: '5' }, basePower: 5, baseToughness: 5 },
    );
    const vesselOff = perm(
      'vessel_off',
      'Type-03 Borg Vessel',
      'Artifact — Spacecraft',
      TYPE_03_ORACLE,
      { counters: { charge: 0 }, card: { power: '5', toughness: '5' } },
    );
    const diamond = perm(
      'qd_1',
      "Queen's Diamond",
      'Legendary Artifact — Spacecraft',
      QUEENS_DIAMOND_ORACLE,
      { counters: { charge: 10 }, card: { power: '5', toughness: '5' }, basePower: 5, baseToughness: 5 },
    );
    const bear = perm('bear_1', 'Grizzly Bears', 'Creature — Bear', '', { card: { power: '2', toughness: '2' }, basePower: 2, baseToughness: 2 });
    const state = { battlefield: [queen, vesselOn, vesselOff, diamond, bear] };

    expect(getContinuousPTBonusForPermanent(queen, state)).toEqual({ power: 2, toughness: 2 });
    expect(getContinuousPTBonusForPermanent(vesselOn, state)).toEqual({ power: 2, toughness: 2 });
    expect(getContinuousPTBonusForPermanent(diamond, state)).toEqual({ power: 2, toughness: 2 });
    expect(getContinuousPTBonusForPermanent(vesselOff, state)).toEqual({ power: 0, toughness: 0 });
    expect(getContinuousPTBonusForPermanent(bear, state)).toEqual({ power: 0, toughness: 0 });

    expect(getCurrentPowerToughness(queen, state)).toEqual({ power: 6, toughness: 6 });
    expect(getCurrentPowerToughness(vesselOn, state)).toEqual({ power: 7, toughness: 7 });
    expect(getCurrentPowerToughness(diamond, state)).toEqual({ power: 7, toughness: 7 });

    const grants = getContinuousGrantedAbilitiesForPermanent(queen, state).join(' | ');
    expect(grants).not.toMatch(/put the rest on the bottom/i);
  });
});
