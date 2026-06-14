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

describe('Oracle IR gap batch 383 — target clusters (Track E2)', () => {
  it('prunes awaken parentheticals and gelid shackles compound static misparses', () => {
    const clutch = parseOracleTextToIR(
      "{U}\nReturn target creature to its owner's hand.\nAwaken 3-{4}{U} (If you cast this spell for {4}{U}, also put three +1/+1 counters on target land you control and it becomes a 0/0 Elemental creature with haste. It's still a land.)",
      'Clutch of Currents'
    );
    const animateSteps = clutch.abilities.flatMap((ability) => ability.steps || []);
    expect(animateSteps.some((step) => step.kind === 'animate_permanent')).toBe(false);

    const gelid = parseOracleTextToIR(
      "Enchanted creature can't block, and its activated abilities can't be activated.",
      'Gelid Shackles'
    );
    expect(gelid.abilities.flatMap((a) => a.steps || []).some((step) => step.kind === 'cant_activate_abilities')).toBe(
      false
    );
  });

  it('executes black creatures, otherwise-it, and destroy-any-number clusters', () => {
    const lightOfDay = parseOracleTextToIR("Black creatures can't block.", 'Light of Day');
    const blackStep = lightOfDay.abilities[0].steps?.find((step) => step.kind === 'cant_block');
    expect(blackStep).toBeTruthy();
    expectNoTargetGaps(
      [blackStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-black', controller: 'p2', type_line: 'Creature — Zombie', colors: ['B'] },
          { id: 'bf-white', controller: 'p2', type_line: 'Creature — Human', colors: ['W'] },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-source' }
    );

    const bonds = parseOracleTextToIR(
      "Enchanted creature is a Soldier in addition to its other types.\nOtherwise, it can't block.",
      'Bonds of Faith'
    );
    const otherwiseStep = bonds.abilities.flatMap((a) => a.steps || []).find((step) => step.kind === 'cant_block');
    expect(otherwiseStep).toBeTruthy();
    expectNoTargetGaps(
      [otherwiseStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-human', controller: controllerId, type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-human', targetCreatureId: 'bf-human' }
    );

    const descent = parseOracleTextToIR('Destroy any number of target creatures.', 'Descent of the Dragons');
    const destroyStep = descent.abilities[0].steps?.find((step) => step.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    const destroyResult = expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-d-1', controller: 'p2', type_line: 'Creature — Dragon' },
          { id: 'bf-d-2', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        selectorContext: { chosenObjectIds: ['bf-d-1', 'bf-d-2'] },
      }
    );
    expect((destroyResult.state?.battlefield || []).length).toBe(0);
  });

  it('executes counters-on-it, those-creatures skip untap, and player graveyard exile clusters', () => {
    const sigil = parseOracleTextToIR(
      'When this creature enters, put two +1/+1 counters on it.',
      'Sigil Captain'
    );
    const counterStep = sigil.abilities
      .flatMap((a) => a.steps || [])
      .find((step) => step.kind === 'add_counter' && /counters on it/i.test(String(step.raw || '')));
    expect(counterStep).toBeTruthy();
    expectNoTargetGaps(
      [counterStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-source', targetCreatureId: 'bf-source' }
    );

    const cone = parseOracleTextToIR(
      "Cone of Cold deals 4 damage to each creature with flying. Those creatures don't untap during their controllers' next untap steps.",
      'Cone of Cold'
    );
    const skipStep = cone.abilities.flatMap((a) => a.steps || []).find((step) => step.kind === 'skip_next_untap');
    expect(skipStep).toBeTruthy();
    expectNoTargetGaps(
      [skipStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-fly', controller: 'p2', type_line: 'Creature — Drake', keywords: ['Flying'] },
          { id: 'bf-ground', controller: 'p2', type_line: 'Creature — Bear' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        lastMovedBattlefieldPermanentIds: ['bf-fly'],
        lastAntecedentBattlefieldPermanentIds: ['bf-fly'],
      }
    );

    const goBlank = parseOracleTextToIR(
      "Target player discards two cards. Then exile that player's graveyard.",
      'Go Blank'
    );
    const exileStep = goBlank.abilities.flatMap((a) => a.steps || []).find((step) => step.kind === 'exile');
    expect(exileStep).toBeTruthy();
    const exileResult = expectNoTargetGaps(
      [exileStep!],
      {
        players: [
          {
            id: 'p2',
            graveyard: [{ id: 'gy-1', type_line: 'Instant' }, { id: 'gy-2', type_line: 'Sorcery' }],
          },
        ],
        battlefield: [],
      } as GameState,
      { controllerId, sourceId: 'bf-source', selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' } }
    );
    const p2 = (exileResult.state?.players || []).find((player: any) => player.id === 'p2');
    expect((p2 as any)?.graveyard || []).toEqual([]);
  });
});
