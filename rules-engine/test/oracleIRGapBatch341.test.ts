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

describe('Oracle IR gap batch 341 — top condition clusters', () => {
  it('evaluates would-enter, time-counter, cast-from-hand, and life-change riders', () => {
    const state = {
      players: [{ id: controllerId }],
      battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature', counters: {} }],
    } as GameState;
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'this land would enter',
      })
    ).toBe(true);
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it had no time counters on it' },
        nextState: state,
        controllerId,
        ctx: baseParams.ctx,
        lastActionOutcome: null,
      })
    ).toBe(true);
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you didn't cast it from your hand" },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, castFromZone: 'graveyard' },
        lastActionOutcome: null,
      })
    ).toBe(true);
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you gained or lost life this turn' },
        nextState: {
          ...state,
          lifeGainedThisTurn: { [controllerId]: 2 },
        } as GameState,
        controllerId,
        ctx: baseParams.ctx,
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('executes Lotus Vale replacement branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "If this land would enter, sacrifice two untapped lands instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.",
      'Lotus Vale'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-land-1', controller: controllerId, type_line: 'Land', tapped: false },
          { id: 'bf-land-2', controller: controllerId, type_line: 'Land', tapped: false },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-lotus-vale' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Deadly Grub dies trigger when source had no time counters', () => {
    const ir = parseOracleTextToIR(
      'When this creature dies, if it had no time counters on it, create a 6/1 green Insect creature token with shroud.',
      'Deadly Grub'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature', counters: {} }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Phage ETB lose-game branch when not cast from hand', () => {
    const ir = parseOracleTextToIR(
      "When Phage enters, if you didn't cast it from your hand, you lose the game.",
      'Phage the Untouchable'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-phage', castFromZone: 'graveyard' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Starlit Soothsayer end-step branch when life changed this turn', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your end step, if you gained or lost life this turn, surveil 1.',
      'Starlit Soothsayer'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, library: [{ id: 'lib-1', name: 'Top Card', type_line: 'Instant' }] }],
        battlefield: [],
        lifeLostThisTurn: { [controllerId]: 1 },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-starlit' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
