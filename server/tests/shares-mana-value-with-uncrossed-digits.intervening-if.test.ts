import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe(
  "Intervening-if: 'if it shares a mana value with one or more uncrossed digits in the chosen number' (Item 85)",
  () => {
    const clause = 'if it shares a mana value with one or more uncrossed digits in the chosen number';

    it('returns true when its mana value matches an uncrossed digit (explicit refs)', () => {
      const ctx: any = { state: {} };
      const refs: any = { uncrossedDigits: [3, 5], itsManaValue: 5 };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, refs)).toBe(true);
    });

    it('returns false when its mana value does not match any uncrossed digit (explicit refs)', () => {
      const ctx: any = { state: {} };
      const refs: any = { uncrossedDigits: [3, 5], itsManaValue: 2 };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, refs)).toBe(false);
    });

    it('returns null when uncrossed digits are not available', () => {
      const ctx: any = { state: {} };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, {} as any)).toBe(null);
    });

    it('can resolve mana value from triggering stack item when refs provide triggeringStackItemId', () => {
      const ctx: any = {
        state: {
          stack: [{ id: 's1', manaValue: 3, card: { manaValue: 3 } }],
        },
      };
      const refs: any = { uncrossedDigits: [3], triggeringStackItemId: 's1' };
      expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, refs)).toBe(true);
    });
  }
);
