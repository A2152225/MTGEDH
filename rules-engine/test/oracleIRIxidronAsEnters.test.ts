import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { collectAsEntersAutomaticReplacementSteps } from '../src/oracleIRAsEntersAutomaticReplacementSteps';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { AbilityType } from '../src/oracleTextParser';

const IXIDRON_ORACLE =
  "As this creature enters, turn all other nontoken creatures face down. (They're 2/2 creatures.)\nIxidron's power and toughness are each equal to the number of face-down creatures on the battlefield.";

function makeState(): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    id: 'ixidron-as-enters',
    format: 'commander',
    turnNumber: 1,
    players: [
      { id: p1, name: 'P1', seat: 0, life: 40, hand: [], library: [], graveyard: [], exile: [], counters: {} },
      { id: p2, name: 'P2', seat: 1, life: 40, hand: [], library: [], graveyard: [], exile: [], counters: {} },
    ],
    battlefield: [
      {
        id: 'ixidron',
        controller: p1,
        owner: p1,
        card: { id: 'ix-card', name: 'Ixidron', type_line: 'Creature — Illusion', oracle_text: IXIDRON_ORACLE },
      },
      {
        id: 'bear',
        controller: p1,
        owner: p1,
        card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'token',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'token-card', name: 'Soldier', type_line: 'Creature — Soldier' },
      },
      {
        id: 'opp',
        controller: p2,
        owner: p2,
        card: { id: 'opp-card', name: 'Goblin', type_line: 'Creature — Goblin' },
      },
    ],
  } as GameState;
}

describe('Ixidron as-enters turn face down', () => {
  it('classifies the face-down ability as a replacement with a turn_face_down step', () => {
    const ir = parseOracleTextToIR(IXIDRON_ORACLE, 'Ixidron');
    const replacement = ir.abilities.find((ability) => ability.type === AbilityType.REPLACEMENT);
    expect(replacement).toBeTruthy();
    expect(replacement?.steps.some((step) => step.kind === 'turn_face_down')).toBe(true);
    expect(collectAsEntersAutomaticReplacementSteps(IXIDRON_ORACLE, 'Ixidron').map((step) => step.kind)).toEqual([
      'turn_face_down',
    ]);
  });

  it('turns other nontoken creatures face down and leaves Ixidron and tokens face up', () => {
    const steps = collectAsEntersAutomaticReplacementSteps(IXIDRON_ORACLE, 'Ixidron');
    const result = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'ixidron',
      }),
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['turn_face_down']);
    const battlefield = result.state.battlefield as any[];
    const ixidron = battlefield.find((perm) => perm.id === 'ixidron');
    const bear = battlefield.find((perm) => perm.id === 'bear');
    const token = battlefield.find((perm) => perm.id === 'token');
    const opp = battlefield.find((perm) => perm.id === 'opp');

    expect(ixidron.card?.faceDown).not.toBe(true);
    expect(token.card?.faceDown).not.toBe(true);
    expect(bear.card?.faceDown).toBe(true);
    expect(bear.faceUpCard?.name).toBe('Grizzly Bears');
    expect(opp.card?.faceDown).toBe(true);
    expect(opp.faceUpCard?.name).toBe('Goblin');
  });
});
