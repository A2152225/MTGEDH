import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../src/oracleIRExecutor';
import { resolveDeterministicArmyCreatureSelection } from '../src/oracleIRExecutorBattlefieldArmySelection';

function creature(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    name: id,
    type_line: 'Creature — Bear',
    power: 2,
    toughness: 2,
    card: { name: id, type_line: 'Creature — Bear' },
    ...over,
  };
}

function state(battlefield: any[]) {
  return {
    id: 'army-fallthrough',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield,
    commandZone: {},
    phase: 'main',
    active: true,
  } as any;
}

describe('named-control army fallthrough for mass each-selectors', () => {
  it('does not treat each other / each land creature as a named singleton', () => {
    const bf = [
      creature('src'),
      creature('ally'),
      creature('landy', { type_line: 'Land Creature — Elemental', card: { type_line: 'Land Creature — Elemental' } }),
    ];
    const ctx = { controllerId: 'p1', sourceId: 'src' } as any;
    expect(resolveDeterministicArmyCreatureSelection(bf, { kind: 'raw', text: 'each other creature you control' }, ctx)).toBeNull();
    expect(resolveDeterministicArmyCreatureSelection(bf, { kind: 'raw', text: 'each land creature you control' }, ctx)).toBeNull();
  });

  it('still auto-picks a unique Army creature you control', () => {
    const bf = [
      creature('army', {
        name: 'Zombie Army',
        type_line: 'Creature — Zombie Army',
        card: { name: 'Zombie Army', type_line: 'Creature — Zombie Army' },
      }),
      creature('bear'),
    ];
    const matches = resolveDeterministicArmyCreatureSelection(
      bf,
      { kind: 'raw', text: 'Army creature you control' },
      { controllerId: 'p1' } as any,
    );
    expect(matches?.map((p: any) => p.id)).toEqual(['army']);
  });

  it('adds counters to each other creature you control', () => {
    const game = state([
      creature('src'),
      creature('ally1'),
      creature('ally2'),
      creature('opp', { controller: 'p2', owner: 'p2' }),
    ]);
    const parsed = parseOracleTextToIR('put a +1/+1 counter on each other creature you control.', 'Probe');
    const steps = (parsed.abilities || []).flatMap((a) => a.steps || []);
    expect(steps.map((s) => s.kind)).toContain('add_counter');
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'src',
        sourceName: 'Probe',
      }),
    );
    expect(result.appliedSteps.some((s) => s.kind === 'add_counter')).toBe(true);
    expect(result.skippedSteps.filter((s) => s.kind === 'add_counter')).toHaveLength(0);
    const bf = result.state.battlefield as any[];
    expect(Number(bf.find((p) => p.id === 'ally1')?.counters?.['+1/+1'] || 0)).toBe(1);
    expect(Number(bf.find((p) => p.id === 'ally2')?.counters?.['+1/+1'] || 0)).toBe(1);
    expect(Number(bf.find((p) => p.id === 'src')?.counters?.['+1/+1'] || 0)).toBe(0);
    expect(Number(bf.find((p) => p.id === 'opp')?.counters?.['+1/+1'] || 0)).toBe(0);
  });

  it('adds counters to each land creature you control', () => {
    const game = state([
      creature('src'),
      creature('land1', { type_line: 'Land Creature — Elemental', card: { type_line: 'Land Creature — Elemental' } }),
      creature('land2', { type_line: 'Land Creature — Elemental', card: { type_line: 'Land Creature — Elemental' } }),
      creature('bear'),
    ]);
    const parsed = parseOracleTextToIR('put two +1/+1 counters on each land creature you control.', 'Bumi');
    const steps = (parsed.abilities || []).flatMap((a) => a.steps || []);
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Bumi' }),
    );
    expect(result.appliedSteps.some((s) => s.kind === 'add_counter')).toBe(true);
    const bf = result.state.battlefield as any[];
    expect(Number(bf.find((p) => p.id === 'land1')?.counters?.['+1/+1'] || 0)).toBe(2);
    expect(Number(bf.find((p) => p.id === 'land2')?.counters?.['+1/+1'] || 0)).toBe(2);
    expect(Number(bf.find((p) => p.id === 'bear')?.counters?.['+1/+1'] || 0)).toBe(0);
  });
});
