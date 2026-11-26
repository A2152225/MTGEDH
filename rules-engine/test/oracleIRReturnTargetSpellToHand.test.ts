import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';
import { asGameState } from './helpers/gameStateFixture';

// Quoted from Sink into Stupor // Soporific Springs (MH3).
const SINK_ORACLE = "Return target spell or nonland permanent an opponent controls to its owner's hand.";

function makeState(): GameState {
  return asGameState({
    id: 'sink-into-stupor',
    format: 'commander',
    players: [
      { id: 'p1', name: 'A2', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
      { id: 'p2', name: 'King2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
    ],
    battlefield: [
      {
        id: 'omnath',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'omnath-card', name: 'Omnath, Locus of Mana', type_line: 'Legendary Creature — Elemental' },
      } as any,
    ],
    stack: [
      {
        id: 'stack_swords',
        type: 'spell',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'swords-card', name: 'Swords to Plowshares', type_line: 'Instant', owner: 'p2' },
      },
      {
        id: 'stack_sink',
        type: 'spell',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'sink-card', name: 'Sink into Stupor', type_line: 'Instant', owner: 'p1' },
      },
    ],
    turnPlayer: 'p2',
    priority: 'p1',
    active: true,
  });
}

describe('Return target spell to its owner\'s hand', () => {
  it('removes the targeted spell from the stack and puts that card in its owner\'s hand', () => {
    const ir = parseOracleTextToIR(SINK_ORACLE, 'Sink into Stupor');
    const steps = ir.abilities[0]?.steps ?? [];

    const result = applyOracleIRStepsToGameState(makeState(), steps, {
      controllerId: 'p1',
      sourceId: 'stack_sink',
      sourceName: 'Sink into Stupor',
      sourceObjectType: 'spell',
      targetSpellId: 'stack_swords',
    });

    const p2 = result.state.players.find((player) => player.id === 'p2') as any;
    const stack = ((result.state as any).stack || []) as any[];
    const battlefield = ((result.state as any).battlefield || []) as any[];

    expect(result.appliedSteps.map((step) => step.kind)).toContain('move_zone');
    expect(stack.map((item) => item.id)).toEqual(['stack_sink']);
    expect((p2.hand || []).map((card: any) => card.id)).toEqual(['swords-card']);
    expect(battlefield.map((perm) => perm.id)).toEqual(['omnath']);
  });

  it('still bounces a nonland permanent when that is the target', () => {
    const ir = parseOracleTextToIR(SINK_ORACLE, 'Sink into Stupor');
    const steps = ir.abilities[0]?.steps ?? [];
    const start = makeState();
    (start as any).stack = [];
    (start as any).battlefield.push({
      id: 'sol-ring',
      controller: 'p2',
      owner: 'p2',
      card: { id: 'sol-ring-card', name: 'Sol Ring', type_line: 'Artifact', owner: 'p2' },
    });

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceName: 'Sink into Stupor',
      sourceObjectType: 'spell',
      targetPermanentId: 'sol-ring',
    });

    const p2 = result.state.players.find((player) => player.id === 'p2') as any;
    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect((p2.hand || []).map((card: any) => card.name)).toContain('Sol Ring');
    expect(battlefield.map((perm) => perm.id)).not.toContain('sol-ring');
    expect(battlefield.map((perm) => perm.id)).toContain('omnath');
  });
});
