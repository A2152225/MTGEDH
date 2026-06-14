import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;

const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 356 — top condition clusters', () => {
  it('evaluates color-mana spent, artifact ETB, toxic target, and another creature ETB', () => {
    const state = {
      players: [{ id: controllerId }],
      stack: [
        {
          id: 'stack-spell-1',
          controller: controllerId,
          type_line: 'Creature — Elemental',
          manaSpent: { red: 2, green: 2 },
        },
      ],
      artifactEnteredThisTurn: { [controllerId]: true },
      creaturesEnteredThisTurn: { [controllerId]: 2 },
      creaturesEnteredBattlefieldThisTurnByController: { [controllerId]: 2 },
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Elemental' },
        {
          id: 'bf-toxic-target',
          controller: 'p2',
          type_line: 'Creature — Phyrexian',
          keywords: ['Toxic'],
        },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: '{R}{R} was spent to cast it',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: '{G}{G} was spent to cast it',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'an artifact entered the battlefield under your control this turn',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'that creature has toxic',
        ctx: {
          ...baseParams.ctx,
          targetCreatureId: 'bf-toxic-target',
          selectorContext: { targetCreatureId: 'bf-toxic-target' },
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'another creature entered the battlefield under your control this turn',
      })
    ).toBe(true);
  });

  it('executes Vibrance red-mana branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if {R}{R} was spent to cast it, this creature deals 3 damage to any target.',
      'Vibrance'
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
            type_line: 'Creature — Elemental',
            manaSpent: { red: 2 },
          },
        ],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Elemental' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Akal Pakal artifact-ETB branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's end step, if an artifact entered the battlefield under your control this turn, look at the top two cards of your library. Put one of them into your hand and the other into your graveyard.",
      'Akal Pakal, First Among Equals'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        artifactEnteredThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-akal' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Hexgold Slash toxic branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Hexgold Slash deals 2 damage to target creature. If that creature has toxic, Hexgold Slash deals 4 damage to that creature instead.',
      'Hexgold Slash'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          {
            id: 'bf-toxic-target',
            controller: 'p2',
            type_line: 'Creature — Phyrexian',
            keywords: ['Toxic'],
          },
        ],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-slash',
        targetCreatureId: 'bf-toxic-target',
        selectorContext: { targetCreatureId: 'bf-toxic-target' },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Waterspout Warden another-creature branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature attacks, if another creature entered the battlefield under your control this turn, this creature gains flying until end of turn.',
      'Waterspout Warden'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        creaturesEnteredThisTurn: { [controllerId]: 2 },
        creaturesEnteredBattlefieldThisTurnByController: { [controllerId]: 2 },
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Merfolk' }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
