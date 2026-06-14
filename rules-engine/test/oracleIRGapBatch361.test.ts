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
  ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-ability-1' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 361 — top condition clusters', () => {
  it('evaluates treasure-activate and that-player-most-lands conditions', () => {
    const activateState = {
      players: [{ id: controllerId }],
      stack: [
        {
          id: 'stack-ability-1',
          controller: controllerId,
          type_line: 'Creature — Human Knight',
          manaFromTreasureSpent: true,
          manaFromTreasureSpentKnown: true,
        },
      ],
      treasureManaSpentToActivateThisTurn: { [controllerId]: true },
    } as GameState;

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: activateState,
        normalizedRaw: 'mana from a treasure was spent to activate this ability',
        ctx: { ...baseParams.ctx, manaFromTreasureSpent: true },
      })
    ).toBe(true);

    const landState = {
      players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      activePlayerIndex: 1,
      battlefield: [
        { id: 'bf-p1-land', controller: 'p1', type_line: 'Basic Land — Forest' },
        { id: 'bf-p2-land-a', controller: 'p2', type_line: 'Basic Land — Island' },
        { id: 'bf-p2-land-b', controller: 'p2', type_line: 'Basic Land — Mountain' },
        { id: 'bf-p2-land-c', controller: 'p2', type_line: 'Basic Land — Swamp' },
      ],
    } as GameState;

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that player controls more lands than each other player' },
        nextState: landState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          selectorContext: { targetPlayerId: 'p2', activePlayerId: 'p2' },
        },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that player controls more lands than each other player' },
        nextState: landState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          selectorContext: { targetPlayerId: 'p1', activePlayerId: 'p1' },
        },
        lastActionOutcome: null,
      })
    ).toBe(false);
  });

  it('executes Forsworn Paladin treasure-activate branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      '{1}, {T}: Target creature gets +2/+0 until end of turn. If mana from a Treasure was spent to activate this ability, that creature also gains deathtouch until end of turn.',
      'Forsworn Paladin'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        stack: [
          {
            id: 'stack-ability-1',
            controller: controllerId,
            type_line: 'Creature — Human Knight',
            manaFromTreasureSpent: true,
            manaFromTreasureSpentKnown: true,
          },
        ],
        treasureManaSpentToActivateThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        targetSpellId: 'stack-ability-1',
        manaFromTreasureSpent: true,
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it("executes Jetmir's Fixer treasure-activate branch without condition gap", () => {
    const ir = parseOracleTextToIR(
      '{1}, Sacrifice a creature: Target creature gets +2/+0 until end of turn. If mana from a Treasure was spent to activate this ability, that creature also gains trample until end of turn.',
      "Jetmir's Fixer"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        stack: [
          {
            id: 'stack-ability-1',
            controller: controllerId,
            type_line: 'Creature — Cat Druid',
            manaFromTreasureSpent: true,
            manaFromTreasureSpentKnown: true,
          },
        ],
        treasureManaSpentToActivateThisTurn: { [controllerId]: true },
      } as GameState,
      [step!],
      {
        controllerId,
        sourceId: 'bf-source',
        targetSpellId: 'stack-ability-1',
        manaFromTreasureSpent: true,
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Rivalry most-lands branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's upkeep, if that player controls more lands than each other player, this enchantment deals 2 damage to them.",
      'Rivalry'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: 'p1' }, { id: 'p2' }],
        activePlayerIndex: 1,
        battlefield: [
          { id: 'bf-source', controller: 'p1', type_line: 'Enchantment' },
          { id: 'bf-p1-land', controller: 'p1', type_line: 'Basic Land — Forest' },
          { id: 'bf-p2-land-a', controller: 'p2', type_line: 'Basic Land — Island' },
          { id: 'bf-p2-land-b', controller: 'p2', type_line: 'Basic Land — Mountain' },
          { id: 'bf-p2-land-c', controller: 'p2', type_line: 'Basic Land — Swamp' },
        ],
      } as GameState,
      [step!],
      {
        controllerId: 'p1',
        sourceId: 'bf-source',
        selectorContext: { targetPlayerId: 'p2', activePlayerId: 'p2' },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Greener Pastures most-lands branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of each player's upkeep, if that player controls more lands than each other player, that player gains 1 life.",
      'Greener Pastures'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: 'p1' }, { id: 'p2' }],
        activePlayerIndex: 1,
        battlefield: [
          { id: 'bf-source', controller: 'p1', type_line: 'Enchantment' },
          { id: 'bf-p1-land', controller: 'p1', type_line: 'Basic Land — Forest' },
          { id: 'bf-p2-land-a', controller: 'p2', type_line: 'Basic Land — Island' },
          { id: 'bf-p2-land-b', controller: 'p2', type_line: 'Basic Land — Mountain' },
          { id: 'bf-p2-land-c', controller: 'p2', type_line: 'Basic Land — Swamp' },
        ],
      } as GameState,
      [step!],
      {
        controllerId: 'p1',
        sourceId: 'bf-source',
        selectorContext: { targetPlayerId: 'p2', activePlayerId: 'p2' },
      }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
