import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

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

  it('records impulse permissions on exiled cards (until end of your next turn)', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until the end of your next turn, you may play that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({ turnNumber: 10 } as any);
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test Source' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(Array.isArray(p1.exile)).toBe(true);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0].canBePlayedBy).toBe('p1');
    expect(p1.exile[0].playableUntilTurn).toBe(11);

    const pfe = (result.state as any).playableFromExile?.p1;
    expect(pfe).toBeTruthy();
    expect(pfe[String(p1.exile[0].id)]).toBe(11);
  });

  it('does not grant cast-from-exile permission to lands', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until end of turn, you may cast that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 3,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest' }],
          hand: [],
          graveyard: [],
        } as any,
      ],
    } as any);

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0].id).toBe('land1');
    expect(p1.exile[0].canBePlayedBy).toBeUndefined();
    expect((result.state as any).playableFromExile?.p1?.land1).toBeUndefined();
  });

  it('applies draw for "each of your opponents" (normalized to each_opponent)', () => {
    const ir = parseOracleTextToIR('Each of your opponents draws a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.hand).toHaveLength(1);
    expect(p2.library).toHaveLength(1);
    expect(p3.hand).toHaveLength(1);
    expect(p3.library).toHaveLength(0);
    expect(result.appliedSteps.some(s => s.kind === 'draw')).toBe(true);
  });

  it('applies mill for "your opponents" (normalized to each_opponent)', () => {
    const ir = parseOracleTextToIR('Your opponents mill a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.graveyard).toHaveLength(1);
    expect(p3.library).toHaveLength(1);
    expect(p3.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'mill')).toBe(true);
  });

  it("applies exile_top for each of your opponents' libraries", () => {
    const ir = parseOracleTextToIR("Exile the top card of each of your opponents' libraries.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies exile_top for those opponents' libraries via relational selector context binding", () => {
    const ir = parseOracleTextToIR("Exile the top card of those opponents' libraries.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies exile_top for all of those opponents' libraries via relational selector context binding", () => {
    const ir = parseOracleTextToIR("Exile the top card of all of those opponents' libraries.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it('applies exile_top for each opponent’s library (curly apostrophe)', () => {
    const ir = parseOracleTextToIR('Exile the top card of each opponent’s library.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies exile_top for each opponent's library (straight apostrophe)", () => {
    const ir = parseOracleTextToIR("Exile the top card of each opponent's library.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies exile_top for 'put the top card of each opponent's library into exile'", () => {
    const ir = parseOracleTextToIR("Put the top card of each opponent's library into exile.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it('applies impulse_exile_top by exiling the top card(s) of your library', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. You may play that card this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top for combined look+exile template in 1v1 (no face down)', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library and exile those cards. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top for look-then-exile face-down template (your library)', () => {
    const ir = parseOracleTextToIR(
      'Look at the top card of your library, then exile it face down. You may play it for as long as it remains exiled.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it("applies impulse_exile_top for look-then-exile face-down template (those opponents' alias via relational context)", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of those opponents' libraries, then exile those cards face down. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it("applies split-clause look-then-exile face-down impulse for those opponents' alias via relational context", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of those opponents' libraries. Then exile those cards face down. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies split-clause look-top-two then exile-those-cards face-down impulse in 1v1', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library. Then exile those cards face down. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies split-clause look-top-two then exile-those-cards impulse in 1v1 (no face down)', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library. Then exile those cards. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect(p2.exile || []).toHaveLength(2);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
  });

  it('applies impulse_exile_top for target_opponent remains-exiled cast + mana-rider template', () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of target opponent's library, then exile it face down. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applies standalone split-clause look-top-two then exile-those-cards face-down exile_top in 1v1', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library. Then exile those cards face down.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'exile_top')).toBe(false);
  });

  it("applies standalone look+exile exile_top for those opponents' alias via relational context (no face down)", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of those opponents' libraries and exile those cards.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'exile_top')).toBe(false);
  });

  it('applies standalone split-clause look-top-two then exile-those-cards exile_top in 1v1 (no face down)', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library. Then exile those cards.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'exile_top')).toBe(false);
  });

  it("applies standalone look+exile face-down exile_top for those opponents' alias via relational context", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of those opponents' libraries and exile those cards face down.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with leading until-the-end-of-turn permission', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. Until the end of turn, you may play that card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with a during-your-next-turn permission', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. During your next turn, you may play that card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with an until-your-next-upkeep permission', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until the beginning of your next upkeep, you may play that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with an immediate you-may-cast permission (no explicit duration)', () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of your library. You may cast that card. If you don't, it deals 2 damage to each opponent.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with an immediate without-paying-mana-cost permission that has a trailing if restriction', () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of your library. You may cast it without paying its mana cost if it's a spell with mana value 2 or less. If you don't, put it into your graveyard.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when until-next-turn permission has a trailing if restriction', () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of your library. Until your next turn, you may cast it if it's an instant or sorcery spell.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when remains-exiled permission has a trailing if restriction', () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of your library. For as long as it remains exiled, you may cast it if it's a creature spell.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top for combined look+exile face-down template (each opponent)', () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of each opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it("applies impulse_exile_top for combined look+exile face-down template (those opponents' alias via relational context)", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of those opponents' libraries and exile those cards face down. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission is gated by an unmodeled leading if condition', () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of your library. If it's a Goblin creature card, you may cast that card until the end of your next turn.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when among-clause restricts to an artifact spell (this turn)', () => {
    const ir = parseOracleTextToIR('Exile the top five cards of your library. You may cast an artifact spell from among them this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }, { id: 'c6' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(5);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when among-clause restricts to instant or sorcery (until end of next turn)', () => {
    const ir = parseOracleTextToIR(
      'Exile the top five cards of your library. Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }, { id: 'c6' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(5);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast spells from among those cards', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until the end of turn, you may cast spells from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast spells from among those cards exiled this way', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until end of turn, you may cast spells from among those cards exiled this way.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says play lands and cast spells from among those cards', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until end of turn, you may play lands and cast spells from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says play lands and cast spells from among those cards until end of your next turn', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until the end of your next turn, you may play lands and cast spells from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says play one of those cards this turn', () => {
    const ir = parseOracleTextToIR('Exile the top two cards of your library. You may play one of those cards this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast one of those cards this turn', () => {
    const ir = parseOracleTextToIR('Exile the top two cards of your library. You may cast one of those cards this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast a spell from among those cards', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until end of turn, you may cast a spell from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast a spell from among those cards until end of your next turn', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until the end of your next turn, you may cast a spell from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast spells from among the exiled cards', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until end of turn, you may cast spells from among the exiled cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when among-clause says until the end of this turn', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until the end of this turn, you may cast spells from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when among-clause says play lands and cast spells until the end of this turn', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until the end of this turn, you may play lands and cast spells from among those cards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when among-clause says cast spells through end of turn', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. You may cast spells from among those cards through end of turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission references the exiled card', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. You may play the exiled card this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission references the card exiled this way', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You may play the card exiled this way until the end of your next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission is granted to "its owner" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" for "its owner" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can cast it this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c66' }, { id: 'p2c67' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c67']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c66']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission is granted to "its owner" for plural exile (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top two cards of their library. Its owner may cast them this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission references spells they exiled this way (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top two cards of their library. Its owner may cast spells they exiled this way this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', types: ['instant'] },
            { id: 'p2c2', types: ['sorcery'] },
            { id: 'p2c3', types: ['land'] },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission references the spell they exiled this way (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast the spell they exiled this way this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1', types: ['instant'] }, { id: 'p2c2', types: ['land'] }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the end of this turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it until the end of this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through end of this turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it through end of this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "during their next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the end of their next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the end of their next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can cast it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c72' }, { id: 'p2c73' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c73']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c72']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the beginning of their next upkeep" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until your next end step" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until your next end step" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can cast it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c74' }, { id: 'p2c75' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c75']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c74']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through their next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through their next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can cast it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c76' }, { id: 'p2c77' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c77']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c76']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next upkeep" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next end step" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next end step" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can cast it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c78' }, { id: 'p2c79' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c79']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c78']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until end of combat on their next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may cast it until end of combat on their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses leading "until your next turn" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its owner may cast it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses leading "until your next turn" with owner can-cast permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its owner can cast it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c68' }, { id: 'p2c69' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c69']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c68']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next turn" grants owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its owner may play it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land1', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land1']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land1).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next turn" grants owner can-play permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its owner can play it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land69', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land69']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land69).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "during their next turn" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land14', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land14']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land14).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "during their next turn" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land74', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land74']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land74).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the end of their next turn" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land15', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land15']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land15).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the end of their next turn" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land84', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land84']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land84).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next upkeep" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land16', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land16']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land16).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next upkeep" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land75', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land75']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land75).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next end step" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land17', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land17']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land17).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next end step" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land85', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land85']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land85).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through their next turn" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land33', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land33']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land33).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through their next turn" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land86', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land86']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land86).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the beginning of their next upkeep" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land34', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land34']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land34).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the beginning of their next upkeep" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land76', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land76']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land76).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until your next end step" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner may play it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land35', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land35']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land35).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until your next end step" with owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its owner can play it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land87', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land87']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land87).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next end step" grants owner play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next end step, its owner may play it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land36', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land36']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land36).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next turn" grants controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its controller may play it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land2', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land2']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land2).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next turn" grants controller can-play permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its controller can play it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land70', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land70']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land70).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next turn" grants controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its controller may cast it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell1']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell1).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next end step" grants controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next end step, its controller may cast it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell2', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell2']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell2).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next end step" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land3', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land3']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land3).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "during their next turn" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land18', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land18']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land18).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "during their next turn" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land77', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land77']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land77).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land68', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land68']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land68).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next end step" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land88', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land88']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land88).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next end step" grants controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next end step, its controller may play it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land37', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land37']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land37).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the end of their next turn" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land19', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land19']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land19).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the end of their next turn" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land89', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land89']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land89).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next upkeep" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land20', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land20']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land20).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next upkeep" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land78', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land78']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land78).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through their next turn" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land21', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land21']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land21).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through their next turn" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land90', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land90']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land90).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the beginning of their next upkeep" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land22', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land22']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land22).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the beginning of their next upkeep" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can play it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land79', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land79']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land79).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until your next end step" with controller play-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may play it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2land23', name: 'Forest', type_line: 'Basic Land — Forest' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2land23']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2land23).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next upkeep" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell3', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell3']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell3).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next upkeep" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it through your next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell71', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell71']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell71).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "this turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell9', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell9']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(9);
    expect((result.state as any).playableFromExile?.p2?.p2spell9).toBe(9);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the end of this turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it until the end of this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell10', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell10']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(9);
    expect((result.state as any).playableFromExile?.p2?.p2spell10).toBe(9);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through end of this turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it through end of this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell11', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell11']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(9);
    expect((result.state as any).playableFromExile?.p2?.p2spell11).toBe(9);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until your next end step" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell12', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell12']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell12).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until your next end step" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell80', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell80']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell80).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through your next end step" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell13', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell13']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell13).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through your next end step" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell81', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell81']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell81).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "during their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell4', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell4']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell4).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "during their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it during their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell72', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell72']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell72).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "through their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell5', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell5']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell5).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "through their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it through their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell82', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell82']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell82).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the end of their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell6', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell6']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell6).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the end of their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it until the end of their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell83', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell83']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell83).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until the beginning of their next upkeep" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell7', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell7']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell7).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "can" + "until the beginning of their next upkeep" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller can cast it until the beginning of their next upkeep.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell73', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell73']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell73).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses "until end of combat on their next turn" with controller cast-permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Its controller may cast it until end of combat on their next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2spell8', name: 'Grizzly Bears', type_line: 'Creature — Bear' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2spell8']);
    expect(p2.exile[0].canBePlayedBy).toBe('p2');
    expect(p2.exile[0].playableUntilTurn).toBe(10);
    expect((result.state as any).playableFromExile?.p2?.p2spell8).toBe(10);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when permission uses leading "until your next end step" (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next end step, its owner may cast it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when leading "until your next turn" grants controller can-cast permission (target player)', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles the top card of their library. Until your next turn, its controller can cast it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      turnNumber: 9,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c70' }, { id: 'p2c71' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c71']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c70']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with a without-paying-mana-cost suffix', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. You may cast it this turn without paying its mana cost.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('treats scry as a deterministic no-op when library is empty', () => {
    const ir = parseOracleTextToIR('Scry 1.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.appliedSteps.some(s => s.kind === 'scry')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'scry')).toBe(false);
  });

  it('treats surveil as a deterministic no-op when library is empty', () => {
    const ir = parseOracleTextToIR('Surveil 1.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.appliedSteps.some(s => s.kind === 'surveil')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'surveil')).toBe(false);
  });

  it('treats defending-player scry as deterministic no-op when target-opponent library is empty', () => {
    const ir = parseOracleTextToIR('Defending player scries 1.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    expect(result.appliedSteps.some(s => s.kind === 'scry')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'scry')).toBe(false);
  });

  it('treats the-defending-player surveil as deterministic no-op when target-opponent library is empty', () => {
    const ir = parseOracleTextToIR('The defending player surveils 1.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    expect(result.appliedSteps.some(s => s.kind === 'surveil')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'surveil')).toBe(false);
  });

  it('treats each-opponent scry as a deterministic no-op when all libraries are empty', () => {
    const ir = parseOracleTextToIR('Each opponent scries 1.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.appliedSteps.some(s => s.kind === 'scry')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'scry')).toBe(false);
  });

  it('applies impulse_exile_top when permission says cast that spell', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. You may cast that spell this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with remains-exiled permission window', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You may play that card for as long as it remains exiled.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with leading remains-exiled permission (and trailing if restriction)', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. For as long as that card remains exiled, you may play it if you control a Kavu.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with next-end-step permission window', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until your next end step, you may play that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with trailing next-end-step can-play permission window', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You can play it until your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with trailing through-next-end-step can-play permission window', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You can play it through your next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with next-turn permission window', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until your next turn, you may play that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when a look clause intervenes', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You may look at that card for as long as it remains exiled. You may play that card this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with first-person can-cast this-turn wording', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library. You can cast it this turn.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with first-person may-cast until-end-of-your-next-turn wording', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until the end of your next turn, you may cast that card.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with first-person next-turn cast + mana-rider wording', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. Until the end of your next turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with first-person leading next-turn play-them wording', () => {
    const ir = parseOracleTextToIR(
      'Exile the top two cards of your library. Until the end of your next turn, you may play them.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(2);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(p1.exile[1]?.id).toBe('c2');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with first-person can-play until-end-of-your-next-turn wording', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You can play that card until end of your next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top with first-person can-play until-end-of-the-next-turn wording', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You can play that card until end of the next turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when multiple reminder clauses intervene', () => {
    const ir = parseOracleTextToIR(
      'Exile the top card of your library. You may look at that card any time. You may spend mana as though it were mana of any color to cast it. You may play that card this turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it("applies impulse_exile_top for each player by exiling from each player's library", () => {
    const ir = parseOracleTextToIR("Exile the top card of each player's library. You may play those cards this turn.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library).toHaveLength(1);
    expect(p2.library).toHaveLength(0);
    expect(p1.exile).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);

    expect(p1.exile[0]?.id).toBe('p1c1');
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
  });

  it("applies impulse_exile_top for each player with next-turn mana-spend reminder suffix", () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of each player's library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast those spells.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library).toHaveLength(1);
    expect(p2.library).toHaveLength(0);
    expect(p1.exile).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('p1c1');
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top for target-opponent choose-one next-turn mana rider template', () => {
    const ir = parseOracleTextToIR(
      "Exile the top three cards of target opponent's library. Choose one of them. Until the end of your next turn, you may play that card, and you may spend mana as though it were mana of any color to cast it.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library).toHaveLength(2);
    expect(p2.library).toHaveLength(0);
    expect(p1.exile).toHaveLength(0);
    expect(p2.exile).toHaveLength(3);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies exile_top by exiling the top card of your library', () => {
    const ir = parseOracleTextToIR('Exile the top card of your library.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies exile_top for each player by exiling from each player's library", () => {
    const ir = parseOracleTextToIR("Exile the top two cards of each player's library.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }, { id: 'p1c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.library).toHaveLength(1);
    expect(p2.library).toHaveLength(0);
    expect(p1.exile).toHaveLength(2);
    expect(p2.exile).toHaveLength(1);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies exile_top when defending player exiles the top card of their library (1v1)", () => {
    const ir = parseOracleTextToIR('Defending player exiles the top card of their library.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applies exile_top parsed from triggered ability effect', () => {
    const ir = parseOracleTextToIR("Whenever Etali attacks, exile the top card of each player's library.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1c1']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1']);
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it('applies exile_top parsed from replacement effect (instead pattern)', () => {
    const ir = parseOracleTextToIR('If you would draw a card, exile the top two cards of your library instead.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library.map((c: any) => c.id)).toEqual(['c3']);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(result.appliedSteps.some(s => s.kind === 'exile_top')).toBe(true);
  });

  it("applies impulse_exile_top for each opponent by exiling from opponents' libraries", () => {
    const ir = parseOracleTextToIR("Exile the top card of each opponent's library. You may play those cards this turn.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(0);
    expect(p2.library).toHaveLength(1);
    expect(p3.library).toHaveLength(0);
    expect(p2.exile).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
  });

  it('skips impulse_exile_top when amount is unknown', () => {
    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(
      start,
      [
        {
          kind: 'impulse_exile_top',
          who: { kind: 'you' },
          amount: { kind: 'x' },
          duration: 'this_turn',
          permission: 'play',
          raw: 'Exile the top X cards of your library. You may play those cards this turn.',
        } as any,
      ],
      { controllerId: 'p1' }
    );

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(2);
    expect(p1.exile).toHaveLength(0);
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
  });

  it("skips impulse_exile_top for corpus Dead Man's Chest wording when amount is unknown", () => {
    const ir = parseOracleTextToIR(
      "When enchanted creature dies, exile cards equal to its power from the top of its owner's library. You may cast spells from among those cards for as long as they remain exiled, and mana of any type can be spent to cast them.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(p1.exile || []).toHaveLength(0);
    expect(p2.exile || []).toHaveLength(0);
  });

  it('applies impulse_exile_top loop for corpus Transforming Flourish wording (until nonland)', () => {
    const ir = parseOracleTextToIR(
      "Destroy target artifact or creature you don't control. If that permanent is destroyed this way, its controller exiles cards from the top of their library until they exile a nonland card, then they may cast that card without paying its mana cost.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', name: 'Island', type_line: 'Basic Land — Island' },
            { id: 'p2c2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual([]);
    expect(p1.exile || []).toHaveLength(0);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
  });

  it('applies impulse_exile_top loop for corpus Bismuth Mindrender wording (target player until nonland)', () => {
    const ir = parseOracleTextToIR(
      "Whenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card. You may cast that card by paying life equal to the spell's mana value rather than paying its mana cost.",
      'Test'
    );
    const ability = ir.abilities.find(a => a.type === 'triggered');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Basic Land — Swamp' },
            { id: 'p2c2', type_line: 'Land' },
            { id: 'p2c3', type_line: 'Creature — Horror' },
            { id: 'p2c4', type_line: 'Instant' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4']);
    expect(p1.exile || []).toHaveLength(0);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
  });

  it('skips impulse_exile_top for corpus Possibility Storm wording when reference spell type context is missing', () => {
    const ir = parseOracleTextToIR(
      'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(p1.exile || []).toHaveLength(0);
    expect(p2.exile || []).toHaveLength(0);
  });

  it('applies impulse_exile_top loop for corpus Possibility Storm wording when reference spell type context is provided', () => {
    const ir = parseOracleTextToIR(
      'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Basic Land — Forest' },
            { id: 'p2c2', type_line: 'Creature — Elf' },
            { id: 'p2c3', type_line: 'Instant' },
            { id: 'p2c4', type_line: 'Sorcery' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
      referenceSpellTypes: ['instant'],
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4', 'p2c1', 'p2c2', 'p2c3']);
    expect(p1.exile || []).toHaveLength(0);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual([]);
  });

  it('applies Possibility Storm cleanup when no shared card type is found (returns all revealed cards)', () => {
    const ir = parseOracleTextToIR(
      'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Creature — Elf' },
            { id: 'p2c2', type_line: 'Land' },
            { id: 'p2c3', type_line: 'Creature — Human' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
      referenceSpellTypes: ['instant'],
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual([]);
  });

  it('applies impulse_exile_top loop for corpus Chaos Wand wording (until instant or sorcery)', () => {
    const ir = parseOracleTextToIR(
      "{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.",
      'Test'
    );
    const ability = ir.abilities.find(a => a.type === 'activated');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', name: 'Forest', type_line: 'Basic Land — Forest' },
            { id: 'p2c2', name: 'Runeclaw Bear', type_line: 'Creature — Bear' },
            { id: 'p2c3', name: 'Shock', type_line: 'Instant' },
            { id: 'p2c4', name: 'Opt', type_line: 'Instant' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4', 'p2c1', 'p2c2', 'p2c3']);
    expect(p1.exile || []).toHaveLength(0);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual([]);
  });

  it('applies Chaos Wand bottom-of-library rider when no instant or sorcery is found', () => {
    const ir = parseOracleTextToIR(
      "{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.",
      'Test'
    );
    const ability = ir.abilities.find(a => a.type === 'activated');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Basic Land — Plains' },
            { id: 'p2c2', type_line: 'Creature — Knight' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual([]);
  });

  it('applies impulse_exile_top loop for corpus Dream Harvest wording (total mana value threshold)', () => {
    const ir = parseOracleTextToIR(
      'Each opponent exiles cards from the top of their library until they have exiled cards with total mana value 5 or greater this way. Until end of turn, you may cast cards exiled this way without paying their mana costs.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', mana_value: 2 },
            { id: 'p2c2', mana_value: 2 },
            { id: 'p2c3', mana_value: 1 },
            { id: 'p2c4', mana_value: 6 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [
            { id: 'p3c1', mana_value: 3 },
            { id: 'p3c2', mana_value: 3 },
            { id: 'p3c3', mana_value: 1 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c3']);
    expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
  });

  it('applies impulse_exile_top loop for corpus Wand of Wonder wording (each opponent until instant or sorcery)', () => {
    const ir = parseOracleTextToIR(
      '{4}, {T}: Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.',
      'Test'
    );
    const ability = ir.abilities.find(a => a.type === 'activated');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Basic Land — Forest' },
            { id: 'p2c2', type_line: 'Creature — Bear' },
            { id: 'p2c3', type_line: 'Instant' },
            { id: 'p2c4', type_line: 'Sorcery' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [
            { id: 'p3c1', type_line: 'Sorcery' },
            { id: 'p3c2', type_line: 'Creature — Elf' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4', 'p2c1', 'p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c3']);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c2']);
    expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1']);
  });

  it('applies Wand of Wonder cleanup when an opponent has no instant or sorcery (returns all revealed cards)', () => {
    const ir = parseOracleTextToIR(
      '{4}, {T}: Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.',
      'Test'
    );
    const ability = ir.abilities.find(a => a.type === 'activated');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Creature — Elf' },
            { id: 'p2c2', type_line: 'Land' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [
            { id: 'p3c1', type_line: 'Instant' },
            { id: 'p3c2', type_line: 'Creature — Human' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual([]);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c2']);
    expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1']);
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

  it('applies add_mana for "you" by updating state.manaPool', () => {
    const ir = parseOracleTextToIR('Add {R}{R}.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const pool = (result.state as any).manaPool?.['p1'];
    expect(pool).toBeTruthy();
    expect(pool.red).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'add_mana')).toBe(true);
  });

  it('applies add_mana for each player', () => {
    const ir = parseOracleTextToIR('Each player adds {G}.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const manaPool = (result.state as any).manaPool;

    expect(manaPool?.['p1']?.green).toBe(1);
    expect(manaPool?.['p2']?.green).toBe(1);
    expect(result.appliedSteps.some(s => s.kind === 'add_mana')).toBe(true);
  });

  it('applies add_mana for defending player via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('Defending player adds {G}.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const manaPool = (result.state as any).manaPool;

    expect(manaPool?.['p1']?.green ?? 0).toBe(0);
    expect(manaPool?.['p2']?.green).toBe(1);
    expect(result.appliedSteps.some(s => s.kind === 'add_mana')).toBe(true);
  });

  it('applies add_mana for the defending player via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('The defending player adds {G}.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const manaPool = (result.state as any).manaPool;

    expect(manaPool?.['p1']?.green ?? 0).toBe(0);
    expect(manaPool?.['p2']?.green).toBe(1);
    expect(result.appliedSteps.some(s => s.kind === 'add_mana')).toBe(true);
  });

  it('applies deal_damage to each opponent (deterministic player target)', () => {
    const ir = parseOracleTextToIR('It deals 3 damage to each opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(37);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to "that player" via target_player selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to that player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to each of those opponents via relational selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each of those opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(38);
  });

  it('applies deal_damage to those opponents via relational selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to those opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(38);
  });

  it('applies deal_damage to all of those opponents via relational selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to all of those opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(38);
  });

  it('applies deal_damage to all those opponents via relational selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to all those opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(38);
  });

  it('applies deal_damage to "him or her" via target_player selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to him or her.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to "its controller" via target_player selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to its controller.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to "its owner" via target_player selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to its owner.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it("applies deal_damage to \"that creature's controller\" via target_player selector context binding", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to that creature's controller.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it("applies deal_damage to \"that permanent's owner\" via target_player selector context binding", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to that permanent's owner.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it("applies deal_damage to \"that creature's owner\" via target_player selector context binding", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to that creature's owner.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it("applies deal_damage to \"that card's controller\" via target_player selector context binding", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to that card's controller.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it("applies deal_damage to \"that card's owner\" via target_player selector context binding", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to that card's owner.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it("applies deal_damage to \"that enchantment's owner\" via target_player selector context binding", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to that enchantment's owner.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to "that opponent" via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to that opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to "defending player" via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to defending player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to "the defending player" via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to the defending player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(38);
  });

  it('applies deal_damage to each player (deterministic player target)', () => {
    const ir = parseOracleTextToIR('Deal 2 damage to each player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(38);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature (deterministic battlefield group)', () => {
    const ir = parseOracleTextToIR('It deals 3 damage to each creature.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'a1', controller: 'p2', owner: 'p2', card: { id: 'a1_card', name: 'Sol Ring', type_line: 'Artifact' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;
    const a1 = (result.state.battlefield || []).find((p: any) => p.id === 'a1') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(3);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(3);
    expect(a1?.counters?.damage ?? a1?.markedDamage ?? a1?.damage ?? 0).toBe(0);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and each planeswalker (deterministic battlefield group)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and each planeswalker.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'pw1', controller: 'p2', owner: 'p2', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw1_card', name: 'Test Walker', type_line: 'Planeswalker — Test' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const pw1 = (result.state.battlefield || []).find((p: any) => p.id === 'pw1') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(pw1?.loyalty ?? pw1?.counters?.loyalty).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each battle (deterministic battlefield group)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each battle.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'b1', controller: 'p2', owner: 'p2', counters: { defense: 5 }, card: { id: 'b1_card', name: 'Test Siege', type_line: 'Battle — Siege' } } as any,
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const b1 = (result.state.battlefield || []).find((p: any) => p.id === 'b1') as any;

    expect(b1?.counters?.defense).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each of your opponents (common player group phrasing)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each of your opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to your opponents (common player group phrasing without "each")', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to your opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to your opponents' creatures (shorthand possessive selector without each/all)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to your opponents' creatures.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to your opponents' planeswalkers (shorthand possessive selector without each/all)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to your opponents' planeswalkers.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'pw_home', controller: 'p1', owner: 'p1', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw_home_card', name: 'Home Walker', type_line: 'Planeswalker — Test' } } as any,
        { id: 'pw_opp', controller: 'p2', owner: 'p2', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw_opp_card', name: 'Opp Walker', type_line: 'Planeswalker — Test' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const pwHome = (result.state.battlefield || []).find((p: any) => p.id === 'pw_home') as any;
    const pwOpp = (result.state.battlefield || []).find((p: any) => p.id === 'pw_opp') as any;

    expect(pwHome?.loyalty ?? pwHome?.counters?.loyalty).toBe(5);
    expect(pwOpp?.loyalty ?? pwOpp?.counters?.loyalty).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to your opponents' battles (shorthand possessive selector without each/all)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to your opponents' battles.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'b_home', controller: 'p1', owner: 'p1', counters: { defense: 5 }, card: { id: 'b_home_card', name: 'Home Siege', type_line: 'Battle — Siege' } } as any,
        { id: 'b_opp', controller: 'p2', owner: 'p2', counters: { defense: 5 }, card: { id: 'b_opp_card', name: 'Opp Siege', type_line: 'Battle — Siege' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const bHome = (result.state.battlefield || []).find((p: any) => p.id === 'b_home') as any;
    const bOpp = (result.state.battlefield || []).find((p: any) => p.id === 'b_opp') as any;

    expect(bHome?.counters?.defense).toBe(5);
    expect(bOpp?.counters?.defense).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to your creatures (shorthand selector without each/all)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to your creatures.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage ?? 0).toBe(0);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to your opponents' creatures and you (mixed target using shorthand selector)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to your opponents' creatures and you.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to your opponents' creatures or planeswalkers and you (mixed target + shorthand union selector)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to your opponents' creatures or planeswalkers and you.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
        { id: 'pw1', controller: 'p2', owner: 'p2', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw1_card', name: 'Test Walker', type_line: 'Planeswalker — Test' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;
    const pw1 = (result.state.battlefield || []).find((p: any) => p.id === 'pw1') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(pw1?.loyalty ?? pw1?.counters?.loyalty).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to creatures your opponents control and each opponent (mixed target + controller-suffix selector without each/all)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to creatures your opponents control and each opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c_you', controller: 'p1', owner: 'p1', card: { id: 'c_you_card', name: 'Your Bear', type_line: 'Creature — Bear' } } as any,
        { id: 'c_opp_2', controller: 'p2', owner: 'p2', card: { id: 'c_opp_2_card', name: 'Opp 2 Giant', type_line: 'Creature — Giant' } } as any,
        { id: 'c_opp_3', controller: 'p3', owner: 'p3', card: { id: 'c_opp_3_card', name: 'Opp 3 Lion', type_line: 'Creature — Cat' } } as any,
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const p3 = result.state.players.find((p: any) => p.id === 'p3') as any;
    const cYou = (result.state.battlefield || []).find((p: any) => p.id === 'c_you') as any;
    const cOpp2 = (result.state.battlefield || []).find((p: any) => p.id === 'c_opp_2') as any;
    const cOpp3 = (result.state.battlefield || []).find((p: any) => p.id === 'c_opp_3') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(p3.life).toBe(38);

    expect(cYou?.counters?.damage ?? cYou?.markedDamage ?? cYou?.damage ?? 0).toBe(0);
    expect(cOpp2?.counters?.damage ?? cOpp2?.markedDamage ?? cOpp2?.damage).toBe(2);
    expect(cOpp3?.counters?.damage ?? cOpp3?.markedDamage ?? cOpp3?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to planeswalkers your opponents control and you (mixed target + controller-suffix selector without each/all)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to planeswalkers your opponents control and you.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'pw_you', controller: 'p1', owner: 'p1', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw_you_card', name: 'Your Walker', type_line: 'Planeswalker — Test' } } as any,
        { id: 'pw_opp', controller: 'p2', owner: 'p2', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw_opp_card', name: 'Opp Walker', type_line: 'Planeswalker — Test' } } as any,
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const pwYou = (result.state.battlefield || []).find((p: any) => p.id === 'pw_you') as any;
    const pwOpp = (result.state.battlefield || []).find((p: any) => p.id === 'pw_opp') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(pwYou?.loyalty ?? pwYou?.counters?.loyalty).toBe(5);
    expect(pwOpp?.loyalty ?? pwOpp?.counters?.loyalty).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and each opponent (mixed deterministic targets)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and each opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and defending player (mixed target + target_opponent context)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and defending player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and the defending player (mixed target + target_opponent context)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and the defending player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and that player (mixed target + target_player context)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and that player.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and that opponent (mixed target + target_opponent context)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and that opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and each of those opponents (mixed relational selector context)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and each of those opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p3'] as any },
    });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const p3 = result.state.players.find((p: any) => p.id === 'p3') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and all of those opponents (mixed relational selector context)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and all of those opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
    });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const p3 = result.state.players.find((p: any) => p.id === 'p3') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(p3.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature and your opponents (mixed deterministic targets, player group shorthand)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature and your opponents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature or planeswalker and each opponent (mixed deterministic targets with union selector)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature or planeswalker and each opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'pw1', controller: 'p2', owner: 'p2', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw1_card', name: 'Test Walker', type_line: 'Planeswalker — Test' } } as any,
        { id: 'a1', controller: 'p2', owner: 'p2', card: { id: 'a1_card', name: 'Sol Ring', type_line: 'Artifact' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const pw1 = (result.state.battlefield || []).find((p: any) => p.id === 'pw1') as any;
    const a1 = (result.state.battlefield || []).find((p: any) => p.id === 'a1') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(pw1?.loyalty ?? pw1?.counters?.loyalty).toBe(3);
    expect(a1?.counters?.damage ?? a1?.markedDamage ?? a1?.damage ?? 0).toBe(0);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each of your opponents' creatures (of + possessive selector)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each of your opponents' creatures.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to you and each creature (mixed deterministic targets)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to you and each creature.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature, each planeswalker, and each opponent (mixed deterministic targets)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature, each planeswalker, and each opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
        {
          id: 'pw1',
          controller: 'p2',
          owner: 'p2',
          loyalty: 5,
          counters: { loyalty: 5 },
          card: { id: 'pw1_card', name: 'Test Walker', type_line: 'Planeswalker — Test' },
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;
    const pw1 = (result.state.battlefield || []).find((p: any) => p.id === 'pw1') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(pw1?.loyalty ?? pw1?.counters?.loyalty).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature you control and each opponent (mixed deterministic targets w/ controller filter)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature you control and each opponent.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(40);
    expect(p2.life).toBe(38);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage).toBe(2);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage ?? 0).toBe(0);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each planeswalker your opponents control and you (mixed deterministic targets w/ controller filter)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each planeswalker your opponents control and you.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'pw1',
          controller: 'p2',
          owner: 'p2',
          loyalty: 5,
          counters: { loyalty: 5 },
          card: { id: 'pw1_card', name: 'Test Walker', type_line: 'Planeswalker — Test' },
        } as any,
        {
          id: 'pw2',
          controller: 'p1',
          owner: 'p1',
          loyalty: 4,
          counters: { loyalty: 4 },
          card: { id: 'pw2_card', name: 'Home Walker', type_line: 'Planeswalker — Test' },
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const pw1 = (result.state.battlefield || []).find((p: any) => p.id === 'pw1') as any;
    const pw2 = (result.state.battlefield || []).find((p: any) => p.id === 'pw2') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(pw1?.loyalty ?? pw1?.counters?.loyalty).toBe(3);
    expect(pw2?.loyalty ?? pw2?.counters?.loyalty).toBe(4);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each creature you don't control (opponent-scope controller filter)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each creature you don't control.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies deal_damage to each creature an opponent controls (opponent-scope controller filter)', () => {
    const ir = parseOracleTextToIR('It deals 2 damage to each creature an opponent controls.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each creature you don’t control (curly apostrophe variant)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each creature you don’t control.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each creature you don’t control and you (mixed deterministic targets, curly apostrophe)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each creature you don’t control and you.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each opponent's creatures (possessive opponent-scope selector)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each opponent's creatures.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each opponent’s creatures and you (possessive + curly apostrophe mixed target)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each opponent’s creatures and you.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' } } as any,
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'Hill Giant', type_line: 'Creature — Giant' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find((p: any) => p.id === 'p1') as any;
    const p2 = result.state.players.find((p: any) => p.id === 'p2') as any;
    const c1 = (result.state.battlefield || []).find((p: any) => p.id === 'c1') as any;
    const c2 = (result.state.battlefield || []).find((p: any) => p.id === 'c2') as any;

    expect(p1.life).toBe(38);
    expect(p2.life).toBe(40);
    expect(c1?.counters?.damage ?? c1?.markedDamage ?? c1?.damage ?? 0).toBe(0);
    expect(c2?.counters?.damage ?? c2?.markedDamage ?? c2?.damage).toBe(2);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each opponent's planeswalkers (possessive opponent-scope selector)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each opponent's planeswalkers.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'pw_home', controller: 'p1', owner: 'p1', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw_home_card', name: 'Home Walker', type_line: 'Planeswalker — Test' } } as any,
        { id: 'pw_opp', controller: 'p2', owner: 'p2', loyalty: 5, counters: { loyalty: 5 }, card: { id: 'pw_opp_card', name: 'Opp Walker', type_line: 'Planeswalker — Test' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const pwHome = (result.state.battlefield || []).find((p: any) => p.id === 'pw_home') as any;
    const pwOpp = (result.state.battlefield || []).find((p: any) => p.id === 'pw_opp') as any;

    expect(pwHome?.loyalty ?? pwHome?.counters?.loyalty).toBe(5);
    expect(pwOpp?.loyalty ?? pwOpp?.counters?.loyalty).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it("applies deal_damage to each opponent's battles (possessive opponent-scope selector)", () => {
    const ir = parseOracleTextToIR("It deals 2 damage to each opponent's battles.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'b_home', controller: 'p1', owner: 'p1', counters: { defense: 5 }, card: { id: 'b_home_card', name: 'Home Siege', type_line: 'Battle — Siege' } } as any,
        { id: 'b_opp', controller: 'p2', owner: 'p2', counters: { defense: 5 }, card: { id: 'b_opp_card', name: 'Opp Siege', type_line: 'Battle — Siege' } } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const bHome = (result.state.battlefield || []).find((p: any) => p.id === 'b_home') as any;
    const bOpp = (result.state.battlefield || []).find((p: any) => p.id === 'b_opp') as any;

    expect(bHome?.counters?.defense).toBe(5);
    expect(bOpp?.counters?.defense).toBe(3);
    expect(result.appliedSteps.some(s => s.kind === 'deal_damage')).toBe(true);
  });

  it('applies destroy for "all creatures" by removing matching permanents from battlefield', () => {
    const ir = parseOracleTextToIR('Destroy all creatures.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
        {
          id: 'bf2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c_creature_2', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'bf3',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_artifact_1', name: 'Sol Ring', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Sol Ring');

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.graveyard).toHaveLength(1);
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'destroy')).toBe(true);
  });

  it('applies exile for "all artifacts you control" by moving them to exile', () => {
    const ir = parseOracleTextToIR('Exile all artifacts you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_art_1', name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'bf2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c_art_2', name: 'Mind Stone', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Mind Stone');
    expect(p1.exile).toHaveLength(1);
    expect(p2.exile).toHaveLength(0);
    expect(result.appliedSteps.some(s => s.kind === 'exile')).toBe(true);
  });

  it('applies exile for "artifacts you control" (controller-suffix selector without each/all)', () => {
    const ir = parseOracleTextToIR('Exile artifacts you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_art_1', name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'bf2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c_art_2', name: 'Mind Stone', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Mind Stone');
    expect(p1.exile).toHaveLength(1);
    expect(p2.exile).toHaveLength(0);
    expect(result.appliedSteps.some(s => s.kind === 'exile')).toBe(true);
  });

  it('applies exile for "artifacts you control" when controller ids contain whitespace', () => {
    const ir = parseOracleTextToIR('Exile artifacts you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'bf1',
          controller: '  p1  ',
          owner: 'p1',
          card: { id: 'c_art_1', name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'bf2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c_art_2', name: 'Mind Stone', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(names).not.toContain('Sol Ring');
    expect(names).toContain('Mind Stone');
    expect(p1.exile).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'exile')).toBe(true);
  });

  it('ignores malformed-controller permanents for opponent controller filters', () => {
    const ir = parseOracleTextToIR("Exile your opponents' artifacts.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c_art_1', name: 'P1 Artifact', type_line: 'Artifact' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c_art_2', name: 'P2 Artifact', type_line: 'Artifact' } },
        { id: 'bf3', controller: '   ', owner: 'p2', card: { id: 'c_art_3', name: 'Malformed Artifact', type_line: 'Artifact' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(names).toContain('P1 Artifact');
    expect(names).not.toContain('P2 Artifact');
    expect(names).toContain('Malformed Artifact');
    expect((p2.exile || []).some((c: any) => c?.name === 'P2 Artifact')).toBe(true);
    expect(result.appliedSteps.some(s => s.kind === 'exile')).toBe(true);
  });

  it('applies exile for "your creatures" (shorthand selector without each/all)', () => {
    const ir = parseOracleTextToIR('Exile your creatures.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p1', owner: 'p1', card: { id: 'a1', name: 'Sol Ring', type_line: 'Artifact' } },
        { id: 'bf3', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(names).not.toContain('P1 Bear');
    expect(names).toContain('Sol Ring');
    expect(names).toContain('P2 Lion');

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.exile).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'exile')).toBe(true);
  });

  it('applies move_zone for returning all creature cards from your graveyard to your hand', () => {
    const ir = parseOracleTextToIR('Return all creature cards from your graveyard to your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h0', name: 'Existing', type_line: 'Instant' }],
          graveyard: [
            { id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'g2', name: 'Shock', type_line: 'Instant' },
            { id: 'g3', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g2']);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['h0', 'g1', 'g3']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for exiling all creature cards from your graveyard', () => {
    const ir = parseOracleTextToIR('Exile all creature cards from your graveyard.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'g2', name: 'Shock', type_line: 'Instant' },
            { id: 'g3', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          exile: [{ id: 'e0', name: 'Already Exiled', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g2']);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['e0', 'g1', 'g3']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from your graveyard into your hand', () => {
    const ir = parseOracleTextToIR('Put all creature cards from your graveyard into your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h0', name: 'Existing', type_line: 'Instant' }],
          graveyard: [
            { id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'g2', name: 'Shock', type_line: 'Instant' },
            { id: 'g3', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g2']);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['h0', 'g1', 'g3']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from your graveyard into exile', () => {
    const ir = parseOracleTextToIR('Put all creature cards from your graveyard into exile.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'g2', name: 'Shock', type_line: 'Instant' },
            { id: 'g3', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          exile: [{ id: 'e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g2']);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['e0', 'g1', 'g3']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone bounce for returning all creatures to their owners\' hands', () => {
    const ir = parseOracleTextToIR("Return all creatures to their owners' hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'c1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c1card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
        {
          id: 'c2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c2card', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'a1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'a1card', name: 'Sol Ring', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Sol Ring');
    expect(p1.hand.map((c: any) => c.id)).toEqual(['c1card']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['c2card']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone bounce for returning all artifacts you control to owners\' hands (stolen artifact returns to owner)', () => {
    const ir = parseOracleTextToIR("Return all artifacts you control to their owners' hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'stolen',
          controller: 'p1',
          owner: 'p2',
          card: { id: 'stolenCard', name: 'Mind Stone', type_line: 'Artifact' },
        },
        {
          id: 'yours',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'yoursCard', name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'p2thing',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'p2thingCard', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Hill Giant');
    expect(p1.hand.map((c: any) => c.id)).toEqual(['yoursCard']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['stolenCard']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone bounce for returning "your creatures" to their owners\' hands (shorthand selector without each/all)', () => {
    const ir = parseOracleTextToIR("Return your creatures to their owners' hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'p1Creature',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'p1CreatureCard', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
        {
          id: 'stolenCreature',
          controller: 'p1',
          owner: 'p2',
          card: { id: 'stolenCreatureCard', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'p2Creature',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'p2CreatureCard', name: 'Silvercoat Lion', type_line: 'Creature — Cat' },
        },
        {
          id: 'p1Artifact',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'p1ArtifactCard', name: 'Sol Ring', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    const battlefieldNames = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(battlefieldNames).toEqual(expect.arrayContaining(['Silvercoat Lion', 'Sol Ring']));
    expect(battlefieldNames).not.toEqual(expect.arrayContaining(['Grizzly Bears', 'Hill Giant']));

    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1CreatureCard']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['stolenCreatureCard']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone bounce for returning "your opponents\u2019 creatures" to their owners\u2019 hands (shorthand selector without each/all)', () => {
    const ir = parseOracleTextToIR('Return your opponents\u2019 creatures to their owners\u2019 hands.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'p1Creature',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'p1CreatureCard', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
        {
          id: 'p2Creature',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'p2CreatureCard', name: 'Silvercoat Lion', type_line: 'Creature — Cat' },
        },
        {
          id: 'stolenCreature',
          controller: 'p2',
          owner: 'p1',
          card: { id: 'stolenCreatureCard', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'p2Artifact',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'p2ArtifactCard', name: 'Mind Stone', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    const battlefieldNames = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(battlefieldNames).toEqual(expect.arrayContaining(['Grizzly Bears', 'Mind Stone']));
    expect(battlefieldNames).not.toEqual(expect.arrayContaining(['Silvercoat Lion', 'Hill Giant']));

    expect(p1.hand.map((c: any) => c.id)).toEqual(['stolenCreatureCard']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2CreatureCard']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from your graveyard onto the battlefield', () => {
    const ir = parseOracleTextToIR('Put all creature cards from your graveyard onto the battlefield.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'g2', name: 'Opt', type_line: 'Instant' },
            { id: 'g3', name: 'Silvercoat Lion', type_line: 'Creature — Cat' },
          ],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g2']);
    expect(result.state.battlefield).toHaveLength(2);
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(names).toContain('Grizzly Bears');
    expect(names).toContain('Silvercoat Lion');
  });

  it('applies destroy for "all artifacts and enchantments" by removing both types', () => {
    const ir = parseOracleTextToIR('Destroy all artifacts and enchantments.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_artifact_1', name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'bf2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c_ench_1', name: 'Seal of Strength', type_line: 'Enchantment' },
        },
        {
          id: 'bf3',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Grizzly Bears');
  });

  it('applies destroy for "all nonland permanents" by keeping only lands', () => {
    const ir = parseOracleTextToIR('Destroy all nonland permanents.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_land_1', name: 'Plains', type_line: 'Land' },
        },
        {
          id: 'bf2',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Plains');
  });

  it('applies destroy for "all planeswalkers" by removing planeswalkers only', () => {
    const ir = parseOracleTextToIR('Destroy all planeswalkers.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_pw_1', name: 'Test Walker', type_line: 'Planeswalker — Test' },
        },
        {
          id: 'bf2',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Grizzly Bears');
  });

  it('applies destroy for "all battles" by removing battles only', () => {
    const ir = parseOracleTextToIR('Destroy all battles.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
      battlefield: [
        {
          id: 'bf1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_battle_1', name: 'Test Siege', type_line: 'Battle — Siege' },
        },
        {
          id: 'bf2',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'c_creature_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Grizzly Bears');
  });

  it('applies destroy for "all creatures you control" by removing only your creatures', () => {
    const ir = parseOracleTextToIR('Destroy all creatures you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('P2 Lion');
  });

  it('applies destroy for "creatures you control" (controller-suffix selector without each/all)', () => {
    const ir = parseOracleTextToIR('Destroy creatures you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('P2 Lion');
    expect(result.appliedSteps.some(s => s.kind === 'destroy')).toBe(true);
  });

  it('applies destroy for "all creatures your opponents control" by removing only opponent creatures', () => {
    const ir = parseOracleTextToIR('Destroy all creatures your opponents control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('P1 Bear');
  });

  it('applies destroy for "creatures your opponents control" (controller-suffix selector without each/all)', () => {
    const ir = parseOracleTextToIR('Destroy creatures your opponents control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
        { id: 'bf3', controller: 'p2', owner: 'p2', card: { id: 'a1', name: 'Sol Ring', type_line: 'Artifact' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(names).toContain('P1 Bear');
    expect(names).toContain('Sol Ring');
    expect(names).not.toContain('P2 Lion');
    expect(result.appliedSteps.some(s => s.kind === 'destroy')).toBe(true);
  });

  it("applies destroy for \"your opponents' creatures\" (shorthand selector without each/all)", () => {
    const ir = parseOracleTextToIR("Destroy your opponents' creatures.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
        { id: 'bf3', controller: 'p2', owner: 'p2', card: { id: 'a1', name: 'Sol Ring', type_line: 'Artifact' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(names).toContain('P1 Bear');
    expect(names).toContain('Sol Ring');
    expect(names).not.toContain('P2 Lion');

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.graveyard).toHaveLength(0);
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'destroy')).toBe(true);
  });

  it('applies destroy for "all creatures you don\'t control" by removing only non-owned creatures', () => {
    const ir = parseOracleTextToIR("Destroy all creatures you don't control.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'bf1', controller: 'p1', owner: 'p1', card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'bf2', controller: 'p2', owner: 'p2', card: { id: 'c2', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('P1 Bear');
  });

  it('applies move_zone for putting all creature cards from your graveyard onto the battlefield tapped', () => {
    const ir = parseOracleTextToIR('Put all creature cards from your graveyard onto the battlefield tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p1g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1g2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(result.state.battlefield).toHaveLength(1);
    const perm = (result.state.battlefield as any[])[0];
    expect(String(perm.card?.name)).toBe('Grizzly Bears');
    expect(perm.tapped).toBe(true);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for returning all creature cards from your exile to your hand', () => {
    const ir = parseOracleTextToIR('Return all creature cards from your exile to your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h0', name: 'Existing', type_line: 'Sorcery' }],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear', canBePlayedBy: 'p1', playableUntilTurn: 123 },
          ],
        } as any,
      ],
    });

    (start as any).playableFromExile = { p1: { p1e2: 123 } };

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h0', 'p1e2']);

    // Leaving exile should clear impulse markers.
    expect((result.state as any).playableFromExile?.p1?.p1e2).toBeUndefined();
    const moved = p1.hand.find((c: any) => c.id === 'p1e2');
    expect(moved?.canBePlayedBy).toBeUndefined();
    expect(moved?.playableUntilTurn).toBeUndefined();

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from your exile onto the battlefield tapped', () => {
    const ir = parseOracleTextToIR('Put all creature cards from your exile onto the battlefield tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(result.state.battlefield).toHaveLength(1);
    const perm = (result.state.battlefield as any[])[0];
    expect(String(perm.card?.name)).toBe('Grizzly Bears');
    expect(String(perm.controller)).toBe('p1');
    expect(String(perm.owner)).toBe('p1');
    expect(perm.tapped).toBe(true);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each player's exile onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each player's exile onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p1e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p2e2', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile).toHaveLength(0);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e1']);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for returning all creature cards from all exiles to their owners' hands", () => {
    const ir = parseOracleTextToIR("Return all creature cards from all exiles to their owners' hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h0', name: 'Existing', type_line: 'Sorcery' }],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [{ id: 'p2h0', name: 'Existing2', type_line: 'Land' }],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);

    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h0', 'p1e2']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2h0', 'p2e1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's exile onto the battlefield under your control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's exile onto the battlefield under your control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p1e1', name: 'Opt', type_line: 'Instant' }],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p3e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);
    expect(p3.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    expect(giant).toBeTruthy();
    expect(bears).toBeTruthy();

    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p1');
    expect(String(bears.owner)).toBe('p3');
    expect(String(bears.controller)).toBe('p1');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from all exiles onto the battlefield tapped', () => {
    const ir = parseOracleTextToIR('Put all creature cards from all exiles onto the battlefield tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');
    expect(bears.tapped).toBe(true);
    expect(giant.tapped).toBe(true);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for returning all creature cards from each opponent's exile to their owners' hands", () => {
    const ir = parseOracleTextToIR(
      "Return all creature cards from each opponent's exile to their owners' hands.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h0', name: 'Existing', type_line: 'Sorcery' }],
          graveyard: [],
          exile: [{ id: 'p1e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [{ id: 'p2h0', name: 'Existing2', type_line: 'Land' }],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p3e1', name: 'Silvercoat Lion', type_line: 'Creature — Cat' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Only opponents (p2, p3) are affected.
    expect(p1.exile).toHaveLength(1);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h0']);

    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2h0', 'p2e1']);

    expect(p3.exile).toHaveLength(0);
    expect(p3.hand.map((c: any) => c.id)).toEqual(['p3e1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from all exiles into their owners' graveyards", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from all exiles into their owners' graveyards.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g0', name: 'Existing', type_line: 'Sorcery' }],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile).toHaveLength(0);

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g0', 'p1e2']);
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2e1']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's exile into their owners' graveyards", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's exile into their owners' graveyards.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g0', name: 'Existing', type_line: 'Sorcery' }],
          exile: [{ id: 'p1e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p3g0', name: 'Existing3', type_line: 'Land' }],
          exile: [{ id: 'p3e1', name: 'Silvercoat Lion', type_line: 'Creature — Cat' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Only opponents (p2, p3) are affected.
    expect(p1.exile).toHaveLength(1);
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g0']);

    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2e1']);

    expect(p3.exile).toHaveLength(0);
    expect(p3.graveyard.map((c: any) => c.id)).toEqual(['p3g0', 'p3e1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from all exiles onto the battlefield under your control", () => {
    const ir = parseOracleTextToIR(
      'Put all creature cards from all exiles onto the battlefield under your control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    // Controller is the spell controller for all moved cards.
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p1');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("skips move_zone for putting all creature cards from each opponent's exile onto the battlefield without explicit control override", () => {
    const ir = parseOracleTextToIR('Put all creature cards from each opponent\'s exile onto the battlefield.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.exile).toHaveLength(1);
    expect(result.state.battlefield).toHaveLength(0);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's exile onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's exile onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p1e1', name: 'Opt', type_line: 'Instant' }],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p3e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);
    expect(p3.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    expect(giant).toBeTruthy();
    expect(bears).toBeTruthy();
    // Under owners' control: controller should match owner (and not the spell controller).
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');
    expect(String(bears.owner)).toBe('p3');
    expect(String(bears.controller)).toBe('p3');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from all exiles onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from all exiles onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's exile onto the battlefield tapped under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's exile onto the battlefield tapped under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p3e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);
    expect(p3.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    expect(giant).toBeTruthy();
    expect(bears).toBeTruthy();
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');
    expect(String(bears.owner)).toBe('p3');
    expect(String(bears.controller)).toBe('p3');
    expect(giant.tapped).toBe(true);
    expect(bears.tapped).toBe(true);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from all exiles onto the battlefield tapped under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from all exiles onto the battlefield tapped under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');
    expect(bears.tapped).toBe(true);
    expect(giant.tapped).toBe(true);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's exile onto the battlefield tapped under your control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's exile onto the battlefield tapped under your control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p3e1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);
    expect(p3.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    expect(giant).toBeTruthy();
    expect(bears).toBeTruthy();
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p1');
    expect(String(bears.owner)).toBe('p3');
    expect(String(bears.controller)).toBe('p1');
    expect(giant.tapped).toBe(true);
    expect(bears.tapped).toBe(true);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from all exiles onto the battlefield tapped under your control', () => {
    const ir = parseOracleTextToIR('Put all creature cards from all exiles onto the battlefield tapped under your control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p1');
    expect(bears.tapped).toBe(true);
    expect(giant.tapped).toBe(true);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each player's exile onto the battlefield (default owners' control)", () => {
    const ir = parseOracleTextToIR("Put all creature cards from each player's exile onto the battlefield.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController).toBeUndefined();

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [{ id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each player's exile onto the battlefield tapped under your control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each player's exile onto the battlefield tapped under your control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p1e1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'p2e1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2e2', name: 'Opt', type_line: 'Instant' },
          ],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e2']);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.owner)).toBe('p1');
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(giant.controller)).toBe('p1');
    expect(bears.tapped).toBe(true);
    expect(giant.tapped).toBe(true);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('skips move_zone for targeting-dependent graveyard-to-battlefield moves', () => {
    const ir = parseOracleTextToIR('Put target creature card from your graveyard onto the battlefield.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
    expect(result.state.battlefield).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
  });

  it("applies move_zone for exiling all cards from each player's graveyard", () => {
    const ir = parseOracleTextToIR("Exile all cards from each player's graveyard.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p1g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1g2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          exile: [{ id: 'p1e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Shock', type_line: 'Instant' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.graveyard).toHaveLength(0);
    expect(p2.graveyard).toHaveLength(0);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e0', 'p1g1', 'p1g2']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2g1']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for exiling all cards from each player\'s hand', () => {
    const ir = parseOracleTextToIR("Exile all cards from each player's hand.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [
            { id: 'p1h1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1h2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [{ id: 'p2h1', name: 'Shock', type_line: 'Instant' }],
          graveyard: [],
          exile: [{ id: 'p2e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.hand).toHaveLength(0);
    expect(p2.hand).toHaveLength(0);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1h1', 'p1h2']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e0', 'p2h1']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("skips move_zone for exiling all cards from target player's graveyard", () => {
    const ir = parseOracleTextToIR("Exile all cards from target player's graveyard.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Opt', type_line: 'Instant' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
    expect(p1.graveyard).toHaveLength(1);
    expect(p1.exile || []).toHaveLength(0);
  });

  it("applies move_zone for exiling all cards from each opponent's graveyard", () => {
    const ir = parseOracleTextToIR("Exile all cards from each opponent's graveyard.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Opt', type_line: 'Instant' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Shock', type_line: 'Instant' }],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p3g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [{ id: 'p3e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Controller's graveyard should be untouched.
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p1.exile || []).toHaveLength(0);

    expect(p2.graveyard).toHaveLength(0);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2g1']);

    expect(p3.graveyard).toHaveLength(0);
    expect(p3.exile.map((c: any) => c.id)).toEqual(['p3e0', 'p3g1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for exiling all cards from each opponent's hand", () => {
    const ir = parseOracleTextToIR("Exile all cards from each opponent's hand.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h1', name: 'Opt', type_line: 'Instant' }],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [{ id: 'p2h1', name: 'Shock', type_line: 'Instant' }],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [
            { id: 'p3h1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'p3h2', name: 'Opt', type_line: 'Instant' },
          ],
          graveyard: [],
          exile: [{ id: 'p3e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Controller's hand should be untouched.
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h1']);
    expect(p1.exile || []).toHaveLength(0);

    expect(p2.hand).toHaveLength(0);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2h1']);

    expect(p3.hand).toHaveLength(0);
    expect(p3.exile.map((c: any) => c.id)).toEqual(['p3e0', 'p3h1', 'p3h2']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("skips move_zone for exiling all cards from target opponent's graveyard", () => {
    const ir = parseOracleTextToIR("Exile all cards from target opponent's graveyard.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Opt', type_line: 'Instant' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g2', name: 'Shock', type_line: 'Instant' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
    expect(p2.graveyard).toHaveLength(1);
    expect(p2.exile || []).toHaveLength(0);
  });

  it("applies move_zone for exiling all creature cards from each opponent's graveyard", () => {
    const ir = parseOracleTextToIR("Exile all creature cards from each opponent's graveyard.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p2g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p2g2', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p3g1', name: 'Silvercoat Lion', type_line: 'Creature — Cat' },
            { id: 'p3g2', name: 'Shock', type_line: 'Instant' },
          ],
          exile: [{ id: 'p3e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Controller is not an opponent; should remain unchanged.
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p1.exile || []).toHaveLength(0);

    // Opponents: only creature cards exiled.
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g1']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2g2']);

    expect(p3.graveyard.map((c: any) => c.id)).toEqual(['p3g2']);
    expect(p3.exile.map((c: any) => c.id)).toEqual(['p3e0', 'p3g1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all instant cards from each opponent's hand into their graveyards", () => {
    const ir = parseOracleTextToIR(
      "Put all instant cards from each opponent's hand into their graveyards.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h1', name: 'Opt', type_line: 'Instant' }],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [
            { id: 'p2h1', name: 'Opt', type_line: 'Instant' },
            { id: 'p2h2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          graveyard: [{ id: 'p2g0', name: 'Existing', type_line: 'Sorcery' }],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [
            { id: 'p3h1', name: 'Shock', type_line: 'Instant' },
            { id: 'p3h2', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Controller untouched.
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h1']);
    expect(p1.graveyard || []).toHaveLength(0);

    // Opponents: instants moved, non-instants kept.
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2h2']);
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g0', 'p2h1']);

    expect(p3.hand.map((c: any) => c.id)).toEqual(['p3h2']);
    expect(p3.graveyard.map((c: any) => c.id)).toEqual(['p3h1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for exiling all creature cards from all graveyards', () => {
    const ir = parseOracleTextToIR('Exile all creature cards from all graveyards.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p1g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1g2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [{ id: 'p2e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p2.graveyard).toHaveLength(0);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1g2']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2e0', 'p2g1']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for returning all creature cards from each opponent's graveyard to their hands", () => {
    const ir = parseOracleTextToIR("Return all creature cards from each opponent's graveyard to their hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h0', name: 'Existing', type_line: 'Sorcery' }],
          graveyard: [
            { id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'p1g2', name: 'Opt', type_line: 'Instant' },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2g2', name: 'Shock', type_line: 'Instant' },
          ],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [{ id: 'p3h0', name: 'Existing', type_line: 'Sorcery' }],
          graveyard: [{ id: 'p3g1', name: 'Silvercoat Lion', type_line: 'Creature — Cat' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Controller is not an opponent; should be untouched.
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1', 'p1g2']);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h0']);

    // Opponents: only creature cards returned from graveyard to hand.
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g2']);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2g1']);

    expect(p3.graveyard).toHaveLength(0);
    expect(p3.hand.map((c: any) => c.id)).toEqual(['p3h0', 'p3g1']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's graveyard onto the battlefield under your control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's graveyard onto the battlefield under your control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2g2', name: 'Opt', type_line: 'Instant' },
          ],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p3g1', name: 'Silvercoat Lion', type_line: 'Creature — Cat' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // Controller's graveyard should be untouched (opponents only).
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);

    // Opponents: only creature cards moved from graveyard.
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g2']);
    expect(p3.graveyard).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    const lion = bf.find(p => String(p?.card?.name) === 'Silvercoat Lion');
    expect(giant).toBeTruthy();
    expect(lion).toBeTruthy();
    expect(String(giant.controller)).toBe('p1');
    expect(String(lion.controller)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');
    expect(String(lion.owner)).toBe('p3');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each opponent's graveyard onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each opponent's graveyard onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' },
            { id: 'p2g2', name: 'Opt', type_line: 'Instant' },
          ],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    // Controller's graveyard should be untouched (opponents only).
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);

    // Opponent: only creature cards moved from graveyard.
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g2']);

    expect(result.state.battlefield).toHaveLength(1);
    const perm = (result.state.battlefield as any[])[0];
    expect(String(perm.card?.name)).toBe('Hill Giant');
    expect(String(perm.owner)).toBe('p2');
    expect(String(perm.controller)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each player's graveyard onto the battlefield under your control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each player's graveyard onto the battlefield under your control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p1g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1g2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p2.graveyard).toHaveLength(0);

    expect(result.state.battlefield).toHaveLength(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(String(perm.controller)).toBe('p1');
    }

    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(String(bears.owner)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each player's graveyard onto the battlefield tapped under your control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each player's graveyard onto the battlefield tapped under your control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('you');
    expect(move.entersTapped).toBe(true);

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(String(perm.controller)).toBe('p1');
      expect(perm.tapped).toBe(true);
    }
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from each player's graveyard onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from each player's graveyard onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(String(bears.controller)).toBe('p1');
    expect(String(bears.owner)).toBe('p1');
    expect(String(giant.controller)).toBe('p2');
    expect(String(giant.owner)).toBe('p2');
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all creature cards from all graveyards onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all creature cards from all graveyards onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.controller)).toBe('p1');
    expect(String(bears.owner)).toBe('p1');
    expect(String(giant.controller)).toBe('p2');
    expect(String(giant.owner)).toBe('p2');
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("skips move_zone for putting all creature cards from each opponent's graveyard onto the battlefield without an explicit control override", () => {
    const ir = parseOracleTextToIR("Put all creature cards from each opponent's graveyard onto the battlefield.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    // Unchanged.
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g1']);
    expect(result.state.battlefield || []).toHaveLength(0);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for returning all cards from each player's graveyard to their hands", () => {
    const ir = parseOracleTextToIR("Return all cards from each player's graveyard to their hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h0', name: 'Existing', type_line: 'Sorcery' }],
          graveyard: [{ id: 'p1g1', name: 'Opt', type_line: 'Instant' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p2g1', name: 'Shock', type_line: 'Instant' },
            { id: 'p2g2', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.graveyard).toHaveLength(0);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h0', 'p1g1']);

    expect(p2.graveyard).toHaveLength(0);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2g1', 'p2g2']);

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from all graveyards onto the battlefield', () => {
    const ir = parseOracleTextToIR('Put all creature cards from all graveyards onto the battlefield.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p1g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1g2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    // Graveyards lose only creature cards.
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p2.graveyard).toHaveLength(0);

    // Battlefield gains two creatures under their owners' control.
    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.controller)).toBe('p1');
    expect(String(bears.owner)).toBe('p1');
    expect(String(giant.controller)).toBe('p2');
    expect(String(giant.owner)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from all graveyards onto the battlefield under your control', () => {
    const ir = parseOracleTextToIR('Put all creature cards from all graveyards onto the battlefield under your control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('you');

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            { id: 'p1g1', name: 'Opt', type_line: 'Instant' },
            { id: 'p1g2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    // Graveyards lose only creature cards.
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p2.graveyard).toHaveLength(0);

    // Battlefield gains two creatures, both under the controller's control.
    expect(result.state.battlefield).toHaveLength(2);
    const bf = result.state.battlefield as any[];
    const bears = bf.find(p => String(p?.card?.name) === 'Grizzly Bears');
    const giant = bf.find(p => String(p?.card?.name) === 'Hill Giant');
    expect(bears).toBeTruthy();
    expect(giant).toBeTruthy();
    expect(String(bears.controller)).toBe('p1');
    expect(String(giant.controller)).toBe('p1');

    // Ownership remains tied to the graveyard they came from (best-effort).
    expect(String(bears.owner)).toBe('p1');
    expect(String(giant.owner)).toBe('p2');

    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all creature cards from all graveyards onto the battlefield tapped under your control', () => {
    const ir = parseOracleTextToIR(
      'Put all creature cards from all graveyards onto the battlefield tapped under your control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('you');
    expect(move.entersTapped).toBe(true);

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'Hill Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    expect(result.state.battlefield).toHaveLength(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(String(perm.controller)).toBe('p1');
      expect(perm.tapped).toBe(true);
    }
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all cards from your hand into your graveyard', () => {
    const ir = parseOracleTextToIR('Put all cards from your hand into your graveyard.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [
            { id: 'h1', name: 'Shock', type_line: 'Instant' },
            { id: 'h2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          graveyard: [{ id: 'g0', name: 'Existing', type_line: 'Sorcery' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.hand).toHaveLength(0);
    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g0', 'h1', 'h2']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for putting all land cards from your hand onto the battlefield tapped', () => {
    const ir = parseOracleTextToIR('Put all land cards from your hand onto the battlefield tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.entersTapped).toBe(true);

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [
            { id: 'hLand', name: 'Plains', type_line: 'Basic Land — Plains' },
            { id: 'hSpell', name: 'Shock', type_line: 'Instant' },
          ],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.hand.map((c: any) => c.id)).toEqual(['hSpell']);
    expect(result.state.battlefield).toHaveLength(1);
    const perm = (result.state.battlefield as any[])[0];
    expect(String(perm.controller)).toBe('p1');
    expect(String(perm.owner)).toBe('p1');
    expect(perm.tapped).toBe(true);
    expect(String(perm?.card?.id)).toBe('hLand');
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it("applies move_zone for putting all instant cards from each opponent's hand onto the battlefield under their owners' control", () => {
    const ir = parseOracleTextToIR(
      "Put all instant cards from each opponent's hand onto the battlefield under their owners' control.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController?.kind).toBe('owner_of_moved_cards');

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [
            { id: 'p2i', name: 'Opt', type_line: 'Instant' },
            { id: 'p2c', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2c']);
    expect(result.state.battlefield).toHaveLength(1);
    const perm = (result.state.battlefield as any[])[0];
    expect(String(perm.controller)).toBe('p2');
    expect(String(perm.owner)).toBe('p2');
    expect(String(perm?.card?.id)).toBe('p2i');
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('skips move_zone for put-into when targeting-dependent', () => {
    const ir = parseOracleTextToIR('Put target creature card from your graveyard into your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.hand).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies move_zone for exiling all creature cards from your hand', () => {
    const ir = parseOracleTextToIR('Exile all creature cards from your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [
            { id: 'h1', name: 'Shock', type_line: 'Instant' },
            { id: 'h2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'h3', name: 'Hill Giant', type_line: 'Creature — Giant' },
          ],
          graveyard: [],
          exile: [{ id: 'e0', name: 'Existing', type_line: 'Sorcery' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.hand.map((c: any) => c.id)).toEqual(['h1']);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['e0', 'h2', 'h3']);
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('skips move_zone for hand moves when targeting-dependent', () => {
    const ir = parseOracleTextToIR('Exile target creature card from your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.hand).toHaveLength(1);
    expect(p1.exile).toHaveLength(0);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('skips move_zone when it is targeting-dependent or otherwise unsupported', () => {
    const ir = parseOracleTextToIR('Return target creature card from your graveyard to your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.hand).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('skips move_zone for exile-from-graveyard when it is targeting-dependent', () => {
    const ir = parseOracleTextToIR('Exile target creature card from your graveyard.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.exile).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
    expect(result.skippedSteps.some(s => s.kind === 'move_zone')).toBe(true);
  });

  it('applies sacrifice when it is deterministic (each opponent sacrifices a creature if they have <= 1 creature)', () => {
    const ir = parseOracleTextToIR('Each opponent sacrifices a creature.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'p2creature',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c2', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'p2artifact',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'a2', name: 'Sol Ring', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Sol Ring');
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('applies sacrifice for defending player via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('Defending player sacrifices a creature.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'p2creature',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c2', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'p2artifact',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'a2', name: 'Sol Ring', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Sol Ring');
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('applies sacrifice for the defending player via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('The defending player sacrifices a creature.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'p2creature',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c2', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
        {
          id: 'p2artifact',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'a2', name: 'Sol Ring', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(1);
    expect(String((result.state.battlefield[0] as any)?.card?.name)).toBe('Sol Ring');
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('skips sacrifice when it requires choice (player controls more than N matching permanents)', () => {
    const ir = parseOracleTextToIR('Each opponent sacrifices a creature.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'p2creature1',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c2a', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
        {
          id: 'p2creature2',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'c2b', name: 'Hill Giant', type_line: 'Creature — Giant' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.state.battlefield).toHaveLength(2);
    expect(p2.graveyard).toHaveLength(0);
    expect(result.skippedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('applies sacrifice for "all artifacts" (you) by moving them to graveyard', () => {
    const ir = parseOracleTextToIR('Sacrifice all artifacts.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
      battlefield: [
        {
          id: 'a1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'solring', name: 'Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'a2',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'mindstone', name: 'Mind Stone', type_line: 'Artifact' },
        },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(result.state.battlefield).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(2);
    expect(result.appliedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('applies sacrifice for "your creatures" (shorthand selector without all/a/an)', () => {
    const ir = parseOracleTextToIR('Sacrifice your creatures.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'a1', controller: 'p1', owner: 'p1', card: { id: 'a1_card', name: 'Sol Ring', type_line: 'Artifact' } },
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(names).toContain('Sol Ring');
    expect(names).toContain('P2 Lion');
    expect(names).not.toContain('P1 Bear');

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('applies sacrifice for "creatures you control" (controller-suffix selector without all/a/an)', () => {
    const ir = parseOracleTextToIR('Sacrifice creatures you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'c1', controller: 'p1', owner: 'p1', card: { id: 'c1_card', name: 'P1 Bear', type_line: 'Creature — Bear' } },
        { id: 'a1', controller: 'p1', owner: 'p1', card: { id: 'a1_card', name: 'Sol Ring', type_line: 'Artifact' } },
        { id: 'c2', controller: 'p2', owner: 'p2', card: { id: 'c2_card', name: 'P2 Lion', type_line: 'Creature — Cat' } },
      ] as any,
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const names = (result.state.battlefield as any[]).map(p => String((p as any)?.card?.name || ''));
    expect(names).toContain('Sol Ring');
    expect(names).toContain('P2 Lion');
    expect(names).not.toContain('P1 Bear');

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'sacrifice')).toBe(true);
  });

  it('applies discard when it is deterministic (discard all cards in hand)', () => {
    const ir = parseOracleTextToIR('Discard two cards.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h1' }, { id: 'h2' }],
          graveyard: [],
        } as any,
      ],
    });
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.hand).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(2);
    expect(result.appliedSteps.some(s => s.kind === 'discard')).toBe(true);
  });

  it('skips discard when it requires a choice (hand has more than N cards)', () => {
    const ir = parseOracleTextToIR('Discard a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h1' }, { id: 'h2' }],
          graveyard: [],
        } as any,
      ],
    });
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.hand).toHaveLength(2);
    expect(p1.graveyard).toHaveLength(0);
    expect(result.skippedSteps.some(s => s.kind === 'discard')).toBe(true);
  });

  it('applies discard for "Discard your hand" (deterministic discard-hand shorthand)', () => {
    const ir = parseOracleTextToIR('Discard your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
          graveyard: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.hand).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(3);
    expect(result.appliedSteps.some(s => s.kind === 'discard')).toBe(true);
  });

  it('applies discard for "Each opponent discards their hand" (deterministic group discard-hand)', () => {
    const ir = parseOracleTextToIR('Each opponent discards their hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h1' }],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [{ id: 'p2h1' }, { id: 'p2h2' }],
          graveyard: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p1.hand).toHaveLength(1);
    expect(p1.graveyard).toHaveLength(0);
    expect(p2.hand).toHaveLength(0);
    expect(p2.graveyard).toHaveLength(2);
    expect(p3.hand).toHaveLength(0);
    expect(p3.graveyard).toHaveLength(0);
    expect(result.appliedSteps.some(s => s.kind === 'discard')).toBe(true);
  });

  it('applies each-player discard when it is deterministic for all players', () => {
    const ir = parseOracleTextToIR('Each player discards a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'p1h1' }],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [{ id: 'p2h1' }],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect(p1.hand).toHaveLength(0);
    expect(p2.hand).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'discard')).toBe(true);
  });

  it('applies mill for you (deterministic)', () => {
    const ir = parseOracleTextToIR('Mill two cards.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
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
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(1);
    expect(p1.graveyard).toHaveLength(2);
    expect(result.appliedSteps.some(s => s.kind === 'mill')).toBe(true);
  });

  it('mills at most library size', () => {
    const ir = parseOracleTextToIR('Mill three cards.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }],
          hand: [],
          graveyard: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.library).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'mill')).toBe(true);
  });

  it('applies each-player mill', () => {
    const ir = parseOracleTextToIR('Each player mills a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.library).toHaveLength(0);
    expect(p2.library).toHaveLength(0);
    expect(p1.graveyard).toHaveLength(1);
    expect(p2.graveyard).toHaveLength(1);
    expect(result.appliedSteps.some(s => s.kind === 'mill')).toBe(true);
  });

  it('applies Trepanation Blade reveal-until-land clause as deterministic mill loop', () => {
    const ir = parseOracleTextToIR(
      'Whenever equipped creature attacks, defending player reveals cards from the top of their library until they reveal a land card. The creature gets +1/+0 until end of turn for each card revealed this way. That player puts the revealed cards into their graveyard.',
      'Trepanation Blade'
    );
    const ability = ir.abilities.find(a => a.type === 'triggered');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Creature — Human' },
            { id: 'p2c2', type_line: 'Instant' },
            { id: 'p2c3', type_line: 'Land' },
            { id: 'p2c4', type_line: 'Sorcery' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'blade1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Trepanation Blade',
          attachedTo: 'attacker1',
          cardType: 'Artifact',
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'attacker1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Equipped Attacker',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: true,
          attacking: 'p2',
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'blade1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const attacker = ((result.state as any).battlefield || []).find((p: any) => p.id === 'attacker1') as any;

    expect(result.appliedSteps.some(s => s.kind === 'mill')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'mill')).toBe(false);
    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4']);
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
    expect(attacker.lastTrepanationBonus).toBe(3);
  });

  it('applies Giant Growth style target creature +3/+3 until end of turn via composable modify_pt', () => {
    const ir = parseOracleTextToIR('Target creature gets +3/+3 until end of turn.', 'Giant Growth');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];
    const ptMod = modifiers.find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(ptMod).toBeTruthy();
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(3);
    expect(ptMod.duration).toBe('end_of_turn');
  });

  it('safely skips modify_pt with unknown for-each scaler', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +1/+1 until end of turn for each opponent you attacked with a creature this combat.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(modifiers.some((m: any) => m?.type === 'powerToughness')).toBe(false);
  });

  it('safely skips modify_pt with condition clause metadata', () => {
    const ir = parseOracleTextToIR(
      'If you control an artifact, target creature gets +2/+2 until end of turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(modifiers.some((m: any) => m?.type === 'powerToughness')).toBe(false);
  });

  it('applies modify_pt when supported if-condition is true (you control an artifact)', () => {
    const ir = parseOracleTextToIR(
      'If you control an artifact, target creature gets +2/+2 until end of turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'artifact1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Relic',
          cardType: 'Artifact',
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];
    const ptMod = modifiers.find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(ptMod).toBeTruthy();
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies modify_pt with supported where-clause condition metadata', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +2/+2 until end of turn where X is the number of artifacts you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'artifact1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Relic',
          cardType: 'Artifact',
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];
    const ptMod = modifiers.find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(ptMod).toBeTruthy();
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt using supported where-clause value resolution', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of artifacts you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'artifact1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Relic A',
          cardType: 'Artifact',
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
        {
          id: 'artifact2',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Relic B',
          cardType: 'Artifact',
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];
    const ptMod = modifiers.find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(ptMod).toBeTruthy();
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt with where-clause cards-in-graveyard evaluation', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of cards in your graveyard.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [{ id: 'g1' }, { id: 'g2' }],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];
    const ptMod = modifiers.find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(ptMod).toBeTruthy();
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt where X is the number of opponents you have', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of opponents you have.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2,
          tapped: false, summoningSick: false, counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt where X is the number of artifacts your opponents control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of artifacts your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppa1', ownerId: 'p2', controller: 'p2', name: 'Opp Relic 1', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppa2', ownerId: 'p3', controller: 'p3', name: 'Opp Relic 2', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt where X is half your life total, rounded up', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is half your life total, rounded up.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 39, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(20);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is that creature\'s power', () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +X/+0 until end of turn where X is that creature's power.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 4, toughness: 2,
          tapped: false, summoningSick: false, counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(4);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of cards exiled with this permanent', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of cards exiled with this permanent.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [],
          exile: [
            { id: 'ex1', exiledBy: 'src-where' },
            { id: 'ex2', exiledBy: 'src-where' },
            { id: 'ex3', exiledBy: 'other-src' },
          ],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2,
          tapped: false, summoningSick: false, counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'src-where' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt where X is the number of creature cards in your graveyard', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of creature cards in your graveyard.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [
            { id: 'g1', type_line: 'Creature — Elf' },
            { id: 'g2', type_line: 'Instant' },
            { id: 'g3', type_line: 'Creature — Human' },
          ],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2,
          tapped: false, summoningSick: false, counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(2);
  });

  it('applies X-based modify_pt where X is one plus the number of artifacts you control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is one plus the number of artifacts you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'a1', ownerId: 'p1', controller: 'p1', name: 'Relic', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is twice the number of artifacts your opponents control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is twice the number of artifacts your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oa1', ownerId: 'p2', controller: 'p2', name: 'Opp Relic 1', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oa2', ownerId: 'p2', controller: 'p2', name: 'Opp Relic 2', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(4);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of artifacts on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of artifacts on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'a1', ownerId: 'p2', controller: 'p2', name: 'Relic', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'a2', ownerId: 'p1', controller: 'p1', name: 'Bauble', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of cards in your hand minus 1', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of cards in your hand minus 1.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
          graveyard: [],
          exile: [],
        } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is your life total', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is your life total.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 17, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(17);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among creatures you control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the greatest power among creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Big', cardType: 'Creature', power: 5, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifact1', ownerId: 'p1', controller: 'p1', name: 'Relic', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(5);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the greatest mana value among permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppPerm1', ownerId: 'p2', controller: 'p2', name: 'Relic', cardType: 'Artifact', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppPerm2', ownerId: 'p2', controller: 'p2', name: 'Titanic Ward', cardType: 'Enchantment', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'blade1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'creature1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature1', ownerId: 'p2', controller: 'p2', name: 'Opp One', cardType: 'Creature', power: 3, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature2', ownerId: 'p2', controller: 'p2', name: 'Opp Two', cardType: 'Creature', power: 1, toughness: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'blade1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among creatures your opponents control with target creature you control selector', () => {
    const ir = parseOracleTextToIR(
      'Target creature you control gets +X/+0 until end of turn where X is the greatest toughness among creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature1', ownerId: 'p2', controller: 'p2', name: 'Opp One', cardType: 'Creature', power: 3, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature2', ownerId: 'p2', controller: 'p2', name: 'Opp Two', cardType: 'Creature', power: 1, toughness: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt with target creature your opponents control selector', () => {
    const ir = parseOracleTextToIR(
      'Target creature your opponents control gets +X/+0 until end of turn where X is the greatest power among creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'p1Creature1', ownerId: 'p1', controller: 'p1', name: 'Big Ally', cardType: 'Creature', power: 5, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'p1Creature2', ownerId: 'p1', controller: 'p1', name: 'Small Ally', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature1', ownerId: 'p2', controller: 'p2', name: 'Target Opponent Creature', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'oppCreature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(5);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt with target creature an opponent controls selector', () => {
    const ir = parseOracleTextToIR(
      'Target creature an opponent controls gets +X/+0 until end of turn where X is the greatest power among creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'p1Creature1', ownerId: 'p1', controller: 'p1', name: 'Big Ally', cardType: 'Creature', power: 6, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature1', ownerId: 'p2', controller: 'p2', name: 'Target Opponent Creature', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'oppCreature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(6);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'Target creature your opponents control gets +X/+0 until end of turn where X is the greatest power among creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppCreature1', ownerId: 'p2', controller: 'p2', name: 'Opp Big Power', cardType: 'Creature', power: 8, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'oppCreature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among other creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among other creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eq1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'target1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'target1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'ally1', ownerId: 'p1', controller: 'p1', name: 'Ally One', cardType: 'Creature', power: 3, toughness: 6, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'ally2', ownerId: 'p1', controller: 'p1', name: 'Ally Two', cardType: 'Creature', power: 1, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eq1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'target1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(6);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among other creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest power among other creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOpp1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'oppTarget', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'p1Creature1', ownerId: 'p1', controller: 'p1', name: 'Ally', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppTarget', ownerId: 'p2', controller: 'p2', name: 'Target Opponent Creature', cardType: 'Creature', power: 9, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppOther1', ownerId: 'p2', controller: 'p2', name: 'Other Opponent Creature', cardType: 'Creature', power: 6, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppOther2', ownerId: 'p2', controller: 'p2', name: 'Other Opponent Creature 2', cardType: 'Creature', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqOpp1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'oppTarget') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(6);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among other permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among other permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqSelf1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetSelf1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetSelf1', ownerId: 'p1', controller: 'p1', name: 'Target Creature', cardType: 'Creature', manaValue: 9, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyPerm1', ownerId: 'p1', controller: 'p1', name: 'Ally Perm 1', cardType: 'Artifact', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyPerm2', ownerId: 'p1', controller: 'p1', name: 'Ally Perm 2', cardType: 'Enchantment', manaValue: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqSelf1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetSelf1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among other permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among other permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOpp2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetOpp2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOpp2', ownerId: 'p2', controller: 'p2', name: 'Target Opponent Creature', cardType: 'Creature', manaValue: 11, power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppPermA', ownerId: 'p2', controller: 'p2', name: 'Opponent Perm A', cardType: 'Artifact', manaValue: 8, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppPermB', ownerId: 'p2', controller: 'p2', name: 'Opponent Perm B', cardType: 'Enchantment', manaValue: 6, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqOpp2',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOpp2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqBattle1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetBattle1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetBattle1', ownerId: 'p1', controller: 'p1', name: 'Target Creature', cardType: 'Creature', manaValue: 9, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyBattle1', ownerId: 'p1', controller: 'p1', name: 'Ally Permanent', cardType: 'Enchantment', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppBattle1', ownerId: 'p2', controller: 'p2', name: 'Opponent Permanent', cardType: 'Artifact', manaValue: 12, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqBattle1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetBattle1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(12);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among other permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among other permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqBattle2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 2, attachedTo: 'targetBattle2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetBattle2', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 15, power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyBattle2', ownerId: 'p1', controller: 'p1', name: 'Ally Permanent', cardType: 'Enchantment', manaValue: 8, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppBattle2', ownerId: 'p2', controller: 'p2', name: 'Opponent Permanent', cardType: 'Artifact', manaValue: 6, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqBattle2',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetBattle2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest power among creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqGlobalPower1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetGlobalPower1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetGlobalPower1', ownerId: 'p1', controller: 'p1', name: 'Target Creature', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyGlobalPower1', ownerId: 'p1', controller: 'p1', name: 'Ally Creature', cardType: 'Creature', power: 7, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppGlobalPower1', ownerId: 'p2', controller: 'p2', name: 'Opponent Creature', cardType: 'Creature', power: 11, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqGlobalPower1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetGlobalPower1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(11);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among other creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among other creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqGlobalTough1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetGlobalTough1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetGlobalTough1', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', power: 9, toughness: 13, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyGlobalTough1', ownerId: 'p1', controller: 'p1', name: 'Ally Creature', cardType: 'Creature', power: 4, toughness: 8, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppGlobalTough1', ownerId: 'p2', controller: 'p2', name: 'Opponent Creature', cardType: 'Creature', power: 3, toughness: 6, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqGlobalTough1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetGlobalTough1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among non-Human creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest power among non-Human creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNH1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNH1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNH1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonHumanBig1', ownerId: 'p1', controller: 'p1', name: 'Non-Human Big', cardType: 'Creature', type_line: 'Creature — Beast', power: 7, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanBig1', ownerId: 'p1', controller: 'p1', name: 'Human Big', cardType: 'Creature Human', type_line: 'Creature — Human Knight', power: 10, toughness: 10, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNH1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNH1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among non-Human creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among non-Human creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNH2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'oppTargetNH1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'p1Support1', ownerId: 'p1', controller: 'p1', name: 'Support', cardType: 'Creature', type_line: 'Creature — Elf', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppTargetNH1', ownerId: 'p2', controller: 'p2', name: 'Target Opponent Creature', cardType: 'Creature', type_line: 'Creature — Beast', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppNonHumanBig1', ownerId: 'p2', controller: 'p2', name: 'Non-Human Big', cardType: 'Creature', type_line: 'Creature — Zombie', power: 3, toughness: 8, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHumanBig1', ownerId: 'p2', controller: 'p2', name: 'Human Big', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 9, toughness: 12, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNH2',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'oppTargetNH1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among other non-Human creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest power among other non-Human creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqONH1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetONH1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetONH1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Beast', power: 9, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'otherNonHumanONH1', ownerId: 'p1', controller: 'p1', name: 'Other Non-Human', cardType: 'Creature', type_line: 'Creature — Elf', power: 6, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanONH1', ownerId: 'p1', controller: 'p1', name: 'Human', cardType: 'Creature Human', type_line: 'Creature — Human Knight', power: 11, toughness: 11, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqONH1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetONH1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(6);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among other non-Human creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among other non-Human creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqONH2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetONH2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetONH2', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Beast', power: 3, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'otherNonHumanONH2', ownerId: 'p2', controller: 'p2', name: 'Other Non-Human', cardType: 'Creature', type_line: 'Creature — Zombie', power: 2, toughness: 7, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanONH2', ownerId: 'p2', controller: 'p2', name: 'Human', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 9, toughness: 12, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqONH2',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetONH2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among nonartifact creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest power among nonartifact creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNA1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNA1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNA1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactCreatureNA1', ownerId: 'p1', controller: 'p1', name: 'Artifact Creature', cardType: 'Artifact Creature', type_line: 'Artifact Creature — Golem', power: 12, toughness: 12, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactCreatureNA1', ownerId: 'p1', controller: 'p1', name: 'Nonartifact Creature', cardType: 'Creature', type_line: 'Creature — Beast', power: 7, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNA1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNA1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among other nonland creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among other nonland creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNL1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNL1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNL1', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Beast', power: 3, toughness: 10, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'landCreatureNL1', ownerId: 'p1', controller: 'p1', name: 'Land Creature', cardType: 'Land Creature', type_line: 'Land Creature — Dryad', power: 2, toughness: 15, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonLandCreatureNL1', ownerId: 'p2', controller: 'p2', name: 'Nonland Creature', cardType: 'Creature', type_line: 'Creature — Zombie', power: 4, toughness: 8, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNL1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNL1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among nonartifact permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among nonartifact permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNAP1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetNAP1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNAP1', ownerId: 'p1', controller: 'p1', name: 'Target Creature', cardType: 'Creature', manaValue: 2, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactNAP1', ownerId: 'p1', controller: 'p1', name: 'Big Artifact', cardType: 'Artifact', manaValue: 12, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactNAP1', ownerId: 'p1', controller: 'p1', name: 'Big Enchantment', cardType: 'Enchantment', manaValue: 8, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNAP1',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNAP1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of nonartifact creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of nonartifact creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqNC1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactCreatureNC1', ownerId: 'p1', controller: 'p1', name: 'Artifact Creature', cardType: 'Artifact Creature', type_line: 'Artifact Creature — Golem', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'plainCreatureNC1', ownerId: 'p1', controller: 'p1', name: 'Plain Creature', cardType: 'Creature', type_line: 'Creature — Beast', power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of other nonhuman creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of other nonhuman creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNC2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC2', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Zombie', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'otherNonHumanNC2', ownerId: 'p2', controller: 'p2', name: 'Other Nonhuman', cardType: 'Creature', type_line: 'Creature — Beast', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanNC2', ownerId: 'p2', controller: 'p2', name: 'Human', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 9, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC2' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of nonartifact permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of nonartifact permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNC3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC3', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC3', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactNC3', ownerId: 'p2', controller: 'p2', name: 'Artifact', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactNC3A', ownerId: 'p1', controller: 'p1', name: 'Enchantment', cardType: 'Enchantment', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactNC3B', ownerId: 'p2', controller: 'p2', name: 'Land', cardType: 'Land', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC3' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of other nonland creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of other nonland creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNC4', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC4', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC4', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Beast', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'otherNonlandCreatureNC4', ownerId: 'p2', controller: 'p2', name: 'Other Nonland Creature', cardType: 'Creature', type_line: 'Creature — Zombie', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'landCreatureNC4', ownerId: 'p2', controller: 'p2', name: 'Land Creature', cardType: 'Land Creature', type_line: 'Land Creature — Elemental', power: 8, toughness: 8, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC4' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC4') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of other nonartifact permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of other nonartifact permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqNC5', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC5', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC5', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactPermNC5', ownerId: 'p1', controller: 'p1', name: 'Artifact', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactPermNC5', ownerId: 'p1', controller: 'p1', name: 'Enchantment', cardType: 'Enchantment', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC5' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC5') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of other nonartifact permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of other nonartifact permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNC6', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC6', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC6', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Zombie', power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppArtifactPermNC6', ownerId: 'p2', controller: 'p2', name: 'Opp Artifact', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppNonArtifactPermNC6', ownerId: 'p2', controller: 'p2', name: 'Opp Enchantment', cardType: 'Enchantment', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC6' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC6') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X uses hyphenated non-human count wording', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of non-human creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqNC7', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC7', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC7', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Zombie', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'otherNonHumanNC7', ownerId: 'p1', controller: 'p1', name: 'Other Nonhuman', cardType: 'Creature', type_line: 'Creature — Beast', power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanNC7', ownerId: 'p1', controller: 'p1', name: 'Human', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 9, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC7' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC7') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X uses spaced non human count wording', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of non human creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNC8', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC8', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC8', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Zombie', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'otherNonHumanNC8', ownerId: 'p2', controller: 'p2', name: 'Other Nonhuman', cardType: 'Creature', type_line: 'Creature — Beast', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanNC8', ownerId: 'p2', controller: 'p2', name: 'Human', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 9, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC8' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC8') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X uses spaced non artifact permanent wording', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the number of non artifact permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNC9', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNC9', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNC9', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactNC9', ownerId: 'p2', controller: 'p2', name: 'Artifact', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactNC9A', ownerId: 'p1', controller: 'p1', name: 'Enchantment', cardType: 'Enchantment', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactNC9B', ownerId: 'p2', controller: 'p2', name: 'Land', cardType: 'Land', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqNC9' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNC9') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least power among creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least power among creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 5, toughness: 5, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'smallLeast1', ownerId: 'p1', controller: 'p1', name: 'Small', cardType: 'Creature', power: 1, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'bigLeast1', ownerId: 'p1', controller: 'p1', name: 'Big', cardType: 'Creature', power: 8, toughness: 8, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least toughness among creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least toughness among creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast2', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppSmallLeast2', ownerId: 'p2', controller: 'p2', name: 'Opp Small', cardType: 'Creature', power: 7, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppBigLeast2', ownerId: 'p2', controller: 'p2', name: 'Opp Big', cardType: 'Creature', power: 2, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast2' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least power among creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least power among creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast3', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast3', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 5, toughness: 5, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppSmallLeast3', ownerId: 'p2', controller: 'p2', name: 'Opp Small', cardType: 'Creature', power: 0, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppBigLeast3', ownerId: 'p2', controller: 'p2', name: 'Opp Big', cardType: 'Creature', power: 6, toughness: 6, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast3' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(0);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the lowest mana value among permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest mana value among permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast4', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 3, attachedTo: 'targetLeast4', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast4', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 5, power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'permLowLeast4', ownerId: 'p1', controller: 'p1', name: 'Low Perm', cardType: 'Enchantment', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'permHighLeast4', ownerId: 'p1', controller: 'p1', name: 'High Perm', cardType: 'Artifact', manaValue: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast4' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast4') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the lowest mana value among permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest mana value among permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast5', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast5', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast5', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLowLeast5', ownerId: 'p2', controller: 'p2', name: 'Opp Low', cardType: 'Enchantment', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHighLeast5', ownerId: 'p2', controller: 'p2', name: 'Opp High', cardType: 'Artifact', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast5' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast5') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the lowest mana value among permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest mana value among permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast6', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast6', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast6', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 4, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyLeast6', ownerId: 'p1', controller: 'p1', name: 'Ally Perm', cardType: 'Enchantment', manaValue: 6, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLeast6', ownerId: 'p2', controller: 'p2', name: 'Opp Perm', cardType: 'Artifact', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast6' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast6') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least toughness among other creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least toughness among other creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast7', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast7', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast7', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 9, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'smallLeast7', ownerId: 'p1', controller: 'p1', name: 'Small', cardType: 'Creature', power: 1, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'bigLeast7', ownerId: 'p1', controller: 'p1', name: 'Big', cardType: 'Creature', power: 5, toughness: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast7' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast7') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least power among other creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least power among other creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast8', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast8', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast8', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', power: 9, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppSmallLeast8', ownerId: 'p2', controller: 'p2', name: 'Opp Small', cardType: 'Creature', power: 1, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppBigLeast8', ownerId: 'p2', controller: 'p2', name: 'Opp Big', cardType: 'Creature', power: 6, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast8' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast8') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least power among nonhuman creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least power among nonhuman creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast9', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast9', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast9', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 7, toughness: 7, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonHumanSmallLeast9', ownerId: 'p1', controller: 'p1', name: 'Nonhuman Small', cardType: 'Creature', type_line: 'Creature — Beast', power: 1, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanLeast9', ownerId: 'p1', controller: 'p1', name: 'Human', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 0, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast9' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast9') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the least toughness among other non-Human creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the least toughness among other non-Human creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast10', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast10', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast10', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Beast', power: 5, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppNonHumanSmallLeast10', ownerId: 'p2', controller: 'p2', name: 'Opp Nonhuman Small', cardType: 'Creature', type_line: 'Creature — Zombie', power: 3, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHumanLeast10', ownerId: 'p2', controller: 'p2', name: 'Opp Human', cardType: 'Creature Human', type_line: 'Creature — Human Knight', power: 2, toughness: 0, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast10' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast10') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the lowest mana value among other permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest mana value among other permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast11', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 3, attachedTo: 'targetLeast11', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast11', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 10, power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'allyLeast11', ownerId: 'p1', controller: 'p1', name: 'Ally Perm', cardType: 'Enchantment', manaValue: 6, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLeast11', ownerId: 'p2', controller: 'p2', name: 'Opp Perm', cardType: 'Artifact', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast11' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast11') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the lowest mana value among nonartifact permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest mana value among nonartifact permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast12', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast12', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast12', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 8, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactLeast12', ownerId: 'p1', controller: 'p1', name: 'Artifact', cardType: 'Artifact', manaValue: 0, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactLeast12A', ownerId: 'p1', controller: 'p1', name: 'Nonartifact A', cardType: 'Enchantment', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactLeast12B', ownerId: 'p1', controller: 'p1', name: 'Nonartifact B', cardType: 'Creature', manaValue: 5, power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast12' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast12') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the lowest mana value among other nonland permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest mana value among other nonland permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast13', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast13', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast13', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', manaValue: 9, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLandLeast13', ownerId: 'p2', controller: 'p2', name: 'Opp Land', cardType: 'Land', manaValue: 0, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppNonlandLeast13A', ownerId: 'p2', controller: 'p2', name: 'Opp Nonland A', cardType: 'Artifact', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppNonlandLeast13B', ownerId: 'p2', controller: 'p2', name: 'Opp Nonland B', cardType: 'Enchantment', manaValue: 3, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast13' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast13') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X uses lowest-power synonym among creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the lowest power among creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast14', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast14', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast14', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 7, toughness: 7, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'smallLeast14', ownerId: 'p1', controller: 'p1', name: 'Small', cardType: 'Creature', power: 1, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast14' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast14') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is one plus the lowest mana value among permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is one plus the lowest mana value among permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast15', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 3, attachedTo: 'targetLeast15', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast15', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 8, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'lowLeast15', ownerId: 'p2', controller: 'p2', name: 'Low', cardType: 'Artifact', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'highLeast15', ownerId: 'p1', controller: 'p1', name: 'High', cardType: 'Enchantment', manaValue: 6, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast15' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast15') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is twice the least toughness among creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is twice the least toughness among creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast16', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast16', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast16', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLeast16A', ownerId: 'p2', controller: 'p2', name: 'Opp A', cardType: 'Creature', power: 4, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLeast16B', ownerId: 'p2', controller: 'p2', name: 'Opp B', cardType: 'Creature', power: 8, toughness: 5, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast16' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast16') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is half the lowest mana value among permanents you control, rounded down', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is half the lowest mana value among permanents you control, rounded down.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqLeast17', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 3, attachedTo: 'targetLeast17', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast17', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 7, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'lowLeast17', ownerId: 'p1', controller: 'p1', name: 'Low', cardType: 'Enchantment', manaValue: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'highLeast17', ownerId: 'p1', controller: 'p1', name: 'High', cardType: 'Artifact', manaValue: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast17' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast17') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is half the least power among creatures on the battlefield, rounded up', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is half the least power among creatures on the battlefield, rounded up.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqLeast18', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetLeast18', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetLeast18', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 8, toughness: 8, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'lowLeast18', ownerId: 'p2', controller: 'p2', name: 'Low', cardType: 'Creature', power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'highLeast18', ownerId: 'p1', controller: 'p1', name: 'High', cardType: 'Creature', power: 9, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqLeast18' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetLeast18') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the highest power among creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the highest power among creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqHighest1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetHighest1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetHighest1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'bigHighest1', ownerId: 'p1', controller: 'p1', name: 'Big', cardType: 'Creature', power: 7, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'smallHighest1', ownerId: 'p1', controller: 'p1', name: 'Small', cardType: 'Creature', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqHighest1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetHighest1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(7);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is one plus the highest mana value among permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is one plus the highest mana value among permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqHighest2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetHighest2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetHighest2', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 2, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'midHighest2', ownerId: 'p2', controller: 'p2', name: 'Mid', cardType: 'Enchantment', manaValue: 5, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'bigHighest2', ownerId: 'p1', controller: 'p1', name: 'Big', cardType: 'Artifact', manaValue: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqHighest2' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetHighest2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(10);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the highest mana value among other nonartifact permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the highest mana value among other nonartifact permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqHighest3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetHighest3', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetHighest3', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 10, power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactHighest3', ownerId: 'p1', controller: 'p1', name: 'Big Artifact', cardType: 'Artifact', manaValue: 15, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'enchantmentHighest3', ownerId: 'p2', controller: 'p2', name: 'Big Enchantment', cardType: 'Enchantment', manaValue: 8, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqHighest3',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetHighest3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the smallest toughness among creatures your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the smallest toughness among creatures your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqSmallest1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetSmallest1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetSmallest1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppSmallest1A', ownerId: 'p2', controller: 'p2', name: 'Opp A', cardType: 'Creature', power: 6, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppSmallest1B', ownerId: 'p2', controller: 'p2', name: 'Opp B', cardType: 'Creature', power: 4, toughness: 5, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqSmallest1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetSmallest1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is twice the smallest mana value among permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is twice the smallest mana value among permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqSmallest2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 2, attachedTo: 'targetSmallest2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetSmallest2', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 8, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'lowSmallest2', ownerId: 'p1', controller: 'p1', name: 'Low', cardType: 'Enchantment', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'highSmallest2', ownerId: 'p1', controller: 'p1', name: 'High', cardType: 'Artifact', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqSmallest2' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetSmallest2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(4);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the smallest mana value among other nonland permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the smallest mana value among other nonland permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqSmallest3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetSmallest3', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetSmallest3', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 6, power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'landSmallest3', ownerId: 'p2', controller: 'p2', name: 'Big Land', cardType: 'Land', manaValue: 0, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'smallestNonland3', ownerId: 'p2', controller: 'p2', name: 'Small Enchantment', cardType: 'Enchantment', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'biggerNonland3', ownerId: 'p1', controller: 'p1', name: 'Big Artifact', cardType: 'Artifact', manaValue: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqSmallest3',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetSmallest3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the highest converted mana cost among permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the highest converted mana cost among permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqCmc1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetCmc1', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetCmc1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 3, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'highCmc1', ownerId: 'p2', controller: 'p2', name: 'High', cardType: 'Enchantment', manaValue: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqCmc1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetCmc1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(9);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is one plus the highest converted mana cost among permanents you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is one plus the highest converted mana cost among permanents you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any],
      battlefield: [
        { id: 'eqCmc2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetCmc2', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetCmc2', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 4, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'highCmc2', ownerId: 'p1', controller: 'p1', name: 'High', cardType: 'Artifact', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqCmc2' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetCmc2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the smallest converted mana cost among nonartifact permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the smallest converted mana cost among nonartifact permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqCmc3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetCmc3', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetCmc3', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 6, power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppArtifactCmc3', ownerId: 'p2', controller: 'p2', name: 'Artifact', cardType: 'Artifact', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppEnchantmentCmc3', ownerId: 'p2', controller: 'p2', name: 'Enchantment', cardType: 'Enchantment', manaValue: 3, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqCmc3',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetCmc3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the highest power among creatures you don\'t control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the highest power among creatures you don\'t control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetOppAlias1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias1', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHigh1', ownerId: 'p2', controller: 'p2', name: 'Opp High', cardType: 'Creature', power: 8, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLow1', ownerId: 'p2', controller: 'p2', name: 'Opp Low', cardType: 'Creature', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the smallest toughness among creatures an opponent controls', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the smallest toughness among creatures an opponent controls.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias2', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetOppAlias2', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias2', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppA2', ownerId: 'p2', controller: 'p2', name: 'Opp A', cardType: 'Creature', power: 5, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppB2', ownerId: 'p2', controller: 'p2', name: 'Opp B', cardType: 'Creature', power: 3, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias2' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias2') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is one plus the highest converted mana cost among permanents you don\'t control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is one plus the highest converted mana cost among permanents you don\'t control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetOppAlias3', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias3', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 4, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHighCmc3', ownerId: 'p2', controller: 'p2', name: 'Opp High', cardType: 'Artifact', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias3' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the highest power among creatures you do not control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the highest power among creatures you do not control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias4', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetOppAlias4', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias4', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHigh4', ownerId: 'p2', controller: 'p2', name: 'Opp High', cardType: 'Creature', power: 9, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias4' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias4') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(9);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the smallest converted mana cost among permanents you do not control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the smallest converted mana cost among permanents you do not control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias5', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetOppAlias5', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias5', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', manaValue: 4, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLow5', ownerId: 'p2', controller: 'p2', name: 'Opp Low', cardType: 'Enchantment', manaValue: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHigh5', ownerId: 'p2', controller: 'p2', name: 'Opp High', cardType: 'Artifact', manaValue: 7, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias5' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias5') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the highest power among other creatures you do not control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the highest power among other creatures you do not control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias6', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetOppAlias6', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias6', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', power: 10, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppHigh6', ownerId: 'p2', controller: 'p2', name: 'Opp High', cardType: 'Creature', power: 6, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppLow6', ownerId: 'p2', controller: 'p2', name: 'Opp Low', cardType: 'Creature', power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias6' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias6') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(6);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the smallest converted mana cost among other nonartifact permanents an opponent controls', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the smallest converted mana cost among other nonartifact permanents an opponent controls.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqOppAlias7', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetOppAlias7', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetOppAlias7', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 1, power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppArtifact7', ownerId: 'p2', controller: 'p2', name: 'Opp Artifact', cardType: 'Artifact', manaValue: 1, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'oppEnchantment7', ownerId: 'p2', controller: 'p2', name: 'Opp Enchantment', cardType: 'Enchantment', manaValue: 3, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eqOppAlias7' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetOppAlias7') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among nonland permanents your opponents control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among nonland permanents your opponents control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNLP1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetNLP1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNLP1', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 3, power: 3, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'landNLP1', ownerId: 'p2', controller: 'p2', name: 'Big Land', cardType: 'Land', manaValue: 15, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonLandNLP1', ownerId: 'p2', controller: 'p2', name: 'Big Nonland', cardType: 'Artifact', manaValue: 9, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNLP1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNLP1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(9);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest mana value among other nonartifact permanents on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest mana value among other nonartifact permanents on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqONAP1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', manaValue: 1, attachedTo: 'targetONAP1', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetONAP1', ownerId: 'p2', controller: 'p2', name: 'Target Creature', cardType: 'Creature', manaValue: 10, power: 4, toughness: 4, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifactONAP1', ownerId: 'p1', controller: 'p1', name: 'Big Artifact', cardType: 'Artifact', manaValue: 14, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonArtifactONAP1', ownerId: 'p2', controller: 'p2', name: 'Big Enchantment', cardType: 'Enchantment', manaValue: 8, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqONAP1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetONAP1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(8);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest power among nonhuman creatures you control', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest power among nonhuman creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNH3', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNH3', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNH3', ownerId: 'p1', controller: 'p1', name: 'Target', cardType: 'Creature', type_line: 'Creature — Elf', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonHumanBig3', ownerId: 'p1', controller: 'p1', name: 'Nonhuman Big', cardType: 'Creature', type_line: 'Creature — Beast', power: 6, toughness: 3, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanBig3', ownerId: 'p1', controller: 'p1', name: 'Human Big', cardType: 'Creature Human', type_line: 'Creature — Human Knight', power: 11, toughness: 11, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNH3',
      selectorContext: { targetPlayerId: 'p1' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNH3') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(6);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the greatest toughness among non-Human creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'The creature gets +X/+0 until end of turn where X is the greatest toughness among non-Human creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'eqNH4', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact', attachedTo: 'targetNH4', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'targetNH4', ownerId: 'p2', controller: 'p2', name: 'Target', cardType: 'Creature', type_line: 'Creature — Beast', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'nonHumanBig4', ownerId: 'p1', controller: 'p1', name: 'Nonhuman Big', cardType: 'Creature', type_line: 'Creature — Dragon', power: 4, toughness: 9, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'humanBig4', ownerId: 'p2', controller: 'p2', name: 'Human Big', cardType: 'Creature Human', type_line: 'Creature — Human Soldier', power: 8, toughness: 13, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'eqNH4',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'targetNH4') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(9);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of creature cards in all graveyards', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of creature cards in all graveyards.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [{ id: 'g1', type_line: 'Creature — Elf' }, { id: 'g2', type_line: 'Instant' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [{ id: 'g3', type_line: 'Creature — Human' }],
          exile: [],
        } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of cards in that player\'s graveyard', () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +X/+0 until end of turn where X is the number of cards in that player's graveyard.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }],
          exile: [],
        } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of creature cards in their graveyard', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of creature cards in their graveyard.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [{ id: 'g1', type_line: 'Creature — Elf' }, { id: 'g2', type_line: 'Instant' }, { id: 'g3', type_line: 'Creature — Human' }],
          exile: [],
        } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is this permanent\'s power', () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +X/+0 until end of turn where X is this permanent's power.",
      'Test Creature'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Creature', cardType: 'Creature', power: 4, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'creature1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(4);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt for Consuming Aberration style opponents-graveyards wording', () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +X/+X until end of turn where X is the number of cards in your opponents' graveyards.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [{ id: 'self1' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [{ id: 'g1' }, { id: 'g2' }],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }],
          hand: [],
          graveyard: [{ id: 'g3' }],
          exile: [],
        } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(3);
  });

  it('applies X-based modify_pt where X is the number of cards in all players\' hands', () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +X/+0 until end of turn where X is the number of cards in all players' hands.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [{ id: 'h1' }, { id: 'h2' }], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [{ id: 'h3' }], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of cards in your opponents\' hands', () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +X/+0 until end of turn where X is the number of cards in your opponents' hands.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [{ id: 'self1' }, { id: 'self2' }], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [{ id: 'opp1' }], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [{ id: 'opp2' }, { id: 'opp3' }], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'creature1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(3);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of other creatures on the battlefield', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of other creatures on the battlefield.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'source1', ownerId: 'p1', controller: 'p1', name: 'Source Relic', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'target1', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'artifact1', ownerId: 'p1', controller: 'p1', name: 'Relic', cardType: 'Artifact', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'source1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'target1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of tapped creatures you control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of tapped creatures you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'target1', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: true, summoningSick: false, counters: {} } as any,
        { id: 'artifact1', ownerId: 'p1', controller: 'p1', name: 'Relic', cardType: 'Artifact', tapped: true, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'target1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is the number of basic land types among lands you control', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is the number of basic land types among lands you control.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'target1', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'land1', ownerId: 'p1', controller: 'p1', name: 'Tropical', type_line: 'Land — Forest Island', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'land2', ownerId: 'p1', controller: 'p1', name: 'Badlands', type_line: 'Land — Swamp Mountain', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'land3', ownerId: 'p1', controller: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'target1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(5);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is your devotion to blue', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is your devotion to blue.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'target1', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', manaCost: '{2}{U}', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'perm1', ownerId: 'p1', controller: 'p1', name: 'Mind Relic', cardType: 'Artifact', manaCost: '{1}{U}{U}', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'perm2', ownerId: 'p1', controller: 'p1', name: 'Hybrid Matrix', cardType: 'Artifact', manaCost: '{U/B}{U/B}', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'target1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(5);
    expect(ptMod.toughness).toBe(0);
  });

  it('applies X-based modify_pt where X is your devotion to black', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+0 until end of turn where X is your devotion to black.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        { id: 'target1', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', manaCost: '{1}{B}', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'perm1', ownerId: 'p1', controller: 'p1', name: 'Dark Relic', cardType: 'Artifact', manaCost: '{B}{B}', tapped: false, summoningSick: false, counters: {} } as any,
        { id: 'perm2', ownerId: 'p1', controller: 'p1', name: 'Hybrid Matrix', cardType: 'Artifact', manaCost: '{U/B}', tapped: false, summoningSick: false, counters: {} } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'target1') as any;
    const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(ptMod.power).toBe(4);
    expect(ptMod.toughness).toBe(0);
  });

  it('safely skips modify_pt with still-unsupported where expression', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets +X/+X until end of turn where X is the number of cards named Forest in your graveyard.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [{ id: 'g1' }, { id: 'g2' }],
          exile: [],
        } as any,
      ],
      battlefield: [
        {
          id: 'creature1',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Test Bear',
          cardType: 'Creature',
          power: 2,
          toughness: 2,
          tapped: false,
          summoningSick: false,
          counters: {},
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'creature1') as any;
    const modifiers = Array.isArray(creature?.modifiers) ? creature.modifiers : [];

    expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
    expect(modifiers.some((m: any) => m?.type === 'powerToughness')).toBe(false);
  });

  it('applies Undercity Informer activated reveal-until-land clause as deterministic mill loop', () => {
    const ir = parseOracleTextToIR(
      '{1}, Sacrifice a creature: Target player reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.',
      'Undercity Informer'
    );
    const ability = ir.abilities.find(a => a.type === 'activated');
    const steps = ability?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [
            { id: 'p2c1', type_line: 'Creature — Human' },
            { id: 'p2c2', type_line: 'Instant' },
            { id: 'p2c3', type_line: 'Land' },
            { id: 'p2c4', type_line: 'Sorcery' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'mill')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'mill')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4']);
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
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

  it('creates a Treasure token for each player', () => {
    const ir = parseOracleTextToIR('Each player creates a Treasure token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    const byController = result.state.battlefield.reduce(
      (acc: Record<string, number>, perm: any) => {
        acc[String(perm.controller)] = (acc[String(perm.controller)] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    expect(byController['p1']).toBe(1);
    expect(byController['p2']).toBe(1);
    expect(result.appliedSteps.some(s => s.kind === 'create_token')).toBe(true);
  });

  it('creates a Treasure token for each opponent', () => {
    const ir = parseOracleTextToIR('Each opponent creates a Treasure token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    const controllers = result.state.battlefield.map((p: any) => p.controller).sort();
    expect(controllers).toEqual(['p2', 'p3']);
    expect(result.appliedSteps.some(s => s.kind === 'create_token')).toBe(true);
  });

  it('creates a Treasure token for defending player via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('Defending player creates a Treasure token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceName: 'Test',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.controller).toBe('p2');
    expect((token.card?.name || '').toLowerCase()).toContain('treasure');
    expect(result.appliedSteps.some(s => s.kind === 'create_token')).toBe(true);
  });

  it('creates a Treasure token for the defending player via target_opponent selector context binding', () => {
    const ir = parseOracleTextToIR('The defending player creates a Treasure token.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceName: 'Test',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.controller).toBe('p2');
    expect((token.card?.name || '').toLowerCase()).toContain('treasure');
    expect(result.appliedSteps.some(s => s.kind === 'create_token')).toBe(true);
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

  it('creates a tapped token when oracle uses a follow-up "enters tapped" clause', () => {
    const ir = parseOracleTextToIR('Create a Treasure token. It enters tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.tapped).toBe(true);
  });

  it('creates multiple tapped tokens when oracle uses a follow-up "They enter tapped" clause', () => {
    const ir = parseOracleTextToIR('Create two Treasure tokens. They enter tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(perm.isToken).toBe(true);
      expect(perm.tapped).toBe(true);
      expect(String(perm.card?.name || '').toLowerCase()).toContain('treasure');
    }
  });

  it('creates tapped tokens for multi-token creation with follow-up "They enter tapped" clause', () => {
    const ir = parseOracleTextToIR('Create a Treasure token and a Clue token. They enter tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    const names = result.state.battlefield.map((p: any) => String(p?.card?.name || '').toLowerCase());
    expect(names.some(n => n.includes('treasure'))).toBe(true);
    expect(names.some(n => n.includes('clue'))).toBe(true);
    for (const perm of result.state.battlefield as any[]) {
      expect(perm.isToken).toBe(true);
      expect(perm.tapped).toBe(true);
    }
  });

  it('creates multiple tokens with counters when oracle uses plural follow-up counters wording', () => {
    const ir = parseOracleTextToIR('Create two Treasure tokens. They enter with two +1/+1 counters on them.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(perm.isToken).toBe(true);
      expect(perm.counters?.['+1/+1']).toBe(2);
    }
  });

  it('creates multiple tapped tokens with counters for combined plural follow-up modifiers', () => {
    const ir = parseOracleTextToIR(
      'Create two Treasure tokens. They enter tapped and with two +1/+1 counters on them.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(perm.isToken).toBe(true);
      expect(perm.tapped).toBe(true);
      expect(perm.counters?.['+1/+1']).toBe(2);
    }
  });

  it('creates multiple tapped tokens for semicolon + lowercase follow-up wording', () => {
    const ir = parseOracleTextToIR('Create two Treasure tokens; they enter tapped.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(perm.isToken).toBe(true);
      expect(perm.tapped).toBe(true);
      expect(String(perm.card?.name || '').toLowerCase()).toContain('treasure');
    }
  });

  it('creates multiple tokens with a shield counter for plural follow-up singular counter wording', () => {
    const ir = parseOracleTextToIR('Create two Treasure tokens. They enter with a shield counter on them.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(2);
    for (const perm of result.state.battlefield as any[]) {
      expect(perm.isToken).toBe(true);
      expect(perm.counters?.shield).toBe(1);
    }
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

  it('creates a token with counters when oracle uses "an additional" counter wording', () => {
    const ir = parseOracleTextToIR('Create a Treasure token with an additional +1/+1 counter on it.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.counters?.['+1/+1']).toBe(1);
  });

  it('creates a token with counters when oracle uses a follow-up "enters with counters" clause', () => {
    const ir = parseOracleTextToIR('Create a Treasure token. It enters with two +1/+1 counters on it.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.counters?.['+1/+1']).toBe(2);
  });

  it('attaches "They gain <keywords> until end of turn" as a create_token follow-up modifier', () => {
    const ir = parseOracleTextToIR(
      'Create two 1/1 white Soldier creature tokens. They gain flying and lifelink until end of turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const create = steps.find((s: any) => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.grantsAbilitiesUntilEndOfTurn).toEqual(['flying', 'lifelink']);
  });

  it('creates a token with counters when oracle uses a follow-up "an additional" counters clause', () => {
    const ir = parseOracleTextToIR(
      'Create a Treasure token. It enters with an additional +1/+1 counter on it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.counters?.['+1/+1']).toBe(1);
  });

  it('creates a tapped token with counters for combined follow-up modifiers', () => {
    const ir = parseOracleTextToIR(
      'Create a Treasure token. It enters the battlefield tapped and with two +1/+1 counters on it.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState();
    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceName: 'Test' });

    expect(result.state.battlefield.length).toBe(1);
    const token = result.state.battlefield[0] as any;
    expect(token.isToken).toBe(true);
    expect(token.tapped).toBe(true);
    expect(token.counters?.['+1/+1']).toBe(2);
  });

  it('attaches haste and next-end-step sacrifice follow-ups to create_token IR', () => {
    const ir = parseOracleTextToIR(
      'Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.grantsHaste).toBe('permanent');
    expect(step.atNextEndStep).toBe('sacrifice');
  });

  it('attaches triggered-template next-end-step cleanup to create_token IR', () => {
    const ir = parseOracleTextToIR(
      'Create two 1/1 red Elemental creature tokens. They gain haste. At the beginning of the next end step, sacrifice them.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.grantsHaste).toBe('permanent');
    expect(step.atNextEndStep).toBe('sacrifice');
  });

  it('attaches end-of-turn exile cleanup to create_token IR (Oracle shorthand)', () => {
    const ir = parseOracleTextToIR(
      'Create two 1/1 blue Illusion creature tokens. Exile them at end of turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.atNextEndStep).toBe('exile');
  });

  it('attaches triggered-template end-of-turn sacrifice cleanup to create_token IR (Oracle shorthand)', () => {
    const ir = parseOracleTextToIR(
      'Create a 2/2 colorless Robot artifact creature token. At end of turn, sacrifice that token.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.atNextEndStep).toBe('sacrifice');
  });

  it('attaches end-of-combat exile follow-up to create_token IR', () => {
    const ir = parseOracleTextToIR(
      "Create two 1/1 blue Illusion creature tokens. Exile those tokens at end of combat.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.atEndOfCombat).toBe('exile');
  });

  it('attaches triggered-template end-of-combat sacrifice follow-up to create_token IR', () => {
    const ir = parseOracleTextToIR(
      'Create a 2/2 colorless Robot artifact creature token. At end of combat, sacrifice that token.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.atEndOfCombat).toBe('sacrifice');
  });

  it('attaches until-EOT haste follow-up to create_token IR', () => {
    const ir = parseOracleTextToIR(
      'Create a 1/1 red Elemental creature token. It gains haste until end of turn.',
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    const step = steps[0] as any;
    expect(step.kind).toBe('create_token');
    expect(step.grantsHaste).toBe('until_end_of_turn');
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

  it('exiles the top card for face-down exile with combined look-and-play permission', () => {
    const text =
      'Exile the top card of your library face down. You may look at and play that card this turn.';

    const ir = parseOracleTextToIR(text, 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'c1' }, { id: 'c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(p1.library).toHaveLength(1);
    expect(p1.exile).toHaveLength(1);
    expect(p1.exile[0]?.id).toBe('c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top for face-down exile with combined look-and-play remains-exiled permission (each opponent)', () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of each opponent's library face down. You may look at and play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(p2.library).toHaveLength(1);
    expect(p2.exile).toHaveLength(1);
    expect(p2.exile[0]?.id).toBe('p2c1');
    expect(p3.library).toHaveLength(1);
    expect(p3.exile).toHaveLength(1);
    expect(p3.exile[0]?.id).toBe('p3c1');
    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
  });

  it('applies impulse_exile_top when target_opponent has a single legal candidate (1v1)', () => {
    const ir = parseOracleTextToIR(
      "Exile the top two cards of target opponent's library face down. You may look at and play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect(p2.exile || []).toHaveLength(2);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
  });

  it("applies impulse_exile_top from 'the defending player's library' source wording in 1v1", () => {
    const ir = parseOracleTextToIR(
      "Exile the top card of the defending player's library. You may play that card this turn.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it("skips impulse_exile_top when it is targeting-dependent (that player's library)", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p1.exile || []).toHaveLength(0);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(p2.exile || []).toHaveLength(0);
  });

  it("applies impulse_exile_top when that-player remains-exiled play + mana-rider has explicit targetPlayerId", () => {
    const ir = parseOracleTextToIR(
      "Look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p1.exile || []).toHaveLength(0);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applies impulse_exile_top for combined look+exile face-down template when target_opponent has a single legal candidate', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect(p2.exile || []).toHaveLength(2);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
  });

  it('applies impulse_exile_top for combined look+exile face-down template with mana-rider cast-them wording', () => {
    const ir = parseOracleTextToIR(
      "Look at the top two cards of target opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled, and mana of any type can be spent to cast them.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c3']);
    expect(p2.exile || []).toHaveLength(2);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
  });

  it('skips impulse_exile_top when target_opponent is ambiguous in multiplayer', () => {
    const ir = parseOracleTextToIR(
      "Exile the top two cards of target opponent's library face down. You may look at and play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }, { id: 'p3c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
    expect(p2.exile || []).toHaveLength(0);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c1', 'p3c2', 'p3c3']);
    expect(p3.exile || []).toHaveLength(0);
  });

  it('applies impulse_exile_top for contextual each_of_those_opponents selector in 1v1 (AtomicCards: Breeches)', () => {
    const ir = parseOracleTextToIR(
      "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
      'Breeches, Brazen Plunderer'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect(p2.exile.map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('skips impulse_exile_top for contextual each_of_those_opponents selector in multiplayer ambiguity', () => {
    const ir = parseOracleTextToIR(
      "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
      'Breeches, Brazen Plunderer'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(p2.exile || []).toHaveLength(0);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
    expect(p3.exile || []).toHaveLength(0);
  });

  it('applies impulse_exile_top for target_opponent in multiplayer when selectorContext binds the target', () => {
    const ir = parseOracleTextToIR(
      "Exile the top two cards of target opponent's library face down. You may look at and play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }, { id: 'p3c3' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p3' },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2', 'p2c3']);
    expect(p2.exile || []).toHaveLength(0);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c3']);
    expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
  });

  it('applies contextual each_of_those_opponents selector in multiplayer when selectorContext binds antecedent set', () => {
    const ir = parseOracleTextToIR(
      "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
      'Breeches, Brazen Plunderer'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }, { id: 'p3c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p3'] },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(p2.exile || []).toHaveLength(0);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c2']);
    expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1']);
  });

  it('applies impulse_exile_top for Gonti-Night-Minister-style look-then-exile play+rider sentence', () => {
    const ir = parseOracleTextToIR(
      "Whenever one or more creatures you control deal combat damage to a player, look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
      'Test'
    );
    const allSteps = ir.abilities.flatMap(a => a.steps);

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, allSteps as any, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applies impulse_exile_top for Thought-String-Analyst-style singular remains-exiled look+play mana-rider text', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of your upkeep, exile the top card of target opponent's library face down. You lose life equal to its mana value. You may look at and play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applies lose_life to contextual each_of_those_opponents in multiplayer when selectorContext binds antecedent set', () => {
    const ir = parseOracleTextToIR('Each of those opponents loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { eachOfThoseOpponents: ['p2'] },
    });
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'lose_life')).toBe(false);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(40);
  });

  it('buildOracleIRExecutionContext maps event hint affectedOpponentIds into each_of_those_opponents execution', () => {
    const ir = parseOracleTextToIR(
      "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
      'Breeches, Brazen Plunderer'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }, { id: 'p2c2' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }, { id: 'p3c2' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1' },
      { affectedOpponentIds: ['p2'], opponentsDealtDamageIds: ['p3'] }
    );

    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    // affectedOpponentIds has precedence for relational selector binding.
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
    expect(p3.exile || []).toHaveLength(0);
  });

  it('buildOracleIRExecutionContext maps spellType hint into referenceSpellTypes', () => {
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1' as any },
      { spellType: 'Instant Sorcery' }
    ) as any;

    expect(ctx.referenceSpellTypes).toEqual(['instant', 'sorcery']);
  });

  it("applies impulse_exile_top when subject is 'its owner' via target_player selector binding", () => {
    const ir = parseOracleTextToIR(
      "Whenever a creature is dealt damage, its owner may exile a card from the top of their library. They may play that card until the end of their next turn.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }, { id: 'p1c2' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }, { id: 'p2c2' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
      turnNumber: 3 as any,
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p1.library.map((c: any) => c.id)).toEqual(['p1c1', 'p1c2']);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('buildOracleIRExecutionContext falls back to targetOpponentId for each_of_those_opponents execution', () => {
    const ir = parseOracleTextToIR(
      "Each of those opponents loses 1 life.",
      'Test Relational'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { targetOpponentId: 'p3' });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(result.skippedSteps.some(s => s.kind === 'lose_life')).toBe(false);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(39);
  });

  it('buildOracleIRExecutionContext maps targetOpponentId for multiplayer target_opponent resolution', () => {
    const ir = parseOracleTextToIR(
      "Exile the top two cards of target opponent's library face down. You may look at and play those cards for as long as they remain exiled.",
      'Test'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }, { id: 'p2c2' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }, { id: 'p3c2' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { targetOpponentId: 'p3' });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c1', 'p2c2']);
    expect(p2.exile || []).toHaveLength(0);
    expect(p3.library.map((c: any) => c.id)).toEqual([]);
    expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
  });

  it('buildOracleIRExecutionContext maps targetOpponentId into target_player fallback', () => {
    const ir = parseOracleTextToIR('Target player loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { targetOpponentId: 'p3' });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(39);
  });

  it('buildOracleIRExecutionContext falls back to targetPlayerId for each_of_those_opponents when relational sets are absent', () => {
    const ir = parseOracleTextToIR('Each of those opponents loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { targetPlayerId: 'p2' });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(40);
  });

  it('buildOracleIRExecutionContext sanitizes each_of_those_opponents by removing controller id', () => {
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1' },
      { affectedPlayerIds: ['p1', 'p2', 'p2', 'p3'] }
    );

    expect(ctx.selectorContext?.eachOfThoseOpponents).toEqual(['p2', 'p3']);
  });

  it('buildOracleIRExecutionContext infers targetOpponentId from singleton affectedOpponentIds', () => {
    const ir = parseOracleTextToIR('Target opponent loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { affectedOpponentIds: ['p3'] });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(39);
  });

  it('buildOracleIRExecutionContext infers targetPlayerId from singleton affectedPlayerIds', () => {
    const ir = parseOracleTextToIR('Target player loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { affectedPlayerIds: ['p2'] });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(40);
  });

  it('buildOracleIRExecutionContext falls back targetPlayerId from base targetOpponentId', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
        selectorContext: { targetOpponentId: 'p3' },
      },
      { affectedPlayerIds: ['p2', 'p3'] }
    );

    expect(ctx.selectorContext?.targetPlayerId).toBe('p3');
    expect(ctx.selectorContext?.targetOpponentId).toBe('p3');
  });

  it('buildOracleIRExecutionContext falls back targetOpponentId from base targetPlayerId when base target is an opponent', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
        selectorContext: { targetPlayerId: 'p2' },
      },
      { affectedPlayerIds: ['p2', 'p3'] }
    );

    expect(ctx.selectorContext?.targetPlayerId).toBe('p2');
    expect(ctx.selectorContext?.targetOpponentId).toBe('p2');
  });

  it('buildOracleIRExecutionContext precedence: explicit hint wins over inferred singleton and base fallback', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
        selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' },
      },
      {
        targetOpponentId: 'p3',
        affectedOpponentIds: ['p2'],
      }
    );

    expect(ctx.selectorContext?.targetOpponentId).toBe('p3');
    expect(ctx.selectorContext?.targetPlayerId).toBe('p3');
  });

  it('buildOracleIRExecutionContext precedence: inferred singleton wins over base fallback when explicit is absent', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
        selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' },
      },
      {
        affectedOpponentIds: ['p3'],
      }
    );

    expect(ctx.selectorContext?.targetOpponentId).toBe('p3');
    expect(ctx.selectorContext?.targetPlayerId).toBe('p3');
  });

  it('buildOracleIRExecutionContext precedence: base fallback is used when explicit and inferred are absent', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
        selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' },
      },
      {
        affectedOpponentIds: ['p2', 'p3'],
      }
    );

    expect(ctx.selectorContext?.targetOpponentId).toBe('p2');
    expect(ctx.selectorContext?.targetPlayerId).toBe('p2');
  });

  it('buildOracleIRExecutionContext ignores targetOpponentId when it equals controller id', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
      },
      {
        targetOpponentId: 'p1',
      }
    );

    expect(ctx.selectorContext).toBeUndefined();
  });

  it('buildOracleIRExecutionContext ignores controller id from affectedOpponentIds for opponent inference', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
      },
      {
        affectedOpponentIds: ['p1'],
      }
    );

    expect(ctx.selectorContext).toBeUndefined();
  });

  it('buildOracleIRExecutionContext infers targetOpponentId from sanitized singleton affectedOpponentIds', () => {
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
      },
      {
        affectedOpponentIds: ['p1', 'p3'],
      }
    );

    expect(ctx.selectorContext?.targetOpponentId).toBe('p3');
    expect(ctx.selectorContext?.targetPlayerId).toBe('p3');
  });

  it('buildOracleIRExecutionContext normalizes whitespace-padded targetOpponentId', () => {
    const ir = parseOracleTextToIR('Target opponent loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, { targetOpponentId: '  p3  ' as any });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(39);
  });

  it('buildOracleIRExecutionContext normalizes whitespace-padded relational ids', () => {
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1' },
      { affectedOpponentIds: [' p2 ', 'p2', ' p3  '] as any }
    );

    expect(ctx.selectorContext?.eachOfThoseOpponents).toEqual(['p2', 'p3']);
  });

  it('target_opponent resolves from direct selectorContext with whitespace-padded id', () => {
    const ir = parseOracleTextToIR('Target opponent loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: '  p3  ' as any },
    });

    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(39);
  });

  it('each_of_those_opponents resolves from direct selectorContext with normalized ids', () => {
    const ir = parseOracleTextToIR('Each of those opponents loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: {
        eachOfThoseOpponents: [' p2 ', 'p2', '  p3  ', 'ghost' as any],
      },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(39);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(39);
  });

  it('buildOracleIRExecutionContext ignores object-valued target ids', () => {
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1' },
      { targetOpponentId: { bad: true } as any, targetPlayerId: { bad: true } as any }
    );

    expect(ctx.selectorContext).toBeUndefined();
  });

  it('target_opponent does not resolve when controller is not a valid player in state', () => {
    const ir = parseOracleTextToIR('Target opponent loses 2 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'ghost-player' as PlayerID },
      { targetOpponentId: 'p2' as PlayerID }
    );
    const result = applyOracleIRStepsToGameState(start, steps, ctx);

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(false);
    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(40);
  });

  it('each_opponent does not resolve when controller is not a valid player in state', () => {
    const ir = parseOracleTextToIR('Each opponent loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, library: [{ id: 'p3c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const ctx = buildOracleIRExecutionContext({ controllerId: 'ghost-player' as PlayerID });
    const result = applyOracleIRStepsToGameState(start, steps, ctx);

    expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(false);
    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p3') as any).life).toBe(40);
  });

  it('buildOracleIRExecutionContext relational matrix enforces precedence + sanitization', () => {
    const cases: Array<{
      name: string;
      hint: any;
      expectedEach: string[];
    }> = [
      {
        name: 'affectedOpponentIds wins over other relational sets',
        hint: {
          affectedOpponentIds: ['p3', 'p2', 'p3'],
          opponentsDealtDamageIds: ['p2'],
          affectedPlayerIds: ['p2'],
        },
        expectedEach: ['p3', 'p2'],
      },
      {
        name: 'opponentsDealtDamageIds wins when affectedOpponentIds absent',
        hint: {
          opponentsDealtDamageIds: ['p2', 'p2', 'p3'],
          affectedPlayerIds: ['p3'],
        },
        expectedEach: ['p2', 'p3'],
      },
      {
        name: 'affectedPlayerIds fallback removes controller and dedupes',
        hint: {
          affectedPlayerIds: ['p1', 'p2', 'p2', 'p3'],
        },
        expectedEach: ['p2', 'p3'],
      },
      {
        name: 'targetPlayer fallback removes controller',
        hint: {
          targetPlayerId: 'p1',
        },
        expectedEach: [],
      },
      {
        name: 'targetOpponent fallback yields singleton relational set',
        hint: {
          targetOpponentId: 'p3',
        },
        expectedEach: ['p3'],
      },
    ];

    for (const testCase of cases) {
      const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' }, testCase.hint);
      const actual = ctx.selectorContext?.eachOfThoseOpponents || [];
      expect(actual, testCase.name).toEqual(testCase.expectedEach);
      expect(actual.includes('p1'), `${testCase.name} should exclude controller`).toBe(false);
      expect(new Set(actual).size, `${testCase.name} should dedupe ids`).toBe(actual.length);
    }
  });

  it('buildOracleIRExecutionContext sanitizes base relational context even without hint', () => {
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1',
      selectorContext: {
        eachOfThoseOpponents: ['p1', 'p2', 'p2', 'p3'],
      },
    });

    expect(ctx.selectorContext?.eachOfThoseOpponents).toEqual(['p2', 'p3']);
  });

  it('buildOracleIRExecutionContext normalizes whitespace-padded base controllerId', () => {
    const ctx = buildOracleIRExecutionContext({
      controllerId: '  p1  ' as any,
      selectorContext: {
        eachOfThoseOpponents: ['p1', 'p2'],
      },
    });

    expect(ctx.controllerId).toBe('p1');
    expect(ctx.selectorContext?.eachOfThoseOpponents).toEqual(['p2']);
  });

  it('buildOracleIRExecutionContext normalizes base controllerId without selector context or hint', () => {
    const ctx = buildOracleIRExecutionContext({
      controllerId: '  p1  ' as any,
    });

    expect(ctx.controllerId).toBe('p1');
    expect(ctx.selectorContext).toBeUndefined();
  });

  it('buildOracleIRExecutionContext fills missing base targetOpponentId from base targetPlayerId without hint', () => {
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1',
      selectorContext: {
        targetPlayerId: 'p2',
      },
    });

    expect(ctx.selectorContext?.targetPlayerId).toBe('p2');
    expect(ctx.selectorContext?.targetOpponentId).toBe('p2');
  });

  it('applyOracleIRStepsToGameState resolves "you" selector with whitespace-padded controllerId', () => {
    const ir = parseOracleTextToIR('You gain 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: '  p1  ' as any,
    });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(result.appliedSteps.some(s => s.kind === 'gain_life')).toBe(true);
    expect(p1.life).toBe(41);
    expect(p2.life).toBe(40);
  });

  it('applyOracleIRStepsToGameState resolves battlefield "you control" filter with whitespace-padded controllerId', () => {
    const ir = parseOracleTextToIR('Destroy all creatures you control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'c1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          faceDown: false,
          counters: {},
          card: { id: 'c1', name: 'Self Creature', type_line: 'Creature' },
        } as any,
        {
          id: 'c2',
          controller: 'p2',
          owner: 'p2',
          tapped: false,
          faceDown: false,
          counters: {},
          card: { id: 'c2', name: 'Opp Creature', type_line: 'Creature' },
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: '  p1  ' as any,
    });

    const battlefield = (result.state as any).battlefield as any[];
    expect(battlefield.some(p => p.id === 'c1')).toBe(false);
    expect(battlefield.some(p => p.id === 'c2')).toBe(true);
  });

  it('applyOracleIRStepsToGameState resolves battlefield opponents filter with whitespace-padded controllerId', () => {
    const ir = parseOracleTextToIR('Destroy all creatures your opponents control.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      battlefield: [
        {
          id: 'c1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          faceDown: false,
          counters: {},
          card: { id: 'c1', name: 'Self Creature', type_line: 'Creature' },
        } as any,
        {
          id: 'c2',
          controller: 'p2',
          owner: 'p2',
          tapped: false,
          faceDown: false,
          counters: {},
          card: { id: 'c2', name: 'Opp Creature', type_line: 'Creature' },
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: '  p1  ' as any,
    });

    const battlefield = (result.state as any).battlefield as any[];
    expect(battlefield.some(p => p.id === 'c1')).toBe(true);
    expect(battlefield.some(p => p.id === 'c2')).toBe(false);
  });

  it('applyOracleIRStepsToGameState resolves move_zone from your graveyard with whitespace-padded controllerId', () => {
    const ir = parseOracleTextToIR('Return all creature cards from your graveyard to your hand.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [{ id: 'h0', name: 'Existing', type_line: 'Instant' }],
          graveyard: [
            { id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'g2', name: 'Shock', type_line: 'Instant' },
          ],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: '  p1  ' as any,
    });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['g2']);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['h0', 'g1']);
  });

  it('applyOracleIRStepsToGameState resolves each-opponent move_zone with whitespace-padded controllerId', () => {
    const ir = parseOracleTextToIR("Return all creature cards from each opponent's graveyard to their hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'P1 Bear', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'P2 Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: '  p1  ' as any,
    });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p1.hand).toEqual([]);
    expect(p2.graveyard).toEqual([]);
    expect(p2.hand.map((c: any) => c.id)).toEqual(['p2g1']);
  });

  it('applyOracleIRStepsToGameState resolves "that player loses life" via target_player context binding', () => {
    const ir = parseOracleTextToIR('That player loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(39);
  });

  it('applyOracleIRStepsToGameState resolves "that opponent loses life" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('That opponent loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(39);
  });

  it('applyOracleIRStepsToGameState resolves "defending player loses life" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('Defending player loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(39);
  });

  it('applyOracleIRStepsToGameState resolves "the defending player loses life" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('The defending player loses 1 life.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'p1c1' }], hand: [], graveyard: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, library: [{ id: 'p2c1' }], hand: [], graveyard: [], exile: [] } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect((result.state.players.find(p => p.id === 'p1') as any).life).toBe(40);
    expect((result.state.players.find(p => p.id === 'p2') as any).life).toBe(39);
  });

  it('applyOracleIRStepsToGameState resolves "that player draws" via target_player context binding', () => {
    const ir = parseOracleTextToIR('That player draws a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect(((result.state.players.find(p => p.id === 'p1') as any).hand || []).length).toBe(0);
    expect(((result.state.players.find(p => p.id === 'p2') as any).hand || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState resolves "that creature\'s owner draws" via target_player context binding', () => {
    const ir = parseOracleTextToIR("That creature's owner draws a card.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    expect(((result.state.players.find(p => p.id === 'p1') as any).hand || []).length).toBe(0);
    expect(((result.state.players.find(p => p.id === 'p2') as any).hand || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState resolves "defending player draws" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('Defending player draws a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect(((result.state.players.find(p => p.id === 'p1') as any).hand || []).length).toBe(0);
    expect(((result.state.players.find(p => p.id === 'p2') as any).hand || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState resolves "the defending player draws" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('The defending player draws a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    expect(((result.state.players.find(p => p.id === 'p1') as any).hand || []).length).toBe(0);
    expect(((result.state.players.find(p => p.id === 'p2') as any).hand || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState resolves "that player discards" via target_player context binding', () => {
    const ir = parseOracleTextToIR('That player discards a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [{ id: 'h1', name: 'Card 1', type_line: 'Instant' }],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetPlayerId: 'p2' as any },
    });

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect((p2.hand || []).length).toBe(0);
    expect((p2.graveyard || []).map((c: any) => c.id)).toEqual(['h1']);
  });

  it('applyOracleIRStepsToGameState resolves "defending player discards" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('Defending player discards a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [{ id: 'h1', name: 'Card 1', type_line: 'Instant' }],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect((p2.hand || []).length).toBe(0);
    expect((p2.graveyard || []).map((c: any) => c.id)).toEqual(['h1']);
  });

  it('applyOracleIRStepsToGameState resolves "the defending player discards" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('The defending player discards a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [{ id: 'h1', name: 'Card 1', type_line: 'Instant' }],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect((p2.hand || []).length).toBe(0);
    expect((p2.graveyard || []).map((c: any) => c.id)).toEqual(['h1']);
  });

  it('applyOracleIRStepsToGameState resolves "that opponent mills" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('That opponent mills a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect((p1.graveyard || []).length).toBe(0);
    expect((p2.graveyard || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState resolves "defending player mills" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('Defending player mills a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect((p1.graveyard || []).length).toBe(0);
    expect((p2.graveyard || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState resolves "the defending player mills" via target_opponent context binding', () => {
    const ir = parseOracleTextToIR('The defending player mills a card.', 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }, { id: 'p2c2' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { targetOpponentId: 'p2' as any },
    });

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    expect((p1.graveyard || []).length).toBe(0);
    expect((p2.graveyard || []).map((c: any) => c.id)).toEqual(['p2c1']);
  });

  it('applyOracleIRStepsToGameState does not execute each-opponent move_zone when controller is invalid', () => {
    const ir = parseOracleTextToIR("Return all creature cards from each opponent's graveyard to their hands.", 'Test');
    const steps = ir.abilities[0]?.steps ?? [];

    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p1g1', name: 'P1 Bear', type_line: 'Creature — Bear' }],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'p2g1', name: 'P2 Giant', type_line: 'Creature — Giant' }],
          exile: [],
        } as any,
      ],
      priority: 'p1',
      turnPlayer: 'p1',
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'ghost-player' as any,
    });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;

    expect(p1.graveyard.map((c: any) => c.id)).toEqual(['p1g1']);
    expect(p2.graveyard.map((c: any) => c.id)).toEqual(['p2g1']);
    expect(p1.hand).toEqual([]);
    expect(p2.hand).toEqual([]);
  });
});
