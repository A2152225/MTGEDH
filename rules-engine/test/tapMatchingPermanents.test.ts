import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from '../src/oracleIR';
import type { PlayerID } from '../../shared/src';

const controller = 'p1' as PlayerID;

function buildState(
  permanents: Array<{ id: string; type_line: string; tapped?: boolean; counters?: Record<string, number> }>
): GameState {
  return {
    players: [{ id: controller, name: 'P1' }],
    battlefield: permanents.map((entry) => ({
      id: entry.id,
      controller,
      owner: controller,
      tapped: entry.tapped === true,
      counters: entry.counters || {},
      card: {
        id: `${entry.id}_card`,
        name: entry.id,
        type_line: entry.type_line,
      },
    })),
  } as GameState;
}

describe('tap_matching_permanents filter', () => {
  it('matches artifacts and/or creatures when tapping five', () => {
    const steps: OracleEffectStep[] = [
      {
        kind: 'tap_matching_permanents',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 5 },
        filter: 'untapped artifacts and/or creatures you control',
        optional: true,
        raw: 'tap five untapped artifacts and/or creatures you control',
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you do' },
        steps: [
          {
            kind: 'turn_face_up',
            target: { kind: 'raw', text: 'Thousand Moons Smithy' },
            raw: 'transform Thousand Moons Smithy',
          },
        ],
        raw: 'If you do, transform Thousand Moons Smithy.',
      },
    ];

    const state = buildState([
      { id: 'artifact_1', type_line: 'Artifact' },
      { id: 'artifact_2', type_line: 'Artifact' },
      { id: 'artifact_3', type_line: 'Artifact Creature — Gnome Soldier' },
      { id: 'creature_1', type_line: 'Creature — Soldier' },
      { id: 'creature_2', type_line: 'Creature — Knight' },
      { id: 'land_1', type_line: 'Basic Land — Plains' },
    ]);

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: controller,
      sourceId: 'smithy_perm',
      sourceName: 'Thousand Moons Smithy',
      interactivePlayerChoices: false,
    }, {
      allowOptional: true,
    });

    const tappedIds = new Set(
      (result.state.battlefield || [])
        .filter((perm: any) => perm?.tapped)
        .map((perm: any) => String(perm.id)),
    );
    expect(tappedIds.size).toBe(5);
    expect(tappedIds.has('land_1')).toBe(false);
    expect(result.appliedSteps.some((step) => step.kind === 'tap_matching_permanents')).toBe(true);
  });
});

describe('Tangle Wire fade-counter tap step', () => {
  const oracleText =
    'Fading 4 (This artifact enters with four fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can\'t, sacrifice it.)\n' +
    "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.";

  it('parses the per-fade-counter tap clause into a tap_matching_permanents step', () => {
    const ir = parseOracleTextToIR(oracleText, 'Tangle Wire');
    const tapStep = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (step) => step.kind === 'tap_matching_permanents'
    ) as any;

    expect(tapStep).toBeTruthy();
    expect(tapStep.who).toEqual({ kind: 'target_player' });
    expect(String(tapStep.filter)).toMatch(/artifact.*creature.*land/i);
    expect(tapStep.amount).toMatchObject({ kind: 'reference_amount' });
    expect(String(tapStep.amount.raw)).toMatch(/fade counter/i);
  });

  it('taps exactly the fade-counter count of matching permanents, excluding non-matching types', () => {
    const step: OracleEffectStep = {
      kind: 'tap_matching_permanents',
      who: { kind: 'target_player' },
      amount: { kind: 'reference_amount', raw: 'the number of fade counters on this artifact' },
      filter: 'artifact, creature, or land',
      raw: 'that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact',
    } as unknown as OracleEffectStep;

    const state = buildState([
      { id: 'tangle_wire', type_line: 'Artifact', counters: { fade: 3 } },
      { id: 'creature_1', type_line: 'Creature — Soldier' },
      { id: 'land_1', type_line: 'Basic Land — Plains' },
      { id: 'enchantment_1', type_line: 'Enchantment' },
    ]);

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId: controller,
      sourceId: 'tangle_wire',
      sourceName: 'Tangle Wire',
      targetPlayerId: controller,
      interactivePlayerChoices: false,
    }, {});

    const tappedIds = new Set(
      (result.state.battlefield || [])
        .filter((perm: any) => perm?.tapped)
        .map((perm: any) => String(perm.id)),
    );
    expect(tappedIds).toEqual(new Set(['tangle_wire', 'creature_1', 'land_1']));
    expect(tappedIds.has('enchantment_1')).toBe(false);
    expect(result.appliedSteps.some((appliedStep) => appliedStep.kind === 'tap_matching_permanents')).toBe(true);
  });
});
