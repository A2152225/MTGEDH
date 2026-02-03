import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

function makeGameWithBattlefield(battlefield: any[]) {
  return { state: { battlefield } } as any;
}

describe('Intervening-if: all nonland permanents you control are white', () => {
  it('returns true when you control no nonland permanents', () => {
    const g = makeGameWithBattlefield([
      { id: 'l1', controller: 'p1', card: { type_line: 'Land', colors: [] } },
    ]);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if all nonland permanents you control are white', { id: 'src' } as any)
    ).toBe(true);
  });

  it('returns true when all your nonland permanents are white', () => {
    const g = makeGameWithBattlefield([
      { id: 'w1', controller: 'p1', card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'w2', controller: 'p1', card: { type_line: 'Artifact Creature', color_identity: ['W'] } },
      { id: 'opp', controller: 'p2', card: { type_line: 'Creature', colors: ['B'] } },
    ]);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if all nonland permanents you control are white', { id: 'src' } as any)
    ).toBe(true);
  });

  it('returns false when you control a known nonwhite nonland permanent', () => {
    const g = makeGameWithBattlefield([
      { id: 'w1', controller: 'p1', card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'c1', controller: 'p1', card: { type_line: 'Artifact', colors: [] } },
    ]);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if all nonland permanents you control are white', { id: 'src' } as any)
    ).toBe(false);
  });

  it('returns null when any nonland permanent has unknown color and none are known nonwhite', () => {
    const g = makeGameWithBattlefield([
      { id: 'w1', controller: 'p1', card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'u1', controller: 'p1', card: { type_line: 'Enchantment' } },
    ]);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if all nonland permanents you control are white', { id: 'src' } as any)
    ).toBe(null);
  });
});
