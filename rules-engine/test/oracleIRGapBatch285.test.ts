import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const controllerId = 'p1' as PlayerID;

function graveyardState(creatureCount: number): GameState {
  const graveyard = Array.from({ length: creatureCount }, (_, index) => ({
    id: `gy-${index + 1}`,
    name: `Creature ${index + 1}`,
    type_line: 'Creature — Human',
  }));
  return {
    players: [{ id: controllerId, library: [], hand: [], graveyard }],
    battlefield: [],
  } as GameState;
}

describe('Oracle IR gap batch 285 — return X from graveyard selectors', () => {
  it('executes Return X target creature cards from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Return X target creature cards from your graveyard to the battlefield.',
      'Entreat the Dead'
    );
    const steps = ir.abilities[0]?.steps || [];
    expect(steps[0]?.kind).toBe('move_zone');

    const result = applyOracleIRStepsToGameState(graveyardState(2), steps, {
      controllerId,
      sourceId: 'bf-source',
      xValue: 2,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
    expect((result.state?.battlefield || []).length).toBe(2);
  });

  it('executes Return X target creature cards from graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      'Return X target creature cards from your graveyard to your hand.',
      'Restless Dreams'
    );
    const steps = ir.abilities[0]?.steps || [];
    const result = applyOracleIRStepsToGameState(graveyardState(2), steps, {
      controllerId,
      sourceId: 'bf-source',
      xValue: 2,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
    expect(player.graveyard.length).toBe(0);
  });

  it('executes Living End exile-then-return exiled-this-way chain', () => {
    const ir = parseOracleTextToIR(
      'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.',
      'Living End'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          graveyard: [
            { id: 'gy-1', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'gy-2', name: 'Elf', type_line: 'Creature — Elf' },
          ],
          hand: [],
          library: [],
        },
        {
          id: 'p2',
          graveyard: [{ id: 'gy-3', name: 'Goblin', type_line: 'Creature — Goblin' }],
          hand: [],
          library: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'bf-source',
    });
    const selectorGaps = (result.automationGaps || []).filter((gap) => gap.reasonCode === 'unsupported_selector');
    expect(selectorGaps).toHaveLength(0);
    expect((result.state?.battlefield || []).length).toBeGreaterThan(0);
  });
});
