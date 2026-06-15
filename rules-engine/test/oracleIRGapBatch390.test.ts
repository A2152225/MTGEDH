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
      String(gap.reasonCode) !== 'no_deterministic_target' &&
      String(gap.reasonCode) !== 'unsupported_target'
  );
  expect(gaps).toEqual([]);
  return result;
}

describe('Oracle IR gap batch 390 — general parse→execute clusters', () => {
  it('executes commander color identity add_mana', () => {
    const tower = parseOracleTextToIR(
      "Add one mana of any color in your commander's color identity.",
      'Command Tower'
    );
    const step = tower.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_mana');
    expect(step).toBeTruthy();
    expectNoGeneralGaps(
      [step!],
      {
        players: [
          {
            id: controllerId,
            commanderColorIdentity: ['W', 'U', 'B', 'R', 'G'],
            commander: { color_identity: ['W', 'U', 'B', 'R', 'G'] },
          },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );
  });

  it('executes blocking-scaler modify_pt and populate copy token', () => {
    const berserk = parseOracleTextToIR(
      'It gets +1/+1 until end of turn for each creature blocking it.',
      'Berserk Murlodont'
    );
    const modifyStep = berserk.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'modify_pt');
    expect(modifyStep).toBeTruthy();
    expectNoGeneralGaps(
      [modifyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-src', controller: controllerId, type_line: 'Creature — Beast', blockedBy: ['bf-blocker'] },
          { id: 'bf-blocker', controller: 'p2', type_line: 'Creature — Soldier', blocking: 'bf-src' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const populate = parseOracleTextToIR(
      "(Create a token that's a copy of a creature token you control.)",
      'Wake the Reflections'
    );
    const tokenStep = populate.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'create_token');
    expect(tokenStep).toBeTruthy();
    expectNoGeneralGaps(
      [tokenStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-token',
            controller: controllerId,
            isToken: true,
            type_line: 'Token Creature — Soldier',
          },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-token'] } }
    );
  });

  it('executes paradigm, prevent X, and graveyard permission clusters', () => {
    const paradigmStep = {
      kind: 'paradigm',
      raw: 'Exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.',
    };
    expectNoGeneralGaps([paradigmStep], { players: [{ id: controllerId }] } as GameState, {
      controllerId,
      sourceId: 'bf-src',
    });

    const temper = parseOracleTextToIR(
      'Prevent the next X damage that would be dealt to target creature this turn.',
      'Temper'
    );
    const preventStep = temper.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'prevent_damage');
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

    const grantStep = {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'Zombie spells' },
      permission: 'cast',
      duration: 'this_turn',
      raw: 'You may cast Zombie spells from your graveyard this turn.',
    };
    expectNoGeneralGaps(
      [grantStep],
      {
        players: [
          {
            id: controllerId,
            graveyard: [{ id: 'gy-zombie', name: 'Audit Zombie', type_line: 'Creature — Zombie', cmc: 2 }],
          },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );
  });
});
