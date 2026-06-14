import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
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

describe('Oracle IR gap batch 355 — top condition clusters', () => {
  it('evaluates that-player land lead, low hand, surge paid, and counter placed', () => {
    const state = {
      players: [
        { id: controllerId, hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }, { id: 'h5' }] },
        { id: 'p2' },
      ],
      battlefield: [
        { id: 'bf-your-land', controller: controllerId, type_line: 'Basic Land — Forest' },
        { id: 'bf-their-land-1', controller: 'p2', type_line: 'Basic Land — Island' },
        { id: 'bf-their-land-2', controller: 'p2', type_line: 'Basic Land — Plains' },
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Goblin', surgeCostWasPaid: true },
      ],
      putCounterOnCreatureThisTurn: { [controllerId]: true },
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that player controls more lands than you' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, targetPlayerId: 'p2', selectorContext: { targetPlayerId: 'p2' } },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you have fewer than seven cards in hand',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'its surge cost was paid',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you put a counter on a creature this turn',
      })
    ).toBe(true);
  });

  it("executes Archaeomancer's Map land-lead branch without condition gap", () => {
    const ir = parseOracleTextToIR(
      "Whenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield.",
      "Archaeomancer's Map"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-your-land', controller: controllerId, type_line: 'Basic Land — Forest' },
          { id: 'bf-their-land-1', controller: 'p2', type_line: 'Basic Land — Island' },
          { id: 'bf-their-land-2', controller: 'p2', type_line: 'Basic Land — Plains' },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-map', targetPlayerId: 'p2' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Damia low-hand branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if you have fewer than seven cards in hand, draw cards equal to the difference.',
      'Damia, Sage of Stone'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }] }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-damia' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Reckless Bushwhacker surge branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if its surge cost was paid, other creatures you control get +1/+0 and gain haste until end of turn.',
      'Reckless Bushwhacker'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Goblin', surgeCostWasPaid: true },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Lord Jyscal Guado counter branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, if you put a counter on a creature this turn, investigate.',
      'Lord Jyscal Guado'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        putCounterOnCreatureThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-jyscal' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
