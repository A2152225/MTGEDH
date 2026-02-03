import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe(
  "Intervening-if: 'if it doesn't share a keyword or ability word with a permanent you control or a card in your graveyard' (Item 84)",
  () => {
    const clause = "if it doesn't share a keyword or ability word with a permanent you control or a card in your graveyard";

    it('returns false when explicit refs say it shares', () => {
      const ctx: any = { state: {} };
      expect(
        evaluateInterveningIfClause(ctx, 'p1', clause, null as any, { itSharesKeywordOrAbilityWordWithYourPermanentOrGraveyardCard: true } as any)
      ).toBe(false);
    });

    it('returns true when explicit refs say it does not share', () => {
      const ctx: any = { state: {} };
      expect(
        evaluateInterveningIfClause(ctx, 'p1', clause, null as any, { itSharesKeywordOrAbilityWordWithYourPermanentOrGraveyardCard: false } as any)
      ).toBe(true);
    });

    it('returns false when a shared keyword with a permanent you control is provable from state', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'it', controller: 'p1', card: { name: 'It', type_line: 'Creature', keywords: ['Haste', 'Flying'] } },
            { id: 'ally', controller: 'p1', card: { name: 'Ally', type_line: 'Creature', keywords: ['Haste'] } },
          ],
        },
      };

      const src = ctx.state.battlefield[0];
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, {} as any)).toBe(false);
    });

    it('returns null when keywords are missing (cannot decide)', () => {
      const ctx: any = {
        state: {
          battlefield: [{ id: 'it', controller: 'p1', card: { name: 'It', type_line: 'Creature' } }],
        },
      };

      const src = ctx.state.battlefield[0];
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, {} as any)).toBe(null);
    });

    it('returns null when no shared keyword is found (absence is not deterministic)', () => {
      const ctx: any = {
        state: {
          battlefield: [
            { id: 'it', controller: 'p1', card: { name: 'It', type_line: 'Creature', keywords: ['Flying'] } },
            { id: 'ally', controller: 'p1', card: { name: 'Ally', type_line: 'Creature', keywords: ['Haste'] } },
          ],
        },
      };

      const src = ctx.state.battlefield[0];
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, {} as any)).toBe(null);
    });
  }
);
