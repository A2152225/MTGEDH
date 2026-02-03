import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: library/graveyard/colors (avoid avoidable nulls)', () => {
  it('"no nonbasic land cards in your library" treats empty library as true', () => {
    const g: any = {
      state: {
        zones: {
          p1: {
            library: [],
          },
        },
      },
    };

    expect(evaluateInterveningIfClause(g as any, 'p1', 'if there are no nonbasic land cards in your library')).toBe(true);
  });

  it('"no nonbasic land cards in your library" returns false when a nonbasic land is present', () => {
    const g: any = {
      state: {
        zones: {
          p1: {
            library: [{ id: 'l1', type_line: 'Land' }],
          },
        },
      },
    };

    expect(evaluateInterveningIfClause(g as any, 'p1', 'if there are no nonbasic land cards in your library')).toBe(false);
  });

  it('"five or more mana values among cards in your graveyard" treats empty graveyard as false', () => {
    const g: any = {
      state: {
        zones: {
          p1: {
            graveyard: [],
          },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g as any, 'p1', 'if there are five or more mana values among cards in your graveyard')
    ).toBe(false);
  });

  it('"five colors among permanents you control" reads card.colors and card.color_identity', () => {
    const g: any = {
      state: {
        battlefield: [
          { id: 'w', controller: 'p1', card: { colors: ['W'], type_line: 'Creature' } },
          { id: 'u', controller: 'p1', card: { colors: ['U'], type_line: 'Creature' } },
          { id: 'b', controller: 'p1', card: { colors: ['B'], type_line: 'Creature' } },
          { id: 'r', controller: 'p1', card: { colors: ['R'], type_line: 'Creature' } },
          // Use color_identity-only to ensure that path is covered.
          { id: 'g', controller: 'p1', card: { color_identity: ['G'], type_line: 'Creature' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(g as any, 'p1', 'if there are five colors among permanents you control')).toBe(true);
  });

  it('"five colors among permanents you control" returns null if unknown permanents exist and only 4 colors found', () => {
    const g: any = {
      state: {
        battlefield: [
          { id: 'w', controller: 'p1', card: { colors: ['W'], type_line: 'Creature' } },
          { id: 'u', controller: 'p1', card: { colors: ['U'], type_line: 'Creature' } },
          { id: 'b', controller: 'p1', card: { colors: ['B'], type_line: 'Creature' } },
          { id: 'r', controller: 'p1', card: { colors: ['R'], type_line: 'Creature' } },
          { id: 'x', controller: 'p1', card: { type_line: 'Artifact' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(g as any, 'p1', 'if there are five colors among permanents you control')).toBe(null);
  });

  it('"five colors among permanents you control" returns false when only 4 colors and no unknowns', () => {
    const g: any = {
      state: {
        battlefield: [
          { id: 'w', controller: 'p1', card: { colors: ['W'], type_line: 'Creature' } },
          { id: 'u', controller: 'p1', card: { colors: ['U'], type_line: 'Creature' } },
          { id: 'b', controller: 'p1', card: { colors: ['B'], type_line: 'Creature' } },
          { id: 'r', controller: 'p1', card: { colors: ['R'], type_line: 'Creature' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(g as any, 'p1', 'if there are five colors among permanents you control')).toBe(false);
  });
});
