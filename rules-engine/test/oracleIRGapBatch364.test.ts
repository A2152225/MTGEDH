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

describe('Oracle IR gap batch 364 — top condition clusters', () => {
  it('evaluates warrior damage, permanent entered, and another +1/+1 counter', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [{ id: 'bf-warrior-source', controller: 'p2', type_line: 'Creature — Human Warrior' }],
        } as GameState,
        normalizedRaw: 'any of that damage was dealt by a warrior',
        ctx: {
          ...baseParams.ctx,
          damageIncludedWarriorSource: true,
          damageSourcePermanentIds: ['bf-warrior-source'],
        },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'this permanent entered this turn' },
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Soldier', enteredThisTurn: true }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Merfolk' },
            { id: 'bf-counter-creature', controller: controllerId, type_line: 'Creature — Elf', counters: { '+1/+1': 1 } },
          ],
        } as GameState,
        normalizedRaw: 'you control another creature with a +1/+1 counter on it',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Merfolk' }],
        } as GameState,
        normalizedRaw: 'you control another creature with a +1/+1 counter on it',
      })
    ).toBe(false);
  });

  it('executes Mindblade Render warrior-damage branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior, you draw a card and you lose 1 life.',
      'Mindblade Render'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [{ id: 'bf-warrior-source', controller: 'p2', type_line: 'Creature — Human Warrior' }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        damageIncludedWarriorSource: true,
        damageSourcePermanentIds: ['bf-warrior-source'],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Hixus entered-this-turn branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this permanent enters, if this permanent entered this turn, exile that creature until this permanent leaves the battlefield.',
      'Hixus, Prison Warden'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Soldier', enteredThisTurn: true }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Zegana another-counter branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if you control another creature with a +1/+1 counter on it, draw a card.',
      'Zegana, Utopian Speaker'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Merfolk Wizard' },
          { id: 'bf-counter-creature', controller: controllerId, type_line: 'Creature — Elf', counters: { '+1/+1': 1 } },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('returns null for warrior damage without source refs', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { players: [{ id: controllerId }] } as GameState,
        normalizedRaw: 'any of that damage was dealt by a warrior',
      })
    ).toBe(null);
  });
});
