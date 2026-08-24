import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const controllerId = 'p1' as PlayerID;

function libraryState(cardCount: number): GameState {
  const library = Array.from({ length: cardCount }, (_, index) => ({
    id: `lib-${index + 1}`,
    name: `Card ${index + 1}`,
    type_line: 'Instant',
  }));
  return {
    players: [{ id: controllerId, library, hand: [], graveyard: [] }],
    battlefield: [],
  } as GameState;
}

describe('Oracle IR gap batch 283 — surveil reminder disposal', () => {
  it('prunes redundant look_top + move_zone after surveil keyword', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)',
      'Twilight Diviner'
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    expect(steps.filter((step) => step.kind === 'surveil')).toHaveLength(1);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(false);
    expect(steps.some((step) => step.kind === 'look_top')).toBe(false);
  });

  it('merges standalone look-at-top surveil disposal into look_select_top and executes', () => {
    const ir = parseOracleTextToIR(
      'Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.',
      'test'
    );
    const steps = ir.abilities[0]?.steps || [];
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('look_select_top');
    expect((steps[0] as any).destination).toBe('graveyard');
    expect((steps[0] as any).restDestination).toBe('library');
    expect((steps[0] as any).restToTop).toBe(true);

    const result = applyOracleIRStepsToGameState(libraryState(4), steps, {
      controllerId,
      sourceId: 'bf-source',
      interactivePlayerChoices: false,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(2);
    expect(player.library.length).toBe(2);
  });
});
