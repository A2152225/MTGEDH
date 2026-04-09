import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('pending-effect prompt replay semantics', () => {
  it('replays queued Ponder-style prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_ponder';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'ponder_1',
      queuedResolutionStep: {
        id: 'queued_pending_ponder_1',
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: p1,
        sourceId: 'ponder_1',
        sourceName: 'Ponder',
        description: 'Ponder: Ponder',
        cards: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
        variant: 'ponder',
        cardCount: 3,
        drawAfter: true,
        mayShuffleAfter: true,
        targetPlayerId: p1,
        effectId: 'ponder_1',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PONDER_EFFECT);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('ponder_1');
  });

  it('replays queued proliferate prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_proliferate';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'source_proliferate_1',
      queuedResolutionStep: {
        id: 'queued_pending_proliferate_1',
        type: ResolutionStepType.PROLIFERATE,
        playerId: p1,
        sourceId: 'source_proliferate_1',
        sourceName: 'Proliferate Test',
        description: 'Choose permanents and/or players to proliferate',
        mandatory: false,
        proliferateId: 'proliferate_1',
        availableTargets: [
          { id: 'perm_1', name: 'Counter Creature', counters: { '+1/+1': 1 }, isPlayer: false },
          { id: p1, name: 'P1', counters: { energy: 2 }, isPlayer: true },
        ],
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PROLIFERATE);
    expect(String((queue.steps[0] as any)?.proliferateId || '')).toBe('proliferate_1');
  });

  it('replays queued Lim-Dul\'s Vault prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_vault';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'vault_1',
      queuedResolutionStep: {
        id: 'queued_pending_vault_1',
        type: ResolutionStepType.LIM_DULS_VAULT,
        playerId: p1,
        sourceId: 'vault_1',
        sourceName: "Lim-Dûl's Vault",
        description: "Lim-Dul's Vault",
        mandatory: true,
        effectId: 'vault_1',
        cards: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }, { id: 'e', name: 'E' }],
        currentLife: 40,
        totalLifePaid: 0,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.LIM_DULS_VAULT);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('vault_1');
  });

  it('replays queued initial Dance with Calamity prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_dance';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'dance_1',
      queuedResolutionStep: {
        id: 'queued_pending_dance_1',
        type: ResolutionStepType.DANCE_WITH_CALAMITY,
        playerId: p1,
        sourceId: 'dance_1',
        sourceName: 'Dance with Calamity',
        description: 'Dance with Calamity: Exile the top card, or stop and cast spells from among the exiled cards.',
        mandatory: true,
        effectId: 'dance_1',
        exiledCards: [],
        totalManaValue: 0,
        canContinue: true,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.DANCE_WITH_CALAMITY);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('dance_1');
  });
});