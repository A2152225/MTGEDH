import { describe, expect, it } from 'vitest';

import { buildOracleIRExecutionContext, applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';
import type { GameState } from '../../shared/src/index.js';

function seedMerfolkExploreState(): GameState {
  return {
    players: [
      {
        id: 'p1',
        hand: [],
        library: [
          { id: 'spell_top', name: 'Nonland Spell', type_line: 'Sorcery' },
          { id: 'land_next', name: 'Island', type_line: 'Basic Land — Island' },
        ],
        graveyard: [],
      } as any,
    ],
    battlefield: [
      {
        id: 'm1',
        controller: 'p1',
        card: { name: 'Hakbal', type_line: 'Creature — Merfolk Scout' },
      } as any,
      {
        id: 'm2',
        controller: 'p1',
        card: { name: 'River Sneak', type_line: 'Creature — Merfolk Warrior' },
      } as any,
    ],
    turnNumber: 1,
  } as GameState;
}

describe('oracleIRExecutor each-subtype explore APANAP', () => {
  it('queues player choice for first Merfolk and carries remainingPermanentIds metadata', () => {
    const text = 'Each Merfolk you control explores.';
    const steps = collectOracleEffectSteps(text, 'Hakbal of the Surging Soul');
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'explore',
        target: { kind: 'raw', text: 'Each Merfolk you control' },
      }),
    ]);

    const state = seedMerfolkExploreState();
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'm1',
      sourceName: 'Hakbal of the Surging Soul',
      sourceObjectType: 'trigger',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.skippedSteps?.map((step) => step.kind)).toEqual(['explore']);
    expect(result.automationGaps?.[0]).toEqual(expect.objectContaining({
      reasonCode: 'player_choice_required',
      stepKind: 'explore',
    }));
    expect(result.automationGaps?.[0]?.metadata).toEqual(expect.objectContaining({
      permanentId: 'm1',
      remainingPermanentIds: ['m2'],
    }));
  });
});
