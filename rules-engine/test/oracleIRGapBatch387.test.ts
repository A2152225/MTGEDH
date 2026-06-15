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

describe('Oracle IR gap batch 387 — target clusters (Track E2 mega-batch)', () => {
  it('executes energy modify_pt, static cant restrictions, and grant clusters', () => {
    const dieYoung = parseOracleTextToIR(
      'Target creature gets -0/-0 until end of turn. The creature gets -1/-1 until end of turn for each {E} paid this way.',
      'Die Young'
    );
    const energyStep = dieYoung.abilities.flatMap((a) => a.steps || []).find((s) => /each \{E\} paid/i.test(String(s.raw || '')));
    expect(energyStep).toBeTruthy();
    const energyResult = expectNoTargetGaps(
      [energyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-target', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        targetCreatureId: 'bf-target',
        energyPaidThisWay: 3,
        selectorContext: { chosenObjectIds: ['bf-target'] },
      }
    );
    const target = (energyResult.state?.battlefield || []).find((p: any) => p.id === 'bf-target');
    expect(target).toBeTruthy();

    const katabatic = parseOracleTextToIR(
      "Creatures with flying can't attack.\nCreatures with flying can't block.",
      'Katabatic Winds'
    );
    const attackStep = katabatic.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'cant_attack');
    const blockStep = katabatic.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'cant_block');
    expect(attackStep).toBeTruthy();
    expect(blockStep).toBeTruthy();
    expectNoTargetGaps(
      [attackStep!, blockStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-fly', controller: 'p2', type_line: 'Creature — Bird', keywords: ['Flying'] },
          { id: 'bf-ground', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const secretTunnel = parseOracleTextToIR(
      "Two target creatures you control that share a creature type can't be blocked this turn.",
      'Secret Tunnel'
    );
    const grantStep = secretTunnel.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'grant_temporary_ability');
    expect(grantStep).toBeTruthy();
    expectNoTargetGaps(
      [grantStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-a', controller: controllerId, type_line: 'Creature — Elf' },
          { id: 'bf-b', controller: controllerId, type_line: 'Creature — Elf Wizard' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-a', 'bf-b'] } }
    );
  });

  it('executes contextual exile, destroy, and sacrifice clusters', () => {
    const topple = parseOracleTextToIR(
      'Exile target creature with the greatest power among creatures on the battlefield.',
      'Topple'
    );
    const exileStep = topple.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'exile');
    expect(exileStep).toBeTruthy();
    const toppleResult = expectNoTargetGaps(
      [exileStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-big', controller: 'p2', type_line: 'Creature — Giant', power: 6 },
          { id: 'bf-small', controller: 'p2', type_line: 'Creature — Human', power: 1 },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-big'] } }
    );
    expect((toppleResult.state?.battlefield || []).some((p: any) => p.id === 'bf-big')).toBe(false);

    const hex = parseOracleTextToIR('Destroy six target creatures.', 'Hex');
    const destroyStep = hex.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: Array.from({ length: 6 }, (_, index) => ({
          id: `bf-${index}`,
          controller: 'p2',
          type_line: 'Creature — Zombie',
        })),
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        selectorContext: { chosenObjectIds: ['bf-0', 'bf-1', 'bf-2', 'bf-3', 'bf-4', 'bf-5'] },
      }
    );

    const skullStorm = parseOracleTextToIR('Each opponent sacrifices a creature of their choice.', 'Skull Storm');
    const sacrificeStep = skullStorm.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'sacrifice');
    expect(sacrificeStep).toBeTruthy();
    expectNoTargetGaps(
      [sacrificeStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [{ id: 'bf-opp', controller: 'p2', type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );
  });

  it('executes move counters, copy, set base pt, and tap clusters', () => {
    const daghatar = parseOracleTextToIR(
      'Move a +1/+1 counter from target creature onto a second target creature.',
      'Daghatar the Adamant'
    );
    const moveStep = daghatar.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_counters');
    expect(moveStep).toBeTruthy();
    const moveResult = expectNoTargetGaps(
      [moveStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-from', controller: controllerId, type_line: 'Creature — Human', counters: { '+1/+1': 2 } },
          { id: 'bf-to', controller: controllerId, type_line: 'Creature — Elf' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-from', 'bf-to'] } }
    );
    const recipient = (moveResult.state?.battlefield || []).find((p: any) => p.id === 'bf-to');
    expect(Number((recipient as any)?.counters?.['+1/+1'] ?? 0)).toBeGreaterThanOrEqual(1);

    const celebrant = parseOracleTextToIR(
      '{T}: When you do, untap all other creatures you control and after this phase, there is an additional combat phase.',
      'Combat Celebrant'
    );
    const tapStep = celebrant.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'tap_or_untap');
    expect(tapStep).toBeTruthy();
    expectNoTargetGaps(
      [tapStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-src', controller: controllerId, type_line: 'Creature — Human', tapped: true },
          { id: 'bf-other', controller: controllerId, type_line: 'Creature — Elf', tapped: true },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const katsumasa = parseOracleTextToIR(
      'It has base power and toughness 1/1 until end of turn.',
      'Katsumasa, the Animator'
    );
    const setBaseStep = katsumasa.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'set_base_pt');
    expect(setBaseStep).toBeTruthy();
    expectNoTargetGaps(
      [setBaseStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-art', controller: controllerId, type_line: 'Artifact' }],
      } as GameState,
      { controllerId, sourceId: 'bf-art', targetPermanentId: 'bf-art' }
    );
  });
});
