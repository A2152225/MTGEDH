import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const ABILITY =
  '{T}, Sacrifice another creature: Any number of target players each lose 2 life and sacrifice a creature of their choice. You create a Treasure token and draw a card.';

function game(options?: { bear?: boolean }): GameState {
  const battlefield = options?.bear
    ? [{ id: 'bear', name: 'Grizzly Bears', controller: 'p2', owner: 'p2', card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' } }]
    : [];
  return {
    players: [
      { id: 'p1', life: 40, hand: [], library: [{ id: 'drawn', name: 'Swamp' }], exile: [], graveyard: [] },
      { id: 'p2', life: 40, hand: [], library: [], exile: [], graveyard: [] },
    ],
    battlefield,
    zones: {
      p1: { hand: [], library: [{ id: 'drawn', name: 'Swamp' }], graveyard: [], exile: [] },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  } as GameState;
}

function run(state: GameState, chosen: string[]) {
  const ir = parseOracleTextToIR(ABILITY, 'Priest of Forgotten Gods');
  const steps = ir.abilities.flatMap((ability) => ability.steps || []);
  return {
    steps,
    result: applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Priest of Forgotten Gods',
        sourceObjectType: 'ability',
        selectorContext: chosen.length > 0 ? { chosenObjectIds: chosen, targetPlayerId: chosen[0] } : {},
      }),
      { allowOptional: true },
    ),
  };
}

describe('Priest of Forgotten Gods', () => {
  it('parses life loss, a sacrifice, a Treasure, and a draw', () => {
    const { steps } = run(game(), ['p2']);
    expect(steps.map((step) => step.kind)).toEqual(['lose_life', 'sacrifice', 'create_token', 'draw']);
  });

  it('has each chosen player lose 2 life and sacrifice a creature', () => {
    const { result } = run(game({ bear: true }), ['p2']);
    expect(result.skippedSteps.map((step) => step.kind)).toEqual([]);
    const p2 = (result.state.players || []).find((player: any) => player.id === 'p2') as any;
    expect(p2.life).toBe(38);
    expect((result.state.battlefield || []).some((perm: any) => perm.id === 'bear')).toBe(false);
  });

  it('treats choosing no players as a legal empty choice', () => {
    const { result } = run(game({ bear: true }), []);
    expect(result.skippedSteps.map((step) => step.kind)).toEqual([]);
    const p2 = (result.state.players || []).find((player: any) => player.id === 'p2') as any;
    expect(p2.life).toBe(40);
    expect((result.state.battlefield || []).some((perm: any) => perm.id === 'bear')).toBe(true);
  });
});
