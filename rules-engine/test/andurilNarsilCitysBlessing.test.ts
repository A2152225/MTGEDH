import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const ANDURIL_ORACLE =
  "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nWhenever equipped creature attacks, put a +1/+1 counter on each creature you control. If you have the city's blessing, put two +1/+1 counters on each creature you control instead.\nEquip {3}";

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [
      {
        id: 'bear-1',
        name: 'Grizzly Bears',
        controller: 'p1',
        type_line: 'Creature — Bear',
        counters: {},
      },
      {
        id: 'bear-2',
        name: 'Runeclaw Bear',
        controller: 'p1',
        type_line: 'Creature — Bear',
        counters: {},
      },
    ],
    commandZone: {} as any,
    phase: 'combat' as any,
    active: true,
    ...overrides,
  } as any;
}

function attackTriggerSteps() {
  const ir = parseOracleTextToIR(ANDURIL_ORACLE, 'Andúril, Narsil Reforged');
  const ability = ir.abilities.find((entry) => /equipped creature attacks/i.test(entry.triggerCondition || entry.text || ''));
  return ability?.steps ?? [];
}

describe('Andúril, Narsil Reforged city\'s blessing', () => {
  it('folds the two-counter instead clause into the base +1/+1 ability', () => {
    const steps = attackTriggerSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { raw: "you have the city's blessing" },
    });
    expect((steps[0] as any).steps).toMatchObject([
      {
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'number', value: 2 },
        target: { kind: 'raw', text: 'each creature you control' },
      },
    ]);
    expect((steps[0] as any).elseSteps).toMatchObject([
      {
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
        target: { kind: 'raw', text: 'each creature you control' },
      },
    ]);
  });

  it('puts one +1/+1 counter on each creature without the city\'s blessing', () => {
    const result = applyOracleIRStepsToGameState(makeState(), attackTriggerSteps(), {
      controllerId: 'p1',
      sourceName: 'Andúril, Narsil Reforged',
    });
    const battlefield = (result.state as any).battlefield as any[];
    expect(battlefield.find((perm) => perm.id === 'bear-1')?.counters?.['+1/+1']).toBe(1);
    expect(battlefield.find((perm) => perm.id === 'bear-2')?.counters?.['+1/+1']).toBe(1);
    expect(result.appliedSteps.filter((step) => step.kind === 'add_counter')).toHaveLength(1);
  });

  it('puts two +1/+1 counters on each creature when cityBlessing is set', () => {
    const result = applyOracleIRStepsToGameState(
      makeState({ cityBlessing: { p1: true } } as any),
      attackTriggerSteps(),
      {
        controllerId: 'p1',
        sourceName: 'Andúril, Narsil Reforged',
      },
    );
    const battlefield = (result.state as any).battlefield as any[];
    expect(battlefield.find((perm) => perm.id === 'bear-1')?.counters?.['+1/+1']).toBe(2);
    expect(battlefield.find((perm) => perm.id === 'bear-2')?.counters?.['+1/+1']).toBe(2);
    expect(result.appliedSteps.filter((step) => step.kind === 'add_counter')).toHaveLength(1);
  });
});
