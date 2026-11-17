import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../src/oracleIRExecutor';
import { resolveCreatureTargetIds } from '../src/oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureTargetIds';
import { resolveDirectBattlefieldPermanents } from '../src/oracleIRExecutorBattlefieldPermanentSelectors';

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
    id: 'mass-pt',
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
    phase: 'combat',
    active: true,
  } as any;
}

describe('mass modify_pt / add_counter gap closures', () => {
  it('resolves bare attacking creatures', () => {
    const bf = [
      creature('atk', { attacking: true }),
      creature('idle'),
    ];
    const ids = resolveCreatureTargetIds(state(bf), { kind: 'raw', text: 'attacking creatures' } as any, {
      controllerId: 'p1',
      sourceId: 'atk',
    } as any);
    expect(ids).toEqual(['atk']);
  });

  it('resolves attacking and blocking creatures with flying', () => {
    const bf = [
      creature('flyer', { attacking: true, keywords: ['flying'] }),
      creature('ground', { attacking: true }),
      creature('blocker', { blocking: true, keywords: ['flying'] }),
    ];
    const game = state(bf);
    expect(
      resolveCreatureTargetIds(game, { kind: 'raw', text: 'attacking creatures with flying' } as any, {
        controllerId: 'p1',
      } as any),
    ).toEqual(['flyer']);
    expect(
      resolveCreatureTargetIds(game, { kind: 'raw', text: 'blocking creatures with flying' } as any, {
        controllerId: 'p1',
      } as any),
    ).toEqual(['blocker']);
  });

  it('resolves all non-Zombie creatures', () => {
    const bf = [
      creature('zombie', { type_line: 'Creature — Zombie', card: { type_line: 'Creature — Zombie' } }),
      creature('bear'),
    ];
    expect(
      resolveCreatureTargetIds(state(bf), { kind: 'raw', text: 'all non-zombie creatures' } as any, {
        controllerId: 'p1',
      } as any),
    ).toEqual(['bear']);
  });

  it('adds counters to creatures with flash or haste', () => {
    const game = state([
      creature('src'),
      creature('flashy', { keywords: ['flash'] }),
      creature('hasty', { keywords: ['haste'] }),
      creature('slow'),
    ]);
    const steps = (parseOracleTextToIR(
      'put a +1/+1 counter on each creature you control with flash or haste.',
      'Sonic',
    ).abilities || []).flatMap((a) => a.steps || []);
    const matches = resolveDirectBattlefieldPermanents(
      game.battlefield,
      (steps[0] as any).target,
      { controllerId: 'p1', sourceId: 'src' } as any,
    );
    expect(matches.map((p: any) => p.id).sort()).toEqual(['flashy', 'hasty']);
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Sonic' }),
    );
    expect(result.appliedSteps.some((s) => s.kind === 'add_counter')).toBe(true);
  });

  it('adds counters by domain toughness compare', () => {
    const game = state([
      creature('src', { toughness: 5 }),
      creature('small', { toughness: 1 }),
      creature('big', { toughness: 5 }),
      {
        id: 'plains',
        controller: 'p1',
        type_line: 'Basic Land — Plains',
        card: { type_line: 'Basic Land — Plains' },
      },
      {
        id: 'island',
        controller: 'p1',
        type_line: 'Basic Land — Island',
        card: { type_line: 'Basic Land — Island' },
      },
      {
        id: 'swamp',
        controller: 'p1',
        type_line: 'Basic Land — Swamp',
        card: { type_line: 'Basic Land — Swamp' },
      },
    ]);
    const steps = (parseOracleTextToIR(
      'put a +1/+1 counter on each creature you control with toughness less than the number of basic land types among lands you control.',
      'Zar',
    ).abilities || []).flatMap((a) => a.steps || []);
    const matches = resolveDirectBattlefieldPermanents(
      game.battlefield,
      (steps[0] as any).target,
      { controllerId: 'p1', sourceId: 'src' } as any,
    );
    expect(matches.map((p: any) => p.id)).toEqual(['small']);
  });
});
