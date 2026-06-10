import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import {
  classifyCopyPermanentTriggerPattern,
  isSupportedCopyPermanentTriggerPattern,
} from '../src/state/modules/trigger-copy-permanent.js';
import { parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('trigger copy_permanent patterns', () => {
  it('classifies Unstable Shapeshifter ETB copy', () => {
    const steps = parseTriggerEffectSteps(
      'this creature becomes a copy of that creature, except it has this ability',
      'Unstable Shapeshifter',
    );
    expect(steps[0]).toMatchObject({ kind: 'copy_permanent' });
    expect(classifyCopyPermanentTriggerPattern(steps[0] as any)).toBe('self_from_that_creature');
    expect(isSupportedCopyPermanentTriggerPattern(steps[0]!)).toBe(true);
  });

  it('classifies Permeating Mass combat damage copy', () => {
    const steps = parseTriggerEffectSteps(
      'that creature becomes a copy of this creature.',
      'Permeating Mass',
    );
    expect(classifyCopyPermanentTriggerPattern(steps[0] as any)).toBe('that_creature_from_self');
    expect(isSupportedCopyPermanentTriggerPattern(steps[0]!)).toBe(true);
  });

  it('applies Permeating Mass copy when that_creature is provided in trigger context', () => {
    const gameId = 'permeating_mass_copy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'mass_1',
        controller: p1,
        card: { name: 'Permeating Mass', type_line: 'Creature — Spirit', power: '1', toughness: '1' },
        power: 1,
        toughness: 1,
      },
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        power: 2,
        toughness: 2,
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Permeating Mass',
      'that creature becomes a copy of this creature.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'mass_1',
        permanentId: 'mass_1',
        effectData: { targetPermanentId: 'bear_1' },
      },
    );

    const bear = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    expect(bear?.card?.name).toBe('Permeating Mass');
    expect(bear?.power).toBe(1);
  });

  it('queues Irma-style other-target copy selection', () => {
    const gameId = 'irma_copy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'irma_1',
        controller: p1,
        card: { name: 'Irma, Part-Time Mutant', type_line: 'Creature — Human Mutant', power: '2', toughness: '2' },
        power: 2,
        toughness: 2,
      },
      {
        id: 'soldier_1',
        controller: p1,
        card: { name: 'Soldier', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
        power: 1,
        toughness: 1,
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    executeTriggerEffect(
      game as any,
      p1,
      'Irma, Part-Time Mutant',
      'irma becomes a copy of up to one other target creature you control, except her name is irma, part-time mutant and she has this ability. then put a +1/+1 counter on her.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'irma_1',
        permanentId: 'irma_1',
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.some(step => step.type === ResolutionStepType.TARGET_SELECTION)).toBe(true);
  });
});
