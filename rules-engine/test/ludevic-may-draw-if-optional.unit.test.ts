import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe('Ludevic-style may-draw-if optional', () => {
  it('keeps optional on "that player may draw a card if CONDITION"', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's end step, that player may draw a card if a player other than you lost life this turn.\nPartner (You can have two commanders if both have partner.)",
    );
    const triggered = ir.abilities.find((a) => a.type === 'triggered');
    expect(triggered).toBeTruthy();
    const conditional = triggered!.steps[0] as any;
    expect(conditional.kind).toBe('conditional');
    expect(conditional.condition?.raw).toMatch(/lost life this turn/i);
    const draw = conditional.steps?.[0];
    expect(draw?.kind).toBe('draw');
    expect(draw?.optional).toBe(true);
    expect(String(draw?.raw || '')).toMatch(/may draw/i);
  });

  it('does not force optional when subject draws without may', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's end step, that player draws a card if a player other than you lost life this turn.",
    );
    const conditional = (ir.abilities[0] as any).steps[0];
    expect(conditional.kind).toBe('conditional');
    expect(conditional.steps[0].optional).toBeFalsy();
  });
});
