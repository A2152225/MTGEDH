import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const controllerId = 'p1' as PlayerID;

function expectNoGeneralGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  const gaps = (result.automationGaps || []).filter(
    (gap) =>
      !['player_choice_required'].includes(String(gap.reasonCode)) &&
      String(gap.reasonCode) !== 'no_deterministic_target'
  );
  expect(gaps).toEqual([]);
  return result;
}

describe('Oracle IR gap batch 391 — general parse→execute clusters', () => {
  it('executes target artifact-or-creature copy tokens', () => {
    const step = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      token: 'copy of target artifact or creature you control',
      raw: "Create a token that's a copy of target artifact or creature you control",
    };
    expectNoGeneralGaps(
      [step],
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-creature-1',
            controller: controllerId,
            type_line: 'Creature — Elf',
            power: 2,
            toughness: 2,
          },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        targetCreatureId: 'bf-creature-1',
        selectorContext: { chosenObjectIds: ['bf-creature-1'], targetCreatureId: 'bf-creature-1' },
      }
    );
  });

  it('executes fight, defending-player damage, and milled-card draw', () => {
    const fight = parseOracleTextToIR('Then those creatures fight each other.', 'Malamet Battle Glyph');
    const fightStep = fight.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'deal_damage');
    expect(fightStep).toBeTruthy();
    expectNoGeneralGaps(
      [fightStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-a', controller: controllerId, type_line: 'Creature — Cat', power: 2, toughness: 2 },
          { id: 'bf-b', controller: 'p2', type_line: 'Creature — Snake', power: 3, toughness: 2 },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        lastMovedBattlefieldPermanentIds: ['bf-a', 'bf-b'],
        selectorContext: { chosenObjectIds: ['bf-a', 'bf-b'] },
      }
    );

    const defending = parseOracleTextToIR(
      'This permanent deals damage equal to its power to defending player.',
      'Squall, Gunblade Duelist'
    );
    const damageStep = defending.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'deal_damage');
    expect(damageStep).toBeTruthy();
    expectNoGeneralGaps(
      [damageStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-src', controller: controllerId, type_line: 'Creature — Human', power: 4, toughness: 3 },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { targetOpponentId: 'p2' } }
    );

    const drawStep = {
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: "the milled card's mana value" },
      raw: "then draw cards equal to the milled card's mana value",
    };
    expectNoGeneralGaps(
      [drawStep],
      { players: [{ id: controllerId, library: [{ id: 'lib-1', name: 'Top', type_line: 'Instant' }] }] } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        lastMovedCards: [{ id: 'milled-1', name: 'Milled', type_line: 'Instant', cmc: 4, manaValue: 4 }],
      }
    );
  });

  it('executes modify_pt scalers, prevent X to creature, and add mana combination', () => {
    const modifyStep = {
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'target creature' },
      power: { kind: 'number', value: 2 },
      toughness: { kind: 'number', value: 2 },
      duration: 'end_of_turn',
      scaler: { kind: 'reference_amount', raw: 'for each of its colors' },
      raw: 'Target creature gets +2/+2 until end of turn for each of its colors',
    };
    expectNoGeneralGaps(
      [modifyStep],
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-target',
            controller: controllerId,
            type_line: 'Creature — Human',
            colors: ['W', 'U'],
            power: 1,
            toughness: 1,
          },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        targetCreatureId: 'bf-target',
        selectorContext: { targetCreatureId: 'bf-target', chosenObjectIds: ['bf-target'] },
      }
    );

    const preventStep = parseOracleTextToIR(
      'Prevent the next X damage that would be dealt to target creature this turn.',
      'Temper'
    ).abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'prevent_damage');
    expect(preventStep).toBeTruthy();
    expectNoGeneralGaps(
      [preventStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human' }],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        xValue: 3,
        targetCreatureId: 'bf-target',
        selectorContext: { targetCreatureId: 'bf-target', chosenObjectIds: ['bf-target'] },
      }
    );

    const addManaStep = parseOracleTextToIR(
      'Add X mana in any combination of {G} and/or {W}.',
      'Saltcrusted Steppe'
    ).abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_mana');
    expect(addManaStep).toBeTruthy();
    expectNoGeneralGaps(
      [addManaStep!],
      { players: [{ id: controllerId }] } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        xValue: 3,
        selectorContext: { chosenMana: '{G}{W}' },
      }
    );
  });
});
