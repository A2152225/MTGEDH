import { describe, expect, it } from 'vitest';

import type { BattlefieldPermanent } from '../../shared/src';
import { buildAvailableManaSourcesForPlayer, createPaymentItemFromSource } from '../src/utils/manaSourceBuilder';

function createPermanent(permanent: Partial<BattlefieldPermanent> & { id: string; controller: string; owner: string; card: any }): BattlefieldPermanent {
  return {
    tapped: false,
    counters: {},
    ...permanent,
  } as BattlefieldPermanent;
}

describe('buildAvailableManaSourcesForPlayer', () => {
  it('creates per-line inline payment sources for supported multi-line mana permanents', () => {
    const battlefield = [
      createPermanent({
        id: 'azure_dynamo_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'azure_dynamo_card_1',
          name: 'Azure Dynamo',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice this artifact: Add {U}.\n{T}: Add {U}{U}.',
        },
      }),
    ];

    const sources = buildAvailableManaSourcesForPlayer('p1', battlefield);

    expect(sources).toHaveLength(2);
    expect(sources).toEqual([
      expect.objectContaining({
        sourcePermanentId: 'azure_dynamo_1',
        abilityId: 'azure_dynamo_card_1-ability-0',
        options: ['U'],
        consumable: true,
      }),
      expect.objectContaining({
        sourcePermanentId: 'azure_dynamo_1',
        abilityId: 'azure_dynamo_card_1-ability-1',
        options: ['U', 'U'],
        amount: 2,
      }),
    ]);
  });

  it('keeps supported named self-sacrifice mana lines available for inline payment', () => {
    const battlefield = [
      createPermanent({
        id: 'generator_servant_1',
        controller: 'p1',
        owner: 'p1',
        summoningSickness: false,
        card: {
          id: 'generator_servant_card_1',
          name: 'Generator Servant',
          type_line: 'Creature - Elemental',
          oracle_text: '{T}, Sacrifice Generator Servant: Add {C}{C}. If that mana is spent on a creature spell, it gains haste until end of turn.',
        },
      }),
    ];

    const sources = buildAvailableManaSourcesForPlayer('p1', battlefield);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual(expect.objectContaining({
      sourcePermanentId: 'generator_servant_1',
      abilityId: 'generator_servant_card_1-ability-0',
      options: ['C', 'C'],
      consumable: true,
      amount: 2,
    }));
  });

  it('includes simple mana-cost lines when their output is representable but still omits mixed-color bundles', () => {
    const battlefield = [
      createPermanent({
        id: 'priced_dynamo_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'priced_dynamo_card_1',
          name: 'Priced Dynamo',
          type_line: 'Artifact',
          oracle_text: '{1}, {T}: Add {U}{U}.',
        },
      }),
      createPermanent({
        id: 'izzet_signet_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'izzet_signet_card_1',
          name: 'Izzet Signet',
          type_line: 'Artifact',
          oracle_text: '{1}, {T}: Add {U}{R}.',
        },
      }),
    ];

    const sources = buildAvailableManaSourcesForPlayer('p1', battlefield);

    expect(sources).toEqual([
      expect.objectContaining({
        sourcePermanentId: 'priced_dynamo_1',
        abilityId: 'priced_dynamo_card_1-ability-0',
        options: ['U', 'U'],
        amount: 2,
      }),
    ]);
  });

  it('omits inline mana lines whose activation costs are not supported by selected payment', () => {
    const battlefield = [
      createPermanent({
        id: 'pain_cache_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'pain_cache_card_1',
          name: 'Pain Cache',
          type_line: 'Artifact',
          oracle_text: 'Pay 1 life: Add {U}.\n{T}: Add {C}.',
        },
      }),
      createPermanent({
        id: 'arena_of_glory_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'arena_of_glory_card_1',
          name: 'Arena of Glory',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}, Exert Arena of Glory: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn.',
        },
      }),
    ];

    const sources = buildAvailableManaSourcesForPlayer('p1', battlefield);

    expect(sources).toEqual([
      expect.objectContaining({
        sourcePermanentId: 'pain_cache_1',
        abilityId: 'pain_cache_card_1-ability-1',
        options: ['C'],
      }),
      expect.objectContaining({
        sourcePermanentId: 'arena_of_glory_1',
        abilityId: 'arena_of_glory_card_1-ability-0',
        options: ['C'],
      }),
    ]);
  });
});

describe('createPaymentItemFromSource', () => {
  it('preserves abilityId and paymentSourceId for split client payment sources', () => {
    const payment = createPaymentItemFromSource(
      {
        id: 'azure_dynamo_1::azure_dynamo_card_1-ability-1',
        sourcePermanentId: 'azure_dynamo_1',
        abilityId: 'azure_dynamo_card_1-ability-1',
        name: 'Azure Dynamo',
        label: 'Add {U}{U}',
        options: ['U', 'U'],
        amount: 2,
      },
      'U',
    );

    expect(payment).toEqual({
      permanentId: 'azure_dynamo_1',
      paymentSourceId: 'azure_dynamo_1::azure_dynamo_card_1-ability-1',
      abilityId: 'azure_dynamo_card_1-ability-1',
      mana: 'U',
      count: 2,
    });
  });
});