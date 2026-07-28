import { describe, expect, it } from 'vitest';

import { detectActivatedAbilityConditionRequirement } from '../src/state/modules/activated-ability-conditions.js';
import {
  getCreatureCountManaAmount,
  getManaAbilitiesForPermanent,
  parseManaSpendRestrictionFromOracle,
  resolvePowerThresholdInsteadManaAbility,
} from '../src/state/modules/mana-abilities.js';
import { getAvailableMana, canPayManaCost, parseManaCost, getTotalManaFromPool } from '../src/state/modules/mana-check.js';
import { canUseRestrictedMana } from '../src/socket/util.js';

function makeCreature(opts: {
  id: string;
  name: string;
  oracle: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
  controller?: string;
}) {
  return {
    id: opts.id,
    controller: opts.controller || 'p1',
    tapped: false,
    basePower: Number(opts.power || 1),
    baseToughness: Number(opts.toughness || 1),
    card: {
      name: opts.name,
      type_line: opts.typeLine || 'Creature',
      oracle_text: opts.oracle,
      power: opts.power || '1',
      toughness: opts.toughness || '1',
    },
  };
}

describe('conditional / scaling mana foundation', () => {
  it('detects ferocious only from ability word or activate-only-if, not upgrade clauses', () => {
    expect(
      detectActivatedAbilityConditionRequirement(
        'Ferocious — {T}: Add {G}{G}. Activate only if you control a creature with power 4 or greater.',
      )?.key,
    ).toBe('ferocious');

    expect(
      detectActivatedAbilityConditionRequirement(
        '{T}: Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead.',
      ),
    ).toBeNull();
  });

  it('detects metalcraft from ability word, not generic three-artifact flavor', () => {
    expect(
      detectActivatedAbilityConditionRequirement(
        'Metalcraft — {T}: Add one mana of any color.',
      )?.key,
    ).toBe('metalcraft');

    expect(
      detectActivatedAbilityConditionRequirement(
        '{T}: Add {C}. If you control three or more artifacts, add {C}{C} instead.',
      ),
    ).toBeNull();
  });

  it('upgrades Raucous Audience mana when ferocious board is present, but always produces at least {G}', () => {
    const audience = makeCreature({
      id: 'audience',
      name: 'Raucous Audience',
      oracle: '{T}: Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead.',
      power: '1',
      toughness: '1',
    });
    const big = makeCreature({
      id: 'big',
      name: 'Beast',
      oracle: '',
      typeLine: 'Creature — Beast',
      power: '5',
      toughness: '5',
    });

    const unmetState: any = {
      battlefield: [audience],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      players: [{ id: 'p1' }],
      zones: { p1: { graveyard: [] } },
    };
    const metState: any = {
      ...unmetState,
      battlefield: [audience, big],
    };

    expect(resolvePowerThresholdInsteadManaAbility(unmetState, 'p1', audience.card.oracle_text)).toEqual({
      id: 'native_power_base',
      cost: '{T}',
      produces: ['G'],
      amount: 1,
    });
    expect(resolvePowerThresholdInsteadManaAbility(metState, 'p1', audience.card.oracle_text)).toEqual({
      id: 'native_power_upgrade',
      cost: '{T}',
      produces: ['G'],
      amount: 2,
    });

    expect(getManaAbilitiesForPermanent(unmetState, audience, 'p1')[0]?.amount).toBe(1);
    expect(getManaAbilitiesForPermanent(metState, audience, 'p1')[0]?.amount).toBe(2);

    const availUnmet = getAvailableMana(unmetState, 'p1' as any);
    const availMet = getAvailableMana(metState, 'p1' as any);
    expect(availUnmet.green).toBe(1);
    expect(getTotalManaFromPool(availUnmet)).toBe(1);
    expect(availMet.green).toBe(2);
    expect(getTotalManaFromPool(availMet)).toBe(2);
  });

  it('counts Bighorner Rancher scaling mana in getAvailableMana', () => {
    const rancher = makeCreature({
      id: 'rancher',
      name: 'Bighorner Rancher',
      oracle: '{T}: Add an amount of {G} equal to the greatest power among creatures you control.',
      typeLine: 'Creature — Human Ranger',
      power: '2',
      toughness: '4',
    });
    const big = makeCreature({
      id: 'big',
      name: 'Beast',
      oracle: '',
      typeLine: 'Creature — Beast',
      power: '7',
      toughness: '7',
    });
    const state: any = {
      battlefield: [rancher, big],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
    };

    expect(getCreatureCountManaAmount(state, rancher, 'p1')).toEqual({ color: 'G', amount: 7 });
    const avail = getAvailableMana(state, 'p1' as any);
    expect(avail.green).toBe(7);
    expect(getTotalManaFromPool(avail)).toBe(7);
    expect(canPayManaCost(avail, parseManaCost('{5}{G}{G}'))).toBe(true);
  });

  it('parses Helga spend restriction and counts any-one-color availability from power', () => {
    const helga = makeCreature({
      id: 'helga',
      name: 'Helga, Skittish Seer',
      oracle:
        "{T}: Add X mana of any one color, where X is Helga's power. Spend this mana only to cast creature spells with mana value 4 or greater or creature spells with {X} in their mana costs.",
      typeLine: 'Legendary Creature — Frog Druid',
      power: '3',
      toughness: '3',
    });
    const state: any = {
      battlefield: [helga],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
    };

    expect(parseManaSpendRestrictionFromOracle(helga.card.oracle_text)).toEqual({
      restriction: 'creature_spells_mv_or_x',
      restrictedTo: '4',
    });
    expect(getCreatureCountManaAmount(state, helga, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 3,
    });

    const avail = getAvailableMana(state, 'p1' as any);
    expect(avail.anyColor).toBe(3);
    expect(getTotalManaFromPool(avail)).toBe(3);
    expect(canPayManaCost(avail, parseManaCost('{G}{G}{G}'))).toBe(true);
  });

  it('enforces Helga-style creature_spells_mv_or_x spend restriction', () => {
    const entry = {
      type: 'green' as const,
      amount: 3,
      restriction: 'creature_spells_mv_or_x' as const,
      restrictedTo: '4',
    };

    expect(
      canUseRestrictedMana(entry, {
        isCreature: true,
        spellCard: { type_line: 'Creature — Beast', mana_cost: '{3}{G}', cmc: 4 },
      }),
    ).toBe(true);

    expect(
      canUseRestrictedMana(entry, {
        isCreature: true,
        spellCard: { type_line: 'Creature — Elf', mana_cost: '{X}{G}', cmc: 1 },
      }),
    ).toBe(true);

    expect(
      canUseRestrictedMana(entry, {
        isCreature: true,
        spellCard: { type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2 },
      }),
    ).toBe(false);

    expect(
      canUseRestrictedMana(entry, {
        spellCard: { type_line: 'Instant', mana_cost: '{4}{G}', cmc: 5 },
      }),
    ).toBe(false);
  });

  it('gates Whisperer of the Wilds availability on ferocious', () => {
    const whisperer = makeCreature({
      id: 'whisperer',
      name: 'Whisperer of the Wilds',
      oracle: 'Ferocious — {T}: Add {G}{G}. Activate only if you control a creature with power 4 or greater.',
      typeLine: 'Creature — Human Shaman',
      power: '2',
      toughness: '2',
    });
    const big = makeCreature({
      id: 'big',
      name: 'Beast',
      oracle: '',
      typeLine: 'Creature — Beast',
      power: '5',
      toughness: '5',
    });

    const unmet: any = {
      battlefield: [whisperer],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      players: [{ id: 'p1' }],
      zones: { p1: { graveyard: [] } },
    };
    const met: any = {
      ...unmet,
      battlefield: [whisperer, big],
    };

    expect(getAvailableMana(unmet, 'p1' as any).green || 0).toBe(0);
    expect(getAvailableMana(met, 'p1' as any).green).toBe(2);
  });
});
