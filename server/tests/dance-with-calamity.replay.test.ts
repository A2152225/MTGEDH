import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { processPendingDanceWithCalamity } from '../src/socket/resolution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const DANCE_WITH_CALAMITY_ORACLE = 'Shuffle your library. As many times as you choose, you may exile the top card of your library. If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs.';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function initZones(game: any, playerId: PlayerID) {
  (game.state as any).zones = {
    ...(game.state as any).zones,
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
}

describe('Dance with Calamity live/replay semantics', () => {
  it('resolving the spell queues the initial push-your-luck prompt directly without pending staging', () => {
    const gameId = 't_dance_with_calamity_live_init';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.importDeckResolved(p1, [
      { id: 'a', name: 'A', zone: 'library', cmc: 1 },
      { id: 'b', name: 'B', zone: 'library', cmc: 2 },
      { id: 'c', name: 'C', zone: 'library', cmc: 3 },
      { id: 'd', name: 'D', zone: 'library', cmc: 4 },
    ] as any);

    (game.state as any).stack = [
      {
        id: 'dance_stack_1',
        cardId: 'dance_stack_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'dance_card_1',
          name: 'Dance with Calamity',
          type_line: 'Sorcery',
          oracle_text: DANCE_WITH_CALAMITY_ORACLE,
        },
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    resolveTopOfStack(game as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type).toBe(ResolutionStepType.DANCE_WITH_CALAMITY);
    expect((steps[0] as any)?.exiledCards).toEqual([]);
    expect((steps[0] as any)?.totalManaValue).toBe(0);
    expect((steps[0] as any)?.canContinue).toBe(true);
    expect((steps[0] as any)?.effectId).toBeTruthy();
    expect((game.state as any).pendingDanceWithCalamity).toBeUndefined();
  });

  it('replays a continue decision by moving the card to exile, updating library state, and rebuilding the next prompt', () => {
    const gameId = 't_dance_with_calamity_continue_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    (game.state as any).pendingDanceWithCalamity = {
      [p1]: {
        effectId: 'dance_1',
        sourceName: 'Dance with Calamity',
        exiledCards: [],
        totalManaValue: 0,
        stage: 'exile',
        queued: true,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DANCE_WITH_CALAMITY,
      playerId: p1,
      description: 'Dance with Calamity',
      mandatory: true,
      effectId: 'dance_1',
      exiledCards: [],
      totalManaValue: 0,
      canContinue: true,
    } as any);

    game.applyEvent({
      type: 'danceWithCalamityContinue',
      playerId: p1,
      effectId: 'dance_1',
      sourceName: 'Dance with Calamity',
      totalManaValue: 6,
      exiledCards: [
        { id: 'spell_a', name: 'Spell A', type_line: 'Sorcery', cmc: 6, zone: 'exile' },
      ],
      libraryAfter: [
        { id: 'b', name: 'B', cmc: 2, zone: 'library' },
        { id: 'c', name: 'C', cmc: 3, zone: 'library' },
      ],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['b', 'c']);
    expect((game.state as any).zones[p1].exile.map((card: any) => card.id)).toEqual(['spell_a']);
    expect((game.state as any).pendingDanceWithCalamity?.[p1]?.queued).toBe(false);

    processPendingDanceWithCalamity({} as any, game, gameId);

    const nextSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]?.type).toBe(ResolutionStepType.DANCE_WITH_CALAMITY);
    expect((nextSteps[0] as any)?.exiledCards?.map((card: any) => card.id)).toEqual(['spell_a']);
    expect((nextSteps[0] as any)?.totalManaValue).toBe(6);
  });

  it('replays the cast-selection stage and rehydrates the ordered free-cast prompt sequence', () => {
    const gameId = 't_dance_with_calamity_cast_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    (game.state as any).zones[p1].exile = [
      { id: 'spell_a', name: 'Spell A', type_line: 'Sorcery', cmc: 6, zone: 'exile' },
      { id: 'land_b', name: 'Land B', type_line: 'Land', cmc: 0, zone: 'exile' },
      { id: 'spell_c', name: 'Spell C', type_line: 'Instant', cmc: 3, zone: 'exile' },
    ];
    (game.state as any).zones[p1].exileCount = 3;

    game.applyEvent({
      type: 'danceWithCalamityBeginCasting',
      playerId: p1,
      effectId: 'dance_2',
      sourceName: 'Dance with Calamity',
      totalManaValue: 9,
      spellCardIds: ['spell_a', 'spell_c'],
    } as any);

    processPendingDanceWithCalamity({} as any, game, gameId);

    let steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type).toBe(ResolutionStepType.DANCE_WITH_CALAMITY_CAST);
    expect((steps[0] as any)?.spellCards?.map((card: any) => card.id)).toEqual(['spell_a', 'spell_c']);

    ResolutionQueueManager.removeQueue(gameId);

    game.applyEvent({
      type: 'danceWithCalamitySetCastOrder',
      playerId: p1,
      effectId: 'dance_2',
      sourceName: 'Dance with Calamity',
      totalManaValue: 9,
      orderedSpellIds: ['spell_c', 'spell_a'],
    } as any);

    processPendingDanceWithCalamity({} as any, game, gameId);

    steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect((steps[0] as any)?.castFromExileCardId).toBe('spell_c');
    expect((steps[0] as any)?.danceWithCalamityCastPrompt).toBe(true);
  });

  it('replays the final resolve event by clearing the pending prompt while preserving exiled cards', () => {
    const gameId = 't_dance_with_calamity_resolve_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    (game.state as any).pendingDanceWithCalamity = {
      [p1]: {
        effectId: 'dance_3',
        sourceName: 'Dance with Calamity',
        exiledCards: [{ id: 'spell_a', name: 'Spell A', type_line: 'Sorcery', cmc: 6, zone: 'exile' }],
        totalManaValue: 6,
        stage: 'cast_sequence',
        orderedSpellIds: ['spell_a'],
        nextCastIndex: 0,
        queued: true,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Dance with Calamity prompt',
      mandatory: false,
      danceWithCalamityCastPrompt: true,
      danceWithCalamityEffectId: 'dance_3',
      castFromExileCardId: 'spell_a',
      castFromExileCard: { id: 'spell_a', name: 'Spell A', type_line: 'Sorcery', cmc: 6 },
      options: [],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    game.applyEvent({
      type: 'danceWithCalamityResolve',
      playerId: p1,
      effectId: 'dance_3',
      sourceName: 'Dance with Calamity',
      outcome: 'complete',
      totalManaValue: 6,
      exiledCards: [
        { id: 'spell_a', name: 'Spell A', type_line: 'Sorcery', cmc: 6, zone: 'exile' },
      ],
      libraryAfter: [
        { id: 'rest_1', name: 'Rest 1', zone: 'library' },
      ],
    } as any);

    expect((game.state as any).pendingDanceWithCalamity).toBeUndefined();
    expect((game.state as any).zones[p1].exile.map((card: any) => card.id)).toEqual(['spell_a']);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });
});