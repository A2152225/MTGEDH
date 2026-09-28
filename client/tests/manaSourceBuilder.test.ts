import { describe, expect, it } from 'vitest';

import {
  buildAvailableManaSourcesForPlayer,
  buildSuggestedPaymentItems,
  collapseIdenticalManaSources,
  createSuggestedPaymentItemsFromSource,
} from '../src/utils/manaSourceBuilder';
import { buildRestrictedManaPurposeForSpell, canPayCost, type ManaPaymentSource } from '../src/utils/manaUtils';
import { simulateSequentialPaymentPool } from '../src/utils/manaSuggestedPaymentActivation';

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

    // Restricted floating mana is preferred first so flexible pool mana is kept.
    expect(items).toEqual([
      { permanentId: '__pool__:restricted:0', mana: 'G', count: 4 },
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
            type_line: 'Basic Land ? Forest',
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
          type_line: 'Land ? Forest Island',
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

  it('includes Talisman of Creativity pain mana as a U or R choice separate from {C}', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'talisman_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'talisman_card',
          name: 'Talisman of Creativity',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}.\n{T}: Add {U} or {R}. This artifact deals 1 damage to you.',
        },
      },
    ] as any);

    const talismanSources = sources.filter((source) => source.name === 'Talisman of Creativity');
    expect(talismanSources.some((source) => source.options.length === 1 && source.options[0] === 'C')).toBe(true);
    expect(talismanSources.some((source) =>
      source.options.includes('U') && source.options.includes('R') && source.options.length === 2
    )).toBe(true);
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
          type_line: 'Land ? Forest Island',
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
          type_line: 'Basic Land ? Plains',
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
          type_line: 'Basic Land ? Plains',
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
          type_line: 'Basic Land ? Plains',
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
          type_line: 'Enchantment ? Aura',
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
    expect(separate?.manaBonuses).toEqual([
      { options: ['W', 'U', 'B', 'R', 'G'], amount: 1 },
    ]);
    expect(separate?.options).toEqual(['W']);
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
          type_line: 'Basic Land ? Forest',
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
          type_line: 'Basic Land ? Forest',
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
          type_line: 'Enchantment ? Aura',
          oracle_text: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds {G}.',
        },
      },
    ] as any);

    const forestRows = sources.filter((source) => source.name === 'Forest');
    expect(forestRows).toHaveLength(2);
    expect(forestRows.some((source) => source.sourcePermanentId === 'forest_b' && source.keepSeparate)).toBe(true);
    expect(forestRows.some((source) => source.sourcePermanentId === 'forest_a' && (source.availableQuantity || 1) === 1)).toBe(true);
    const enchanted = forestRows.find((source) => source.sourcePermanentId === 'forest_b');
    expect(enchanted?.manaBonuses).toEqual([{ options: ['G'], amount: 1 }]);
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

describe('chosen-color lands and land-aura bonuses', () => {
  const thrivingOracle = [
    'This land enters tapped. As it enters, choose a color other than green.',
    '{T}: Add {G} or one mana of the chosen color.',
  ].join('\n');

  it('adds the stored chosen color to Thriving Grove payment options', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'grove_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        chosenColor: 'red',
        card: {
          id: 'grove_card',
          name: 'Thriving Grove',
          type_line: 'Land',
          oracle_text: thrivingOracle,
        },
      },
    ] as any);

    expect(sources).toHaveLength(1);
    expect(sources[0].options).toEqual(['G', 'R']);
  });

  it('reads chosen color from the card object when the permanent field is empty', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'grove_2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'grove_card',
          name: 'Thriving Grove',
          type_line: 'Land',
          oracle_text: thrivingOracle,
          chosenColor: 'blue',
        },
      },
    ] as any);

    expect(sources[0].options).toEqual(['G', 'U']);
  });

  it('suggests mixed native + Fertile Ground mana for a two-color cost', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [
      {
        id: 'forest_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'forest_card',
          name: 'Forest',
          type_line: 'Basic Land ? Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
      {
        id: 'fertile_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        attachedTo: 'forest_1',
        card: {
          id: 'fertile_card',
          name: 'Fertile Ground',
          type_line: 'Enchantment ? Aura',
          oracle_text:
            'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.',
        },
      },
    ] as any);

    const forest = sources.find((source) => source.sourcePermanentId === 'forest_1');
    expect(forest?.options).toEqual(['G']);
    expect(forest?.manaBonuses).toEqual([
      { options: ['W', 'U', 'B', 'R', 'G'], amount: 1 },
    ]);

    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      sources,
      new Set(),
    );

    expect(items).toHaveLength(1);
    expect(items[0].permanentId).toBe('forest_1');
    expect(items[0].producedColors?.slice().sort()).toEqual(['G', 'U']);
    expect(items[0].count).toBe(2);
  });
});

describe('signet sequential auto-pay', () => {
  const rakdosSignet = {
    id: 'signet_1',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: 'rakdos_signet_card',
      name: 'Rakdos Signet',
      type_line: 'Artifact',
      oracle_text: '{1}, {T}: Add {B}{R}.',
    },
  };
  const mountain = {
    id: 'mountain_1',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: 'mountain_card',
      name: 'Mountain',
      type_line: 'Basic Land — Mountain',
      oracle_text: '{T}: Add {R}.',
    },
  };

  it('stamps {1} activation cost and mixed {B}{R} production on Rakdos Signet', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [rakdosSignet] as any);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('Rakdos Signet');
    expect(sources[0].activationManaCost).toBe('{1}');
    expect(sources[0].producedColors).toEqual(['B', 'R']);
    expect(sources[0].amount).toBe(2);
  });

  it('autopays {B}{R} by tapping a land first, then the Signet', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [rakdosSignet, mountain] as any);
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 1, R: 1, G: 0, C: 0 },
        generic: 0,
        hybrids: [],
      },
      sources,
      new Set(),
    );

    expect(items.map((item) => item.permanentId)).toEqual(['mountain_1', 'signet_1']);
    const signet = items.find((item) => item.permanentId === 'signet_1');
    expect(signet?.producedColors?.slice().sort()).toEqual(['B', 'R']);
    expect(Number(signet?.count || 0)).toBe(2);
  });

  it('does not spend a Signet when basic lands already cover the cost', () => {
    const swamp = {
      id: 'swamp_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'swamp_card',
        name: 'Swamp',
        type_line: 'Basic Land — Swamp',
        oracle_text: '{T}: Add {B}.',
      },
    };
    const sources = buildAvailableManaSourcesForPlayer('p1', [rakdosSignet, mountain, swamp] as any);
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 1, R: 1, G: 0, C: 0 },
        generic: 0,
        hybrids: [],
      },
      sources,
      new Set(),
    );

    expect(items.some((item) => item.permanentId === 'signet_1')).toBe(false);
    expect(items.map((item) => item.permanentId).sort()).toEqual(['mountain_1', 'swamp_1']);
  });

  it('autopays {1}{B}{R} with a land-plus-Signet net by floating the {1} first', () => {
    const swamp = {
      id: 'swamp_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'swamp_card',
        name: 'Swamp',
        type_line: 'Basic Land — Swamp',
        oracle_text: '{T}: Add {B}.',
      },
    };
    const sources = buildAvailableManaSourcesForPlayer('p1', [rakdosSignet, mountain, swamp] as any);
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 1, R: 1, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      sources,
      new Set(),
    );

    expect(items.some((item) => item.permanentId === 'signet_1')).toBe(true);
    const signetIndex = items.findIndex((item) => item.permanentId === 'signet_1');
    expect(signetIndex).toBeGreaterThan(0);
    expect(items.slice(0, signetIndex).every((item) => item.permanentId !== 'signet_1')).toBe(true);
    expect(items.length).toBe(3);
  });

  it('autopays {2} with a land first, then Izzet Signet', () => {
    const izzetSignet = {
      id: 'izzet_signet_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'izzet_signet_card',
        name: 'Izzet Signet',
        type_line: 'Artifact',
        oracle_text: '{1}, {T}: Add {U}{R}.',
      },
    };
    const plains = {
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
    };
    const sources = buildAvailableManaSourcesForPlayer('p1', [izzetSignet, plains] as any);
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 2,
        hybrids: [],
      },
      sources,
      new Set(),
    );

    expect(items.map((item) => item.permanentId)).toEqual(['plains_1', 'izzet_signet_1']);
    const signet = items.find((item) => item.permanentId === 'izzet_signet_1');
    expect(signet?.producedColors?.slice().sort()).toEqual(['R', 'U']);
    expect(Number(signet?.count || 0)).toBe(2);
  });
});

describe('simulateSequentialPaymentPool', () => {
  const genericTwo = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 2,
    hybrids: [] as Array<Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>>,
  };

  it('nets a land-plus-Signet payment to the two mana the spell can spend', () => {
    const sources = new Map([
      ['plains_1', { activationManaCost: undefined }],
      ['izzet_signet_1', { activationManaCost: '{1}' }],
    ]);
    const simulated = simulateSequentialPaymentPool(
      [
        { permanentId: 'plains_1', mana: 'W', count: 1 },
        { permanentId: 'izzet_signet_1', mana: 'U', count: 2, producedColors: ['U', 'R'] },
      ],
      sources,
    );

    expect(simulated.unpaidActivationPips).toBe(0);
    expect(simulated.pool).toEqual({ W: 0, U: 1, B: 0, R: 1, G: 0, C: 0 });
    expect(canPayCost(genericTwo, simulated.pool)).toBe(true);
  });

  it('does not treat a lone Signet as covering {2} with no floating mana', () => {
    const sources = new Map([
      ['izzet_signet_1', { activationManaCost: '{1}' }],
    ]);
    const simulated = simulateSequentialPaymentPool(
      [
        { permanentId: 'izzet_signet_1', mana: 'U', count: 2, producedColors: ['U', 'R'] },
      ],
      sources,
    );

    expect(simulated.unpaidActivationPips).toBe(1);
    expect(canPayCost(genericTwo, simulated.pool) && simulated.unpaidActivationPips === 0).toBe(false);
  });
});

describe('chosen-type Cavern of Souls source stamping', () => {
  const cavernOracle =
    'As this land enters, choose a creature type.\n'
    + '{T}: Add {C}.\n'
    + '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.';
  const unclaimedOracle =
    'As this land enters, choose a creature type.\n'
    + '{T}: Add {C}.\n'
    + '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.';

  const cavernPermanent = {
    id: 'cavern_1',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    chosenCreatureType: 'Elf',
    card: {
      id: 'cavern_card',
      name: 'Cavern of Souls',
      type_line: 'Land',
      oracle_text: cavernOracle,
    },
  };
  const forestPermanent = {
    id: 'forest_1',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: 'forest_card',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    },
  };

  it('stamps chosen-type restriction and uncounterable only on any-color, not {C}', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [cavernPermanent] as any);
    const colorless = sources.find((source) => source.abilityId === 'native_c' || source.options.join('') === 'C');
    const anyColor = sources.find((source) => source.abilityId === 'native_any');

    expect(colorless).toBeTruthy();
    expect(colorless?.spendRestriction).toBeUndefined();
    expect(colorless?.grantsUncounterableOnSpend).toBeUndefined();

    expect(anyColor).toBeTruthy();
    expect(anyColor?.spendRestriction).toEqual({
      restriction: 'chosen_type_creature_spell',
      restrictedTo: 'elf',
    });
    expect(anyColor?.grantsUncounterableOnSpend).toBe(true);
  });

  it('does not stamp restriction before a creature type is chosen', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [{
      ...cavernPermanent,
      chosenCreatureType: undefined,
    }] as any);
    const anyColor = sources.find((source) => source.abilityId === 'native_any');
    expect(anyColor?.spendRestriction).toBeUndefined();
    expect(anyColor?.grantsUncounterableOnSpend).toBeUndefined();
  });

  it('stamps Unclaimed Territory restriction without uncounterable', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [{
      id: 'ut_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      chosenCreatureType: 'Elf',
      card: {
        id: 'ut_card',
        name: 'Unclaimed Territory',
        type_line: 'Land',
        oracle_text: unclaimedOracle,
      },
    }] as any);
    const anyColor = sources.find((source) => source.abilityId === 'native_any');
    expect(anyColor?.spendRestriction).toEqual({
      restriction: 'chosen_type_creature_spell',
      restrictedTo: 'elf',
    });
    expect(anyColor?.grantsUncounterableOnSpend).toBeUndefined();
  });

  it('suggests Cavern any-color for a matching Elf {G} over Forest', () => {
    const sources = buildAvailableManaSourcesForPlayer('p1', [forestPermanent, cavernPermanent] as any);
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      sources,
      new Set(),
      undefined,
      {
        purpose: buildRestrictedManaPurposeForSpell({
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          mana_cost: '{G}',
        }),
      },
    );

    expect(items).toEqual([
      expect.objectContaining({ permanentId: 'cavern_1', mana: 'G', count: 1 }),
    ]);
  });
});
