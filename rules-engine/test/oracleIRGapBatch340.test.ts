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

describe('Oracle IR gap batch 340 — top condition clusters', () => {
  it('evaluates mana-ability, cast-this-way, dragon-cast, and additional-cost riders', () => {
    const state = { players: [{ id: controllerId }], battlefield: [] } as GameState;
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "it isn't a mana ability",
        ctx: { ...baseParams.ctx, activatedAbilityIsManaAbility: false },
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you cast a spell this way',
        ctx: { ...baseParams.ctx, spellCastThisWay: true },
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you revealed a dragon card or controlled a dragon as you cast this spell',
        ctx: { ...baseParams.ctx, controlledDragonAsCast: true },
      })
    ).toBe(true);
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "this spell's additional cost was paid" },
        nextState: state,
        controllerId,
        ctx: { ...baseParams.ctx, optionalAdditionalCostWasPaid: true },
        lastActionOutcome: null,
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'that creature dies this way',
        ctx: { ...baseParams.ctx, creatureDiedThisWay: true },
      })
    ).toBe(true);
  });

  it('executes Illusionist Bracers copy when ability is not a mana ability', () => {
    const ir = parseOracleTextToIR(
      "Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability. You may choose new targets for the copy.",
      "Illusionist's Bracers"
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [], stack: [{ id: 'stack-target-ability-1' }] } as GameState,
      steps as any[],
      {
        controllerId,
        sourceId: 'bf-bracers',
        activatedAbilityIsManaAbility: false,
        copyReplaySteps: [{ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw: 'Draw a card' }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Noctis finality counter when spell cast this way', () => {
    const ir = parseOracleTextToIR(
      'You may cast artifact spells from your graveyard by paying 3 life in addition to paying their other costs. If you cast a spell this way, that artifact enters with a finality counter on it.',
      'Noctis, Prince of Lucis'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId, graveyard: [], hand: [] }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'test', spellCastThisWay: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Scaleguard Sentinels dragon-cast counter rider', () => {
    const ir = parseOracleTextToIR(
      'With a +1/+1 counter on it if you revealed a Dragon card or controlled a Dragon as you cast this spell.',
      'Scaleguard Sentinels'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-scaleguard', controlledDragonAsCast: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Spirit Water Revival paid-additional-cost branch', () => {
    const ir = parseOracleTextToIR(
      "Draw two cards. If this spell's additional cost was paid, instead shuffle your graveyard into your library, draw seven cards, and you have no maximum hand size for the rest of the game.",
      'Spirit Water Revival'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId, library: [], hand: [], graveyard: [{ id: 'gy-spirit-1', name: 'Spirit GY', type_line: 'Instant' }] }],
        battlefield: [],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'test', optionalAdditionalCostWasPaid: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
