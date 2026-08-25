import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  collectActivatedAbilitySteps,
  tryApplyOracleIRToActivatedAbility,
} from '../src/state/modules/oracleIrAbilityExecution.js';
import { ORACLE_IR_FALLBACK_STEP_KINDS } from '../src/state/modules/trigger-runtime-wiring.js';
import { detectWinConditions } from '../src/state/modules/game-state-effects.js';

// Quoted from mtg_data.db cards.text WHERE name = 'Maze''s End' AND is_token = 0.
const MAZES_END_ORACLE =
  "This land enters tapped.\n{T}: Add {C}.\n{3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put it onto the battlefield, then shuffle. If you control ten or more Gates with different names, you win the game.";

const MAZES_END_ACTIVATED =
  "{3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put it onto the battlefield, then shuffle. If you control ten or more Gates with different names, you win the game.";

const WIN_IF_CONTROL_GATES =
  'If you control ten or more Gates with different names, you win the game.';

function makeGate(id: string, name: string) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
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

function makeActivatedCtx(gates: readonly ReturnType<typeof makeGate>[], sourceName: string) {
  return {
    state: {
      players: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      battlefield: [
        {
          id: 'land_1',
          controller: 'p1',
          owner: 'p1',
          card: { name: sourceName, oracle_text: MAZES_END_ORACLE, type_line: 'Land' },
        },
        ...gates,
      ],
      life: { p1: 40, p2: 40 },
      turnNumber: 3,
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [] },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
    },
    gameId: 'test_win_if_control_different_names',
    bumpSeq: () => {},
    libraries: new Map(),
  } as any;
}

describe('activated win-if-control-N-different-names (Maze\'s End family)', () => {
  it('wires win_game for activated / fallback IR', () => {
    expect(ORACLE_IR_FALLBACK_STEP_KINDS.has('win_game')).toBe(true);
  });

  it('collects the activated Gate-search line as search plus conditional win_game', () => {
    const steps = collectActivatedAbilitySteps(MAZES_END_ACTIVATED, 'Custom Gate Nexus');
    expect(steps.some((step) => step.kind === 'search_library')).toBe(true);
    const winIf = steps.find((step) => step.kind === 'conditional') as {
      condition?: { raw?: string };
      steps?: Array<{ kind: string }>;
    } | undefined;
    expect(String(winIf?.condition?.raw || '').toLowerCase()).toContain(
      'ten or more gates with different names',
    );
    expect((winIf?.steps || []).map((step) => step.kind)).toEqual(['win_game']);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
  });

  it('applies the post-search win-if clause and stamps gameOver without a Maze\'s End name check', () => {
    const gates = Array.from({ length: 10 }, (_, i) => makeGate(`gate_${i}`, `Gate ${i}`));
    const ctx = makeActivatedCtx(gates, 'Custom Gate Nexus');
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Custom Gate Nexus',
      oracleText: WIN_IF_CONTROL_GATES,
      sourcePermanentId: 'land_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.status).toBe('finished');
    expect(ctx.state.gameOver).toBe(true);
  });

  it('does not win when ten Gates share a name', () => {
    const gates = Array.from({ length: 10 }, (_, i) => makeGate(`gate_${i}`, 'Same Gate'));
    const ctx = makeActivatedCtx(gates, 'Custom Gate Nexus');
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Custom Gate Nexus',
      oracleText: WIN_IF_CONTROL_GATES,
      sourcePermanentId: 'land_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeUndefined();
  });

  it("keeps Maze's End out of the immediate detectWinConditions battlefield scan", () => {
    const ir = parseOracleTextToIR(MAZES_END_ORACLE, "Maze's End");
    expect(ir.abilities.some((ability) =>
      (ability.steps || []).some((step) => step.kind === 'conditional'),
    )).toBe(true);

    const ctx = {
      state: {
        battlefield: [
          {
            id: 'maze_1',
            controller: 'p1',
            card: { name: "Maze's End", oracle_text: MAZES_END_ORACLE, type_line: 'Land' },
          },
          ...Array.from({ length: 10 }, (_, i) => ({
            id: `gate_${i}`,
            controller: 'p1',
            card: { name: `Gate ${i}`, type_line: 'Land — Gate' },
          })),
        ],
      },
    } as any;
    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
  });
});
