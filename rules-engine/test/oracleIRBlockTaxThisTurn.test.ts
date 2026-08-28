import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { tryParseBlockTaxThisTurnClause } from '../src/oracleIRParserBlockTaxThisTurn';
import type { GameState } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../src/oracleIR';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const WAR_CADENCE_ORACLE =
  "{X}{R}: This turn, creatures can't block unless their controller pays {X} for each blocking creature they control.";
const WAR_CADENCE_EFFECT =
  "This turn, creatures can't block unless their controller pays {X} for each blocking creature they control.";
const TRAILING_THIS_TURN =
  "Creatures can't block unless their controller pays {3} this turn.";
const ARCHANGEL_CLAUSE =
  "As long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.";

function withMeta<T extends OracleEffectStep>(step: T): T {
  return step;
}

function collectGrantSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || [])
    .filter((step) => step.kind === 'grant_static_ability');
}

function makeState(): GameState {
  return {
    id: 'block-tax-this-turn',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    turn: 4,
    active: true,
  } as unknown as GameState;
}

describe('this-turn block tax oracle IR', () => {
  it('parses War Cadence activation as grant_static_ability duration this_turn', () => {
    const grants = collectGrantSteps(WAR_CADENCE_ORACLE, 'War Cadence');
    expect(grants).toEqual([
      expect.objectContaining({
        kind: 'grant_static_ability',
        duration: 'this_turn',
        effectText: ["can't block unless their controller pays {X}"],
        target: expect.objectContaining({ text: 'creatures' }),
      }),
    ]);
  });

  it('parses leading and trailing this-turn block-tax clauses', () => {
    expect(tryParseBlockTaxThisTurnClause({
      clause: WAR_CADENCE_EFFECT,
      rawClause: WAR_CADENCE_EFFECT,
      withMeta,
    })).toEqual(expect.objectContaining({
      kind: 'grant_static_ability',
      duration: 'this_turn',
      effectText: ["can't block unless their controller pays {X}"],
    }));
    expect(tryParseBlockTaxThisTurnClause({
      clause: TRAILING_THIS_TURN,
      rawClause: TRAILING_THIS_TURN,
      withMeta,
    })).toEqual(expect.objectContaining({
      kind: 'grant_static_ability',
      duration: 'this_turn',
      effectText: ["can't block unless their controller pays {3}"],
    }));
  });

  it('does not parse continuous Archangel attacking block tax', () => {
    expect(tryParseBlockTaxThisTurnClause({
      clause: ARCHANGEL_CLAUSE,
      rawClause: ARCHANGEL_CLAUSE,
      withMeta,
    })).toBeNull();
  });

  it('applies War Cadence with xValue=2 as lastingEffects blockTaxGeneric', () => {
    const grants = collectGrantSteps(WAR_CADENCE_ORACLE, 'War Cadence')
      .filter((step) => String((step as { duration?: string }).duration || '') === 'this_turn');
    const result = applyOracleIRStepsToGameState(
      makeState(),
      grants,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'perm_1',
        sourceName: 'War Cadence',
        sourceObjectType: 'ability',
        xValue: 2,
      } as any),
    );
    expect(result.appliedSteps.map((step) => step.kind)).toContain('grant_static_ability');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'blockTaxGeneric',
        duration: 'this_turn',
        amount: 2,
        global: true,
        source: 'War Cadence',
      }),
    ]);
  });
});
