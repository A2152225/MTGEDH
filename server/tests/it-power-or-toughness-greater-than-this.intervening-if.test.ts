import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe(
  "Intervening-if: 'if its power is greater than this creature's power or its toughness is greater than this creature's toughness' (Item 86)",
  () => {
    const clause = "if its power is greater than this creature's power or its toughness is greater than this creature's toughness";

    it('returns true when the referenced creature has greater power', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'src', controller: 'p1', card: { name: 'Src', type_line: 'Creature' }, power: 2, toughness: 2 },
            { id: 'it', controller: 'p2', card: { name: 'It', type_line: 'Creature' }, power: 3, toughness: 1 },
          ],
        },
      };
      const src = ctx.state.battlefield[0];
      const refs: any = { thatCreatureId: 'it' };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(true);
    });

    it('returns true when the referenced creature has greater toughness', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'src', controller: 'p1', card: { name: 'Src', type_line: 'Creature' }, power: 2, toughness: 2 },
            { id: 'it', controller: 'p2', card: { name: 'It', type_line: 'Creature' }, power: 1, toughness: 4 },
          ],
        },
      };
      const src = ctx.state.battlefield[0];
      const refs: any = { itCreatureId: 'it' };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(true);
    });

    it('returns false when neither power nor toughness is greater', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'src', controller: 'p1', card: { name: 'Src', type_line: 'Creature' }, power: 3, toughness: 3 },
            { id: 'it', controller: 'p2', card: { name: 'It', type_line: 'Creature' }, power: 2, toughness: 2 },
          ],
        },
      };
      const src = ctx.state.battlefield[0];
      const refs: any = { thatCreatureId: 'it' };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(false);
    });

    it('returns null when the referenced creature is not on the battlefield', () => {
      const ctx: any = {
        state: {
          battlefield: [{ id: 'src', controller: 'p1', card: { name: 'Src', type_line: 'Creature' }, power: 2, toughness: 2 }],
        },
      };
      const src = ctx.state.battlefield[0];
      const refs: any = { thatCreatureId: 'missing' };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, refs)).toBe(null);
    });
  }
);
