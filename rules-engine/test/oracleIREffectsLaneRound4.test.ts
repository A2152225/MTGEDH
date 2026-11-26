import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { applyStaticAbilitiesToBattlefield } from '../src/staticAbilities';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function walker(id: string, controller: PlayerID, loyalty: number) {
  return {
    id, controller, owner: controller, tapped: false, counters: { loyalty }, loyalty,
    card: { id: `${id}_card`, name: `Walker ${id}`, type_line: 'Legendary Planeswalker - Test', oracle_text: '' },
  };
}

function baseState(battlefield: any[]): GameState {
  const player = (id: PlayerID) => ({ id, name: id, seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] });
  return { players: [player(p1), player(p2)], battlefield, stack: [], turnOrder: [p1, p2], turnPlayer: p1, priority: p1 } as any;
}

describe('oracle IR effects lane round 4', () => {
  it('removes a fixed number of counters from each planeswalker (Pestilent Haze mode 2)', () => {
    const steps = parseOracleTextToIR('Remove two loyalty counters from each planeswalker.', 'Pestilent Haze').abilities[0]?.steps ?? [];
    const state = baseState([walker('w1', p1, 5), walker('w2', p2, 1)]);
    const result = applyOracleIRStepsToGameState(state, steps, { controllerId: p1 } as any);
    expect(result.skippedSteps).toEqual([]);
    const counters = (id: string) => Number(((result.state as any).battlefield.find((p: any) => p.id === id)?.counters || {}).loyalty || 0);
    expect(counters('w1')).toBe(3);
    expect(counters('w2')).toBe(0);
  });

  it('does not return a stale static-ability result after a permanent changes characteristics', () => {
    const land = {
      id: 'land-1', controller: p1, owner: p1, counters: { '+1/+1': 3 },
      type_line: 'Basic Land - Island', card: { name: 'Island', type_line: 'Basic Land - Island' },
    };
    const before = applyStaticAbilitiesToBattlefield([land] as any)[0] as any;
    expect(String(before.type_line)).not.toMatch(/creature/i);
    const animatedTypeLine = 'Basic Land Creature - Island Elemental';
    const animated = {
      ...land, type_line: animatedTypeLine, basePower: 0, baseToughness: 0, power: 0, toughness: 0,
      card: { ...land.card, type_line: animatedTypeLine },
    };
    const after = applyStaticAbilitiesToBattlefield([animated] as any)[0] as any;
    expect(after.type_line).toBe('Basic Land Creature - Island Elemental');
    expect(after.basePower).toBe(0);
    expect(after.effectivePower).toBe(3);
    // Mutating a returned permanent must not leak into the next cached read.
    after.type_line = 'mutated';
    expect((applyStaticAbilitiesToBattlefield([animated] as any)[0] as any).type_line).toBe('Basic Land Creature - Island Elemental');
  });
});
