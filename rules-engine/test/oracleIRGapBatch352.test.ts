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

describe('Oracle IR gap batch 352 — top condition clusters', () => {
  it('evaluates no attack, damage threshold, no creatures, and attack group', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      attackersDeclaredThisCombatByPlayer: { p1: [] },
      battlefield: [
        { id: 'bf-planeswalker-1', controller: controllerId, type_line: 'Legendary Planeswalker — Test' },
        { id: 'bf-attacker-1', controller: 'p2', type_line: 'Creature — Human', attacking: 'p1' },
        { id: 'bf-attacker-2', controller: 'p2', type_line: 'Creature — Human', attacking: 'bf-planeswalker-1' },
      ],
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you didn't attack with a creature this turn" },
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
        normalizedRaw: '4 or more damage was dealt to it this turn',
        lastMovedCards: [{ id: 'bf-zubera', type_line: 'Creature — Spirit', damageThisTurn: 4 }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { ...state, battlefield: [] } as GameState,
        normalizedRaw: 'you control no creatures',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'two or more of those creatures are attacking you and/or planeswalkers you control',
        ctx: {
          ...baseParams.ctx,
          thoseCreatureIds: ['bf-attacker-1', 'bf-attacker-2'],
        },
      })
    ).toBe(true);
  });

  it('executes Curious Obsession no-attack branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of your end step, if you didn't attack with a creature this turn, sacrifice this Aura.",
      'Curious Obsession'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        attackersDeclaredThisCombatByPlayer: { [controllerId]: [] },
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Enchantment — Aura' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Burning-Eye Zubera damage branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature dies, if 4 or more damage was dealt to it this turn, this creature deals 3 damage to any target.',
      'Burning-Eye Zubera'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-zubera',
        lastMovedCards: [{ id: 'bf-zubera', type_line: 'Creature — Spirit', damageThisTurn: 4 }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Thran Quarry no-creatures branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of the end step, if you control no creatures, sacrifice this land.',
      'Thran Quarry'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Land' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Tomik attack-group branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that opponent loses 3 life and you draw a card.',
      'Tomik, Wielder of Law'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-planeswalker-1', controller: controllerId, type_line: 'Legendary Planeswalker — Test' },
          { id: 'bf-attacker-1', controller: 'p2', type_line: 'Creature — Human', attacking: controllerId },
          { id: 'bf-attacker-2', controller: 'p2', type_line: 'Creature — Human', attacking: 'bf-planeswalker-1' },
        ],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-tomik',
        thoseCreatureIds: ['bf-attacker-1', 'bf-attacker-2'],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
