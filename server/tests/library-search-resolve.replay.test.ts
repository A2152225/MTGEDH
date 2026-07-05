import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('librarySearchResolve replay semantics', () => {
  it('replays battlefield results using persisted permanent ids', () => {
    const gameId = 't_library_search_resolve_replay_ids';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
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

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'library_search_step_1',
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: p1,
      description: 'Search your library',
      mandatory: true,
      sourceName: 'Search Effect',
    } as any);

    game.applyEvent({
      type: 'librarySearchResolve',
      playerId: p1,
      resolvedStepId: 'library_search_step_1',
      sourceName: 'Search Effect',
      selectedCardIds: ['library_card_1'],
      selectedCards: [
        {
          id: 'library_card_1',
          name: 'Knight of the White Orchid',
          type_line: 'Creature — Human Knight',
          oracle_text: 'First strike',
          power: '2',
          toughness: '2',
        },
      ],
      createdPermanentIds: ['searched_perm_1'],
      destination: 'battlefield',
      entersTapped: false,
      remainingLibraryIds: [],
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('searched_perm_1');
    expect(battlefield[0]?.card?.id).toBe('library_card_1');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'library_search_step_1')).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('falls back to deterministic ids for legacy battlefield search events without persisted ids', () => {
    const game = createInitialGameState('t_library_search_resolve_replay_legacy_ids');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
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

    game.applyEvent({
      type: 'librarySearchResolve',
      playerId: p1,
      selectedCardIds: ['legacy_library_card_1'],
      selectedCards: [
        {
          id: 'legacy_library_card_1',
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
          power: '1',
          toughness: '1',
        },
      ],
      destination: 'battlefield',
      entersTapped: true,
      remainingLibraryIds: [],
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toContain('perm_legacy_library_card_1');
    expect(battlefield[0]?.tapped).toBe(true);
    expect(battlefield[0]?.card?.id).toBe('legacy_library_card_1');
  });

  it('does not re-shuffle library on replay finalize when libraryAfter snapshot is present', () => {
    const gameId = 't_library_search_library_after_no_reshuffle';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game as any).libraries = new Map([
      [p1, [
        { id: 'island', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
        { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
      ]],
    ]);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const libraryAfter = [
      { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
      { id: 'island', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
    ];

    game.replay([{
      type: 'librarySearchResolve',
      playerId: p1,
      searchOwnerId: p1,
      sourceName: "Kodama's Reach",
      selectedCardIds: ['f1', 'p1'],
      selectedCards: [
        { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
        { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'library' },
      ],
      splitAssignments: { toBattlefield: ['f1'], toHand: ['p1'] },
      destination: 'split',
      entersTapped: true,
      remainingLibraryIds: ['bolt', 'island'],
      libraryAfter,
      oracleIrResumeStepsJson: JSON.stringify([
        { kind: 'shuffle_library', who: { kind: 'you' }, raw: 'then shuffle' },
      ]),
      oracleIrControllerId: p1,
      oracleIrSourceId: 'kodamas_reach_2',
      oracleIrSourceName: "Kodama's Reach",
    } as any]);

    const lib = ((game as any).libraries?.get(p1) || []).map((card: any) => String(card?.id || ''));
    expect(lib).toEqual(['bolt', 'island']);
    expect((game.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });
});