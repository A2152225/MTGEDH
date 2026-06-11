import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('trigger tap and untap oracle IR fallback', () => {
  it('untaps up to two tapped lands without a resolution prompt', () => {
    const gameId = 'trigger_untap_lands_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'land_1',
        controller: p1,
        owner: p1,
        tapped: true,
        card: { id: 'land_1_card', name: 'Forest', type_line: 'Land — Forest' },
      },
      {
        id: 'land_2',
        controller: p1,
        owner: p1,
        tapped: true,
        card: { id: 'land_2_card', name: 'Island', type_line: 'Land — Island' },
      },
      {
        id: 'land_3',
        controller: p1,
        owner: p1,
        tapped: true,
        card: { id: 'land_3_card', name: 'Mountain', type_line: 'Land — Mountain' },
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(game as any, p1, 'Snap', 'Untap up to two lands.', {
      type: 'triggered_ability',
      controller: p1,
      sourceId: 'snap_source',
      id: 'snap_trigger',
    });

    const land1 = (game.state as any).battlefield.find((perm: any) => perm.id === 'land_1');
    const land2 = (game.state as any).battlefield.find((perm: any) => perm.id === 'land_2');
    const land3 = (game.state as any).battlefield.find((perm: any) => perm.id === 'land_3');
    expect(Boolean(land1?.tapped)).toBe(false);
    expect(Boolean(land2?.tapped)).toBe(false);
    expect(Boolean(land3?.tapped)).toBe(true);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('queues tap target creature when multiple creatures are legal', () => {
    const gameId = 'trigger_tap_creature_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: { id: 'bear_1_card', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'bear_2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: { id: 'bear_2_card', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(game as any, p1, 'Dispatch', 'Tap target creature.', {
      type: 'triggered_ability',
      controller: p1,
      sourceId: 'dispatch_source',
      id: 'dispatch_trigger',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const tapStep = steps.find(step => step.type === ResolutionStepType.TAP_UNTAP_TARGET);
    expect(tapStep).toBeTruthy();
    expect((tapStep as any)?.action).toBe('tap');
    expect((tapStep as any)?.targetCount).toBe(1);
    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(false);
  });
});
