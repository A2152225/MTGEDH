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

describe('Oracle IR gap batch 386 — target clusters (Track E2 mega-batch)', () => {
  it('executes contextual destroy, exile, and regenerate clusters', () => {
    const overload = parseOracleTextToIR(
      'Destroy that artifact if its mana value is 5 or less instead.',
      'Overload'
    );
    const destroyArtifact = overload.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'destroy');
    expect(destroyArtifact).toBeTruthy();
    const destroyResult = expectNoTargetGaps(
      [destroyArtifact!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-art', controller: 'p2', type_line: 'Artifact', cmc: 3 }],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        lastReferencedPermanentId: 'bf-art',
        selectorContext: { chosenObjectIds: ['bf-art'] },
      }
    );
    expect((destroyResult.state?.battlefield || []).some((p: any) => p.id === 'bf-art')).toBe(false);

    const carrionette = parseOracleTextToIR(
      "Exile this card and target creature unless that creature's controller pays {2}.",
      'Carrionette'
    );
    const exileUnless = carrionette.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'exile');
    expect(exileUnless).toBeTruthy();
    expectNoTargetGaps(
      [exileUnless!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-src', controller: controllerId, type_line: 'Creature — Zombie' },
          { id: 'bf-target', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-target'] } }
    );

    const fullMoon = parseOracleTextToIR('Regenerate all Werewolf creatures you control.', "Full Moon's Rise");
    const regenerate = fullMoon.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'regenerate');
    expect(regenerate).toBeTruthy();
    expectNoTargetGaps(
      [regenerate!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-wolf', controller: controllerId, type_line: 'Creature — Werewolf' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const goblinRise = parseOracleTextToIR('Regenerate all Goblin creatures you control.', 'Typed Regeneration');
    const goblinRegenerate = goblinRise.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'regenerate');
    expect(goblinRegenerate).toBeTruthy();
    const goblinResult = expectNoTargetGaps(
      [goblinRegenerate!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-goblin', controller: controllerId, type_line: 'Creature — Goblin' },
          { id: 'bf-human', controller: controllerId, type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );
    const goblinShields = ((goblinResult.state as any)?.regenerationShields || []) as Array<{ permanentId?: string }>;
    expect(goblinShields.some((shield) => shield.permanentId === 'bf-goblin')).toBe(true);
    expect(goblinShields.some((shield) => shield.permanentId === 'bf-human')).toBe(false);
  });

  it('executes loyalty move, planeswalker counters, distribute snow, and luck counters', () => {
    const gatewatch = parseOracleTextToIR(
      'You may move a loyalty counter from this artifact onto that planeswalker.',
      'Gatewatch Beacon'
    );
    const moveStep = gatewatch.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_counters');
    expect(moveStep).toBeTruthy();
    const moveResult = expectNoTargetGaps(
      [moveStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-beacon', controller: controllerId, type_line: 'Artifact', counters: { loyalty: 2 } },
          { id: 'bf-pw', controller: controllerId, type_line: 'Planeswalker — Jace', counters: { loyalty: 3 } },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-beacon', targetPermanentId: 'bf-pw' }
    );
    const pw = (moveResult.state?.battlefield || []).find((p: any) => p.id === 'bf-pw');
    expect(Number((pw as any)?.counters?.loyalty ?? 0)).toBeGreaterThanOrEqual(4);

    const settle = parseOracleTextToIR('Put two loyalty counters on a planeswalker you control.', 'Settle the Score');
    const loyaltyStep = settle.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_counter');
    expect(loyaltyStep).toBeTruthy();
    expectNoTargetGaps(
      [loyaltyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-pw2', controller: controllerId, type_line: 'Planeswalker — Liliana' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const blessing = parseOracleTextToIR(
      'Distribute X +1/+1 counters among any number of creatures you control, where X is the amount of {S} spent to cast this spell.',
      'Blessing of Frost'
    );
    const distributeStep = blessing.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_counter');
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
      {
        controllerId,
        sourceId: 'bf-src',
        snowManaSpent: 2,
        interactivePlayerChoices: false,
        selectorContext: { chosenObjectIds: ['bf-c1', 'bf-c2'] },
      }
    );

    const pickBeeble = parseOracleTextToIR(
      'Put a number of luck counters on this permanent equal to the result.',
      'Pick-a-Beeble'
    );
    const luckStep = pickBeeble.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_counter');
    expect(luckStep).toBeTruthy();
    const luckResult = expectNoTargetGaps(
      [luckStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-src', controller: controllerId, type_line: 'Artifact' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src', referenceAmount: 4 }
    );
    const src = (luckResult.state?.battlefield || []).find((p: any) => p.id === 'bf-src');
    expect(Number((src as any)?.counters?.luck ?? 0)).toBe(4);
  });

  it('executes copy, suspect, remove counter, and damage clusters', () => {
    const shapesharer = parseOracleTextToIR(
      'Target Shapeshifter becomes a copy of target creature until your next turn.',
      'Shapesharer'
    );
    const copyStep = shapesharer.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'copy_permanent');
    expect(copyStep).toBeTruthy();
    expectNoTargetGaps(
      [copyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-shape', controller: controllerId, type_line: 'Creature — Shapeshifter' },
          { id: 'bf-ref', controller: controllerId, type_line: 'Creature — Elf', name: 'Reference Elf' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        selectorContext: { chosenObjectIds: ['bf-shape', 'bf-ref'] },
      }
    );

    const braggart = parseOracleTextToIR('Whenever this creature deals combat damage to a player, you may suspect it.', 'Rubblebelt Braggart');
    const suspectStep = braggart.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'suspect');
    expect(suspectStep).toBeTruthy();
    const suspectResult = expectNoTargetGaps(
      [suspectStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-src', controller: controllerId, type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src', targetCreatureId: 'bf-src' }
    );
    const suspected = (suspectResult.state?.battlefield || []).find((p: any) => p.id === 'bf-src');
    expect((suspected as any)?.isSuspected).toBe(true);

    const dust = parseOracleTextToIR(
      'Remove two time counters from each permanent and each suspended card.',
      'Dust of Moments'
    );
    const removeStep = dust.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'remove_counter');
    expect(removeStep).toBeTruthy();
    expectNoTargetGaps(
      [removeStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-time', controller: controllerId, type_line: 'Artifact', counters: { time: 3 } }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const thunderwave = parseOracleTextToIR(
      'This permanent deals 3 damage to each creature not chosen this way.',
      'Thunderwave'
    );
    const damageStep = thunderwave.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'deal_damage');
    expect(damageStep).toBeTruthy();
    expectNoTargetGaps(
      [damageStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-kept', controller: controllerId, type_line: 'Creature — Human' },
          { id: 'bf-hit', controller: controllerId, type_line: 'Creature — Goblin' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-kept'] } }
    );
  });
});
