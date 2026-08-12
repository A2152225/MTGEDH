import { describe, expect, it } from 'vitest';
import { calculateCostReduction } from '../src/socket/game-actions.js';

describe('delirium / void / vivid cast-time cost reduction', () => {
  it('Drag to the Roots costs {2} less with delirium and full cost without', () => {
    const card = {
      name: 'Drag to the Roots',
      mana_cost: '{2}{B}{G}',
      type_line: 'Instant',
      colors: ['B', 'G'],
      oracle_text:
        'Delirium — This spell costs {2} less to cast as long as there are four or more card types among cards in your graveyard.\nDestroy target nonland permanent.',
    };

    const withoutDelirium = {
      state: {
        battlefield: [],
        zones: {
          p1: {
            graveyard: [
              { type_line: 'Creature — Elf' },
              { type_line: 'Instant' },
              { type_line: 'Land' },
            ],
          },
        },
      },
    } as any;
    expect(calculateCostReduction(withoutDelirium, 'p1', card).generic).toBe(0);

    const withDelirium = {
      state: {
        battlefield: [],
        zones: {
          p1: {
            graveyard: [
              { type_line: 'Creature — Elf' },
              { type_line: 'Instant' },
              { type_line: 'Land' },
              { type_line: 'Artifact' },
            ],
          },
        },
      },
    } as any;
    const reduction = calculateCostReduction(withDelirium, 'p1', card);
    expect(reduction.generic).toBe(2);
    expect(reduction.messages.some((m) => /as-long-as cost rider/i.test(m))).toBe(true);
  });

  it('Temporal Intervention costs {2} less when void is active', () => {
    const card = {
      name: 'Temporal Intervention',
      mana_cost: '{2}{B}',
      type_line: 'Sorcery',
      colors: ['B'],
      oracle_text:
        'Void — This spell costs {2} less to cast if a nonland permanent left the battlefield this turn or a spell was warped this turn.\nTarget opponent reveals their hand. You choose a nonland card from it. That player discards that card.',
    };

    const inactive = {
      state: {
        battlefield: [],
        permanentLeftBattlefieldThisTurn: { p1: false },
        spellWasWarpedThisTurn: { p1: false },
        zones: { p1: { graveyard: [] } },
      },
    } as any;
    expect(calculateCostReduction(inactive, 'p1', card).generic).toBe(0);

    const active = {
      state: {
        battlefield: [],
        permanentLeftBattlefieldThisTurn: { p2: true },
        spellWasWarpedThisTurn: { p1: false },
        zones: { p1: { graveyard: [] } },
      },
    } as any;
    expect(calculateCostReduction(active, 'p1', card).generic).toBe(2);
  });

  it('Rime Chill reduces by {1} per color among permanents you control', () => {
    const card = {
      name: 'Rime Chill',
      mana_cost: '{6}{U}',
      type_line: 'Instant',
      colors: ['U'],
      oracle_text:
        'Vivid — This spell costs {1} less to cast for each color among permanents you control.\nTap up to two target creatures. Put a stun counter on each of them.\nDraw a card.',
    };

    const game = {
      state: {
        battlefield: [
          {
            id: 'a',
            controller: 'p1',
            card: { name: 'Birds of Paradise', colors: ['G'], mana_cost: '{G}', type_line: 'Creature' },
          },
          {
            id: 'b',
            controller: 'p1',
            card: { name: 'Sol Ring', colors: [], mana_cost: '{1}', type_line: 'Artifact' },
          },
          {
            id: 'c',
            controller: 'p1',
            card: { name: 'Lightning Bolt', colors: ['R'], mana_cost: '{R}', type_line: 'Instant' },
          },
        ],
        zones: { p1: { graveyard: [] } },
      },
    } as any;

    const reduction = calculateCostReduction(game, 'p1', card);
    expect(reduction.generic).toBe(2);
  });
});
