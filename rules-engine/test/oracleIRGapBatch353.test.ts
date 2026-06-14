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

describe('Oracle IR gap batch 353 — top condition clusters', () => {
  it('evaluates life loss threshold, enchant/equip, exiled type match, and no tapped lands', () => {
    const state = {
      players: [
        { id: 'p1', exile: [{ id: 'ex-1', type_line: 'Creature — Human', exiledWithSourceId: 'bf-source' }] },
        { id: 'p2' },
      ],
      lifeLostThisTurn: { p2: 5 },
      stack: [{ id: 'stack-spell-1', type_line: 'Creature — Elf', card: { type_line: 'Creature — Elf' } }],
      battlefield: [{ id: 'bf-land-1', controller: controllerId, type_line: 'Basic Land — Forest', tapped: false }],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'a player lost 4 or more life this turn',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'it was enchanted or equipped',
        lastMovedCards: [{ id: 'bf-died', type_line: 'Creature — Human', wasEquipped: true }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'it shares a card type with the exiled card',
        ctx: { ...baseParams.ctx, targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you control no tapped lands',
      })
    ).toBe(true);
  });

  it('executes Y\'shtola life-loss branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card.',
      "Y'shtola, Night's Blessed"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        lifeLostThisTurn: { p2: 4 },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-ysh' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Koll enchant/equip branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever another nontoken creature you control dies, if it was enchanted or equipped, return it to its owner\'s hand.',
      'Koll, the Forgemaster'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-koll',
        lastMovedCards: [{ id: 'bf-died', type_line: 'Creature — Human', wasEnchanted: true }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Cemetery Protector exiled-type branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever you play a land or cast a spell, if it shares a card type with the exiled card, create a 1/1 white Human creature token.',
      'Cemetery Protector'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          {
            id: controllerId,
            exile: [{ id: 'ex-1', type_line: 'Creature — Human', exiledWithSourceId: 'bf-source' }],
          },
        ],
        stack: [{ id: 'stack-spell-1', type_line: 'Creature — Elf', card: { type_line: 'Creature — Elf' } }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Nantuko Shaman no-tapped-lands branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, if you control no tapped lands, draw a card.',
      'Nantuko Shaman'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-land-1', controller: controllerId, type_line: 'Basic Land — Forest', tapped: false }],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-shaman' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
