import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { applyVariableTokenPowerToughness, readVariableTokenPt } from '../src/oracleIRExecutorTokenVariablePt';

function stepsFor(text: string, sourceName = 'Source') {
  return parseOracleTextToIR(text, sourceName).abilities.flatMap((ability: any) => ability.steps);
}

function emptyState(): any {
  return { players: [{ id: 'p1', name: 'P1', life: 40 }], battlefield: [], stack: [], zones: {}, turnPlayer: 'p1' };
}

describe('X/X token power/toughness', () => {
  it('reads variable P/T from the token hint only when X is involved', () => {
    expect(readVariableTokenPt('X/X blue Shark')).toEqual({ powerIsX: true, toughnessIsX: true });
    expect(readVariableTokenPt('X/1 red Elemental')).toEqual({ powerIsX: true, toughnessIsX: false, fixedToughness: 1 });
    expect(readVariableTokenPt('2/2 black Zombie')).toBeNull();
    expect(readVariableTokenPt('Treasure', 'create a Treasure token')).toBeNull();
    expect(readVariableTokenPt('Treasure', 'put a +1/+1 counter on it')).toBeNull();
  });

  it('returns null when X cannot be resolved, so no P/T-less creature is made', () => {
    expect(applyVariableTokenPowerToughness({ power: undefined }, 'X/X blue Shark', '', () => null)).toBeNull();
    expect(applyVariableTokenPowerToughness({}, 'X/X blue Shark', '', () => 3)).toEqual({ power: 3, toughness: 3 });
    expect(applyVariableTokenPowerToughness({ power: 1, toughness: 1 }, '1/1 white Spirit', '', () => 9)).toEqual({ power: 1, toughness: 1 });
  });

  it("creates a Shark token whose P/T equals that spell's mana value (Shark Typhoon)", () => {
    const steps = stepsFor("create an X/X blue Shark creature token with flying, where X is that spell's mana value.", 'Shark Typhoon');
    const result: any = applyOracleIRStepsToGameState(emptyState(), steps as any, {
      controllerId: 'p1', sourceId: 'shark', sourceName: 'Shark Typhoon', referenceSpellManaValue: 3,
    } as any);
    const sharks = result.state.battlefield.filter((perm: any) => perm.card?.name === 'Shark');
    expect(sharks).toHaveLength(1);
    expect(Number(sharks[0].card.power)).toBe(3);
    expect(Number(sharks[0].card.toughness)).toBe(3);
    expect(sharks[0].baseToughness).toBe(3);
  });

  it('uses the announced X when there is no "where X is" clause', () => {
    const steps = stepsFor('Create an X/X green Ooze creature token.', 'Ooze Maker');
    const result: any = applyOracleIRStepsToGameState(emptyState(), steps as any, {
      controllerId: 'p1', sourceId: 'ooze-maker', sourceName: 'Ooze Maker', xValue: 4,
    } as any);
    const oozes = result.state.battlefield.filter((perm: any) => /ooze/i.test(String(perm.card?.name || perm.card?.type_line || '')));
    expect(oozes).toHaveLength(1);
    expect(Number(oozes[0].card.power)).toBe(4);
    expect(Number(oozes[0].card.toughness)).toBe(4);
  });

  it('skips (instead of creating a P/T-less creature) when X is unknown', () => {
    const steps = stepsFor('Create an X/X green Ooze creature token.', 'Ooze Maker');
    const result: any = applyOracleIRStepsToGameState(emptyState(), steps as any, {
      controllerId: 'p1', sourceId: 'ooze-maker', sourceName: 'Ooze Maker',
    } as any);
    expect(result.state.battlefield).toHaveLength(0);
    expect(result.skippedSteps?.length).toBe(1);
  });
});