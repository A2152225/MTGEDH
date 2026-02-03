import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: kicked + was cast (safe defaults)', () => {
  it('"if it was kicked" returns null when untracked', () => {
    const g: any = { state: {} };
    const source: any = { card: { name: 'Test' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', source)).toBe(null);
  });

  it('"if it was kicked" respects explicit boolean metadata', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { wasKicked: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { wasKicked: false } as any)).toBe(false);
  });

  it('"if this creature wasn\'t kicked" inverts explicit boolean metadata', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { wasKicked: true } as any)).toBe(false);
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { wasKicked: false } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { card: { name: 'X' } } as any)).toBe(null);
  });

  it('kicker count metadata is treated as positive-only evidence', () => {
    const g: any = { state: {} };

    // "if it was kicked": count > 0 => true; count = 0 => unknown (null)
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { kickerPaidCount: 1 } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { timesKicked: 2 } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { kickedTimes: 0 } as any)).toBe(null);

    // "if this creature wasn't kicked": count > 0 => false; count = 0 => unknown (null)
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { kickerPaidCount: 1 } as any)).toBe(false);
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { timesKicked: 0 } as any)).toBe(null);
  });

  it('"if that spell was kicked" is replay-safe (null when untracked)', () => {
    const g: any = { state: {} };

    // Even if we have a source object, missing metadata should not become false.
    expect(evaluateInterveningIfClause(g, 'p1', 'if that spell was kicked', { card: { name: 'X' } } as any)).toBe(null);

    // Explicit boolean evidence is deterministic.
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if that spell was kicked', { card: { wasKicked: true } } as any)
    ).toBe(true);
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if that spell was kicked', { card: { wasKicked: false } } as any)
    ).toBe(false);

    // If refs.stackItem is present, prefer that spell's metadata.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if that spell was kicked',
        { card: { wasKicked: false } } as any,
        { stackItem: { card: { wasKicked: true } } } as any
      )
    ).toBe(true);
  });

  it('"if it was kicked twice" is replay-safe (no false without explicit evidence)', () => {
    const g: any = { state: {} };

    // Untracked: null.
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked twice', { card: { name: 'X' } } as any)).toBe(null);

    // Explicit boolean evidence is deterministic.
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked twice', { wasKickedTwice: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked twice', { wasKickedTwice: false } as any)).toBe(false);

    // Explicit "not kicked" implies "not kicked twice".
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked twice', { wasKicked: false } as any)).toBe(false);

    // Kicked at least once doesn't imply kicked twice.
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked twice', { wasKicked: true } as any)).toBe(null);
  });

  it('"if it was cast" returns true when cast provenance is tracked', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { castSourceZone: 'hand' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { source: 'graveyard' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { fromZone: 'exile' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { castFromHand: true } as any)).toBe(true);
  });

  it('"if that spell was foretold" prefers triggering stack item metadata', () => {
    const g: any = { state: {} };

    // Source permanent might exist but refers to the resolving permanent; the clause refers to the triggering spell.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if that spell was foretold',
        { castFromForetell: false } as any,
        { stackItem: { castFromForetell: true } } as any
      )
    ).toBe(true);

    // Still returns null when nothing is tracked.
    expect(evaluateInterveningIfClause(g, 'p1', 'if that spell was foretold', { card: { name: 'X' } } as any)).toBe(null);
  });
});
