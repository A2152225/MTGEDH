import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: turn tracking and color families', () => {
  it('evaluates "if you\'ve cast an instant or sorcery spell this turn" from tracked spell entries', () => {
    const g: any = {
      state: {
        spellsCastThisTurn: [
          { casterId: 'p1', card: { type_line: 'Creature — Human' } },
          { casterId: 'p1', card: { type_line: 'Instant' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', "if you've cast an instant or sorcery spell this turn")).toBe(true);
  });

  it('returns false for instant-or-sorcery clause when tracked spells are known and none qualify', () => {
    const g: any = {
      state: {
        spellsCastThisTurn: [
          { casterId: 'p1', card: { type_line: 'Creature — Human' } },
          { casterId: 'p1', card: { type_line: 'Artifact' } },
          { casterId: 'p2', card: { type_line: 'Sorcery' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', "if you've cast an instant or sorcery spell this turn")).toBe(false);
  });

  it('returns null for instant-or-sorcery clause when tracked spell typing is incomplete', () => {
    const g: any = {
      state: {
        spellsCastThisTurn: [{ casterId: 'p1', card: {} }],
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', "if you've cast an instant or sorcery spell this turn")).toBe(null);
  });

  it('evaluates "if a creature entered and a creature died this turn" from replay-safe turn trackers', () => {
    const g: any = {
      state: {
        creaturesEnteredBattlefieldThisTurnByController: { p1: 1, p2: 0 },
        creatureDiedThisTurn: true,
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if a creature entered and a creature died this turn')).toBe(true);
  });

  it('returns false for entered-and-died clause when one side of the conjunction is false', () => {
    const noEntry: any = {
      state: {
        creaturesEnteredBattlefieldThisTurnByController: { p1: 0, p2: 0 },
        creatureDiedThisTurn: true,
      },
    };
    const noDeath: any = {
      state: {
        creaturesEnteredBattlefieldThisTurnByController: { p1: 1, p2: 0 },
        creatureDiedThisTurn: false,
      },
    };

    expect(evaluateInterveningIfClause(noEntry, 'p1', 'if a creature entered and a creature died this turn')).toBe(false);
    expect(evaluateInterveningIfClause(noDeath, 'p1', 'if a creature entered and a creature died this turn')).toBe(false);
  });

  it('evaluates "+1/+1 counter attacker" by scanning current battlefield state', () => {
    const g: any = {
      state: {
        battlefield: [
          {
            id: 'c1',
            controller: 'p1',
            attackedThisTurn: true,
            counters: { '+1/+1': 1 },
            card: { type_line: 'Creature — Human' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if you control a creature with a +1/+1 counter on it that attacked this turn'
      )
    ).toBe(true);
  });

  it('returns false for "+1/+1 counter attacker" when counters are tracked but no attacker qualifies', () => {
    const g: any = {
      state: {
        battlefield: [
          {
            id: 'c1',
            controller: 'p1',
            counters: { '+1/+1': 1 },
            card: { type_line: 'Creature — Human' },
          },
          {
            id: 'c2',
            controller: 'p1',
            attackedThisTurn: true,
            counters: { '+1/+1': 0 },
            card: { type_line: 'Creature — Human' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if you control a creature with a +1/+1 counter on it that attacked this turn'
      )
    ).toBe(false);
  });

  it('returns null for "+1/+1 counter attacker" when counters are not tracked at all', () => {
    const g: any = {
      state: {
        battlefield: [
          {
            id: 'c1',
            controller: 'p1',
            attackedThisTurn: true,
            card: { type_line: 'Creature — Human' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if you control a creature with a +1/+1 counter on it that attacked this turn'
      )
    ).toBe(null);
  });

  it('evaluates "if this creature isn\'t all colors" from explicit color metadata', () => {
    const twoColor: any = { card: { colors: ['G', 'U'], type_line: 'Creature — Dinosaur' } };
    const allColors: any = { card: { colors: ['W', 'U', 'B', 'R', 'G'], type_line: 'Creature — Dinosaur' } };

    expect(evaluateInterveningIfClause({ state: {} } as any, 'p1', "if this creature isn't all colors", twoColor)).toBe(true);
    expect(evaluateInterveningIfClause({ state: {} } as any, 'p1', "if this creature isn't all colors", allColors)).toBe(false);
  });

  it('returns null for "if this creature isn\'t all colors" when explicit color data is absent', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature isn't all colors", { card: { type_line: 'Creature — Dinosaur' } })).toBe(null);
  });
});