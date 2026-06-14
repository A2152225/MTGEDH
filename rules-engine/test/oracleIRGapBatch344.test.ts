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

describe('Oracle IR gap batch 344 — top condition clusters', () => {
  it('evaluates creature-mana spend, seven-card hand, life lead, and no monarch', () => {
    const state = {
      players: [
        {
          id: controllerId,
          life: 40,
          hand: Array.from({ length: 7 }, (_, index) => ({ id: `h${index + 1}` })),
        },
        { id: 'p2', life: 30 },
      ],
      battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human' }],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'that mana is spent on a creature spell',
        ctx: { ...baseParams.ctx, manaSpentOnCreatureSpell: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you have seven or more cards in hand',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you have more life than an opponent',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'there is no monarch' },
        nextState: state,
        controllerId,
        ctx: baseParams.ctx,
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('executes Generator Servant creature-mana branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      '{T}: Add {C}{C}. If that mana is spent on a creature spell, it gains haste until end of turn.',
      'Generator Servant'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Construct' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', manaSpentOnCreatureSpell: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Kiyomaro seven-card hand branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if you have seven or more cards in hand, you gain 7 life.',
      'Kiyomaro, First to Stand'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          {
            id: controllerId,
            hand: Array.from({ length: 7 }, (_, index) => ({ id: `hand-${index + 1}` })),
          },
        ],
        battlefield: [],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-kiyomaro' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Glorious Enforcer life-lead branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if you have more life than an opponent, this creature gains double strike until end of turn.',
      'Glorious Enforcer'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, life: 40 }, { id: 'p2', life: 30 }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Angel' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Crown of Gondor no-monarch branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this artifact enters, if there is no monarch, you become the monarch.',
      'Crown of Gondor'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-crown' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
