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

describe('Oracle IR gap batch 351 — top condition clusters', () => {
  it('evaluates counters on permanent, non-attacker tap, exile cast, and command zone presence', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'bf-source',
          controller: controllerId,
          type_line: 'Legendary Creature — Human Wizard',
          counters: { '+1/+1': 1 },
        },
        { id: 'bf-opponent-creature', controller: 'p2', type_line: 'Creature — Human', tapped: true },
      ],
      attackersDeclaredThisCombatByPlayer: { p2: [] },
      commandZone: { p1: { commanderCards: [{ id: 'bf-source' }], inCommandZone: ['bf-source'] } },
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'this permanent has counters on it',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "it isn't being declared as an attacker",
        ctx: {
          ...baseParams.ctx,
          targetPermanentId: 'bf-opponent-creature',
          targetPlayerId: 'p2',
        },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'this spell was cast from exile' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, castFromZone: 'exile' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'this permanent is in the command zone or on the battlefield',
      })
    ).toBe(true);
  });

  it('executes Denry Klin counters branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever a nontoken creature you control enters, if Denry Klin has counters on it, put the same number of each kind of counter on that creature.',
      'Denry Klin, Editor in Chief'
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
            type_line: 'Legendary Creature — Human Advisor',
            counters: { '+1/+1': 1 },
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Verity Circle non-attacker branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card.",
      'Verity Circle'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        attackersDeclaredThisCombatByPlayer: { p2: [] },
        battlefield: [
          { id: 'bf-opponent-creature', controller: 'p2', type_line: 'Creature — Human', tapped: true },
        ],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-circle',
        targetPermanentId: 'bf-opponent-creature',
        targetPlayerId: 'p2',
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Delayed Blast Fireball exile-cast branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Delayed Blast Fireball deals 2 damage to each opponent and each creature they control. If this spell was cast from exile, it deals 5 damage to each opponent and each creature they control instead.',
      'Delayed Blast Fireball'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }, { id: 'p2' }] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-fireball', castFromZone: 'exile' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Inalla command-zone branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Eminence — Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, you may pay {1}. If you do, create a token that's a copy of that Wizard.",
      'Inalla, Archmage Ritualist'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, commandZone: [{ id: 'bf-source', name: 'Inalla, Archmage Ritualist' }] }],
        commandZone: { p1: { commanderCards: [{ id: 'bf-source' }], inCommandZone: ['bf-source'] } },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
