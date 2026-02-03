import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if <Name> is a creature" (Item 39)', () => {
  function mkCtx(battlefield: any[]): any {
    return { state: { battlefield, players: [] } };
  }

  const p1 = 'p1';

  it('returns true/false from type_line when there is a unique battlefield match', () => {
    const ctxTrue = mkCtx([{ id: 'a', card: { name: 'Alpha', type_line: 'Creature — Human' } }]);
    expect(evaluateInterveningIfClause(ctxTrue, p1, 'if Alpha is a creature')).toBe(true);

    const ctxFalse = mkCtx([{ id: 'a', card: { name: 'Alpha', type_line: 'Artifact' } }]);
    expect(evaluateInterveningIfClause(ctxFalse, p1, 'if Alpha is a creature')).toBe(false);
  });

  it('returns true/false from card.types when type_line is unavailable', () => {
    const ctxTrue = mkCtx([{ id: 'a', card: { name: 'Alpha', types: ['Creature', 'Artifact'] } }]);
    expect(evaluateInterveningIfClause(ctxTrue, p1, 'if Alpha is a creature')).toBe(true);

    const ctxFalse = mkCtx([{ id: 'a', card: { name: 'Alpha', types: ['Artifact'] } }]);
    expect(evaluateInterveningIfClause(ctxFalse, p1, 'if Alpha is a creature')).toBe(false);
  });

  it('returns null when a unique match exists but there is no type information', () => {
    const ctx = mkCtx([{ id: 'a', card: { name: 'Alpha' } }]);
    expect(evaluateInterveningIfClause(ctx, p1, 'if Alpha is a creature')).toBe(null);
  });

  it('prefers sourcePermanent when its name matches (avoids multi-copy ambiguity)', () => {
    const source = { id: 's1', card: { name: 'Alpha', type_line: 'Artifact Creature — Golem' } } as any;
    const ctx = mkCtx([
      { id: 'x1', card: { name: 'Alpha', type_line: 'Artifact' } },
      { id: 'x2', card: { name: 'Alpha', type_line: 'Artifact' } },
    ]);

    expect(evaluateInterveningIfClause(ctx, p1, 'if Alpha is a creature', source)).toBe(true);
  });

  it('returns false when no battlefield matches exist', () => {
    const ctx = mkCtx([{ id: 'b', card: { name: 'Beta', type_line: 'Creature — Elf' } }]);
    expect(evaluateInterveningIfClause(ctx, p1, 'if Alpha is a creature')).toBe(false);
  });

  it('returns null when battlefield match is ambiguous and no sourcePermanent disambiguates', () => {
    const ctx = mkCtx([
      { id: 'x1', card: { name: 'Alpha', type_line: 'Creature — Human' } },
      { id: 'x2', card: { name: 'Alpha', type_line: 'Artifact' } },
    ]);

    expect(evaluateInterveningIfClause(ctx, p1, 'if Alpha is a creature')).toBe(null);
  });
});
