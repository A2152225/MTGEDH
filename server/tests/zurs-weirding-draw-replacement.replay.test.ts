import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function card(id: string, name: string) {
  return {
    id,
    name,
    oracle_text: '',
    type_line: 'Instant',
  };
}

function setupZursWeirdingGame(gameId: string) {
  ResolutionQueueManager.clearAllSteps(gameId);
  const game = createInitialGameState(gameId);
  const drawingPlayerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  const library = [card('library_1', 'Island'), card('library_2', 'Forest')];

  addPlayer(game, drawingPlayerId, 'P1');
  addPlayer(game, opponentId, 'P2');
  game.libraries.set(drawingPlayerId, [...library]);

  (game.state as any).players = [
    { id: drawingPlayerId, name: 'P1', life: 40 },
    { id: opponentId, name: 'P2', life: 40 },
  ];
  (game.state as any).life = { [drawingPlayerId]: 40, [opponentId]: 40 };
  (game.state as any).startingLife = 40;
  (game.state as any).zones = {
    [drawingPlayerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      libraryCount: library.length,
    },
    [opponentId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      libraryCount: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'zurs_weirding',
      controller: opponentId,
      card: {
        name: "Zur's Weirding",
        oracle_text:
          "Players play with their hands revealed.\nIf a player would draw a card, they reveal it instead. Then any other player may pay 2 life. If a player does, put that card into its owner's graveyard. Otherwise, that player draws a card.",
      },
    },
  ];

  return { game, drawingPlayerId, opponentId, library };
}

describe("Zur's Weirding draw replacement replay semantics", () => {
  it('replays declined opponent choices by clearing the prompt and drawing the revealed card', () => {
    const gameId = 't_zurs_weirding_decline_replay';
    const { game, drawingPlayerId, opponentId } = setupZursWeirdingGame(gameId);

    ResolutionQueueManager.addStep(gameId, {
      id: 'zurs_step_declined',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: opponentId,
      sourceName: "Zur's Weirding",
      description: "Zur's Weirding: P1 would draw Island. You may pay 2 life to put it into their graveyard.",
      mandatory: false,
      zursWeirdingOpponentChoice: true,
      drawingPlayerId,
      decidingOpponentId: opponentId,
      opponentIndex: 0,
      remainingDrawCountAfterChoice: 0,
      opponents: [opponentId],
      revealedCard: { id: 'library_1', name: 'Island' },
      options: [
        { id: 'pay_2_life', label: 'Pay 2 life (put card in graveyard)' },
        { id: 'decline', label: 'Decline' },
      ],
    } as any);

    (game.state as any).zursWeirdingPendingDraw = {
      drawingPlayerId,
      sourceName: "Zur's Weirding",
      revealedCard: { id: 'library_1', name: 'Island' },
      remainingDrawCountAfterChoice: 0,
      opponents: [opponentId],
      nextOpponentIndex: 0,
    };

    game.applyEvent({
      type: 'zursWeirdingDrawReplacementResolve',
      playerId: opponentId,
      drawingPlayerId,
      resolvedStepId: 'zurs_step_declined',
      choiceId: 'decline',
      opponentIndex: 0,
      remainingDrawCountAfterChoice: 0,
    } as any);

    expect(ResolutionQueueManager.getStepsForPlayer(gameId, opponentId)).toEqual([]);
    expect((game.state as any).zones[drawingPlayerId].hand.map((entry: any) => entry.id)).toEqual(['library_1']);
    expect((game.state as any).zones[drawingPlayerId].graveyard).toEqual([]);
    expect(game.libraries.get(drawingPlayerId)?.map((entry: any) => entry.id)).toEqual(['library_2']);
  });

  it('replays paid opponent choices by milling the revealed card instead of drawing it', () => {
    const gameId = 't_zurs_weirding_pay_replay';
    const { game, drawingPlayerId, opponentId } = setupZursWeirdingGame(gameId);

    ResolutionQueueManager.addStep(gameId, {
      id: 'zurs_step_paid',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: opponentId,
      sourceName: "Zur's Weirding",
      description: "Zur's Weirding: P1 would draw Island. You may pay 2 life to put it into their graveyard.",
      mandatory: false,
      zursWeirdingOpponentChoice: true,
      drawingPlayerId,
      decidingOpponentId: opponentId,
      opponentIndex: 0,
      remainingDrawCountAfterChoice: 0,
      opponents: [opponentId],
      revealedCard: { id: 'library_1', name: 'Island' },
      options: [
        { id: 'pay_2_life', label: 'Pay 2 life (put card in graveyard)' },
        { id: 'decline', label: 'Decline' },
      ],
    } as any);

    (game.state as any).zursWeirdingPendingDraw = {
      drawingPlayerId,
      sourceName: "Zur's Weirding",
      revealedCard: { id: 'library_1', name: 'Island' },
      remainingDrawCountAfterChoice: 0,
      opponents: [opponentId],
      nextOpponentIndex: 0,
    };

    game.applyEvent({
      type: 'zursWeirdingDrawReplacementResolve',
      playerId: opponentId,
      drawingPlayerId,
      resolvedStepId: 'zurs_step_paid',
      choiceId: 'pay_2_life',
      opponentIndex: 0,
      remainingDrawCountAfterChoice: 0,
    } as any);

    expect(ResolutionQueueManager.getStepsForPlayer(gameId, opponentId)).toEqual([]);
    expect((game.state as any).zones[drawingPlayerId].hand).toEqual([]);
    expect((game.state as any).zones[drawingPlayerId].graveyard.map((entry: any) => entry.id)).toEqual(['library_1']);
    expect((game.state as any).life[opponentId]).toBe(38);
    expect(game.libraries.get(drawingPlayerId)?.map((entry: any) => entry.id)).toEqual(['library_2']);
  });
});
