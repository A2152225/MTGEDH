import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function card(id: string, name: string, oracleText = '') {
  return {
    id,
    name,
    oracle_text: oracleText,
    type_line: 'Creature',
  };
}

function setupDredgeGame(gameId: string) {
  ResolutionQueueManager.clearAllSteps(gameId);
  const game = createInitialGameState(gameId);
  const playerId = 'p1' as PlayerID;
  const dredgeCard = card('stinkweed_imp_1', 'Stinkweed Imp', 'Flying\nDredge 5');
  const library = [
    card('library_1', 'Island'),
    card('library_2', 'Swamp'),
    card('library_3', 'Forest'),
    card('library_4', 'Mountain'),
    card('library_5', 'Plains'),
    card('library_6', 'Wastes'),
  ];

  addPlayer(game, playerId, 'P1');
  game.libraries.set(playerId, [...library]);
  (game.state as any).zones[playerId] = {
    hand: [],
    handCount: 0,
    graveyard: [{ ...dredgeCard, zone: 'graveyard' }],
    graveyardCount: 1,
    libraryCount: library.length,
  };

  return { game, playerId, dredgeCard, library };
}

describe('dredge draw replacement replay semantics', () => {
  it('queues a Dredge replacement choice instead of drawing immediately', () => {
    const gameId = 't_dredge_replacement_queue';
    const { game, playerId } = setupDredgeGame(gameId);

    const drawn = game.drawCards(playerId, 1);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);

    expect(drawn).toEqual([]);
    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual([
      'library_1',
      'library_2',
      'library_3',
      'library_4',
      'library_5',
      'library_6',
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      dredgeDrawReplacementChoice: true,
      minSelections: 1,
      maxSelections: 1,
      remainingDrawCountAfterChoice: 0,
    });
    expect((steps[0] as any).options.map((option: any) => option.id)).toEqual(['draw', 'dredge:stinkweed_imp_1']);
  });

  it('replays accepted Dredge choices by clearing the prompt, milling, and returning the card', () => {
    const gameId = 't_dredge_replacement_accept_replay';
    const { game, playerId } = setupDredgeGame(gameId);

    ResolutionQueueManager.addStep(gameId, {
      id: 'dredge_step_accepted',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'stinkweed_imp_1',
      sourceName: 'Stinkweed Imp',
      description: 'Replace this draw with dredge?',
      mandatory: true,
      dredgeDrawReplacementChoice: true,
      options: ['draw', 'dredge:stinkweed_imp_1'],
    } as any);

    (game as any).isReplaying = true;
    (game as any)._replayNextEventType = 'dredgeDrawReplacementResolve';
    game.applyEvent({ type: 'drawCards', playerId, count: 1 } as any);

    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual([
      'library_1',
      'library_2',
      'library_3',
      'library_4',
      'library_5',
      'library_6',
    ]);

    game.applyEvent({
      type: 'dredgeDrawReplacementResolve',
      playerId,
      resolvedStepId: 'dredge_step_accepted',
      choiceId: 'dredge',
      dredgeCardId: 'stinkweed_imp_1',
      dredgeAmount: 5,
    } as any);

    const zones = (game.state as any).zones[playerId];
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toEqual([]);
    expect(zones.hand.map((entry: any) => entry.id)).toEqual(['stinkweed_imp_1']);
    expect(zones.graveyard.map((entry: any) => entry.id)).toEqual([
      'library_1',
      'library_2',
      'library_3',
      'library_4',
      'library_5',
    ]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual(['library_6']);
    expect(zones.handCount).toBe(1);
    expect(zones.graveyardCount).toBe(5);
    expect(zones.libraryCount).toBe(1);
  });

  it('replays declined Dredge choices as a normal draw without re-queueing Dredge', () => {
    const gameId = 't_dredge_replacement_decline_replay';
    const { game, playerId } = setupDredgeGame(gameId);

    ResolutionQueueManager.addStep(gameId, {
      id: 'dredge_step_declined',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'stinkweed_imp_1',
      sourceName: 'Stinkweed Imp',
      description: 'Replace this draw with dredge?',
      mandatory: true,
      dredgeDrawReplacementChoice: true,
      options: ['draw', 'dredge:stinkweed_imp_1'],
    } as any);

    (game as any).isReplaying = true;
    (game as any)._replayNextEventType = 'dredgeDrawReplacementResolve';
    game.applyEvent({ type: 'drawCards', playerId, count: 1 } as any);

    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual([
      'library_1',
      'library_2',
      'library_3',
      'library_4',
      'library_5',
      'library_6',
    ]);

    game.applyEvent({
      type: 'dredgeDrawReplacementResolve',
      playerId,
      resolvedStepId: 'dredge_step_declined',
      choiceId: 'draw',
    } as any);

    const zones = (game.state as any).zones[playerId];
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toEqual([]);
    expect(zones.hand.map((entry: any) => entry.id)).toEqual(['library_1']);
    expect(zones.graveyard.map((entry: any) => entry.id)).toEqual(['stinkweed_imp_1']);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual([
      'library_2',
      'library_3',
      'library_4',
      'library_5',
      'library_6',
    ]);
  });
});