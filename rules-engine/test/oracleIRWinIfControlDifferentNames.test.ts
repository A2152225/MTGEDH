import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE name = 'Maze''s End' AND is_token = 0.
const MAZES_END_ORACLE =
  "This land enters tapped.\n{T}: Add {C}.\n{3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put it onto the battlefield, then shuffle. If you control ten or more Gates with different names, you win the game.";

const WIN_IF_CONTROL_GATES =
  'If you control ten or more Gates with different names, you win the game.';

function collectActivatedWinSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

function makeGate(id: string, name: string, controller = 'p1') {
  return {
    id,
    controller,
    owner: controller,
    type_line: 'Land - Gate',
    cardType: 'Land - Gate',
    types: ['Land'],
    subtypes: ['Gate'],
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Land - Gate',
      types: ['Land'],
      subtypes: ['Gate'],
    },
  };
}

function makeState(gates: readonly ReturnType<typeof makeGate>[]): GameState {
  return {
    id: 'win-if-control-names',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [...gates],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
  } as unknown as GameState;
}

function applyWinIf(text: string, sourceName: string, gates: readonly ReturnType<typeof makeGate>) {
  const steps = collectActivatedWinSteps(text, sourceName).filter(
    (step) => step.kind === 'conditional' || step.kind === 'win_game',
  );
  return applyOracleIRStepsToGameState(
    makeState(gates),
    steps,
    buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'land_1',
      sourceName,
      sourceObjectType: 'ability',
    }),
  );
}

describe('win if you control N or more [type] with different names', () => {
  it('parses Maze\'s End activated win-if as conditional wrapping win_game', () => {
    const steps = collectActivatedWinSteps(MAZES_END_ORACLE, "Maze's End");
    const winIf = steps.find((step) => step.kind === 'conditional') as {
      condition?: { raw?: string };
      steps?: Array<{ kind: string; raw?: string }>;
    } | undefined;
    expect(winIf).toBeTruthy();
    expect(String(winIf?.condition?.raw || '').toLowerCase()).toBe(
      'you control ten or more gates with different names',
    );
    expect((winIf?.steps || []).map((step) => step.kind)).toEqual(['win_game']);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
  });

  it('parses the same oracle on a renamed land with no Maze\'s End name check', () => {
    const steps = collectActivatedWinSteps(MAZES_END_ORACLE, 'Custom Gate Nexus');
    const winIf = steps.find((step) => step.kind === 'conditional');
    expect(winIf?.kind).toBe('conditional');
    expect(String((winIf as { condition?: { raw?: string } } | undefined)?.condition?.raw || '').toLowerCase()).toBe(
      'you control ten or more gates with different names',
    );
  });

  it('wins when the controller has ten uniquely named Gates', () => {
    const gates = Array.from({ length: 10 }, (_, i) => makeGate(`gate_${i}`, `Gate ${i}`));
    const result = applyWinIf(WIN_IF_CONTROL_GATES, 'Custom Gate Nexus', gates);
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['win_game']);
    expect((result.state as any).winner).toBe('p1');
    expect((result.state as any).status).toBe('finished');
  });

  it('does not win with ten Gates that share one name', () => {
    const gates = Array.from({ length: 10 }, (_, i) => makeGate(`gate_${i}`, 'Same Gate'));
    const result = applyWinIf(WIN_IF_CONTROL_GATES, 'Custom Gate Nexus', gates);
    expect((result.state as any).winner).toBeUndefined();
    expect((result.state as any).status).not.toBe('finished');
  });

  it('does not win with nine uniquely named Gates', () => {
    const gates = Array.from({ length: 9 }, (_, i) => makeGate(`gate_${i}`, `Gate ${i}`));
    const result = applyWinIf(WIN_IF_CONTROL_GATES, 'Custom Gate Nexus', gates);
    expect((result.state as any).winner).toBeUndefined();
  });
});
