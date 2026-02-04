import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

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
        library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
        hand: [],
        graveyard: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    phase: 'pre_game' as any,
    active: true,
    ...overrides,
  } as any;
}

describe('Oracle IR Executor', () => {
  it('applies draw steps for "you"', () => {
    const ir = parseOracleTextToIR('Draw two cards.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.hand).toHaveLength(2);
    expect(p1.library).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'draw')).toBe(true);
  });

  it('applies life gain and life loss', () => {
    const ir = parseOracleTextToIR('You gain 3 life. You lose 2 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.life).toBe(41);
    expect(result.appliedSteps.filter(s => s.kind === 'gain_life')).toHaveLength(1);
    expect(result.appliedSteps.filter(s => s.kind === 'lose_life')).toHaveLength(1);
  });

  it('creates a Treasure token', () => {
    const ir = parseOracleTextToIR('Create a Treasure token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.controller).toBe('p1');
    expect((token.card?.name || '').toLowerCase()).toContain('treasure');
  });

  it('creates other common artifact tokens (Gold, Powerstone)', () => {
    const ir = parseOracleTextToIR('Create a Gold token. Create a Powerstone token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    const names = result.state.battlefield.map((p: any) => String(p?.card?.name || '').toLowerCase());
    expect(names.some(n => n.includes('gold'))).toBe(true);
    expect(names.some(n => n.includes('powerstone'))).toBe(true);
  });

  it('creates a tapped token when oracle says tapped', () => {
    const ir = parseOracleTextToIR('Create a tapped Treasure token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.tapped).toBe(true);
  });

  it('creates a tapped token when oracle says "token tapped"', () => {
    const ir = parseOracleTextToIR('Create a Treasure token tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.tapped).toBe(true);
  });

  it('creates a token with counters when oracle specifies counters', () => {
    const ir = parseOracleTextToIR(
      'Create a 1/1 white Soldier creature token with two +1/+1 counters on it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.counters?.['+1/+1']).toBe(2);
  });

  it('skips optional steps by default', () => {
    const ir = parseOracleTextToIR('You may draw a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.hand).toHaveLength(0);
    expect(result.skippedSteps.length).toBeGreaterThan(0);

    const forced = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' }, { allowOptional: true });
    const p1b = forced.state.players.find(p => p.id === 'p1') as any;
    expect(p1b.hand).toHaveLength(1);
  });
});
