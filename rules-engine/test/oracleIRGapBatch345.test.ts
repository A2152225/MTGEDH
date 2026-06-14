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

describe('Oracle IR gap batch 345 — top condition clusters', () => {
  it('evaluates non-hand cast, zero mana spent, would-lose, and no untapped lands', () => {
    const state = {
      players: [{ id: controllerId }],
      battlefield: [
        { id: 'bf-land-1', controller: controllerId, type_line: 'Basic Land — Forest', tapped: true },
      ],
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'this spell was cast from anywhere other than your hand' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, castFromZone: 'graveyard' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'no mana was spent to cast it' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, noManaSpentToCast: true },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'you would lose the game' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, wouldLoseTheGame: true },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you control no untapped lands',
      })
    ).toBe(true);
  });

  it('executes Otterball Antics non-hand cast branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Create a 1/1 blue and red Otter creature token with prowess. If this spell was cast from anywhere other than your hand, put a +1/+1 counter on that creature.',
      'Otterball Antics'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'stack-spell-1', castFromZone: 'graveyard' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Vexing Bauble zero-mana branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever a player casts a spell, if no mana was spent to cast it, counter that spell.',
      'Vexing Bauble'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-bauble', noManaSpentToCast: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Exquisite Archangel would-lose branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'If you would lose the game, instead exile this creature and your life total becomes equal to your starting life total.',
      'Exquisite Archangel'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Angel' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', wouldLoseTheGame: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Well of Life no-untapped-lands branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if you control no untapped lands, you gain 2 life.',
      'Well of Life'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-land-1', controller: controllerId, type_line: 'Basic Land — Plains', tapped: true },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-well' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
