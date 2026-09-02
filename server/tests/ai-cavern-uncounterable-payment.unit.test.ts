import { describe, expect, it } from 'vitest';

import '../src/socket/ai.js';
import { getPaymentSources } from '../src/socket/ai-handlers/aiPaymentSources.js';

const CAVERN_ORACLE =
  'As this land enters, choose a creature type.\n'
  + '{T}: Add {C}.\n'
  + '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.';

const UNCLAIMED_ORACLE =
  'As this land enters, choose a creature type.\n'
  + '{T}: Add {C}.\n'
  + '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.';

function cavernPermanent(id: string, chosenCreatureType = 'Elf') {
  return {
    id,
    controller: 'ai1',
    tapped: false,
    chosenCreatureType,
    card: {
      id: `${id}_card`,
      name: 'Cavern of Souls',
      type_line: 'Land',
      oracle_text: CAVERN_ORACLE,
    },
  };
}

function unclaimedPermanent(id: string) {
  return {
    id,
    controller: 'ai1',
    tapped: false,
    chosenCreatureType: 'Elf',
    card: {
      id: `${id}_card`,
      name: 'Unclaimed Territory',
      type_line: 'Land',
      oracle_text: UNCLAIMED_ORACLE,
    },
  };
}

function forestPermanent(id: string) {
  return {
    id,
    controller: 'ai1',
    tapped: false,
    card: {
      id: `${id}_card`,
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    },
  };
}

function makeGame(battlefield: any[]) {
  return {
    state: {
      battlefield,
      manaPool: {
        ai1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    },
  };
}

const elfPurpose = {
  isCreature: true as const,
  spellCard: {
    name: 'Llanowar Elves',
    type_line: 'Creature — Elf Druid',
    mana_cost: '{G}',
  },
};

const goblinPurpose = {
  isCreature: true as const,
  spellCard: {
    name: 'Goblin Guide',
    type_line: 'Creature — Goblin Scout',
    mana_cost: '{R}',
  },
};

const instantPurpose = {
  isInstantOrSorcery: true as const,
  spellCard: {
    name: 'Giant Growth',
    type_line: 'Instant',
    mana_cost: '{G}',
  },
};

describe('AI payment prefers uncounterable chosen-type mana', () => {
  it('uses matching Cavern any-color for {G} instead of a Forest', () => {
    const game = makeGame([forestPermanent('forest_1'), cavernPermanent('cavern_1')]);
    const payments = getPaymentSources(
      game,
      'ai1',
      { colors: { G: 1 }, generic: 0 },
      { restrictedSpendPurpose: elfPurpose },
    );

    expect(payments).toEqual([
      expect.objectContaining({
        sourceId: 'cavern_1',
        produceColor: 'G',
      }),
    ]);
    expect(String(payments[0]?.abilityId || '')).toMatch(/ability-1$/);
  });

  it('uses Cavern any-color for the colored pip before Forest generic on {1}{G}', () => {
    const game = makeGame([forestPermanent('forest_1'), cavernPermanent('cavern_1')]);
    const payments = getPaymentSources(
      game,
      'ai1',
      { colors: { G: 1 }, generic: 1 },
      { restrictedSpendPurpose: elfPurpose },
    );

    expect(payments.find((entry) => entry.sourceId === 'cavern_1')).toEqual(
      expect.objectContaining({ produceColor: 'G' }),
    );
    expect(String(payments.find((entry) => entry.sourceId === 'cavern_1')?.abilityId || '')).toMatch(/ability-1$/);
    expect(payments.find((entry) => entry.sourceId === 'forest_1')).toEqual(
      expect.objectContaining({ produceColor: 'G' }),
    );
  });

  it('uses matching Cavern any-color for generic instead of {C}', () => {
    const game = makeGame([cavernPermanent('cavern_1')]);
    const payments = getPaymentSources(
      game,
      'ai1',
      { colors: {}, generic: 1 },
      { restrictedSpendPurpose: elfPurpose },
    );

    expect(payments).toEqual([
      expect.objectContaining({
        sourceId: 'cavern_1',
      }),
    ]);
    expect(String(payments[0]?.abilityId || '')).toMatch(/ability-1$/);
    expect(payments[0]?.produceColor).not.toBe('C');
  });

  it('does not spend Cavern any-color on a mismatched creature type', () => {
    const game = makeGame([forestPermanent('forest_1'), cavernPermanent('cavern_1')]);
    const payments = getPaymentSources(
      game,
      'ai1',
      { colors: { G: 1 }, generic: 0 },
      { restrictedSpendPurpose: goblinPurpose },
    );

    expect(payments.find((entry) => entry.sourceId === 'cavern_1')).toBeUndefined();
    expect(payments.find((entry) => entry.sourceId === 'forest_1')).toEqual(
      expect.objectContaining({ produceColor: 'G' }),
    );
  });

  it('does not spend Cavern any-color on a non-creature spell', () => {
    const game = makeGame([forestPermanent('forest_1'), cavernPermanent('cavern_1')]);
    const payments = getPaymentSources(
      game,
      'ai1',
      { colors: { G: 1 }, generic: 0 },
      { restrictedSpendPurpose: instantPurpose },
    );

    expect(payments.find((entry) => entry.sourceId === 'cavern_1')).toBeUndefined();
    expect(payments.find((entry) => entry.sourceId === 'forest_1')).toEqual(
      expect.objectContaining({ produceColor: 'G' }),
    );
  });

  it('does not prefer Unclaimed Territory any-color over a Forest', () => {
    const game = makeGame([forestPermanent('forest_1'), unclaimedPermanent('ut_1')]);
    const payments = getPaymentSources(
      game,
      'ai1',
      { colors: { G: 1 }, generic: 0 },
      { restrictedSpendPurpose: elfPurpose },
    );

    expect(payments.find((entry) => entry.sourceId === 'forest_1')).toEqual(
      expect.objectContaining({ produceColor: 'G' }),
    );
    expect(payments.find((entry) => entry.sourceId === 'ut_1')).toBeUndefined();
  });
});
