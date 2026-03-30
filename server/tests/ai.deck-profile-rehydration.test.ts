import { afterEach, describe, expect, it } from 'vitest';

import { cleanupGameAI, rehydrateAIPlayerRuntime } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/gameState.js';

describe('AI deck profile rehydration', () => {
  const gameId = 'ai_deck_profile_rehydration';

  afterEach(() => {
    cleanupGameAI(gameId);
    games.delete(gameId);
  });

  it('rebuilds the AI deck profile from battlefield, commander snapshot, and remaining library state after replay', () => {
    const game = createInitialGameState(gameId);
    games.set(gameId, game as any);

    game.applyEvent({
      type: 'join',
      playerId: 'ai_1',
      name: 'AI Opponent 1',
      spectator: false,
      seatToken: 'seat_ai',
      isAI: true,
      strategy: 'control',
      difficulty: 0.8,
    } as any);

    (game.state as any).zones = {
      ai_1: {
        hand: [
          {
            id: 'hand_opt',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
          },
        ],
        library: [
          {
            id: 'library_counterspell',
            name: 'Counterspell',
            type_line: 'Instant',
            oracle_text: 'Counter target spell.',
            mana_cost: '{U}{U}',
            cmc: 2,
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
        libraryCount: 1,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game as any).searchLibrary = (playerId: string) => {
      if (playerId !== 'ai_1') return [];
      return [
        {
          id: 'library_counterspell',
          name: 'Counterspell',
          type_line: 'Instant',
          oracle_text: 'Counter target spell.',
          mana_cost: '{U}{U}',
          cmc: 2,
        },
      ];
    };
    (game.state as any).commandZone = {
      ai_1: {
        commanderIds: ['commander_mizzix'],
        commanderCards: [
          {
            id: 'commander_mizzix',
            name: 'Mizzix of the Izmagnus',
            type_line: 'Legendary Creature — Goblin Wizard',
            oracle_text: 'Whenever you cast an instant or sorcery spell with mana value greater than the number of experience counters you have, you get an experience counter.',
            mana_cost: '{2}{U}{R}',
            cmc: 4,
          },
        ],
        inCommandZone: ['commander_mizzix'],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'battlefield_storm_kiln',
        controller: 'ai_1',
        card: {
          id: 'battlefield_storm_kiln_card',
          name: 'Storm-Kiln Artist',
          type_line: 'Creature — Dwarf Shaman',
          oracle_text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token.',
          mana_cost: '{3}{R}',
          cmc: 4,
        },
      },
    ];

    delete (game.state as any).aiDeckProfiles;

    expect(rehydrateAIPlayerRuntime(gameId, 'ai_1' as any, { refreshDeckProfile: true })).toBe(true);

    const profile = (game.state as any).aiDeckProfiles?.ai_1;
    expect(profile).toBeDefined();
    expect(profile.totalCards).toBe(4);
    expect(profile.primaryArchetypes).toContain('spellslinger');
    expect(profile.categoryCounts.creature).toBeGreaterThanOrEqual(2);
  });
});