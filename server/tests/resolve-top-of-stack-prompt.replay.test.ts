import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('resolveTopOfStack prompt replay semantics', () => {
  it('replays queued target-selection prompts created during stack resolution', () => {
    const gameId = 't_resolve_top_of_stack_prompt_replay_target';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'reejerey_1',
      queuedResolutionStep: {
        id: 'queued_resolve_prompt_target_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sourceId: 'reejerey_1',
        sourceName: 'Merrow Reejerey',
        description: 'Merrow Reejerey: Tap or untap target permanent',
        mandatory: true,
        validTargets: [
          { id: 'target_perm_1', label: 'Test Relic', description: 'Artifact' },
        ],
        targetTypes: ['permanent'],
        minTargets: 1,
        maxTargets: 1,
        action: 'tap_or_untap_target',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_resolve_prompt_target_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.action).toBe('tap_or_untap_target');
  });

  it('replays queued player-choice prompts created during stack resolution', () => {
    const gameId = 't_resolve_top_of_stack_prompt_replay_player';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'bog_1',
      queuedResolutionStep: {
        id: 'queued_resolve_prompt_player_1',
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: p1,
        sourceName: 'Bojuka Bog',
        description: 'Bojuka Bog: Choose target player',
        mandatory: true,
        triggerItem: {
          id: 'trigger_bog_1',
          sourceName: 'Bojuka Bog',
          description: 'When Bojuka Bog enters, exile all cards from target player\'s graveyard.',
          controller: p1,
        },
        etbTargetTrigger: true,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_resolve_prompt_player_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PLAYER_CHOICE);
    expect((queue.steps[0] as any)?.etbTargetTrigger).toBe(true);
  });

  it('replays queued bounce-land prompts created during stack resolution', () => {
    const gameId = 't_resolve_top_of_stack_prompt_replay_bounce';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'bounce_land',
      queuedResolutionStep: {
        id: 'queued_resolve_prompt_bounce_1',
        type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
        playerId: p1,
        sourceId: 'bounce_land',
        sourceName: 'Simic Growth Chamber',
        description: 'Simic Growth Chamber: Return a land you control to its owner\'s hand',
        mandatory: true,
        returnControlledPermanentChoice: true,
        returnControlledPermanentDestination: 'hand',
        returnControlledPermanentOptions: [
          { permanentId: 'forest_1', cardName: 'Forest' },
        ],
        stackItemId: 'trigger_bounce_1',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_resolve_prompt_bounce_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE);
    expect((queue.steps[0] as any)?.stackItemId).toBe('trigger_bounce_1');
  });

  it('replays queued spell color-choice prompts created during stack resolution', () => {
    const gameId = 't_resolve_top_of_stack_prompt_replay_spell_color';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'spell_stack_1',
      queuedResolutionStep: {
        id: 'queued_resolve_prompt_color_1',
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: p1,
        sourceId: 'spell_stack_1',
        sourceName: 'Brave the Elements',
        description: 'Choose a color for Brave the Elements',
        mandatory: true,
        colors: ['white', 'blue', 'black', 'red', 'green'],
        spellId: 'spell_stack_1',
        oracleText: 'Choose a color. White creatures you control gain protection from the chosen color until end of turn.',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_resolve_prompt_color_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.COLOR_CHOICE);
    expect((queue.steps[0] as any)?.spellId).toBe('spell_stack_1');
  });
});