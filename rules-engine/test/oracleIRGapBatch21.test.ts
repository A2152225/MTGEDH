import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { executeCleanupStep } from '../src/actions/turnActions';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: any = {
    id: 'oracle-ir-gap-batch-21',
    format: 'commander',
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 20, hand: [], library: [], graveyard: [], exile: [], counters: {} },
      { id: 'p2', name: 'P2', seat: 1, life: 20, hand: [], library: [], graveyard: [], exile: [], counters: {} },
    ],
    turnOrder: ['p1', 'p2'],
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turn: 1,
    turnNumber: 1,
    phase: 'precombatMain',
    step: 'main',
    stack: [],
    battlefield: [],
    commandZone: {},
    startingLife: 20,
    allowUndos: false,
    turnTimerEnabled: false,
    turnTimerSeconds: 0,
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    spectators: [],
    status: 'inProgress',
  };

  return { ...base, ...overrides } as GameState;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Oracle IR gap batch 21 support', () => {
  it('parses and applies looking at target opponent hand', () => {
    const ir = parseOracleTextToIR("Look at target opponent's hand.", 'Hand Peek');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps[0]).toMatchObject({ kind: 'look_hand', who: { kind: 'target_opponent' } });

    const state = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 20, hand: [], library: [], graveyard: [], exile: [], counters: {} } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 20,
          hand: [{ id: 'h1', name: 'Hidden One' }, { id: 'h2', name: 'Hidden Two' }],
          library: [],
          graveyard: [],
          exile: [],
          counters: {},
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' },
    });

    expect(result.appliedSteps.map(step => step.kind)).toEqual(['look_hand']);
    expect(result.log.join('\n')).toContain("p1 looks at p2's hand (2 card(s))");
    expect((result.state.players.find(player => player.id === 'p2') as any).hand).toHaveLength(2);
  });

  it('parses six-sided die rolls and records multiple dice totals', () => {
    const single = parseOracleTextToIR('Roll a six-sided die.', 'Clowning Around');
    expect(collectUnknowns(single.abilities)).toEqual([]);
    expect(single.abilities[0]?.steps[0]).toMatchObject({ kind: 'roll_die', sides: 6, count: 1 });

    const multi = parseOracleTextToIR('Roll two six-sided dice.', 'Dice Pair');
    const steps = multi.abilities[0]?.steps ?? [];
    expect(collectUnknowns(multi.abilities)).toEqual([]);
    expect(steps[0]).toMatchObject({ kind: 'roll_die', sides: 6, count: 2 });

    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    const result = applyOracleIRStepsToGameState(makeState(), steps, { controllerId: 'p1' });

    expect((result.state as any).lastDieRoll).toMatchObject({ sides: 6, count: 2, results: [1, 6], result: 7 });
  });

  it('switches target creature power and toughness until end of turn', () => {
    const ir = parseOracleTextToIR("Switch target creature's power and toughness until end of turn.", 'About Face');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps[0]).toMatchObject({ kind: 'switch_power_toughness', target: { kind: 'raw', text: 'target creature' } });

    const state = makeState({
      battlefield: [
        {
          id: 'creature-1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'creature-card', name: 'Tall Wall', type_line: 'Creature - Wall', power: '2', toughness: '5' },
          basePower: 2,
          baseToughness: 5,
          counters: {},
          modifiers: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      targetCreatureId: 'creature-1',
    });
    const creature = (result.state.battlefield as any[]).find(perm => perm.id === 'creature-1');

    expect(result.appliedSteps.map(step => step.kind)).toEqual(['switch_power_toughness']);
    expect(creature.power).toBe(5);
    expect(creature.toughness).toBe(2);
    expect(creature.modifiers.some((modifier: any) => modifier.type === 'switchPowerToughness')).toBe(true);
  });

  it('turns target land face down', () => {
    const ir = parseOracleTextToIR('Turn target land face down.', 'Weirding Wood');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps[0]).toMatchObject({ kind: 'turn_face_down', target: { kind: 'raw', text: 'target land' } });

    const state = makeState({
      battlefield: [
        {
          id: 'land-1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'land-card', name: 'Forest', type_line: 'Basic Land - Forest' },
          counters: {},
          modifiers: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      targetPermanentId: 'land-1',
    });
    const land = (result.state.battlefield as any[]).find(perm => perm.id === 'land-1');

    expect(result.appliedSteps.map(step => step.kind)).toEqual(['turn_face_down']);
    expect(land.card.faceDown).toBe(true);
    expect(land.faceUpCard.name).toBe('Forest');
    expect(land.basePower).toBe(2);
    expect(land.baseToughness).toBe(2);
  });

  it('applies chosen basic land type changes and restores temporary changes at cleanup', () => {
    const ir = parseOracleTextToIR('Target land becomes the basic land type of your choice until end of turn.', 'Compass Trick');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps[0]).toMatchObject({ kind: 'set_basic_land_type', landType: 'choice', duration: 'end_of_turn' });

    const state = makeState({
      battlefield: [
        {
          id: 'land-1',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Land - Locus',
          subtypes: ['Locus'],
          card: { id: 'land-card', name: 'Cloudpost', type_line: 'Land - Locus', subtypes: ['Locus'] },
          counters: {},
          modifiers: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      targetPermanentId: 'land-1',
      selectorContext: { chosenBasicLandType: 'Island' },
    });
    const changedLand = (result.state.battlefield as any[]).find(perm => perm.id === 'land-1');

    expect(result.appliedSteps.map(step => step.kind)).toEqual(['set_basic_land_type']);
    expect(changedLand.type_line).toBe('Land - Island');
    expect(changedLand.card.type_line).toBe('Land - Island');
    expect(changedLand.modifiers.some((modifier: any) => modifier.type === 'setBasicLandType')).toBe(true);

    const cleanup = executeCleanupStep(result.state, 'p1');
    const restoredLand = (cleanup.state.battlefield as any[]).find(perm => perm.id === 'land-1');
    expect(restoredLand.type_line).toBe('Land - Locus');
    expect(restoredLand.card.type_line).toBe('Land - Locus');
  });
});
