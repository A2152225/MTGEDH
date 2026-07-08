import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from '../src/oracleIR';
import type { PlayerID } from '../../shared/src';

const controller = 'p1' as PlayerID;

function buildState(permanents: Array<{ id: string; type_line: string; tapped?: boolean }>): GameState {
  return {
    players: [{ id: controller, name: 'P1' }],
    battlefield: permanents.map((entry) => ({
      id: entry.id,
      controller,
      owner: controller,
      tapped: entry.tapped === true,
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
