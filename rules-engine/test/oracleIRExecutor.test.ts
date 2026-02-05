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
