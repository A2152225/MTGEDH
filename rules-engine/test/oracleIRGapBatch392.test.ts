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

describe('Oracle IR gap batch 392 — general parse→execute clusters', () => {
  it('executes add mana combination, gy-return life chain, and they lose life', () => {
    const addManaStep = parseOracleTextToIR(
      'Add X mana in any combination of {G} and/or {W}.',
      'Saltcrusted Steppe'
    ).abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_mana');
    expect(addManaStep).toBeTruthy();
    expectNoGeneralGaps([addManaStep!], { players: [{ id: controllerId }] } as GameState, {
      controllerId,
      sourceId: 'bf-src',
      xValue: 3,
      selectorContext: { chosenMana: '{R}' },
    });

    const steps = [
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target card from your graveyard' },
        to: 'hand',
        raw: 'return target card from your graveyard to your hand',
      },
      {
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' },
        raw: "You gain life equal to that card's mana value",
      },
    ];
    expectNoGeneralGaps(
      steps,
      {
        players: [
          {
            id: controllerId,
            graveyard: [{ id: 'gy-1', name: 'Returned', type_line: 'Instant', cmc: 4, manaValue: 4 }],
          },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['gy-1'] } }
    );

    expectNoGeneralGaps(
      [
        {
          kind: 'lose_life',
          who: { kind: 'target_player' },
          amount: { kind: 'number', value: 3 },
          raw: 'they lose 3 life',
        },
      ],
      { players: [{ id: controllerId }, { id: 'p2' }] } as GameState,
      { controllerId, selectorContext: { targetPlayerId: 'p2' } }
    );
  });

  it('executes fight early path and token amount where-X patterns', () => {
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
        lastMovedBattlefieldPermanentIds: ['bf-a', 'bf-b'],
        selectorContext: { chosenObjectIds: ['bf-a', 'bf-b'] },
      }
    );

    const tokenStep = parseOracleTextToIR(
      'Create X 2/2 black Zombie Berserker creature tokens, where X is the number of nontoken creatures that died this turn.',
      'Rise of the Dread Marn'
    ).abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'create_token');
    expect(tokenStep).toBeTruthy();
    expectNoGeneralGaps(
      [tokenStep!],
      {
        players: [{ id: controllerId }],
        nontokenCreaturesDiedThisTurnByController: { p1: 2 },
      } as GameState,
      { controllerId, sourceId: 'bf-src', xValue: 2 }
    );
  });

  it('executes modify_pt double, tribal unity, and forest scaler', () => {
    const doubleStep = parseOracleTextToIR(
      "Two-Weapon Fighting - Double target creature's power and toughness until end of turn.",
      'Choose Your Weapon'
    ).abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'modify_pt');
    expect(doubleStep).toBeTruthy();
    expectNoGeneralGaps(
      [doubleStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-target',
            controller: controllerId,
            type_line: 'Creature — Human',
            power: 2,
            toughness: 3,
          },
        ],
      } as GameState,
      {
        controllerId,
        targetCreatureId: 'bf-target',
        selectorContext: { targetCreatureId: 'bf-target', chosenObjectIds: ['bf-target'] },
      }
    );

    const tribalStep = parseOracleTextToIR(
      'Creatures of the creature type of your choice get +X/+X until end of turn.',
      'Tribal Unity'
    ).abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'modify_pt');
    expect(tribalStep).toBeTruthy();
    expectNoGeneralGaps(
      [tribalStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-human', controller: controllerId, type_line: 'Creature — Human', power: 1, toughness: 1 },
        ],
      } as GameState,
      {
        controllerId,
        xValue: 2,
        selectorContext: { chosenCreatureType: 'Human' },
      }
    );
  });
});
