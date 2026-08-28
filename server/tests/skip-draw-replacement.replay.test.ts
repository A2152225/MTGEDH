import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { collectAttackYouProhibitionForAttacker } from '../src/state/modules/staticEffectSpecAttackYouTax.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const ISLAND_SANCTUARY_ORACLE =
  "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by creatures with flying and/or islandwalk.";

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function card(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    oracle_text: '',
    type_line: 'Creature',
    ...extra,
  };
}

function setupSkipDrawGame(gameId: string, step: string) {
  ResolutionQueueManager.clearAllSteps(gameId);
  const game = createInitialGameState(gameId);
  const playerId = 'p1' as PlayerID;
  const library = [
    card('library_1', 'Island'),
    card('library_2', 'Swamp'),
  ];

  addPlayer(game, playerId, 'P1');
  game.libraries.set(playerId, [...library]);
  (game.state as any).step = step;
  (game.state as any).phase = step === 'DRAW' ? 'beginning' : 'precombat';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).battlefield = [{
    id: 'sanctuary_1',
    controller: playerId,
    card: {
      name: 'Island Sanctuary',
      type_line: 'Enchantment',
      oracle_text: ISLAND_SANCTUARY_ORACLE,
    },
  }];
  (game.state as any).zones[playerId] = {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    libraryCount: library.length,
  };

  return { game, playerId, library };
}

describe('skip-draw replacement replay semantics', () => {
  it('queues a skip-draw choice during the draw step instead of drawing', () => {
    const gameId = 't_skip_draw_replacement_queue';
    const { game, playerId } = setupSkipDrawGame(gameId, 'DRAW');

    const drawn = game.drawCards(playerId, 1);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);

    expect(drawn).toEqual([]);
    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual(['library_1', 'library_2']);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      skipDrawReplacementChoice: true,
      minSelections: 1,
      maxSelections: 1,
      remainingDrawCountAfterChoice: 0,
    });
    expect((steps[0] as any).exceptKeywords).toEqual(['flying', 'islandwalk']);
    expect((steps[0] as any).options.map((option: any) => option.id)).toEqual(['draw', 'skip_draw']);
  });

  it('draws immediately outside the draw step', () => {
    const gameId = 't_skip_draw_replacement_main';
    const { game, playerId } = setupSkipDrawGame(gameId, 'MAIN1');

    const drawn = game.drawCards(playerId, 1);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);

    expect(drawn.map((entry: any) => entry.id)).toEqual(['library_1']);
    expect((game.state as any).zones[playerId].hand.map((entry: any) => entry.id)).toEqual(['library_1']);
    expect(steps).toHaveLength(0);
  });

  it('replays skip by clearing the prompt, skipping the draw, and stamping the except-keywords lock', () => {
    const gameId = 't_skip_draw_replacement_skip_replay';
    const { game, playerId } = setupSkipDrawGame(gameId, 'DRAW');

    ResolutionQueueManager.addStep(gameId, {
      id: 'skip_draw_step_accepted',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'sanctuary_1',
      sourceName: 'Island Sanctuary',
      description: 'Skip this draw?',
      mandatory: true,
      skipDrawReplacementChoice: true,
      exceptKeywords: ['flying', 'islandwalk'],
      options: ['draw', 'skip_draw'],
    } as any);

    (game as any).isReplaying = true;
    (game as any)._replayNextEventType = 'skipDrawReplacementResolve';
    game.applyEvent({ type: 'drawCards', playerId, count: 1 } as any);

    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual(['library_1', 'library_2']);

    game.applyEvent({
      type: 'skipDrawReplacementResolve',
      playerId,
      resolvedStepId: 'skip_draw_step_accepted',
      choiceId: 'skip_draw',
      remainingDrawCountAfterChoice: 0,
      exceptKeywords: ['flying', 'islandwalk'],
      sourcePermanentId: 'sanctuary_1',
      sourceName: 'Island Sanctuary',
    } as any);

    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
    expect((game.state as any).zones[playerId].hand).toEqual([]);
    expect(game.libraries.get(playerId)?.map((entry: any) => entry.id)).toEqual(['library_1', 'library_2']);
    expect((game.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'attackYouProhibitedExceptKeywords',
        targetPlayer: playerId,
        keywords: ['flying', 'islandwalk'],
      }),
    ]);

    const ground = {
      id: 'bear_1',
      controller: 'p2',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    expect(collectAttackYouProhibitionForAttacker(game.state, playerId, ground as any)).toBe('Island Sanctuary');
  });

  it('replays draw by clearing the prompt and drawing the card', () => {
    const gameId = 't_skip_draw_replacement_draw_replay';
    const { game, playerId } = setupSkipDrawGame(gameId, 'DRAW');

    ResolutionQueueManager.addStep(gameId, {
      id: 'skip_draw_step_declined',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'sanctuary_1',
      sourceName: 'Island Sanctuary',
      description: 'Skip this draw?',
      mandatory: true,
      skipDrawReplacementChoice: true,
      exceptKeywords: ['flying', 'islandwalk'],
      options: ['draw', 'skip_draw'],
    } as any);

    (game as any).isReplaying = true;
    (game as any)._replayNextEventType = 'skipDrawReplacementResolve';
    game.applyEvent({ type: 'drawCards', playerId, count: 1 } as any);

    game.applyEvent({
      type: 'skipDrawReplacementResolve',
      playerId,
      resolvedStepId: 'skip_draw_step_declined',
      choiceId: 'draw',
      remainingDrawCountAfterChoice: 0,
    } as any);

    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
    expect((game.state as any).zones[playerId].hand.map((entry: any) => entry.id)).toEqual(['library_1']);
    expect((game.state as any).lastingEffects || []).toEqual([]);
  });
});
