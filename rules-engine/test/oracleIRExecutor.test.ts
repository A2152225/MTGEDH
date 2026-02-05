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
    expect(result.appliedSteps.some(s => s.kind === 'move_zone')).toBe(true);
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
            { id: 'p1e2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          ],
        } as any,
      ],
    });

    const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(p1.exile.map((c: any) => c.id)).toEqual(['p1e1']);
    expect(p1.hand.map((c: any) => c.id)).toEqual(['p1h0', 'p1e2']);
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
});
