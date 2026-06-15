import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const controllerId = 'p1' as PlayerID;

function expectNoTargetGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_target')).toBe(false);
  return result;
}

describe('Oracle IR gap batch 384 — target clusters (Track E2)', () => {
  it('prunes parenthetical those-creatures attack and optional swamp sacrifice misparses', () => {
    const aurification = parseOracleTextToIR(
      '(Those creatures can\'t attack as long as this artifact remains on the battlefield.)',
      'Aurification'
    );
    expect(
      aurification.abilities.flatMap((a) => a.steps || []).some((step) => step.kind === 'cant_attack')
    ).toBe(false);

    const akuta = parseOracleTextToIR('You may sacrifice a Swamp.', 'Akuta, Born of Ash');
    expect(akuta.abilities.flatMap((a) => a.steps || []).some((step) => step.kind === 'sacrifice')).toBe(false);
  });

  it('executes exhaustion, other-creatures cant attack, and any-number cant block clusters', () => {
    const exhaustion = parseOracleTextToIR(
      "Creatures and lands target opponent controls don't untap during their next untap step.",
      'Exhaustion'
    );
    const skipStep = exhaustion.abilities[0].steps?.find((step) => step.kind === 'skip_next_untap');
    expect(skipStep).toBeTruthy();
    expectNoTargetGaps(
      [skipStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-land', controller: 'p2', type_line: 'Land' },
          { id: 'bf-creature', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { targetOpponentId: 'p2' } }
    );

    const intimidation = parseOracleTextToIR(
      "Tap target creature.\nOther creatures can't attack this turn.",
      'Intimidation Bolt'
    );
    const cantAttackStep = intimidation.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'cant_attack');
    expect(cantAttackStep).toBeTruthy();
    expectNoTargetGaps(
      [cantAttackStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-tapped', controller: 'p2', type_line: 'Creature — Human' },
          { id: 'bf-other', controller: 'p2', type_line: 'Creature — Elf' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', targetPermanentId: 'bf-tapped', targetCreatureId: 'bf-tapped' }
    );

    const blinding = parseOracleTextToIR("Any number of target creatures can't block this turn.", 'Blinding Flare');
    const cantBlockStep = blinding.abilities[0].steps?.find((step) => step.kind === 'cant_block');
    expect(cantBlockStep).toBeTruthy();
    expectNoTargetGaps(
      [cantBlockStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-1', controller: 'p2', type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-1'] } }
    );
  });

  it('executes distribute counters, exile-the-other, and destroy chosen permanents clusters', () => {
    const blessing = parseOracleTextToIR(
      'Distribute X +1/+1 counters among any number of creatures you control, where X is the amount of {S} spent to cast this spell.',
      'Blessing of Frost'
    );
    const distributeStep = blessing.abilities[0].steps?.find((step) => step.kind === 'add_counter');
    expect(distributeStep).toBeTruthy();
    expectNoTargetGaps(
      [distributeStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-c1', controller: controllerId, type_line: 'Creature — Human' },
          { id: 'bf-c2', controller: controllerId, type_line: 'Creature — Elf' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', xValue: 2, snowManaSpent: 2, selectorContext: { chosenObjectIds: ['bf-c1', 'bf-c2'] } }
    );

    const karn = parseOracleTextToIR(
      'Look at the top five cards of your library. Exile one of them face down and put the rest on the bottom in a random order. exile the other with a silver counter on it.',
      'Karn, Scion of Urza'
    );
    const exileStep = karn.abilities.flatMap((a) => a.steps || []).find((s) => /exile the other/i.test(String(s.raw || '')));
    expect(exileStep).toBeTruthy();
    expectNoTargetGaps(
      [exileStep!],
      {
        players: [{ id: controllerId, library: [{ id: 'lib-1' }, { id: 'lib-2' }], exile: [] }],
        battlefield: [],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        lastMovedCards: [
          { id: 'lib-1', type_line: 'Artifact' },
          { id: 'lib-2', type_line: 'Instant' },
        ],
        selectorContext: { chosenObjectIds: ['lib-1'] },
      }
    );

    const meteor = parseOracleTextToIR('Destroy the chosen permanents.', 'Ultimate Magic: Meteor');
    const destroyStep = meteor.abilities[0].steps?.find((step) => step.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    const destroyResult = expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-d1', controller: 'p2', type_line: 'Creature — Dragon' },
          { id: 'bf-d2', controller: 'p2', type_line: 'Artifact' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-d1', 'bf-d2'] } }
    );
    expect((destroyResult.state?.battlefield || []).length).toBe(0);
  });
});
