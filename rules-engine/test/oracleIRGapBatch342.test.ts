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

describe('Oracle IR gap batch 342 — top condition clusters', () => {
  it('evaluates was-cast, crime, legendary, and ring-bearer riders', () => {
    const state = {
      players: [{ id: controllerId }],
      battlefield: [
        { id: 'bf-legendary-creature', controller: controllerId, type_line: 'Legendary Creature — Human' },
      ],
    } as GameState;
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was cast' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, wasCast: true, castFromZone: 'hand' },
        lastActionOutcome: null,
      })
    ).toBe(true);
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you've committed a crime this turn" },
        nextState: { ...state, committedCrimeThisTurn: { [controllerId]: true } } as GameState,
        controllerId,
        ctx: baseParams.ctx,
        lastActionOutcome: null,
      })
    ).toBe(true);
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it's legendary" },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, targetPermanentId: 'bf-legendary-creature' },
        lastActionOutcome: null,
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you chose a creature other than this permanent as your ring-bearer',
        ctx: { ...baseParams.ctx, chosenRingBearerId: 'bf-creature-1' },
      })
    ).toBe(true);
  });

  it('executes Wedding Ring cast rider without condition gap', () => {
    const ir = parseOracleTextToIR(
      "When this artifact enters, if it was cast, target opponent creates a token that's a copy of it.",
      'Wedding Ring'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }, { id: 'p2' }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-wedding-ring', wasCast: true, castFromZone: 'hand', targetOpponentId: 'p2' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Servant of the Stinger crime branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Whenever this creature deals combat damage to a player, if you've committed a crime this turn, you may sacrifice this creature.",
      'Servant of the Stinger'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature' }],
        committedCrimeThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it("executes Gimli's Fury legendary trample branch without condition gap", () => {
    const ir = parseOracleTextToIR(
      "Target creature gets +3/+2 until end of turn. If it's legendary, it also gains trample until end of turn.",
      "Gimli's Fury"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-legendary-creature', controller: controllerId, type_line: 'Legendary Creature — Dwarf Warrior' },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'test', targetPermanentId: 'bf-legendary-creature' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Aragorn ring-bearer branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever the Ring tempts you, if you chose a creature other than this permanent as your Ring-bearer, put your choice of a counter from among first strike, vigilance, deathtouch, and lifelink on this permanent.',
      'Aragorn, Company Leader'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId, ringBearerId: 'bf-creature-1' }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-aragorn', chosenRingBearerId: 'bf-creature-1' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
