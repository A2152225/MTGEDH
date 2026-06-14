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

describe('Oracle IR gap batch 348 — top condition clusters', () => {
  it('evaluates specific kicker, warrior subtype, gy entry, and life lead', () => {
    const state = {
      startingLife: 40,
      players: [{ id: controllerId, life: 55 }],
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Warrior', wasKicked: true },
        {
          id: 'bf-gy-entry',
          controller: controllerId,
          type_line: 'Creature — Zombie',
          enteredFromZone: 'graveyard',
          castFromZone: 'graveyard',
        },
      ],
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was kicked with its {2}{U} kicker' },
        nextState: state,
        controllerId,
        ctx: baseParams.ctx,
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'this creature is a warrior',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: {
          kind: 'if',
          raw: 'one or more of them entered from a graveyard or was cast from a graveyard',
        },
        nextState: state,
        controllerId,
        ctx: {
          ...baseParams.ctx,
          lastMovedCards: [state.battlefield![1]],
          lastAntecedentBattlefieldPermanentIds: ['bf-gy-entry'],
        },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you have at least 15 life more than your starting life total',
      })
    ).toBe(true);
  });

  it('executes Sunscape Battlemage kicker branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Kicker {2}{U} (You may pay an additional {2}{U} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {2}{U} kicker, target player discards three cards.',
      'Sunscape Battlemage'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((entry) => entry.kind === 'conditional' && /kicker/i.test(entry.raw || ''));
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature', wasKicked: true }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Ascendant Spirit warrior branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature attacks, if this creature is a Warrior, it gets +1/+1 until end of turn.',
      'Ascendant Spirit'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Warrior' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Kotis graveyard-entry branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever one or more creatures enter the battlefield under your control, if one or more of them entered from a graveyard or was cast from a graveyard, put two +1/+1 counters on this permanent.',
      'Kotis, Sibsig Champion'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature' },
          {
            id: 'bf-gy-entry',
            controller: controllerId,
            type_line: 'Creature — Zombie',
            enteredFromZone: 'graveyard',
            castFromZone: 'graveyard',
          },
        ],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        lastMovedCards: [
          {
            id: 'bf-gy-entry',
            controller: controllerId,
            type_line: 'Creature — Zombie',
            enteredFromZone: 'graveyard',
            castFromZone: 'graveyard',
          },
        ],
        lastAntecedentBattlefieldPermanentIds: ['bf-gy-entry'],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Angel of Destiny life-lead branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your end step, if you have at least 15 life more than your starting life total, each player this creature attacked this turn loses the game.',
      'Angel of Destiny'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        startingLife: 40,
        players: [{ id: controllerId, life: 55 }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Angel' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
