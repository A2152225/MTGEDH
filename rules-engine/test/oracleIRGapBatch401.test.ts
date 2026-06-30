import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';
import { parseActivatedAbility, parseOracleText } from '../src/oracleTextParser.ts';
import { splitOracleTextIntoParseLines } from '../src/oracleTextParserPreprocess.ts';

describe('oracle IR gap batch401 — Station ability boundaries', () => {
  it('splits Station reminder from threshold activated lines', () => {
    const oracle =
      'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n' +
      "12+ | {3}{W}, {T}: Create a token that's a copy of target artifact or enchantment you control, except it's legendary. Activate only as a sorcery.";

    const lines = splitOracleTextIntoParseLines(oracle);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Station \(Tap another creature you control:/);
    expect(lines[1]).toMatch(/^12\+ \| \{3\}\{W\}, \{T\}:/);
  });

  it('parses Station keyword without splitting on inner reminder colon', () => {
    const activated = parseActivatedAbility(
      'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)'
    );
    expect(activated?.cost).toBe('Station (Tap another creature you control)');
    expect(activated?.effect).toBe('Put charge counters equal to its power on this Planet.');
  });

  it('parses Kavaron Station with inline threshold reminder as add_counter', () => {
    const stationOnly =
      "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)";
    const ir = parseOracleTextToIR(stationOnly, 'Kavaron, Memorial World');
    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.steps.map((step) => step.kind)).toEqual(['add_counter']);
  });

  it('keeps Kavaron Station add_counter separate from threshold token ability in full card IR', () => {
    const oracle =
      '{T}: Add {R}.\n' +
      "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)\n" +
      '12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.';
    const ir = parseOracleTextToIR(oracle, 'Kavaron, Memorial World');
    const stationAbility = ir.abilities.find((ability) => /Station \(Tap another creature/i.test(ability.text || ''));
    const thresholdAbility = ir.abilities.find((ability) => /^12\+ \|/i.test(ability.text || ''));

    expect(stationAbility?.steps.map((step) => step.kind)).toEqual(['add_counter']);
    expect(thresholdAbility?.steps.some((step) => step.kind === 'create_token')).toBe(true);
    expect(stationAbility?.steps.some((step) => step.kind === 'create_token')).toBe(false);
  });

  it('keeps Adagia Station and threshold copy abilities separate in IR', () => {
    const oracle =
      'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n' +
      "12+ | {3}{W}, {T}: Create a token that's a copy of target artifact or enchantment you control, except it's legendary. Activate only as a sorcery.";
    const parsed = parseOracleText(oracle, 'Adagia, Windswept Bastion');
    expect(parsed.abilities).toHaveLength(2);

    const ir = parseOracleTextToIR(oracle, 'Adagia, Windswept Bastion');
    const stationAbility = ir.abilities.find((ability) => /Station \(Tap another creature/i.test(ability.text || ''));
    const thresholdAbility = ir.abilities.find((ability) => /^12\+ \|/i.test(ability.text || ''));

    expect(stationAbility?.steps.map((step) => step.kind)).toEqual(['add_counter']);
    expect(thresholdAbility?.steps.some((step) => step.kind === 'create_token')).toBe(true);
    expect(stationAbility?.steps.some((step) => step.kind === 'create_token')).toBe(false);
  });
});
