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
  lastActionOutcome: { kind: 'applied', stepKind: 'prevent_damage' } as any,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 363 — top condition clusters', () => {
  it('evaluates prevented-damage source kinds and kicked-twice', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { players: [{ id: controllerId }] } as GameState,
        normalizedRaw: 'damage from a creature source is prevented this way',
        ctx: {
          ...baseParams.ctx,
          creatureDamagePreventedThisWay: true,
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { players: [{ id: controllerId }] } as GameState,
        normalizedRaw: 'damage from a noncreature source is prevented this way',
        ctx: {
          ...baseParams.ctx,
          noncreatureDamagePreventedThisWay: true,
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { players: [{ id: controllerId }] } as GameState,
        normalizedRaw: 'damage from a creature source is prevented this way',
        ctx: {
          ...baseParams.ctx,
          noncreatureDamagePreventedThisWay: true,
        },
      })
    ).toBe(false);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was kicked twice' },
        nextState: {
          players: [{ id: controllerId }],
          stack: [
            {
              id: 'stack-spell-1',
              controller: controllerId,
              type_line: 'Creature — Angel',
              wasKickedTwice: true,
              kickedTimes: 2,
            },
          ],
        } as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          targetSpellId: 'stack-spell-1',
        },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was kicked twice' },
        nextState: {
          players: [{ id: controllerId }],
          stack: [{ id: 'stack-spell-1', controller: controllerId, wasKicked: true, kickedTimes: 1 }],
        } as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          targetSpellId: 'stack-spell-1',
        },
        lastActionOutcome: null,
      })
    ).toBe(null);
  });

  it('executes Comeuppance creature-prevent branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Prevent all damage that would be dealt to you and planeswalkers you control this turn by sources you don't control. If damage from a creature source is prevented this way, Comeuppance deals that much damage to that creature.",
      'Comeuppance'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find(
        (entry) =>
          entry.kind === 'conditional' &&
          String((entry as any).condition?.raw || '').toLowerCase().includes('creature source')
      );
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }] } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        creatureDamagePreventedThisWay: true,
        lastActionOutcome: { kind: 'applied', stepKind: 'prevent_damage' },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Comeuppance noncreature-prevent branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Prevent all damage that would be dealt to you and planeswalkers you control this turn by sources you don't control. If damage from a noncreature source is prevented this way, Comeuppance deals that much damage to the source's controller.",
      'Comeuppance'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find(
        (entry) =>
          entry.kind === 'conditional' &&
          String((entry as any).condition?.raw || '').toLowerCase().includes('noncreature source')
      );
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }] } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        noncreatureDamagePreventedThisWay: true,
        lastActionOutcome: { kind: 'applied', stepKind: 'prevent_damage' },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Archangel of Wrath kicked-twice branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if it was kicked twice, it deals 2 damage to any target.',
      'Archangel of Wrath'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        stack: [
          {
            id: 'stack-spell-1',
            controller: controllerId,
            type_line: 'Creature — Angel',
            wasKickedTwice: true,
            kickedTimes: 2,
          },
        ],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        targetSpellId: 'stack-spell-1',
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('returns null for kicked-twice without explicit evidence', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was kicked twice' },
        nextState: { players: [{ id: controllerId }] } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(null);
  });
});
