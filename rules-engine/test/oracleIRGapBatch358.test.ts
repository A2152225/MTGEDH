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

describe('Oracle IR gap batch 358 — top condition clusters', () => {
  it('evaluates cast-both, enchanted power, underpay cast, and creature damage this way', () => {
    const state = {
      players: [{ id: controllerId }],
      spellsCastThisTurn: { [controllerId]: 2 },
      noncreatureSpellsCastThisTurn: { [controllerId]: 1 },
      castBothCreatureAndNoncreatureSpellThisTurn: { [controllerId]: true },
      stack: [
        {
          id: 'stack-spell-1',
          controller: controllerId,
          type_line: 'Instant',
          manaValue: 5,
          manaSpentTotal: 2,
        },
      ],
      battlefield: [
        {
          id: 'bf-source',
          controller: controllerId,
          type_line: 'Enchantment — Aura',
          attachedTo: 'bf-enchanted-creature',
        },
        {
          id: 'bf-enchanted-creature',
          controller: controllerId,
          type_line: 'Creature — Beast',
          power: 5,
          toughness: 5,
        },
      ],
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "you've cast both a creature spell and a noncreature spell this turn",
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "enchanted creature's power is 4 or greater",
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'the amount of mana spent to cast it was less than its mana value',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'a creature is dealt damage this way',
        lastActionOutcome: { kind: 'applied', stepKind: 'deal_damage' },
        ctx: {
          ...baseParams.ctx,
          creatureDealtDamageThisWay: true,
          lastDamagedCards: [{ id: 'bf-damaged', type_line: 'Creature — Goblin' }],
        },
      })
    ).toBe(true);
  });

  it('executes Eshki Dragonclaw cast-both branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of combat on your turn, if you've cast both a creature spell and a noncreature spell this turn, draw a card and put two +1/+1 counters on Eshki Dragonclaw.",
      'Eshki Dragonclaw'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        spellsCastThisTurn: { [controllerId]: 2 },
        noncreatureSpellsCastThisTurn: { [controllerId]: 1 },
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-eshki' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Domestication enchanted-power branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of your end step, if enchanted creature's power is 4 or greater, sacrifice this Aura.",
      'Domestication'
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
            type_line: 'Enchantment — Aura',
            attachedTo: 'bf-enchanted-creature',
          },
          {
            id: 'bf-enchanted-creature',
            controller: controllerId,
            type_line: 'Creature — Beast',
            power: 5,
            toughness: 5,
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Tokka & Rahzar underpay branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever a player casts a spell, if the amount of mana spent to cast it was less than its mana value, Tokka & Rahzar deal 3 damage to that player.',
      'Tokka & Rahzar, Terrible Twos'
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
            type_line: 'Instant',
            manaValue: 5,
            manaSpentTotal: 2,
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-tokka', targetSpellId: 'stack-spell-1' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Burn from Within creature-damage branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      'Burn from Within deals X damage to any target. If a creature is dealt damage this way, it loses indestructible until end of turn. If that creature would die this turn, exile it instead.',
      'Burn from Within'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'conditional' && entry.condition?.raw === 'a creature is dealt damage this way'
    );
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-burn',
        creatureDealtDamageThisWay: true,
        lastDamagedCards: [{ id: 'bf-target', type_line: 'Creature — Goblin' }],
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
