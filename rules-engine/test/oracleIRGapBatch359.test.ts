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

describe('Oracle IR gap batch 359 — top condition clusters', () => {
  it('evaluates excess damage, renowned, another high-power creature, and treasure cast', () => {
    const state = {
      players: [{ id: controllerId }, { id: 'p2' }],
      excessDamageThisTurnByCreatureId: { 'bf-excess-target': 3 },
      treasureManaSpentToCastThisTurn: { [controllerId]: true },
      stack: [
        {
          id: 'stack-spell-1',
          controller: controllerId,
          type_line: 'Sorcery',
          manaFromTreasureSpent: true,
          manaFromTreasureSpentKnown: true,
        },
      ],
      battlefield: [
        { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human', renowned: true, power: 2 },
        { id: 'bf-big-creature', controller: controllerId, type_line: 'Creature — Giant', power: 5, toughness: 5 },
        {
          id: 'bf-excess-target',
          controller: 'p2',
          type_line: 'Creature — Beast',
          wasDealtExcessDamageThisTurn: true,
        },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'that creature was dealt excess damage this turn',
        ctx: {
          ...baseParams.ctx,
          targetCreatureId: 'bf-excess-target',
          selectorContext: { targetCreatureId: 'bf-excess-target' },
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "it's renowned",
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you control another creature with power 4 or greater',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'mana from a treasure was spent to cast this spell',
      })
    ).toBe(true);
  });

  it('executes Overclocked Electromancer excess-damage branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature deals combat damage to a creature, if that creature was dealt excess damage this turn, you get X {E}, where X is that excess damage.',
      'Overclocked Electromancer'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        excessDamageThisTurnByCreatureId: { 'bf-excess-target': 3 },
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Wizard' },
          {
            id: 'bf-excess-target',
            controller: 'p2',
            type_line: 'Creature — Beast',
            wasDealtExcessDamageThisTurn: true,
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', targetCreatureId: 'bf-excess-target' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it("executes Consul's Lieutenant renowned branch without condition gap", () => {
    const ir = parseOracleTextToIR(
      "Whenever this creature attacks, if it's renowned, other attacking creatures you control get +1/+1 until end of turn.",
      "Consul's Lieutenant"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'conditional' && entry.condition?.raw === "it's renowned"
    );
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human Soldier', renowned: true },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Nessian Hornbeetle another-power branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of combat on your turn, if you control another creature with power 4 or greater, put a +1/+1 counter on this creature.',
      'Nessian Hornbeetle'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Creature — Insect', power: 2, toughness: 2 },
          { id: 'bf-big-creature', controller: controllerId, type_line: 'Creature — Giant', power: 5, toughness: 5 },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Devour Intellect treasure-cast branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Target opponent discards a card. If mana from a Treasure was spent to cast this spell, instead that player reveals their hand, you choose a nonland card from it, then that player discards that card.',
      'Devour Intellect'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        stack: [
          {
            id: 'stack-spell-1',
            controller: controllerId,
            type_line: 'Sorcery',
            manaFromTreasureSpent: true,
            manaFromTreasureSpentKnown: true,
          },
        ],
        treasureManaSpentToCastThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-spell', targetSpellId: 'stack-spell-1', manaFromTreasureSpent: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
