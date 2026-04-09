import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('resolveTopOfStack prompt persistence (integration)', () => {
  const targetTriggerGameId = 'test_resolve_top_of_stack_prompt_targeted_trigger';
  const merrowGameId = 'test_resolve_top_of_stack_prompt_merrow';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of [targetTriggerGameId, merrowGameId]) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  });

  it('persists targeted triggered abilities that resolve into a target-selection prompt', () => {
    createGameIfNotExists(targetTriggerGameId, 'commander', 40);
    const game = ensureGame(targetTriggerGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = targetTriggerGameId;
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'vazi_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'vazi_card', name: 'Vazi, Keen Negotiator', type_line: 'Legendary Creature — Human Advisor' },
      },
      {
        id: 'target_creature',
        controller: 'p1',
        owner: 'p1',
        counters: {},
        card: { id: 'target_creature_card', name: 'Target Creature', type_line: 'Creature — Test' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_vazi_1',
        type: 'triggered_ability',
        controller: 'p1',
        sourceId: 'vazi_1',
        sourceName: 'Vazi, Keen Negotiator',
        description: 'Put a +1/+1 counter on target creature, then draw a card.',
        requiresTarget: true,
        targetType: 'creature',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(targetTriggerGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.targetedTriggeredAbility).toBe(true);

    const promptEvent = getEvents(targetTriggerGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'trigger_vazi_1',
      queuedResolutionStep: {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: 'p1',
        sourceId: 'trigger_vazi_1',
        targetedTriggeredAbility: true,
      },
    });
  });

  it('persists Merrow-style stack resolution prompts before the tap-or-untap follow-up choice', () => {
    createGameIfNotExists(merrowGameId, 'commander', 40);
    const game = ensureGame(merrowGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = merrowGameId;
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'reejerey_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'reejerey_card', name: 'Merrow Reejerey', type_line: 'Creature — Merfolk Soldier' },
      },
      {
        id: 'target_perm_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: { id: 'relic_card', name: 'Test Relic', type_line: 'Artifact' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_merrow_1',
        type: 'triggered_ability',
        controller: 'p1',
        sourceId: 'reejerey_1',
        sourceName: 'Merrow Reejerey',
        description: 'You may tap or untap target permanent.',
        requiresTarget: true,
        targetType: 'permanent',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(merrowGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.action).toBe('tap_or_untap_target');

    const promptEvent = getEvents(merrowGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'trigger_merrow_1',
      queuedResolutionStep: {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: 'p1',
        sourceId: 'trigger_merrow_1',
        action: 'tap_or_untap_target',
      },
    });
  });
});