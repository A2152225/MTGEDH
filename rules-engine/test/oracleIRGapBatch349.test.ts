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

describe('Oracle IR gap batch 349 — top condition clusters', () => {
  it('evaluates kicked spell, human type, uncast entry, and planeswalker ETB', () => {
    const state = {
      players: [{ id: controllerId }],
      stack: [{ id: 'stack-spell-1', controller: controllerId, type_line: 'Instant', wasKicked: true }],
      planeswalkerEnteredThisTurn: { [controllerId]: true },
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that spell was kicked' },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, targetSpellId: 'stack-spell-1' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'it was a human',
        ctx: {
          ...baseParams.ctx,
          lastMovedCards: [{ id: 'bf-human', type_line: 'Creature — Human' }],
        },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it wasn't cast" },
        nextState: {
          ...state,
          battlefield: [
            { id: 'bf-uncast', controller: controllerId, type_line: 'Creature — Elf', enteredFromZone: 'library' },
          ],
        } as GameState,
        controllerId,
        ctx: { ...baseParams.ctx, wasCast: false, targetPermanentId: 'bf-uncast' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'a planeswalker entered the battlefield under your control this turn',
      })
    ).toBe(true);
  });

  it('executes Hallar kicked-spell branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever you cast a spell, if that spell was kicked, put a +1/+1 counter on this permanent. Then this permanent deals damage equal to that spell\'s mana value to each of up to one target.',
      'Hallar, the Firefletcher'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        stack: [{ id: 'stack-spell-1', controller: controllerId, type_line: 'Instant', wasKicked: true, manaValue: 3 }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Legendary Creature — Elf Shaman' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it("executes Slayer's Plate human branch without condition gap", () => {
    const ir = parseOracleTextToIR(
      'Whenever equipped creature dies, if it was a Human, create a 1/1 white Spirit creature token with flying.',
      "Slayer's Plate"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-plate',
        targetPermanentId: 'bf-human-creature',
        lastMovedCards: [{ id: 'bf-human-creature', type_line: 'Creature — Human' }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Rapid Augmenter uncast branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Whenever a creature enters the battlefield under your control, if it wasn't cast, put a +1/+1 counter on that creature and that creature can't be blocked this turn.",
      'Rapid Augmenter'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-uncast-creature', controller: controllerId, type_line: 'Creature — Elf', enteredFromZone: 'library' },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-augmenter', wasCast: false, targetPermanentId: 'bf-uncast-creature' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Oath of Liliana planeswalker ETB branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, if a planeswalker entered the battlefield under your control this turn, create a 2/2 black Zombie creature token.',
      'Oath of Liliana'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [],
        planeswalkerEnteredThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-oath' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
