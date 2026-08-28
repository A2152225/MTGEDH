import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { tryParseAttackTaxThisTurnClause } from '../src/oracleIRParserAttackTaxThisTurn';
import type { GameState } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../src/oracleIR';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const WAR_TAX_ORACLE =
  "{X}{U}: This turn, creatures can't attack unless their controller pays {X} for each attacking creature they control.";
const WAR_TAX_EFFECT =
  "This turn, creatures can't attack unless their controller pays {X} for each attacking creature they control.";
const TRAILING_THIS_TURN =
  "Creatures can't attack unless their controller pays {3} this turn.";
const FORBIDDING_SPIRIT_EFFECT =
  "Until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays {2} for each of those creatures.";

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
    id: 'attack-tax-this-turn',
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

function applyGrants(
  text: string,
  sourceName: string,
  extraCtx: Record<string, unknown> = {},
) {
  const steps = collectGrantSteps(text, sourceName)
    .filter((step) => {
      const duration = String((step as { duration?: string }).duration || '');
      return duration === 'this_turn' || duration === 'until_next_turn';
    });
  return applyOracleIRStepsToGameState(
    makeState(),
    steps,
    buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'perm_1',
      sourceName,
      sourceObjectType: 'ability',
      ...extraCtx,
    } as any),
  );
}

describe('this-turn attack tax oracle IR', () => {
  it('parses War Tax activation as grant_static_ability duration this_turn', () => {
    const grants = collectGrantSteps(WAR_TAX_ORACLE, 'War Tax');
    expect(grants).toEqual([
      expect.objectContaining({
        kind: 'grant_static_ability',
        duration: 'this_turn',
        effectText: ["can't attack unless their controller pays {X}"],
        target: expect.objectContaining({ text: 'creatures' }),
      }),
    ]);
  });

  it('parses the War Tax effect clause and trailing this-turn numeric tax', () => {
    expect(tryParseAttackTaxThisTurnClause({
      clause: WAR_TAX_EFFECT,
      rawClause: WAR_TAX_EFFECT,
      withMeta,
    })).toMatchObject({
      kind: 'grant_static_ability',
      duration: 'this_turn',
      effectText: ["can't attack unless their controller pays {X}"],
    });
    expect(tryParseAttackTaxThisTurnClause({
      clause: TRAILING_THIS_TURN,
      rawClause: TRAILING_THIS_TURN,
      withMeta,
    })).toMatchObject({
      duration: 'this_turn',
      effectText: ["can't attack unless their controller pays {3}"],
    });
  });

  it('parses Forbidding Spirit until-next-turn as attack-you grant', () => {
    expect(tryParseAttackTaxThisTurnClause({
      clause: FORBIDDING_SPIRIT_EFFECT,
      rawClause: FORBIDDING_SPIRIT_EFFECT,
      withMeta,
    })).toMatchObject({
      kind: 'grant_static_ability',
      duration: 'until_next_turn',
      effectText: ["can't attack you unless their controller pays {2}"],
      target: expect.objectContaining({ text: 'you' }),
    });
  });

  it('stamps lastingEffects.attackTaxGeneric from War Tax with xValue=3', () => {
    const result = applyGrants(WAR_TAX_ORACLE, 'War Tax', { xValue: 3 });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('grant_static_ability');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'attackTaxGeneric',
        duration: 'this_turn',
        amount: 3,
        global: true,
        source: 'War Tax',
      }),
    ]);
  });

  it('does not stamp Alchemy A- this-turn sources', () => {
    const result = applyGrants(WAR_TAX_ORACLE, 'A-War Tax', { xValue: 3 });
    expect((result.state as any).lastingEffects || []).toEqual([]);
  });

  it('stamps Forbidding Spirit as until_your_next_turn attack-you tax', () => {
    const result = applyGrants(FORBIDDING_SPIRIT_EFFECT, 'Forbidding Spirit');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'attackTaxGeneric',
        duration: 'until_your_next_turn',
        amount: 2,
        defenderId: 'p1',
        global: false,
        source: 'Forbidding Spirit',
        controllerId: 'p1',
        turnApplied: 4,
      }),
    ]);
  });
});
