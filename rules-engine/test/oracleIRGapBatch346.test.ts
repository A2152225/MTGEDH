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

describe('Oracle IR gap batch 346 — top condition clusters', () => {
  it('evaluates opponent life lead, empty hand, no attack, and team warrior', () => {
    const state = {
      players: [
        { id: controllerId, life: 30 },
        { id: 'p2', life: 40, hand: [] },
      ],
      battlefield: [
        {
          id: 'bf-source',
          controller: controllerId,
          type_line: 'Creature — Human Warrior',
          attackedThisTurn: false,
        },
        { id: 'bf-warrior-ally', controller: controllerId, type_line: 'Creature — Human Warrior' },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'an opponent has more life than you',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that player has no cards in hand' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, targetPlayerId: 'p2', targetOpponentId: 'p2' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "this creature didn't attack this turn" },
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
        normalizedRaw: 'your team controls another warrior',
      })
    ).toBe(true);
  });

  it('executes Linvala opponent-life branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if an opponent has more life than you, you gain 5 life.',
      'Linvala, the Preserver'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId, life: 30 }, { id: 'p2', life: 40 }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-linvala' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Asylum Visitor empty-hand branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's upkeep, if that player has no cards in hand, that player loses 1 life.",
      'Asylum Visitor'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }, { id: 'p2', hand: [] }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-asylum', targetPlayerId: 'p2', targetOpponentId: 'p2' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Erg Raiders no-attack branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of your upkeep, if this creature didn't attack this turn, it deals 2 damage to you unless it came under your control this turn.",
      'Erg Raiders'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-source',
            controller: controllerId,
            type_line: 'Creature — Human Warrior',
            attackedThisTurn: false,
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Sickle Dancer team-warrior branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature attacks, if your team controls another Warrior, this creature gets +1/+1 until end of turn.',
      'Sickle Dancer'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Warrior' },
          { id: 'bf-warrior-ally', controller: controllerId, type_line: 'Creature — Human Warrior' },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
