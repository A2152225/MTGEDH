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

describe('Oracle IR gap batch 347 — top condition clusters', () => {
  it('evaluates dragon beheld, no artifacts, empty battlefield, and nontoken', () => {
    const state = {
      players: [{ id: controllerId }],
      battlefield: [
        { id: 'bf-nontoken-creature', controller: controllerId, type_line: 'Creature — Human', isToken: false },
        { id: 'bf-land-1', controller: controllerId, type_line: 'Basic Land — Forest' },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'a dragon was beheld',
        ctx: { ...baseParams.ctx, beheldQuality: 'dragon' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you control no artifacts',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { ...state, battlefield: [] } as GameState,
        normalizedRaw: 'no creatures are on the battlefield',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it's not a token" },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, targetPermanentId: 'bf-nontoken-creature' },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('executes Osseous Exhale dragon-beheld branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Exhale — Behold a Dragon. This permanent deals 5 damage to target attacking or blocking creature. If a Dragon was beheld, you gain 2 life.',
      'Osseous Exhale'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((entry) => entry.kind === 'conditional' && /dragon was beheld/i.test(entry.raw || ''));
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-exhale', beheldQuality: 'dragon' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it("executes Tezzeret's Ambition no-artifacts branch without condition gap", () => {
    const ir = parseOracleTextToIR(
      "Draw three cards. If you control no artifacts, discard a card.",
      "Tezzeret's Ambition"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }] }],
        battlefield: [{ id: 'bf-land-1', controller: controllerId, type_line: 'Basic Land — Island' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'stack-spell-1' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Pyrohemia empty-battlefield branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if no creatures are on the battlefield, sacrifice this enchantment.',
      'Pyrohemia'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-pyrohemia', controller: controllerId, type_line: 'Enchantment' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-pyrohemia' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Life of the Party nontoken branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "If it's not a token, each opponent creates a token that's a copy of it.",
      'Life of the Party'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-nontoken-creature', controller: controllerId, type_line: 'Creature — Human', isToken: false },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-party', targetPermanentId: 'bf-nontoken-creature' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
