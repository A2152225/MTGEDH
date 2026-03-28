import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('librarySearchResolve replay semantics', () => {
  it('replays battlefield results using persisted permanent ids', () => {
    const game = createInitialGameState('t_library_search_resolve_replay_ids');
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
      libraryAfter: [],
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('searched_perm_1');
    expect(battlefield[0]?.card?.id).toBe('library_card_1');
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
      libraryAfter: [],
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toContain('perm_legacy_library_card_1');
    expect(battlefield[0]?.tapped).toBe(true);
    expect(battlefield[0]?.card?.id).toBe('legacy_library_card_1');
  });
});