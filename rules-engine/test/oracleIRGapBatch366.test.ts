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

describe('Oracle IR gap batch 366 — top condition clusters', () => {
  it('evaluates its-vs-self stats, dethrone attack target, and unattacked opponent', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [
            { id: 'bf-source', controller: controllerId, power: 2, toughness: 2, type_line: 'Creature — Human Detective' },
            { id: 'bf-entering', controller: controllerId, power: 4, toughness: 1, type_line: 'Creature — Soldier' },
          ],
        } as GameState,
        normalizedRaw:
          "its power is greater than this creature's power or its toughness is greater than this creature's toughness",
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-entering' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [
            { id: controllerId, life: 20 },
            { id: 'p2', life: 40 },
            { id: 'p3', life: 15 },
          ],
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              defendingPlayerId: 'p2',
              attacking: true,
              type_line: 'Creature — Demon',
            },
          ],
        } as GameState,
        normalizedRaw: "it's attacking the player with the most life or tied for most life",
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [
            { id: controllerId, life: 40 },
            { id: 'p2', life: 40 },
            { id: 'p3', life: 40 },
          ],
          battlefield: [
            {
              id: 'bf-attacker',
              controller: 'p2',
              defendingPlayerId: controllerId,
              attacking: true,
              type_line: 'Creature — Soldier',
            },
          ],
        } as GameState,
        normalizedRaw: "that player has another opponent who isn't being attacked",
        ctx: { controllerId, sourceId: 'bf-skyguard', attackingPlayerId: 'p2' },
      })
    ).toBe(true);
  });

  it('executes Sharp-Eyed Rookie stat-comparison branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Vigilance\nWhenever a creature you control enters, if its power is greater than this creature's power or its toughness is greater than this creature's toughness, put a +1/+1 counter on this creature and investigate.",
      'Sharp-Eyed Rookie'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, power: 2, toughness: 2, type_line: 'Creature — Human Detective' },
          { id: 'bf-entering', controller: controllerId, power: 4, toughness: 1, type_line: 'Creature — Soldier' },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-entering' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Scourge of the Throne dethrone-style branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Flying\nDethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)\nWhenever this creature attacks for the first time each turn, if it's attacking the player with the most life or tied for most life, untap all attacking creatures. After this phase, there is an additional combat phase.",
      'Scourge of the Throne'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find(
        (entry) =>
          entry.kind === 'conditional' &&
          String((entry as any)?.condition?.raw || '').includes('most life or tied for most life')
      );
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          { id: controllerId, life: 20 },
          { id: 'p2', life: 40 },
          { id: 'p3', life: 15 },
        ],
        battlefield: [
          {
            id: 'bf-source',
            controller: controllerId,
            defendingPlayerId: 'p2',
            attacking: true,
            type_line: 'Creature — Demon',
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Suppressor Skyguard unattacked-opponent branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "Flying\nWhenever a player attacks you, if that player has another opponent who isn't being attacked, prevent all combat damage that would be dealt to you this combat.",
      'Suppressor Skyguard'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [
          { id: controllerId, life: 40 },
          { id: 'p2', life: 40 },
          { id: 'p3', life: 40 },
        ],
        battlefield: [
          { id: 'bf-skyguard', controller: controllerId, type_line: 'Creature — Angel' },
          {
            id: 'bf-attacker',
            controller: 'p2',
            defendingPlayerId: controllerId,
            attacking: true,
            type_line: 'Creature — Soldier',
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-skyguard', attackingPlayerId: 'p2' }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('returns false in two-player Suppressor Skyguard games', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "that player has another opponent who isn't being attacked" },
        nextState: {
          players: [
            { id: controllerId, life: 40 },
            { id: 'p2', life: 40 },
          ],
          battlefield: [
            {
              id: 'bf-attacker',
              controller: 'p2',
              defendingPlayerId: controllerId,
              attacking: true,
              type_line: 'Creature — Soldier',
            },
          ],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-skyguard', attackingPlayerId: 'p2' },
        lastActionOutcome: null,
      })
    ).toBe(false);
  });
});
