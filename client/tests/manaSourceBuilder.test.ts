import { describe, expect, it } from 'vitest';

import { buildAvailableManaSourcesForPlayer, buildSuggestedPaymentItems } from '../src/utils/manaSourceBuilder';
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
      { permanentId: '__pool__:blue:0', mana: 'U', count: 1 },
      { permanentId: '__pool__:green:0', mana: 'G', count: 1 },
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
      { permanentId: '__pool__:blue:0', mana: 'U', count: 1 },
      { permanentId: '__pool__:green:0', mana: 'G', count: 1 },
    ]);
  });

  it('uses restricted floating mana for auto-pay without duplicating regular pool slots', () => {
    const floatingSources: ManaPaymentSource[] = [
      { id: '__pool__:green:0', name: 'Floating {G}', options: ['G'], amount: 1 },
      { id: '__pool__:green:1', name: 'Floating {G}', options: ['G'], amount: 1 },
      { id: '__pool__:restricted:0:0', name: 'Restricted {G}', options: ['G'], amount: 1 },
      { id: '__pool__:restricted:0:1', name: 'Restricted {G}', options: ['G'], amount: 1 },
      { id: '__pool__:restricted:0:2', name: 'Restricted {G}', options: ['G'], amount: 1 },
      { id: '__pool__:restricted:0:3', name: 'Restricted {G}', options: ['G'], amount: 1 },
      { id: '__pool__:restricted:0:4', name: 'Restricted {G}', options: ['G'], amount: 1 },
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
      { permanentId: '__pool__:green:0', mana: 'G', count: 1 },
      { permanentId: '__pool__:green:1', mana: 'G', count: 1 },
      { permanentId: '__pool__:restricted:0:0', mana: 'G', count: 1 },
      { permanentId: '__pool__:restricted:0:1', mana: 'G', count: 1 },
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
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ] as any,
      { excludePermanentIds: ['nykthos_1'] },
    );

    expect(sources.some((source) => String(source.sourcePermanentId || source.id).startsWith('nykthos_1'))).toBe(false);
    expect(sources.some((source) => String(source.sourcePermanentId || source.id).startsWith('forest_1'))).toBe(true);
  });
});
