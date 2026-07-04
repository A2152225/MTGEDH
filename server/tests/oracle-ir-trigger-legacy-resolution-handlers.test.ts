import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

import {
  applyRetiredTriggerLegacyBelbePortalPutFromHand,
  applyRetiredTriggerLegacyKynaiosLandDrawChoice,
  applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield,
} from '../src/state/modules/oracleIrTriggerLegacyResolutionHandlers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracleIrTriggerLegacyResolutionHandlers', () => {
  it('returns false when not a Kynaios effect', () => {
    expect(applyRetiredTriggerLegacyKynaiosLandDrawChoice({
      ctx: { gameId: 'g1' } as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Other',
      desc: 'Draw a card.',
      triggerItem: {},
      state: {},
      players: [{ id: 'p1' }],
      battlefield: [],
      isKynaiosEffect: false,
    })).toBe(false);
  });

  it('queues Kynaios choice steps when gameId is present', () => {
    const gameId = 'kynaios_test';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: { hand: [{ id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest' }] },
    };
    game.libraries = new Map([[p1, [{ id: 'lib-1', name: 'Island', zone: 'library' }]]]);

    expect(applyRetiredTriggerLegacyKynaiosLandDrawChoice({
      ctx: { ...game, gameId, libraries: game.libraries } as any,
      controller: p1,
      sourceName: 'Kynaios and Tiro of Meletis',
      desc: 'Each player may put a land card from their hand onto the battlefield. Then each opponent who didn\'t draws a card.',
      triggerItem: { id: 'batch-1' },
      state: game.state,
      players: [{ id: p1 }],
      battlefield: [],
      isKynaiosEffect: true,
    })).toBe(true);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.KYNAIOS_CHOICE);
    expect(steps.length).toBeGreaterThan(0);
  });

  it('queues generic put-from-hand modal for soldier creatures', () => {
    const gameId = 'put_from_hand_test';
    ResolutionQueueManager.removeQueue(gameId);

    const p1 = 'p1' as PlayerID;
    const hand = [{
      id: 'soldier-1',
      name: 'Soldier',
      type_line: 'Creature — Human Soldier',
      image_uris: { small: 'x' },
    }];

    expect(applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield({
      ctx: { gameId } as any,
      controller: p1,
      sourceName: 'Preeminent Captain',
      desc: 'You may put a Soldier creature card from your hand onto the battlefield tapped and attacking.',
      triggerItem: {},
      state: { zones: { [p1]: { hand } } },
      players: [{ id: p1 }],
      battlefield: [],
    })).toBe(true);

    const modalSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.MODAL_CHOICE);
    expect(modalSteps).toHaveLength(1);
  });

  it('handles Belbe Portal chosen-type put from hand', () => {
    const gameId = 'belbe_test';
    ResolutionQueueManager.removeQueue(gameId);

    const p1 = 'p1' as PlayerID;
    const hand = [{
      id: 'elf-1',
      name: 'Elf',
      type_line: 'Creature — Elf',
      image_uris: { small: 'x' },
    }];

    expect(applyRetiredTriggerLegacyBelbePortalPutFromHand({
      ctx: { gameId } as any,
      controller: p1,
      sourceName: "Belbe's Portal",
      desc: 'Put a creature card of the chosen type from your hand onto the battlefield.',
      triggerItem: { chosenCreatureType: 'Elf' },
      state: { zones: { [p1]: { hand } } },
      players: [{ id: p1 }],
      battlefield: [],
    })).toBe(true);

    const modalSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.MODAL_CHOICE);
    expect(modalSteps).toHaveLength(1);
  });
});
