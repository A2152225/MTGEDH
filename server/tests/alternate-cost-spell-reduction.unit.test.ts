import { describe, expect, it } from 'vitest';
import {
  calculateCostReduction,
  formatManaCostWithCostAdjustment,
  formatSpellAlternateCostWithReduction,
  resolveEffectiveSpellBaseManaCost,
} from '../src/socket/game-actions.js';
import { getExternalWUBRGSource } from '../src/state/modules/alternate-costs.js';

const HAKBAL = {
  name: 'Hakbal of the Surging Soul',
  mana_cost: '{1}{G}{U}',
  type_line: 'Legendary Creature — Merfolk Scout',
  colors: ['G', 'U'],
  oracle_text: 'Mutate {1}{G}{U}\nAt the beginning of combat on your turn, each Merfolk you control explores.',
};

/** Leyline of Mutation + Morophon (Merfolk) — Morpholk-style reduction stack. */
const HAKBAL_MOROPHON_LEYLINE_GAME = {
  state: {
    battlefield: [
      {
        id: 'leyline_1',
        controller: 'p1',
        card: {
          name: 'Leyline of Mutation',
          type_line: 'Enchantment',
          oracle_text: 'You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.',
        },
      },
      {
        id: 'morophon_1',
        controller: 'p1',
        chosenCreatureType: 'Merfolk',
        card: {
          name: 'Morophon, the Boundless',
          oracle_text: 'Changeling As Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay.',
        },
      },
    ],
  },
} as any;

describe('alternate cost spell reductions', () => {
  it('Hakbal + Leyline of Mutation + Morophon: mutate, normal, and WUBRG costs', () => {
    const game = HAKBAL_MOROPHON_LEYLINE_GAME;

    expect(getExternalWUBRGSource({ state: game.state } as any, 'p1')).toMatchObject({
      sourceName: 'Leyline of Mutation',
    });

    const reduction = calculateCostReduction(game, 'p1', HAKBAL);
    expect(reduction.messages.some((message) => message.includes('Morophon'))).toBe(true);

    // Printed mana cost {1}{G}{U} — Morophon removes {G}{U}.
    expect(formatManaCostWithCostAdjustment('{1}{G}{U}', reduction)).toBe('{1}');

    // Mutate alternate cost {1}{G}{U} — same colored reduction applies.
    expect(formatSpellAlternateCostWithReduction(game, 'p1', HAKBAL, '{1}{G}{U}')).toBe('{1}');
    expect(resolveEffectiveSpellBaseManaCost({
      forcedAlternateCostId: 'mutate',
      mutateCost: '{1}{G}{U}',
      card: HAKBAL,
    })).toBe('{1}{G}{U}');

    // Leyline WUBRG instead of mana cost — Morophon removes all five colors.
    expect(formatSpellAlternateCostWithReduction(game, 'p1', HAKBAL, '{W}{U}{B}{R}{G}')).toBe('{0}');
    expect(resolveEffectiveSpellBaseManaCost({
      forcedAlternateCostId: 'wubrg_external',
      card: HAKBAL,
    })).toBe('{W}{U}{B}{R}{G}');
  });

  it('resolves mutate and WUBRG alternate base costs from pending cast metadata', () => {
    expect(resolveEffectiveSpellBaseManaCost({
      forcedAlternateCostId: 'mutate',
      mutateCost: '{1}{G}{U}',
      manaCost: '{1}{G}{U}',
      card: HAKBAL,
    })).toBe('{1}{G}{U}');

    expect(resolveEffectiveSpellBaseManaCost({
      forcedAlternateCostId: 'wubrg_external',
      manaCost: '{1}{G}{U}',
    })).toBe('{W}{U}{B}{R}{G}');
  });

  it('applies Pearl Medallion to mutate alternate costs on white spells', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'pearl',
            controller: 'p1',
            card: {
              name: 'Pearl Medallion',
              oracle_text: 'White spells you cast cost {1} less to cast.',
            },
          },
        ],
      },
    };

    const card = {
      name: 'Exalted Sunborn',
      type_line: 'Creature — Angel',
      mana_cost: '{3}{W}{W}',
      colors: ['W'],
      oracle_text: 'Flying\nMutate {1}{W}',
    };

    const reduction = calculateCostReduction(game, 'p1', card);
    expect(formatManaCostWithCostAdjustment('{1}{W}', reduction)).toBe('{W}');
  });
});
