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

describe('Oracle IR gap batch 350 — top condition clusters', () => {
  it('evaluates minus counter, life lost last turn, not your turn, and equipped', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      activePlayerIndex: 1,
      lifeLostLastTurnByPlayerCounts: { [controllerId]: 2 },
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'it had a -1/-1 counter on it',
        lastMovedCards: [{ id: 'bf-died', type_line: 'Creature — Zombie', counters: { '-1/-1': 1 } }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you lost life last turn',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "it's not your turn",
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          ...state,
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              type_line: 'Legendary Creature — Human Samurai',
              isEquipped: true,
              attachedEquipment: ['bf-sword-1'],
            },
          ],
        } as GameState,
        normalizedRaw: "it's equipped",
      })
    ).toBe(true);
  });

  it('executes Retched Wretch minus-counter branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "When this creature dies, if it had a -1/-1 counter on it, return it to the battlefield under its owner's control and it loses all abilities.",
      'Retched Wretch'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-wretch',
        lastMovedCards: [{ id: 'bf-wretch', type_line: 'Creature — Zombie', counters: { '-1/-1': 1 } }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes First Response life-lost branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each upkeep, if you lost life last turn, create a 1/1 white Soldier creature token.',
      'First Response'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        lifeLostLastTurnByPlayerCounts: { [controllerId]: 1 },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-response' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Zealous Display not-your-turn branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Creatures you control get +2/+0 until end of turn. If it's not your turn, untap those creatures.",
      'Zealous Display'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        activePlayerIndex: 1,
        battlefield: [{ id: 'bf-creature-1', controller: controllerId, type_line: 'Creature — Human', tapped: true }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-display' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Tetsuo equipped branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Whenever Tetsuo attacks, if it's equipped, choose one —\n• Tetsuo deals damage equal to the greatest mana value among Equipment attached to it to any target.",
      'Tetsuo, Imperial Champion'
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
            type_line: 'Legendary Creature — Human Samurai',
            isEquipped: true,
            attachedEquipment: ['bf-equip-1'],
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
