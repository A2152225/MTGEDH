import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;

const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 354 — top condition clusters', () => {
  it('evaluates no attack, no damage yet, second land, and opponent damage', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      creaturesAttackedThisTurn: {},
      landsEnteredBattlefieldThisTurn: { p2: 2 },
      creaturesThatDealtDamageToPlayer: { p2: { 'bf-source': true } },
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Angel', hasDealtDamage: false },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'no creatures attacked this turn',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "it hasn't dealt damage yet",
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'that player had another land enter the battlefield under their control this turn',
        ctx: { ...baseParams.ctx, targetPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'this creature dealt damage to an opponent this turn',
      })
    ).toBe(true);
  });

  it('executes Charging Cinderhorn no-attack branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's end step, if no creatures attacked this turn, put a fury counter on this creature.",
      'Charging Cinderhorn'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        creaturesAttackedThisTurn: {},
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Elemental Ox' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Karakyk Guardian no-damage-yet branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "This creature has hexproof if it hasn't dealt damage yet.",
      'Karakyk Guardian'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Angel', hasDealtDamage: false },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Tunnel Ignus second-land branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Whenever a land enters under an opponent's control, if that player had another land enter the battlefield under their control this turn, this creature deals 3 damage to that player.",
      'Tunnel Ignus'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        landsEnteredBattlefieldThisTurn: { p2: 2 },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-ignus', targetPlayerId: 'p2' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Whirling Dervish opponent-damage branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, if this creature dealt damage to an opponent this turn, put a +1/+1 counter on it.',
      'Whirling Dervish'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        creaturesThatDealtDamageToPlayer: { p2: { 'bf-source': true } },
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Monk' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
