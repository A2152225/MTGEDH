import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

describe('oracle IR gap batch422 — Adagia Station tier boundary guard', () => {
  const adagiaOracle =
    'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n' +
    "12+ | {3}{W}, {T}: Create a token that's a copy of target artifact or enchantment you control, except it's legendary. Activate only as a sorcery.";

  it('keeps copy-token threshold text out of the Station add_counter ability', () => {
    const ir = parseOracleTextToIR(adagiaOracle, 'Adagia, Windswept Bastion');
    const stationAbility = ir.abilities.find((ability) => /Station \(Tap another creature/i.test(ability.text || ''));
    const thresholdAbility = ir.abilities.find((ability) => /^12\+ \|/i.test(ability.text || ''));

    expect(stationAbility?.steps.map((step) => step.kind)).toEqual(['add_counter']);
    expect(stationAbility?.steps.some((step) => step.kind === 'create_token')).toBe(false);
    expect(thresholdAbility?.steps.some((step) => step.kind === 'create_token')).toBe(true);
    expect(thresholdAbility?.stationChargeThreshold).toBe(12);
  });
});
