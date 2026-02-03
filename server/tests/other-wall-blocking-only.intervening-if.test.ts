import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe(
  "Intervening-if: 'if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature' (Item 83)",
  () => {
    const clause =
      'if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature';

    it('returns true when all blockers are walls and there is at least one other wall besides the source', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'att', controller: 'p2', card: { name: 'Attacker', type_line: 'Creature' }, blockedBy: ['w1', 'w2'] },
            { id: 'w1', controller: 'p1', card: { name: 'Wall 1', type_line: 'Creature — Wall' } },
            { id: 'w2', controller: 'p1', card: { name: 'Wall 2', type_line: 'Creature — Wall' } },
          ],
        },
      };

      const src = ctx.state.battlefield[1];
      const refs: any = { thatCreatureId: 'att', blockingCreatureIds: ['w1', 'w2'] };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(true);
    });

    it('returns false when any known non-wall creature is blocking that creature', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'att', controller: 'p2', card: { name: 'Attacker', type_line: 'Creature' }, blockedBy: ['w1', 'b1'] },
            { id: 'w1', controller: 'p1', card: { name: 'Wall 1', type_line: 'Creature — Wall' } },
            { id: 'b1', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear' } },
          ],
        },
      };

      const src = ctx.state.battlefield[1];
      const refs: any = { thatCreatureId: 'att', blockingCreatureIds: ['w1', 'b1'] };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(false);
    });

    it('returns false when only the source wall is blocking (no other wall)', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'att', controller: 'p2', card: { name: 'Attacker', type_line: 'Creature' }, blockedBy: ['w1'] },
            { id: 'w1', controller: 'p1', card: { name: 'Wall 1', type_line: 'Creature — Wall' } },
          ],
        },
      };

      const src = ctx.state.battlefield[1];
      const refs: any = { thatCreatureId: 'att', blockingCreatureIds: ['w1'] };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(false);
    });

    it('returns null when blocker identity is incomplete (unknown blockers could be non-walls)', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'att', controller: 'p2', card: { name: 'Attacker', type_line: 'Creature' }, blockedBy: ['w1', 'missing'] },
            { id: 'w1', controller: 'p1', card: { name: 'Wall 1', type_line: 'Creature — Wall' } },
          ],
        },
      };

      const src = ctx.state.battlefield[1];
      const refs: any = { thatCreatureId: 'att', blockingCreatureIds: ['w1', 'missing'] };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(null);
    });

    it('can compute blockers from battlefield blockedBy when blockingCreatureIds are not provided', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'att', controller: 'p2', card: { name: 'Attacker', type_line: 'Creature' }, blockedBy: ['w1', 'w2'] },
            { id: 'w1', controller: 'p1', card: { name: 'Wall 1', type_line: 'Creature — Wall' } },
            { id: 'w2', controller: 'p1', card: { name: 'Wall 2', type_line: 'Creature — Wall' } },
          ],
        },
      };

      const src = ctx.state.battlefield[1];
      const refs: any = { thatCreatureId: 'att' };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(true);
    });
  }
);
