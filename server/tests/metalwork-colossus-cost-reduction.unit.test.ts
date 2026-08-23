import { describe, expect, it } from 'vitest';
import { calculateCostReduction, formatManaCostWithCostAdjustment } from '../src/socket/game-actions.js';
import {
  applySpellSelfTotalManaValueCostReduction,
  parseTotalManaValueCostLessQualifier,
  permanentMatchesManaValueFilter,
} from '../src/state/modules/spellSelfTotalManaValueCostReduction.js';

const METALWORK_COLOSSUS = {
  name: 'Metalwork Colossus',
  mana_cost: '{11}',
  cmc: 11,
  type_line: 'Artifact Creature — Construct',
  colors: [],
  oracle_text:
    'This spell costs {X} less to cast, where X is the total mana value of noncreature artifacts you control.\nSacrifice two artifacts: Return Metalwork Colossus from your graveyard to your hand.',
};

function makeGame(battlefield: any[]) {
  return {
    state: {
      battlefield,
      zones: { p1: { graveyard: [] } },
    },
  } as any;
}

describe('spellSelfTotalManaValueCostReduction (Metalwork Colossus pattern)', () => {
  it('parses noncreature artifacts qualifier generically', () => {
    expect(
      parseTotalManaValueCostLessQualifier('noncreature artifacts you control'),
    ).toEqual({ kind: 'noncreature_artifacts' });
    expect(parseTotalManaValueCostLessQualifier('historic permanents you control')).toEqual({
      kind: 'historic',
    });
  });

  it('matches noncreature artifacts but not artifact creatures', () => {
    const filter = { kind: 'noncreature_artifacts' as const };
    expect(
      permanentMatchesManaValueFilter(
        { card: { type_line: 'Artifact' } },
        filter,
      ),
    ).toBe(true);
    expect(
      permanentMatchesManaValueFilter(
        { card: { type_line: 'Artifact Creature — Golem' } },
        filter,
      ),
    ).toBe(false);
  });

  it('sums total MV of noncreature artifacts you control', () => {
    const delta = applySpellSelfTotalManaValueCostReduction({
      oracleText: METALWORK_COLOSSUS.oracle_text,
      cardName: METALWORK_COLOSSUS.name,
      playerId: 'p1',
      battlefield: [
        {
          id: 'sol',
          controller: 'p1',
          card: { name: 'Sol Ring', mana_cost: '{1}', cmc: 1, type_line: 'Artifact' },
        },
        {
          id: 'thran',
          controller: 'p1',
          card: { name: 'Thran Dynamo', mana_cost: '{4}', cmc: 4, type_line: 'Artifact' },
        },
        {
          id: 'golem',
          controller: 'p1',
          card: {
            name: 'Platinum Angel',
            mana_cost: '{7}',
            cmc: 7,
            type_line: 'Artifact Creature — Angel',
          },
        },
        {
          id: 'opp',
          controller: 'p2',
          card: { name: 'Mana Crypt', mana_cost: '{0}', cmc: 0, type_line: 'Artifact' },
        },
      ],
    });
    // Sol Ring (1) + Thran Dynamo (4) = 5; artifact creature excluded; opponent excluded
    expect(delta.generic).toBe(5);
  });

  it('Metalwork Colossus with noncreature artifacts totaling MV >= 11 is payable as {0}', () => {
    const game = makeGame([
      {
        id: 'a',
        controller: 'p1',
        card: { name: 'Dreamstone Hedron', mana_cost: '{6}', cmc: 6, type_line: 'Artifact' },
      },
      {
        id: 'b',
        controller: 'p1',
        card: { name: 'Gilded Lotus', mana_cost: '{5}', cmc: 5, type_line: 'Artifact' },
      },
      {
        id: 'c',
        controller: 'p1',
        card: { name: 'Worn Powerstone', mana_cost: '{3}', cmc: 3, type_line: 'Artifact' },
      },
      {
        id: 'd',
        controller: 'p1',
        card: { name: 'Solemn Simulacrum', mana_cost: '{4}', cmc: 4, type_line: 'Artifact Creature — Golem' },
      },
    ]);

    const reduction = calculateCostReduction(game, 'p1', METALWORK_COLOSSUS);
    // 6+5+3 = 14 (>= 11); Solemn (creature) excluded
    expect(reduction.generic).toBeGreaterThanOrEqual(11);
    expect(reduction.messages.some((m) => /noncreature artifact mana value/i.test(m))).toBe(true);

    const adjusted = formatManaCostWithCostAdjustment('{11}', reduction);
    expect(adjusted).toBe('{0}');
  });

  it('does not apply when only artifact creatures are controlled', () => {
    const game = makeGame([
      {
        id: 'g',
        controller: 'p1',
        card: {
          name: 'Steel Hellkite',
          mana_cost: '{6}',
          cmc: 6,
          type_line: 'Artifact Creature — Dragon',
        },
      },
    ]);
    const reduction = calculateCostReduction(game, 'p1', METALWORK_COLOSSUS);
    expect(reduction.generic).toBe(0);
    const adjusted = formatManaCostWithCostAdjustment('{11}', reduction);
    expect(adjusted).toBe('{11}');
  });
});
