import { describe, expect, it } from 'vitest';

import {
  buildAvailableManaSourcesForPlayer,
  buildSuggestedPaymentItems,
  collapseIdenticalManaSources,
  createSuggestedPaymentItemsFromSource,
} from '../src/utils/manaSourceBuilder';
import type { ManaPaymentSource } from '../src/utils/manaUtils';

describe('buildSuggestedPaymentItems', () => {
  it('uses floating pool mana before tapping lands when explicit pool items are enabled', () => {
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [
        { id: 'reflecting_pool', name: 'Reflecting Pool', options: ['W', 'U', 'B', 'R', 'G'] },
        { id: 'forest_1', name: 'Forest', options: ['G'] },
      ],
      new Set(),
      { blue: 1, green: 1, white: 0, black: 0, red: 0, colorless: 0 },
      { includeExplicitPoolItems: true },
    );

    expect(items).toEqual([
      { permanentId: '__pool__:blue', mana: 'U', count: 1 },
      { permanentId: '__pool__:green', mana: 'G', count: 1 },
    ]);
  });

  it('does not tap lands for generic-only costs when the pool already has enough mana', () => {
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [{ id: 'reflecting_pool', name: 'Reflecting Pool', options: ['W', 'U', 'B', 'R', 'G'] }],
      new Set(),
      { blue: 1, green: 1, white: 0, black: 0, red: 0, colorless: 0 },
      { includeExplicitPoolItems: true },
    );

    expect(items).toEqual([
      { permanentId: '__pool__:blue', mana: 'U', count: 1 },
      { permanentId: '__pool__:green', mana: 'G', count: 1 },
    ]);
  });

  it('uses restricted floating mana for auto-pay without duplicating regular pool slots', () => {
    const floatingSources: ManaPaymentSource[] = [
      { id: '__pool__:green', name: 'Floating {G}', options: ['G'], amount: 2 },
      { id: '__pool__:restricted:0', name: 'Restricted {G}', options: ['G'], amount: 5 },
    ];
    const landSources: ManaPaymentSource[] = [
      { id: 'forest_1', name: 'Forest', options: ['G'] },
      { id: 'forest_2', name: 'Forest', options: ['G'] },
    ];

    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 3,
        hybrids: [],
      },
      [...floatingSources, ...landSources],
      new Set(),
      {
        green: 2,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        colorless: 0,
        restricted: [{ type: 'green', amount: 5 }],
      },
      { includeExplicitPoolItems: true },
    );

    expect(items).toEqual([
      { permanentId: '__pool__:green', mana: 'G', count: 2 },
      { permanentId: '__pool__:restricted:0', mana: 'G', count: 2 },
    ]);
    expect(items.some((item) => item.permanentId === 'forest_1')).toBe(false);
  });

  it('taps each permanent at most once when dual lands expose multiple ability sources', () => {
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [
        {
          id: 'perm_tg::native_g',
          sourcePermanentId: 'perm_tg',
          abilityId: 'native_g',
          name: 'Temple Garden',
          options: ['G', 'W'],
          producedColors: ['G'],
        },
        {
          id: 'perm_tg::native_w',
          sourcePermanentId: 'perm_tg',
          abilityId: 'native_w',
          name: 'Temple Garden',
          options: ['G', 'W'],
          producedColors: ['W'],
        },
        {
          id: 'perm_wg::native_u',
          sourcePermanentId: 'perm_wg',
          abilityId: 'native_u',
          name: 'Watery Grave',
          options: ['U', 'B'],
          producedColors: ['U'],
        },
        {
          id: 'perm_rp::native_c',
          sourcePermanentId: 'perm_rp',
          abilityId: 'native_c',
          name: 'Reflecting Pool',
          options: ['C'],
        },
      ],
      new Set(),
    );

    const templeGardenUses = items.filter((item) => item.permanentId === 'perm_tg');
    expect(templeGardenUses).toHaveLength(1);
    expect(items.some((item) => item.permanentId === 'perm_wg')).toBe(true);
  });

  it('excludes an activating permanent from payment sources when requested', () => {
    const sources = buildAvailableManaSourcesForPlayer(
      'p1',
      [
        {
          id: 'nykthos_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'nykthos_card',
            name: 'Nykthos, Shrine to Nyx',
            type_line: 'Legendary Land',
            oracle_text: '{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.',
          },
        },
        {
          id: 'forest_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'forest_card',
            name: 'Forest',
            type_line: 'Basic Land â€” Forest',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ] as any,
      { excludePermanentIds: ['nykthos_1'] },
    );

    expect(sources.every((source) => source.sourcePermanentId !== 'nykthos_1')).toBe(true);
    expect(sources.some((source) => source.name === 'Forest')).toBe(true);
  });

  it('includes Breeding Pool parenthetical tap-mana as a payment source', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'breeding_pool_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'breeding_pool_card',
          name: 'Breeding Pool',
          type_line: 'Land â€” Forest Island',
          oracle_text:
            "({T}: Add {G} or {U}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.",
        },
      },
      {
        id: 'mox_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'mox_card',
          name: 'Mox Amber',
          type_line: 'Legendary Artifact',
          oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
        },
      },
    ] as any);

    const breedingPool = sources.filter((source) => source.name === 'Breeding Pool');
    expect(breedingPool.length).toBeGreaterThanOrEqual(1);
    expect(breedingPool.some((source) => source.options.includes('U') && source.options.includes('G'))).toBe(true);
  });

  it('includes Forest Island duals with missing oracle via basic land types', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'ghost_dual_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'ghost_dual_card',
          name: 'Breeding Pool',
          type_line: 'Land â€” Forest Island',
          oracle_text: '',
        },
      },
    ] as any);

    expect(sources.some((source) =>
      source.name === 'Breeding Pool'
      && source.options.includes('U')
      && source.options.includes('G'),
    )).toBe(true);
  });

  it('autopays {X}{W}{W} at X=10 by locking WW then filling generic from pool + lands', () => {
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 10,
        hybrids: [],
      },
      [
        { id: 'plains_1', name: 'Plains', options: ['W'] },
        { id: 'plains_2', name: 'Plains', options: ['W'] },
        { id: 'forest_1', name: 'Forest', options: ['G'] },
        { id: 'forest_2', name: 'Forest', options: ['G'] },
        { id: 'forest_3', name: 'Forest', options: ['G'] },
        { id: 'sol_ring', name: 'Sol Ring', options: ['C', 'C'] },
      ],
      new Set(),
      { white: 2, blue: 0, black: 0, red: 0, green: 2, colorless: 1 },
      { includeExplicitPoolItems: true },
    );

    // Floating white is reserved for the {W}{W} requirement first (not spent on X/generic).
    const whitePool = items.find((item) => item.permanentId === '__pool__:white');
    expect(whitePool).toEqual({ permanentId: '__pool__:white', mana: 'W', count: 2 });

    const total = items.reduce((sum, item) => sum + Number(item.count || 1), 0);
    expect(total).toBeGreaterThanOrEqual(12);

    // Remaining white lands may still help fill generic, but colored WW is already covered by pool.
    const whiteFromTaps = items
      .filter((item) => item.mana === 'W' && !String(item.permanentId).startsWith('__pool__'))
      .reduce((sum, item) => sum + Number(item.count || 1), 0);
    expect(Number(whitePool?.count || 0) + whiteFromTaps).toBeGreaterThanOrEqual(2);
  });
});

describe('mana source quantity stacks', () => {
    it('stamps no_nonartifact_spells on Vibranium sources from oracle text', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'vib_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'vibranium_card',
          name: 'Vibranium',
          type_line: 'Token Artifact - Vibranium',
          oracle_text: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
        },
      },
    ] as any);

    const vib = sources.find((source) => source.name === 'Vibranium');
    expect(vib).toBeTruthy();
    expect(vib?.spendRestriction).toEqual({ restriction: 'no_nonartifact_spells' });
  });

  it('sets availableQuantity from grouped Vibranium tokenCount / groupedTokenIds', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'group_vib_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        isGroupedTokens: true,
        tokenCount: 5,
        groupedTokenIds: ['vib_1', 'vib_2', 'vib_3', 'vib_4', 'vib_5'],
        card: {
          id: 'vibranium_card',
          name: 'Vibranium',
          type_line: 'Artifact Token',
          oracle_text: '{T}: Add {C}.',
        },
      },
    ] as any);

    const vib = sources.find((source) => source.name === 'Vibranium');
    expect(vib).toBeTruthy();
    expect(vib?.availableQuantity).toBe(5);
    expect(sources.filter((source) => source.name === 'Vibranium')).toHaveLength(1);
  });

  it('collapses identical ungrouped Powerstone tokens into one quantity row', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'ps_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'powerstone_card',
          name: 'Powerstone',
          type_line: 'Artifact Token',
          oracle_text: '{T}: Add {C}.',
        },
      },
      {
        id: 'ps_2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'powerstone_card',
          name: 'Powerstone',
          type_line: 'Artifact Token',
          oracle_text: '{T}: Add {C}.',
        },
      },
      {
        id: 'ps_3',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'powerstone_card',
          name: 'Powerstone',
          type_line: 'Artifact Token',
          oracle_text: '{T}: Add {C}.',
        },
      },
    ] as any);

    const powerstones = sources.filter((source) => source.name === 'Powerstone');
    expect(powerstones).toHaveLength(1);
    expect(powerstones[0].availableQuantity).toBe(3);
    expect(powerstones[0].stackPermanentIds).toEqual(['ps_1', 'ps_2', 'ps_3']);
  });

  it('suggests qty>1 from a Vibranium group for generic mana and emits N group_* payment rows', () => {
    const sources: ManaPaymentSource[] = [
      {
        id: 'group_vib::native_c',
        sourcePermanentId: 'group_vib',
        abilityId: 'native_c',
        name: 'Vibranium',
        options: ['C'],
        availableQuantity: 5,
      },
      { id: 'forest_1', sourcePermanentId: 'forest_1', name: 'Forest', options: ['G'] },
    ];

    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 3,
        hybrids: [],
      },
      sources,
      new Set(),
    );

    const vibItems = items.filter((item) => item.permanentId === 'group_vib');
    expect(vibItems).toHaveLength(3);
    expect(vibItems.every((item) => item.mana === 'C')).toBe(true);
    expect(vibItems.every((item) => (item.count ?? 1) === 1)).toBe(true);
    expect(vibItems.every((item) => item.paymentSourceId === 'group_vib::native_c')).toBe(true);
  });


  it('collapses unmodified identical lands across different printings/card ids', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'plains_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'plains_printing_a',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'plains_2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'plains_printing_b',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'plains_3',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'plains_printing_c',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'breeding_pool_a',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'bp_printing_a',
          name: 'Breeding Pool',
          type_line: 'Land - Forest Island',
          oracle_text: '({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don\'t, it enters tapped.',
        },
      },
      {
        id: 'breeding_pool_b',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'bp_printing_b',
          name: 'Breeding Pool',
          type_line: 'Land - Forest Island',
          oracle_text: '({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don\'t, it enters tapped.',
        },
      },
    ] as any);

    const plainsRows = sources.filter((source) => source.name === 'Plains');
    expect(plainsRows).toHaveLength(1);
    expect(plainsRows[0].availableQuantity).toBe(3);
    expect(plainsRows[0].stackPermanentIds).toEqual(['plains_1', 'plains_2', 'plains_3']);
    expect(plainsRows[0].abilityId).toBe('native_w');

    const poolRows = sources.filter((source) => source.name === 'Breeding Pool');
    expect(poolRows).toHaveLength(1);
    expect(poolRows[0].availableQuantity).toBe(2);
    expect(poolRows[0].stackPermanentIds).toEqual(['breeding_pool_a', 'breeding_pool_b']);
  });

  it('keeps attachment-modified lands separate from identical unmodified lands', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'plains_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'plains_card',
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'plains_2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'plains_card',
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'plains_fertile',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        attachments: ['fertile_1'],
        card: {
          id: 'plains_card',
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'fertile_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        attachedTo: 'plains_fertile',
        card: {
          id: 'fertile_card',
          name: 'Fertile Ground',
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds one mana of any color.',
        },
      },
    ] as any);

    const plainsRows = sources.filter((source) => source.name === 'Plains');
    expect(plainsRows).toHaveLength(2);

    const stacked = plainsRows.find((source) => (source.availableQuantity || 1) > 1);
    const separate = plainsRows.find((source) => source.sourcePermanentId === 'plains_fertile');
    expect(stacked?.availableQuantity).toBe(2);
    expect(stacked?.stackPermanentIds).toEqual(['plains_1', 'plains_2']);
    expect(separate?.keepSeparate).toBe(true);
    expect(separate?.availableQuantity).toBeUndefined();
  });

  it('keeps lands separate when attachment is only linked via attachedTo', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'forest_a',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
      {
        id: 'forest_b',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
      {
        id: 'wild_growth',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        attachedTo: 'forest_b',
        card: {
          id: 'wg_card',
          name: 'Wild Growth',
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds {G}.',
        },
      },
    ] as any);

    const forestRows = sources.filter((source) => source.name === 'Forest');
    expect(forestRows).toHaveLength(2);
    expect(forestRows.some((source) => source.sourcePermanentId === 'forest_b' && source.keepSeparate)).toBe(true);
    expect(forestRows.some((source) => source.sourcePermanentId === 'forest_a' && (source.availableQuantity || 1) === 1)).toBe(true);
  });

  it('does not treat Sol Ring multi-mana amount as a quantity stack', () => {
    const collapsed = collapseIdenticalManaSources([
      {
        id: 'sol::native',
        sourcePermanentId: 'sol',
        name: 'Sol Ring',
        options: ['C', 'C'],
        amount: 2,
      },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].availableQuantity).toBeUndefined();

    const items = createSuggestedPaymentItemsFromSource(
      'sol::native',
      { color: 'C', count: 2 },
      new Map([['sol::native', collapsed[0]]]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(2);
  });
});
