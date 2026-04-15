import { describe, expect, it } from 'vitest';

import { hasConvokeAlternateCost, hasImproviseAlternateCost } from '../src/state/modules/alternate-costs.js';

describe('alternate-cost mana-source checks', () => {
  it('does not treat improvise as fixing missing colored mana through a Signet bundle', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'island_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
          },
          {
            id: 'izzet_signet_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Izzet Signet', type_line: 'Artifact', oracle_text: '{1}, {T}: Add {U}{R}.' },
          },
        ],
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const card: any = {
      name: 'Thought Monitor Clone',
      mana_cost: '{U}{U}',
      oracle_text: 'Improvise',
    };

    expect(hasImproviseAlternateCost(ctx, 'p1', card)).toBe(false);
  });

  it('allows improvise when it only needs to cover generic mana', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'island_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
          },
          {
            id: 'ornithopter_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Ornithopter', type_line: 'Artifact Creature — Thopter', oracle_text: 'Flying' },
          },
        ],
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const card: any = {
      name: 'Whir Clone',
      mana_cost: '{1}{U}',
      oracle_text: 'Improvise',
    };

    expect(hasImproviseAlternateCost(ctx, 'p1', card)).toBe(true);
  });

  it('does not let improvise use the spell itself as discard fodder for a colored mana source', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'mind_cache_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Mind Cache', type_line: 'Artifact', oracle_text: 'Discard a card: Add {U}.' },
          },
          {
            id: 'ornithopter_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Ornithopter', type_line: 'Artifact Creature - Thopter', oracle_text: 'Flying' },
          },
        ],
        zones: {
          p1: {
            hand: [
              {
                id: 'rebuke_hand',
                name: 'Metallic Rebuke Clone',
                mana_cost: '{2}{U}',
                oracle_text: 'Improvise',
              },
            ],
          },
        },
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const card: any = {
      id: 'rebuke_hand',
      name: 'Metallic Rebuke Clone',
      mana_cost: '{2}{U}',
      oracle_text: 'Improvise',
    };

    expect(hasImproviseAlternateCost(ctx, 'p1', card, ['rebuke_hand'])).toBe(false);
  });

  it('does not treat convoke as fixing missing colored mana through a Signet bundle', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'island_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
          },
          {
            id: 'bear_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
          },
        ],
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const card: any = {
      name: 'Convoke Clone',
      mana_cost: '{U}{U}',
      oracle_text: 'Convoke',
    };

    expect(hasConvokeAlternateCost(ctx, 'p1', card)).toBe(false);
  });

  it('allows convoke when it only needs to cover generic mana', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'island_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
          },
          {
            id: 'bear_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
          },
        ],
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const card: any = {
      name: 'Blue Convoke Clone',
      mana_cost: '{1}{U}',
      oracle_text: 'Convoke',
    };

    expect(hasConvokeAlternateCost(ctx, 'p1', card)).toBe(true);
  });

  it('does not let convoke use the spell itself as discard fodder for a colored mana source', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'mind_cache_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Mind Cache', type_line: 'Artifact', oracle_text: 'Discard a card: Add {U}.' },
          },
          {
            id: 'bear_1',
            controller: 'p1',
            tapped: false,
            card: { name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '' },
          },
          {
            id: 'bear_2',
            controller: 'p1',
            tapped: false,
            card: { name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '' },
          },
        ],
        zones: {
          p1: {
            hand: [
              {
                id: 'convoke_hand',
                name: 'Blue Convoke Clone',
                mana_cost: '{2}{U}',
                oracle_text: 'Convoke',
              },
            ],
          },
        },
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const card: any = {
      id: 'convoke_hand',
      name: 'Blue Convoke Clone',
      mana_cost: '{2}{U}',
      oracle_text: 'Convoke',
    };

    expect(hasConvokeAlternateCost(ctx, 'p1', card, ['convoke_hand'])).toBe(false);
  });
});