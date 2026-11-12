import { describe, expect, it } from 'vitest';

import { isCreatureNow } from '../src/state/creatureTypeNow.js';
import {
  getCreatureCountManaAmount,
  getManaAbilitiesForPermanent,
  parseManaSpendRestrictionFromOracle,
} from '../src/state/modules/mana-abilities.js';
import { tryApplyUntapAllYouControlTrigger } from '../src/state/modules/triggerUntapAllUtils.js';
import {
  addRestrictedManaToPool,
  buildManaTotalsIncludingEligibleRestricted,
  calculateManaProduction,
  canUseRestrictedMana,
} from '../src/socket/util.js';
import { exactManaSpendRestrictionAllowsPurpose } from '../src/state/modules/mana-check-handlers/manaCheckExactSources.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { tryHandleActivateGenericMana } from '../src/socket/interaction-handlers/interactionActivateGenericMana.js';
import { getManaSpendRestrictionSelectionFields } from '../src/socket/interaction-handlers/interactionManaAbilityActivationShape.js';

const QUEENS_DIAMOND_ORACLE =
  "{T}: Choose a color. Add one mana of that color for each charge counter on Queen's Diamond. Spend this mana only to cast your commander.\n" +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n" +
  '8+ | Flying, vigilance, haste';

const EVERFLOWING_ORACLE = '{T}: Add {C} for each charge counter on this artifact.';

function queensDiamondPermanent(charge: number, extras: Record<string, unknown> = {}) {
  return {
    id: 'qd_1',
    controller: 'p1',
    tapped: true,
    counters: { charge },
    card: {
      name: "Queen's Diamond",
      type_line: 'Legendary Artifact — Spacecraft',
      oracle_text: QUEENS_DIAMOND_ORACLE,
      power: '5',
      toughness: '5',
    },
    ...extras,
  };
}

describe("Queen's Diamond mana (#96)", () => {
  it('requires a color choice and scales with charge counters (not colorless)', () => {
    const permanent = queensDiamondPermanent(6);
    const state = { battlefield: [permanent] };

    const production = calculateManaProduction(state, permanent, 'p1');
    expect(production.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(production.baseAmount).toBe(6);
    expect(production.requiresColorChoice).toBe(true);

    const withColor = calculateManaProduction(state, permanent, 'p1', 'U');
    expect(withColor.colors).toEqual(['U']);
    expect(withColor.baseAmount).toBe(6);
    expect(withColor.requiresColorChoice).not.toBe(true);

    expect(getCreatureCountManaAmount(state, permanent, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 6,
    });

    const abilities = getManaAbilitiesForPermanent(state, permanent, 'p1');
    expect(abilities.some((a) => a.id === 'native_dynamic' && a.produces.includes('G'))).toBe(true);
    expect(abilities.find((a) => a.id === 'native_dynamic')?.spendRestriction).toEqual({
      restriction: 'commander',
    });
  });

  it('restricts produced mana to casting your commander only', () => {
    expect(parseManaSpendRestrictionFromOracle(QUEENS_DIAMOND_ORACLE)).toEqual({
      restriction: 'commander',
    });

    const entry = {
      type: 'blue' as const,
      amount: 6,
      restriction: 'commander' as const,
      sourceId: 'qd_1',
      sourceName: "Queen's Diamond",
    };
    expect(canUseRestrictedMana(entry, { isCommander: true })).toBe(true);
    expect(canUseRestrictedMana(entry, { isCreature: true, isLegendary: true })).toBe(false);
    expect(canUseRestrictedMana(entry, { isActivatedAbility: true })).toBe(false);
    expect(
      exactManaSpendRestrictionAllowsPurpose({ restriction: 'commander' }, { isCommander: true }),
    ).toBe(true);
    expect(
      exactManaSpendRestrictionAllowsPurpose(
        { restriction: 'commander' },
        { isCreature: true, isLegendary: true },
      ),
    ).toBe(false);

    const state: any = {
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };
    addRestrictedManaToPool(state, 'p1', 'blue', 6, 'commander', undefined, 'qd_1', "Queen's Diamond");
    const unrestricted = buildManaTotalsIncludingEligibleRestricted(state.manaPool.p1, {
      isCreature: true,
    } as any);
    expect(unrestricted.blue).toBe(0);
    const forCommander = buildManaTotalsIncludingEligibleRestricted(state.manaPool.p1, {
      isCommander: true,
    } as any);
    expect(forCommander.blue).toBe(6);
  });

  it('still produces colorless for Everflowing Chalice-style charge mana', () => {
    const permanent = {
      id: 'chal_1',
      controller: 'p1',
      counters: { charge: 4 },
      card: {
        name: 'Everflowing Chalice',
        type_line: 'Artifact',
        oracle_text: EVERFLOWING_ORACLE,
      },
    };
    const production = calculateManaProduction({ battlefield: [permanent] }, permanent, 'p1');
    expect(production.colors).toEqual(['C']);
    expect(production.baseAmount).toBe(4);
  });
});

describe("Queen's Diamond station creature + Intruder Alarm (#97)", () => {
  it('is a creature at 8+ charge even when type_line stays Spacecraft', () => {
    expect(isCreatureNow(queensDiamondPermanent(7))).toBe(false);
    expect(isCreatureNow(queensDiamondPermanent(8))).toBe(true);
    expect(isCreatureNow(queensDiamondPermanent(10))).toBe(true);
  });

  it('untaps under "untap all creatures" when stationed at 10 charge', () => {
    const permanent = queensDiamondPermanent(10, { tapped: true });
    const ctx = {
      state: { battlefield: [permanent] },
      bumpSeq: () => {},
    };

    const handled = tryApplyUntapAllYouControlTrigger(
      ctx as any,
      'p1' as any,
      'Whenever a creature enters, untap all creatures',
    );

    expect(handled).toBe(true);
    expect(permanent.tapped).toBe(false);
  });
});

describe("Queen's Diamond live color-choice restriction (#99)", () => {
  it('attaches commander spend restriction on the charge-scaled any-color prompt', async () => {
    const permanent = queensDiamondPermanent(6, { tapped: false });
    expect(getManaSpendRestrictionSelectionFields(permanent)).toEqual({
      manaRestriction: 'commander',
    });

    const gameId = 'qd_mana_restrict_99';
    ResolutionQueueManager.removeQueue(gameId);
    const game: any = {
      gameId,
      seq: 0,
      state: {
        battlefield: [permanent],
        manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        players: [{ id: 'p1', name: 'P1', life: 40 }],
      },
    };
    const abilityLine = QUEENS_DIAMOND_ORACLE.split('\n')[0];
    const abilities = getManaAbilitiesForPermanent(game.state, permanent, 'p1');
    const abilityId = abilities.find((entry) => entry.id === 'native_dynamic')?.id || 'native_dynamic';
    const io: any = { to: () => ({ emit: () => {} }), emit: () => {} };
    const socket: any = { emit: () => {}, data: { playerId: 'p1' } };
    const ctx: any = {
      io,
      socket,
      game,
      gameId,
      pid: 'p1',
      permanentId: 'qd_1',
      abilityId,
      selectedXValue: undefined,
      splitSecondLockActive: false,
      battlefield: game.state.battlefield,
      permIndex: 0,
      permanent,
      card: permanent.card,
      cardName: "Queen's Diamond",
      oracleText: QUEENS_DIAMOND_ORACLE,
      typeLine: permanent.card.type_line,
      scopedAbilityText: abilityLine,
      scopedAbilityFullText: abilityLine,
      isGenericActivatedAbilityId: false,
    };
    const mut: any = {
      pendingLifePaymentForCost: 0,
      pendingManaLifeLossAmount: 0,
      pendingManaLifeLossIsDamage: false,
      manaGrantsCreatureSpellHasteUntilEndOfTurn: false,
      persistedStackItemId: undefined,
      tappedPermanentsForCost: [],
      sacrificedPermanentsForCost: [],
      recordedAddedMana: {},
      removedCountersForCost: [],
      pendingCounterRemovals: [],
    };
    const extras: any = {
      abilityText: abilityLine,
      requiresTap: true,
      requiresUntap: false,
      manaCost: '{T}',
      requiresSelfExert: false,
      sacrificeType: null,
      sacrificeSubtype: undefined,
      isPowerUpActivation: false,
      powerUpAbilityIndex: 0,
      selectedAbilityIndex: 0,
      selectedAbilityFullText: abilityLine,
      selectedAbilityOracleLine: abilityLine,
      isExhaustActivation: false,
      isBoastAbility: false,
      oncePerTurnActivatedEffect: '',
      resolvedAbilityText: abilityLine,
      resolvedActivatedAbilityText: abilityLine,
    };

    await tryHandleActivateGenericMana(ctx, mut, extras, () => {});
    const step = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any)
      .find((entry: any) => entry?.type === ResolutionStepType.MANA_COLOR_SELECTION) as any;
    expect(step).toBeDefined();
    expect(step.manaRestriction).toBe('commander');
    expect(step.amount).toBe(6);
    ResolutionQueueManager.removeQueue(gameId);
  });
});
