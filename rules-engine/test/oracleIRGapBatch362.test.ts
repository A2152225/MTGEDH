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

describe('Oracle IR gap batch 362 — top condition clusters', () => {
  it('evaluates thopter-only-self, opponent-discard, and two-players-lost conditions', () => {
    const thopterState = {
      players: [{ id: controllerId }],
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Artifact Creature — Thopter' },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: thopterState,
        normalizedRaw: 'you control no thopters other than this creature',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          ...thopterState,
          battlefield: [
            ...thopterState.battlefield!,
            { id: 'bf-other-thopter', controller: controllerId, type_line: 'Artifact Creature — Thopter' },
          ],
        } as GameState,
        normalizedRaw: 'you control no thopters other than this creature',
      })
    ).toBe(false);

    const discardState = {
      players: [{ id: controllerId }, { id: 'p2' }],
      discardedCardThisTurn: { [controllerId]: false, p2: true },
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'an opponent discarded a card this turn' },
        nextState: discardState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    const lostState = {
      players: [
        { id: 'p1', hasLost: false },
        { id: 'p2', hasLost: false },
        { id: 'p3', hasLost: true },
        { id: 'p4', hasLost: true },
      ],
      playersLostCount: 2,
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: lostState,
        normalizedRaw: 'two or more players have lost the game',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [
            { id: 'p1', hasLost: false },
            { id: 'p2', hasLost: true },
          ],
        } as GameState,
        normalizedRaw: 'two or more players have lost the game',
      })
    ).toBe(false);
  });

  it('executes Thopter Assembly upkeep branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of your upkeep, if you control no Thopters other than this creature, return this creature to its owner's hand and create five 1/1 colorless Thopter artifact creature tokens with flying.",
      'Thopter Assembly'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Artifact Creature — Thopter' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Tinybones opponent-discard branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, if an opponent discarded a card this turn, you draw a card and you lose 1 life.',
      'Tinybones, Trinket Thief'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        discardedCardThisTurn: { [controllerId]: false, p2: true },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Hot Pursuit two-players-lost branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of combat on your turn, if two or more players have lost the game, gain control of all goaded and/or suspected creatures until end of turn.',
      'Hot Pursuit'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          { id: controllerId, hasLost: false },
          { id: 'p2', hasLost: false },
          { id: 'p3', hasLost: true },
          { id: 'p4', hasLost: true },
        ],
        playersLostCount: 2,
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Enchantment' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('evaluates opponent-discard as false when no opponent discarded', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'an opponent discarded a card this turn' },
        nextState: {
          players: [{ id: controllerId }, { id: 'p2' }],
          discardedCardThisTurn: { [controllerId]: true, p2: false },
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(false);
  });
});
