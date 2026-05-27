import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addActiveStep(gameId: string, playerId: PlayerID, extra: Record<string, any>) {
  const step = ResolutionQueueManager.addStep(gameId, {
    playerId,
    description: 'Resolve a prompt.',
    mandatory: true,
    ...extra,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('proliferate, fateseal, and clash replay semantics', () => {
  it('replays proliferate by adding one of each existing counter to permanents and players', () => {
    const gameId = 't_proliferate_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.PROLIFERATE,
      proliferateId: 'proliferate_1',
    });

    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        counters: { '+1/+1': 2, charge: 1 },
        card: { id: 'perm_card', name: 'Contagion Target', type_line: 'Artifact Creature' },
      },
    ];
    const playerTwo = ((game.state as any).players || []).find((player: any) => player.id === p2);
    (playerTwo as any).counters = { poison: 1 };

    game.applyEvent({
      type: 'proliferateResolve',
      playerId: p1,
      resolvedStepId: step.id,
      targetIds: ['perm_1', p2],
      proliferateId: 'proliferate_1',
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect(permanent.counters).toEqual({ '+1/+1': 3, charge: 2 });
    expect((playerTwo as any).counters).toEqual({ poison: 2 });
    expect((game.state as any).putCounterOnCreatureThisTurn?.[p1]).toBe(true);
    expect((game.state as any).countersPutThisTurnByPermanentId?.perm_1).toBe(1);
    expect((game.state as any).plusOneCountersPutThisTurnByPermanentId?.perm_1).toBe(1);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.PROLIFERATE);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.PROLIFERATE)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays fateseal by restoring the chosen top and bottom library order', () => {
    const gameId = 't_fateseal_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.FATESEAL,
      opponentId: p2,
    });

    game.importDeckResolved(p2, [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
      { id: 'c3', name: 'Card 3', zone: 'library' },
      { id: 'c4', name: 'Card 4', zone: 'library' },
    ] as any);
    (game.state as any).zones = {
      [p2]: { hand: [], handCount: 0, libraryCount: 4, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    game.applyEvent({
      type: 'fatesealResolve',
      playerId: p1,
      resolvedStepId: step.id,
      opponentId: p2,
      keepTopOrder: [{ id: 'c2', name: 'Card 2' }],
      bottomOrder: [{ id: 'c1', name: 'Card 1' }],
    } as any);

    expect((game.searchLibrary(p2, '', 10) || []).map((card: any) => card.id)).toEqual(['c2', 'c3', 'c4', 'c1']);
    expect((game.state as any).zones[p2].libraryCount).toBe(4);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.FATESEAL);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.FATESEAL)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays clash by moving the revealed top card to the bottom when chosen', () => {
    const gameId = 't_clash_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.CLASH,
      revealedCard: { id: 'top_card', name: 'Top Card' },
    });

    game.importDeckResolved(p1, [
      { id: 'top_card', name: 'Top Card', zone: 'library' },
      { id: 'next_card', name: 'Next Card', zone: 'library' },
    ] as any);
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 2, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    game.applyEvent({
      type: 'clashResolve',
      playerId: p1,
      resolvedStepId: step.id,
      revealedCard: { id: 'top_card', name: 'Top Card' },
      putOnBottom: true,
    } as any);

    expect((game.searchLibrary(p1, '', 10) || []).map((card: any) => card.id)).toEqual(['next_card', 'top_card']);
    expect((game.state as any).zones[p1].libraryCount).toBe(2);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.CLASH);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.CLASH)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });
});