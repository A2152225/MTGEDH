import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { viewerCanExamineExiledCard } from '../src/state/modules/impulse-exile-utils.js';

const SHARED_FATE_ORACLE =
  "If a player would draw a card, that player exiles the top card of one of their opponents' libraries face down instead.\nEach player may look at cards they exiled with this enchantment, and they may play lands and cast spells from among those cards.";

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function setupSharedFateReplayGame(gameId: string) {
  ResolutionQueueManager.clearAllSteps(gameId);
  const game = createInitialGameState(gameId);
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  addPlayer(game, playerId, 'P1');
  addPlayer(game, opponentId, 'P2');

  const opponentLibrary = [{
    id: 'p2_top',
    name: 'Lightning Bolt',
    type_line: 'Instant',
    mana_cost: '{R}',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    zone: 'library',
  }];
  game.libraries.set(opponentId, opponentLibrary.map((card) => ({ ...card })));
  (game.state as any).zones[opponentId] = {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    libraryCount: 1,
  };
  (game.state as any).zones[playerId] = {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    libraryCount: 0,
  };
  (game.state as any).step = 'MAIN1';
  (game.state as any).phase = 'precombat';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).battlefield = [{
    id: 'shared_fate_1',
    controller: playerId,
    card: {
      name: 'Shared Fate',
      type_line: 'Enchantment',
      oracle_text: SHARED_FATE_ORACLE,
    },
  }];

  return { game, playerId, opponentId };
}

describe('opponent-library draw replacement replay semantics', () => {
  it('replays opponentLibraryDrawReplacementResolve by clearing the prompt and exiling the chosen library top', () => {
    const gameId = 't_opponent_library_draw_replacement_replay';
    const { game, playerId, opponentId } = setupSharedFateReplayGame(gameId);

    ResolutionQueueManager.addStep(gameId, {
      id: 'opp_lib_draw_step',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'shared_fate_1',
      sourceName: 'Shared Fate',
      description: 'Choose an opponent whose library top to exile',
      mandatory: true,
      opponentLibraryDrawReplacement: true,
      remainingDrawCountAfterChoice: 0,
      options: [{ id: opponentId, label: 'P2' }],
    } as any);

    (game as any).isReplaying = true;
    (game as any)._replayNextEventType = 'opponentLibraryDrawReplacementResolve';
    game.applyEvent({ type: 'drawCards', playerId, count: 1 } as any);

    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(opponentId)?.map((entry: any) => entry.id)).toEqual(['p2_top']);

    game.applyEvent({
      type: 'opponentLibraryDrawReplacementResolve',
      playerId,
      opponentId,
      remainingDrawCountAfterChoice: 0,
      sourcePermanentId: 'shared_fate_1',
      sourceName: 'Shared Fate',
      resolvedStepId: 'opp_lib_draw_step',
    } as any);

    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(opponentId) || []).toEqual([]);
    const exiled = ((game.state as any).zones[opponentId].exile || [])[0];
    expect(exiled?.id).toBe('p2_top');
    expect(exiled?.faceDown).toBe(true);
    expect(viewerCanExamineExiledCard(exiled, playerId)).toBe(true);
  });
});
