import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('optional triggered ability replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_optional_trigger_prompt_replay',
      't_optional_trigger_choice_accept_replay',
      't_optional_trigger_choice_decline_replay',
      't_optional_trigger_choice_accept_full_replay_no_orphan',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays the queued optional-trigger prompt during stack resolution replay', () => {
    const gameId = 't_optional_trigger_prompt_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'soul_attendant_1',
      effectProgram: {
        effectProgramId: 'optional-trigger:soul_attendant_1:trigger_1',
        effectProgramFamily: 'optional_triggered_ability',
        effectProgramSourceId: 'soul_attendant_1',
        effectProgramSourceName: "Soul's Attendant",
        effectProgramCursor: 0,
        effectProgramStepId: 'optional-trigger:soul_attendant_1:trigger_1:choice',
        effectProgramBindingKey: 'optional-trigger:soul_attendant_1:trigger_1:decision',
      },
      queuedResolutionStep: {
        id: 'queued_optional_trigger_prompt_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: "You may: You may gain 1 life.",
        mandatory: false,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        deferredTriggeredAbilityItem: {
          id: 'trigger_1',
          type: 'triggered_ability',
          controller: playerId,
          source: 'soul_attendant_1',
          sourceName: "Soul's Attendant",
          description: 'You may gain 1 life.',
          effect: 'You may gain 1 life.',
          triggerType: 'creature_etb',
          mandatory: false,
          requiresChoice: true,
          optionalTriggeredAbilityDecisionApplied: true,
        },
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_optional_trigger_prompt_1');
    expect((queue.steps[0] as any)?.optionalTriggeredAbilityPrompt).toBeUndefined();
    expect((queue.steps[0] as any)?.effectProgramPrompt).toBe(true);
    expect((queue.steps[0] as any)?.effectProgramFamily).toBe('optional_triggered_ability');
    expect((queue.steps[0] as any)?.effectProgramId).toBe('optional-trigger:soul_attendant_1:trigger_1');
    expect((queue.steps[0] as any)?.effectProgramBindingKey).toBe('optional-trigger:soul_attendant_1:trigger_1:decision');
  });

  it('replays an accepted optional-trigger choice by resolving the deferred trigger', () => {
    const gameId = 't_optional_trigger_choice_accept_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'soul_attendant_1',
      queuedResolutionStep: {
        id: 'queued_optional_trigger_prompt_2',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: "You may: You may gain 1 life.",
        mandatory: false,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalTriggeredAbilityPrompt: true,
      },
    } as any);

    game.applyEvent({
      type: 'optionalTriggeredAbilityChoice',
      playerId,
      sourceId: 'soul_attendant_1',
      sourceName: "Soul's Attendant",
      resolvedStepId: 'queued_optional_trigger_prompt_2',
      choice: 'yes',
      deferredTriggeredAbilityItem: {
        id: 'trigger_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: 'You may gain 1 life.',
        effect: 'You may gain 1 life.',
        triggerType: 'creature_etb',
        mandatory: false,
        requiresChoice: true,
        optionalTriggeredAbilityDecisionApplied: true,
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).life[playerId]).toBe(41);
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(0);
  });

  it('replays a declined optional-trigger choice by clearing the queued prompt only', () => {
    const gameId = 't_optional_trigger_choice_decline_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'soul_attendant_1',
      queuedResolutionStep: {
        id: 'queued_optional_trigger_prompt_3',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: "You may: You may gain 1 life.",
        mandatory: false,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalTriggeredAbilityPrompt: true,
      },
    } as any);

    game.applyEvent({
      type: 'optionalTriggeredAbilityChoice',
      playerId,
      sourceId: 'soul_attendant_1',
      sourceName: "Soul's Attendant",
      resolvedStepId: 'queued_optional_trigger_prompt_3',
      choice: 'no',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).life[playerId]).toBe(40);
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(0);
  });

  it('full event-log replay does not live-resolve accepted optional triggers into ETB orphans', () => {
    // G1 regression: optionalTriggeredAbilityChoice used to call live resolveTopOfStack
    // during isReplaying, which re-fired Altar of the Brood / Aura Shards ETBs and left
    // 10–20+ stack orphans after server restart even though yes/no was already logged.
    const gameId = 't_optional_trigger_choice_accept_full_replay_no_orphan';
    resetGame(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const tokenCreateEffect = 'Create a 1/1 blue Merfolk creature token.';

    game.replay([
      { type: 'join', playerId, name: 'P1' },
      { type: 'join', playerId: opponentId, name: 'P2' },
      {
        type: 'executeEffect',
        effectType: 'createToken',
        controllerId: playerId,
        tokenData: {
          id: 'altar_1',
          name: 'Altar of the Brood',
          typeLine: 'Artifact',
          power: 0,
          toughness: 0,
          abilities: [
            'Whenever another permanent enters the battlefield under your control, each opponent mills 1 card.',
          ],
        },
      },
      {
        type: 'pushTriggeredAbility',
        triggerId: 'merrow_cast_1',
        sourceId: 'merrow_1',
        controllerId: playerId,
        sourceName: 'Merrow Reejerey',
        description: 'Whenever you cast a Merfolk spell, you may tap or untap target permanent.',
        effect: 'You may tap or untap target permanent.',
        triggerType: 'cast_creature_type',
        mandatory: false,
        requiresChoice: true,
      },
      { type: 'resolveTopOfStack', playerId },
      {
        type: 'resolveTopOfStackPrompt',
        playerId,
        sourceId: 'merrow_1',
        queuedResolutionStep: {
          id: 'queued_optional_merrow_1',
          type: ResolutionStepType.OPTION_CHOICE,
          playerId,
          sourceId: 'merrow_1',
          sourceName: 'Merrow Reejerey',
          description: 'You may: tap or untap target permanent.',
          mandatory: false,
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
          minSelections: 1,
          maxSelections: 1,
          optionalTriggeredAbilityPrompt: true,
          deferredTriggeredAbilityItem: {
            id: 'merrow_deferred_1',
            type: 'triggered_ability',
            controller: playerId,
            source: 'merrow_1',
            sourceName: 'Merrow Reejerey',
            description: tokenCreateEffect,
            effect: tokenCreateEffect,
            triggerType: 'cast_creature_type',
            mandatory: false,
            requiresChoice: true,
            optionalTriggeredAbilityDecisionApplied: true,
          },
        },
      },
      {
        type: 'optionalTriggeredAbilityChoice',
        playerId,
        sourceId: 'merrow_1',
        sourceName: 'Merrow Reejerey',
        resolvedStepId: 'queued_optional_merrow_1',
        choice: 'yes',
        deferredTriggeredAbilityItem: {
          id: 'merrow_deferred_1',
          type: 'triggered_ability',
          controller: playerId,
          source: 'merrow_1',
          sourceName: 'Merrow Reejerey',
          description: tokenCreateEffect,
          effect: tokenCreateEffect,
          triggerType: 'cast_creature_type',
          mandatory: false,
          requiresChoice: true,
          optionalTriggeredAbilityDecisionApplied: true,
        },
      },
      {
        type: 'executeEffect',
        effectType: 'createToken',
        controllerId: playerId,
        tokenData: {
          id: 'merfolk_token_1',
          name: 'Merfolk',
          typeLine: 'Token Creature — Merfolk',
          power: 1,
          toughness: 1,
          abilities: [],
        },
      },
    ] as any);

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(stack).toHaveLength(0);
    expect(
      stack.some((item: any) => String(item?.sourceName || '').includes('Altar')),
    ).toBe(false);
  });
});
