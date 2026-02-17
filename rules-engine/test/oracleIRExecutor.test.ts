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
