import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';
import { parseActivatedAbility } from '../src/oracleTextParser.ts';

describe('oracle IR gap batch403 — Station threshold activated costs', () => {
  const adagiaThreshold =
    "12+ | {3}{W}, {T}: Create a token that's a copy of target artifact or enchantment you control, except it's legendary. Activate only as a sorcery.";
  const kavaronThreshold =
    '12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.';

  it('splits charge-counter threshold from activated mana cost', () => {
    const activated = parseActivatedAbility(adagiaThreshold);
    expect(activated?.type).toBe('activated');
    expect(activated?.stationChargeThreshold).toBe(12);
    expect(activated?.cost).toBe('{3}{W}, {T}');
    expect(activated?.effect).toMatch(/^Create a token that's a copy of target artifact or enchantment/i);
  });

  it('parses sacrifice costs on threshold-gated station abilities', () => {
    const activated = parseActivatedAbility(kavaronThreshold);
    expect(activated?.stationChargeThreshold).toBe(12);
    expect(activated?.cost).toBe('{1}{R}, {T}, Sacrifice a land');
    expect(activated?.effect).toMatch(/^Create a 2\/2 colorless Robot artifact creature token/i);
  });

  it('carries stationChargeThreshold through IR for Adagia threshold copy', () => {
    const oracle =
      'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n' +
      adagiaThreshold;
    const ir = parseOracleTextToIR(oracle, 'Adagia, Windswept Bastion');
    const thresholdAbility = ir.abilities.find((ability) => /^12\+ \|/i.test(ability.text || ''));

    expect(thresholdAbility?.stationChargeThreshold).toBe(12);
    expect(thresholdAbility?.cost).toBe('{3}{W}, {T}');
    expect(thresholdAbility?.steps.some((step) => step.kind === 'create_token')).toBe(true);
  });

  it('does not treat die-roll result bands as station threshold activations', () => {
    const dieBand = '1-9 | Scry 2, then draw a card.';
    expect(parseActivatedAbility(dieBand)).toBeNull();
  });
});
