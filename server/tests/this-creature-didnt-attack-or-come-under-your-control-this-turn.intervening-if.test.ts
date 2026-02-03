import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: \"if this creature didn't attack or come under your control this turn\" (Item 33)", () => {
  it('returns false when the creature attacked (direct flag)', () => {
    const ctx: any = { state: {} };
    const src: any = { id: 'c1', controller: 'p1', attackedThisTurn: true };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if this creature didn't attack or come under your control this turn", src, {} as any)
    ).toBe(false);
  });

  it('returns false when the creature is currently attacking (best-effort state)', () => {
    const ctx: any = { state: {} };
    const src: any = { id: 'c1', controller: 'p1', defendingPlayerId: 'p2' };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if this creature didn't attack or come under your control this turn", src, {} as any)
    ).toBe(false);
  });

  it('returns false when it came under your control this turn (explicit)', () => {
    const ctx: any = { state: {} };
    const src: any = { id: 'c1', controller: 'p1', attackedThisTurn: false, cameUnderYourControlThisTurn: true };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if this creature didn't attack or come under your control this turn", src, {} as any)
    ).toBe(false);
  });

  it('treats enteredThisTurn === true as positive evidence (returns false)', () => {
    const ctx: any = { state: {} };
    const src: any = { id: 'c1', controller: 'p1', attackedThisTurn: false, cameUnderYourControlThisTurn: false, enteredThisTurn: true };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if this creature didn't attack or come under your control this turn", src, {} as any)
    ).toBe(false);
  });

  it('returns true only when both signals are explicitly known-false', () => {
    const ctx: any = { state: {} };
    const src: any = { id: 'c1', controller: 'p1', attackedThisTurn: false, cameUnderYourControlThisTurn: false };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if this creature didn't attack or come under your control this turn", src, {} as any)
    ).toBe(true);
  });

  it('returns null when one of the signals is unknown', () => {
    const ctx: any = { state: {} };
    const src: any = { id: 'c1', controller: 'p1', attackedThisTurn: false };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if this creature didn't attack or come under your control this turn", src, {} as any)
    ).toBe(null);
  });
});
