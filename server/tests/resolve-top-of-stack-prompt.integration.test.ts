import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('resolveTopOfStack prompt persistence (integration)', () => {
  const targetTriggerGameId = 'test_resolve_top_of_stack_prompt_targeted_trigger';
  const merrowGameId = 'test_resolve_top_of_stack_prompt_merrow';
  const bounceLandGameId = 'test_resolve_top_of_stack_prompt_bounce_land';
  const spellColorChoiceGameId = 'test_resolve_top_of_stack_prompt_spell_color_choice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of [targetTriggerGameId, merrowGameId, bounceLandGameId, spellColorChoiceGameId]) {
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

  it('persists bounce-land prompts created during stack resolution', () => {
    createGameIfNotExists(bounceLandGameId, 'commander', 40);
    const game = ensureGame(bounceLandGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = bounceLandGameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'bounce_land',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'bounce_land_card', name: 'Simic Growth Chamber', type_line: 'Land' },
      },
      {
        id: 'forest_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'forest_card', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_bounce_1',
        type: 'triggered_ability',
        controller: 'p1',
        permanentId: 'bounce_land',
        sourceName: 'Simic Growth Chamber',
        description: 'Return a land you control to its owner\'s hand.',
        triggerType: 'etb_bounce_land',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(bounceLandGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE);
    expect((queue.steps[0] as any)?.stackItemId).toBe('trigger_bounce_1');

    const promptEvent = getEvents(bounceLandGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'bounce_land',
      queuedResolutionStep: {
        type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
        playerId: 'p1',
        sourceId: 'bounce_land',
        stackItemId: 'trigger_bounce_1',
      },
    });
  });

  it('persists spell color-choice prompts created during stack resolution', () => {
    createGameIfNotExists(spellColorChoiceGameId, 'commander', 40);
    const game = ensureGame(spellColorChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = spellColorChoiceGameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).stack = [
      {
        id: 'spell_stack_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'spell_stack_1',
          name: 'Brave the Elements',
          type_line: 'Instant',
          oracle_text: 'Choose a color. White creatures you control gain protection from the chosen color until end of turn.',
        },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(spellColorChoiceGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.COLOR_CHOICE);
    expect((queue.steps[0] as any)?.spellId).toBe('spell_stack_1');

    const promptEvent = getEvents(spellColorChoiceGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'spell_stack_1',
      queuedResolutionStep: {
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: 'p1',
        sourceId: 'spell_stack_1',
        spellId: 'spell_stack_1',
      },
    });
  });
});