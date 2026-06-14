import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
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

describe('Oracle IR gap batch 357 — top condition clusters', () => {
  it('evaluates same-name permanent, clues sacrificed, prowl paid, and lesson in graveyard', () => {
    const state = {
      players: [
        {
          id: controllerId,
          graveyard: [{ id: 'gy-lesson-1', name: 'Introduction to Prophecy', type_line: 'Sorcery — Lesson' }],
        },
      ],
      cluesSacrificedThisTurn: { [controllerId]: 3 },
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Faerie', prowlCostWasPaid: true },
        { id: 'bf-named-perm', controller: 'p2', name: 'Lightning Bolt', type_line: 'Instant' },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'it has the same name as a permanent',
        lastMovedCards: [{ id: 'lib-card-1', name: 'Lightning Bolt', type_line: 'Instant' }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you sacrificed three or more Clues this turn',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'its prowl cost was paid',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "there's a lesson card in your graveyard",
      })
    ).toBe(true);
  });

  it('executes Mitotic Manipulation same-name branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Look at the top seven cards of your library. You may put one of those cards onto the battlefield if it has the same name as a permanent. Put the rest on the bottom of your library in any order.',
      'Mitotic Manipulation'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-named-perm', controller: 'p2', name: 'Lightning Bolt', type_line: 'Instant' }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-spell',
        lastMovedCards: [{ id: 'lib-card-1', name: 'Lightning Bolt', type_line: 'Instant' }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Briarbridge Patrol clues branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, if you sacrificed three or more Clues this turn, you may put a creature card from your hand onto the battlefield.',
      'Briarbridge Patrol'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, hand: [{ id: 'h-creature', type_line: 'Creature — Human' }] }],
        cluesSacrificedThisTurn: { [controllerId]: 3 },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-patrol' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Latchkey Faerie prowl branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if its prowl cost was paid, draw a card.',
      'Latchkey Faerie'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Faerie', prowlCostWasPaid: true },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Dragonfly Swarm lesson branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "When this creature dies, if there's a Lesson card in your graveyard, draw a card.",
      'Dragonfly Swarm'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          {
            id: controllerId,
            graveyard: [{ id: 'gy-lesson-1', name: 'Introduction to Prophecy', type_line: 'Sorcery — Lesson' }],
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-swarm' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
