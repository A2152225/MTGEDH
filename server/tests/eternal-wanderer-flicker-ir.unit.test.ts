import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const WANDERER =
  "No more than one creature can attack The Eternal Wanderer each combat.\n" +
  "[+1]: Exile up to one target artifact or creature. Return that card to the battlefield under its owner's control at the beginning of that player's next end step.\n" +
  "[0]: Create a 2/2 white Samurai creature token with double strike.\n" +
  "[−4]: For each player, choose a creature that player controls. Each player sacrifices all creatures they control not chosen this way.";

describe('The Eternal Wanderer +1 IR', () => {
  it('parses delayed return as schedule_delayed_trigger (not immediate move_zone)', () => {
    const ir = parseOracleTextToIR(WANDERER, { cardName: 'The Eternal Wanderer' }) as any;
    const plusOne = (ir.abilities || []).find((a: any) => String(a?.cost || '') === '[+1]');
    expect(plusOne).toBeTruthy();
    const steps = plusOne.steps || [];
    expect(steps.some((s: any) => s.kind === 'exile')).toBe(true);
    const delayed = steps.find((s: any) => s.kind === 'schedule_delayed_trigger');
    expect(delayed).toBeTruthy();
    expect(String(delayed.timing)).toBe('your_next_end_step');
    expect(String(delayed.effect || '').toLowerCase()).toMatch(/return.*battlefield/);
    expect(steps.some((s: any) => s.kind === 'move_zone')).toBe(false);
  });
});
