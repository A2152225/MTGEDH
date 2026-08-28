import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const XANTCHA_ORACLE =
  "Xantcha enters under the control of an opponent of your choice.\n" +
  "Xantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.\n" +
  "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.";

describe('Xantcha, Sleeper Agent oracle IR', () => {
  it('parses enters-under-opponent-control as gain_control, not a repeating unknown', () => {
    const ir = parseOracleTextToIR(XANTCHA_ORACLE, 'Xantcha, Sleeper Agent');
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    const gainControl = steps.find((step) => step.kind === 'gain_control') as any;
    expect(gainControl).toBeTruthy();
    expect(String(gainControl?.newController?.kind || '')).toBe('target_opponent');
    expect(String(gainControl?.raw || '')).toMatch(/enters(?: the battlefield)? under the control of an opponent/i);
    expect(steps.some((step) => step.kind === 'unknown' && /under the control of an opponent/i.test(String(step.raw || '')))).toBe(false);
  });

  it('parses the {3} ability as lose-life plus draw that any player may activate', () => {
    const ir = parseOracleTextToIR(XANTCHA_ORACLE, 'Xantcha, Sleeper Agent');
    const activated = ir.abilities.find((ability) => ability.type === 'activated') as any;
    expect(activated).toBeTruthy();
    expect(activated.anyPlayerMayActivate).toBe(true);
    expect(activated.steps.map((step: any) => step.kind)).toEqual(['lose_life', 'draw']);
    const loseLife = activated.steps.find((step: any) => step.kind === 'lose_life');
    expect(loseLife?.who?.kind).toBe('source_controller');
    expect(ir.abilities.some((ability) => /^any player may activate this ability/i.test(String(ability.text || '')))).toBe(false);
  });
});
