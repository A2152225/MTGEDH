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

describe('Oracle IR gap batch 385 — target clusters (Track E2)', () => {
  it('executes copy-permanent, siege dragon damage, and contextual sacrifice clusters', () => {
    const gardens = parseOracleTextToIR(
      '{T}: This land becomes a copy of target nontoken artifact you control with mana value X, where X is 3.',
      'The Mycosynth Gardens'
    );
    const copyStep = gardens.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'copy_permanent');
    expect(copyStep).toBeTruthy();
    expectNoTargetGaps(
      [copyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-land', controller: controllerId, type_line: 'Land' },
          { id: 'bf-artifact', controller: controllerId, type_line: 'Artifact', cmc: 3 },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-land',
        xValue: 3,
        selectorContext: { chosenObjectIds: ['bf-artifact'] },
      }
    );

    const siege = parseOracleTextToIR(
      'When this creature enters, it deals 2 damage to each creature without flying that player controls.',
      'Siege Dragon'
    );
    const damageStep = siege.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'deal_damage');
    expect(damageStep).toBeTruthy();
    expectNoTargetGaps(
      [damageStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-flyer', controller: 'p2', type_line: 'Creature — Dragon', keywords: ['Flying'] },
          { id: 'bf-ground', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' } }
    );

    const wanderer = parseOracleTextToIR(
      'Each player sacrifices all creatures they control not chosen this way.',
      'The Eternal Wanderer'
    );
    const sacrificeStep = wanderer.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'sacrifice');
    expect(sacrificeStep).toBeTruthy();
    const sacrificeResult = expectNoTargetGaps(
      [sacrificeStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-kept', controller: controllerId, type_line: 'Creature — Human' },
          { id: 'bf-sac', controller: controllerId, type_line: 'Creature — Elf' },
          { id: 'bf-opp', controller: 'p2', type_line: 'Creature — Zombie' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-kept'] } }
    );
    expect((sacrificeResult.state?.battlefield || []).some((p: any) => p.id === 'bf-kept')).toBe(true);
    expect((sacrificeResult.state?.battlefield || []).some((p: any) => p.id === 'bf-sac')).toBe(false);
  });

  it('executes reference-amount counters, gideon exile, and destroy contextual clusters', () => {
    const astarion = parseOracleTextToIR(
      "Put X +1/+1 counters on a commander creature you control, where X is the power of the creature exiled this way.",
      "Astarion's Thirst"
    );
    const counterStep = astarion.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_counter');
    expect(counterStep).toBeTruthy();
    const counterResult = expectNoTargetGaps(
      [counterStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-commander', controller: controllerId, type_line: 'Legendary Creature — Vampire', isCommander: true },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        referenceAmount: 5,
        lastExiledCards: [{ id: 'ex-1', type_line: 'Creature — Dragon', power: 5 }],
        selectorContext: { chosenObjectIds: ['bf-commander'] },
      }
    );
    const commander = (counterResult.state?.battlefield || []).find((p: any) => p.id === 'bf-commander');
    expect(Number((commander as any)?.counters?.['+1/+1'] ?? 0)).toBeGreaterThanOrEqual(5);

    const gideon = parseOracleTextToIR(
      'Exile this permanent and each creature your opponents control.',
      'Gideon, the Oathsworn'
    );
    const exileStep = gideon.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'exile');
    expect(exileStep).toBeTruthy();
    expectNoTargetGaps(
      [exileStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-gideon', controller: controllerId, type_line: 'Planeswalker — Gideon' },
          { id: 'bf-opp', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-gideon' }
    );

    const wearDown = parseOracleTextToIR('Destroy two target artifacts and/or enchantments.', 'Wear Down');
    const destroyStep = wearDown.abilities[0].steps?.find((s) => s.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-a1', controller: 'p2', type_line: 'Artifact' },
          { id: 'bf-e1', controller: 'p2', type_line: 'Enchantment' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-a1', 'bf-e1'] } }
    );
  });

  it('executes prevent damage, move counters, and remove counter clusters', () => {
    const refraction = parseOracleTextToIR(
      'Prevent the next 3 damage that a source of your choice would deal to you and/or permanents you control this turn.',
      'Refraction Trap'
    );
    const preventStep = refraction.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'prevent_damage');
    expect(preventStep).toBeTruthy();
    expectNoTargetGaps(
      [preventStep!],
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const beacon = parseOracleTextToIR(
      'You may move a loyalty counter from this artifact onto that planeswalker.',
      'Gatewatch Beacon'
    );
    const moveStep = beacon.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_counters');
    expect(moveStep).toBeTruthy();
    expectNoTargetGaps(
      [moveStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-artifact', controller: controllerId, type_line: 'Artifact', counters: { loyalty: 1 } },
          { id: 'bf-pw', controller: controllerId, type_line: 'Planeswalker — Jace', counters: { loyalty: 3 } },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-artifact', targetPermanentId: 'bf-pw' }
    );

    const fountain = parseOracleTextToIR('Remove all flood counters from them.', 'Quicksilver Fountain');
    const removeStep = fountain.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'remove_counter');
    expect(removeStep).toBeTruthy();
    expectNoTargetGaps(
      [removeStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-perm', controller: controllerId, type_line: 'Artifact', counters: { flood: 3 } }],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-perm'] } }
    );
  });
});
