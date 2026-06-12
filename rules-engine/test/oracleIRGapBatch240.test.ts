import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch240');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      {
        id: p1,
        name: 'P1',
        hand: [],
        library: [
          { id: 'lib-1', name: 'Shock', type_line: 'Instant' },
          { id: 'lib-2', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        ],
        graveyard: [],
      },
      { id: p2, name: 'P2', hand: [], library: [{ id: 'lib-p2-1' }], graveyard: [] },
    ],
    battlefield: [
      { id: 'src', controller: p1, type_line: 'Creature — Human Rogue', card: { type_line: 'Creature — Human Rogue' } },
      { id: 'damager', controller: p2, type_line: 'Creature — Bear', card: { type_line: 'Creature — Bear' } },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 240 support', () => {
  it('parses bare destroy it trigger fragments', () => {
    const steps = parseBareTriggerEffectFragmentSteps('destroy it.');
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'destroy',
        target: expect.objectContaining({ text: 'it' }),
      }),
    ]);
  });

  it('connives without polluted audit chosenObjectIds', () => {
    const steps = collectStepsFromText('It connives.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: {
          chosenObjectIds: ['damager', 'src', 'lib-1', 'lib-2'],
        },
      })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.appliedSteps?.some((step) => step.kind === 'connive')).toBe(true);
  });

  it('destroys the contextual creature for destroy it', () => {
    const steps = collectStepsFromText('Destroy it.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetCreatureId: 'damager',
        targetPermanentId: 'damager',
      })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'damager')).toBe(false);
  });
});
