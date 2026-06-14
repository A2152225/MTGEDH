import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const controllerId = 'p1' as PlayerID;

function libraryState(cardCount: number): GameState {
  const library = Array.from({ length: cardCount }, (_, index) => ({
    id: `lib-${index + 1}`,
    name: `Card ${index + 1}`,
    type_line: 'Creature — Human',
  }));
  return {
    players: [{ id: controllerId, library, hand: [], graveyard: [] }],
    battlefield: [],
  } as GameState;
}

describe('Oracle IR gap batch 284 — manifest dread selector', () => {
  it('parses manifest dread twice as two manifest_dread steps without orphan move_zone', () => {
    const ir = parseOracleTextToIR(
      'When this enchantment enters, manifest dread twice. (To manifest dread, look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it\'s a creature card.)',
      'They Came from the Pipes'
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    expect(steps.filter((step) => step.kind === 'manifest_dread')).toHaveLength(2);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(false);
  });

  it('executes manifest dread from standalone reminder text', () => {
    const ir = parseOracleTextToIR(
      'Manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it\'s a creature card.)',
      'Manifest Dread'
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    expect(steps.filter((step) => step.kind === 'manifest_dread')).toHaveLength(1);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(false);

    const result = applyOracleIRStepsToGameState(libraryState(4), steps, {
      controllerId,
      sourceId: 'bf-source',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(1);
    expect((result.state?.battlefield || []).length).toBe(1);
  });
});
