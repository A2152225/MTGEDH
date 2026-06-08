import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  canCastFromTop,
  canLookAtTopOfLibrary,
  getTopCardForPlayer,
} from '../src/state/modules/game-state-effects.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';

describe('Elven Chorus top-of-library', () => {
  const p1 = 'p1' as PlayerID;

  const elvenChorusOracle =
    'You may look at the top card of your library any time.\n'
    + 'You may cast creature spells from the top of your library.\n'
    + 'Creatures you control have "{T}: Add one mana of any color."';

  function setupGame() {
    const game = createInitialGameState('elven_chorus_top_library_test');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'elven_chorus_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'elven_chorus_card',
          name: 'Elven Chorus',
          type_line: 'Enchantment',
          oracle_text: elvenChorusOracle,
        },
      },
    ];

    const library = [
      {
        id: 'top_creature',
        name: 'Elvish Mystic',
        type_line: 'Creature — Elf Druid',
        mana_cost: '{G}',
        colors: ['G'],
        oracle_text: '{T}: Add {G}.',
      },
      {
        id: 'second_card',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        mana_cost: '{R}',
        colors: ['R'],
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      },
    ];
    game.libraries.set(p1, library.map((card) => ({ ...card })));
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: library.map((card) => ({ ...card })),
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: library.length,
      },
    };

    return game;
  }

  it('allows looking at the top card via Elven Chorus', () => {
    const game = setupGame();
    const ctx = game as any;

    const lookPermission = canLookAtTopOfLibrary(ctx, p1);
    expect(lookPermission.canLook).toBe(true);
    expect(lookPermission.sources).toContain('Elven Chorus');

    const topView = getTopCardForPlayer(ctx, p1);
    expect(topView.canSee).toBe(true);
    expect(topView.card?.name).toBe('Elvish Mystic');
  });

  it('allows casting creature spells but not instants from the top of the library', () => {
    const game = setupGame();
    const ctx = game as any;

    const creatureTop = {
      type_line: 'Creature — Elf Druid',
      colors: ['G'],
    };
    const instantTop = {
      type_line: 'Instant',
      colors: ['R'],
    };

    const creaturePermission = canCastFromTop(ctx, p1, creatureTop);
    expect(creaturePermission.canCast).toBe(true);
    expect(creaturePermission.sources).toContain('Elven Chorus');

    const instantPermission = canCastFromTop(ctx, p1, instantTop);
    expect(instantPermission.canCast).toBe(false);
    expect(instantPermission.restrictions.join(' ')).toMatch(/creature/i);
  });

  it('surfaces the top creature as a library cast candidate', () => {
    const game = setupGame();
    const candidates = getCastableSpellCandidates(game as any, p1, { mode: 'main' });
    const topCreatureCast = candidates.find(
      (entry) => entry.sourceZone === 'library' && entry.castCard?.name === 'Elvish Mystic',
    );

    expect(topCreatureCast).toBeDefined();
    expect(candidates.some((entry) => entry.sourceZone === 'library' && entry.castCard?.name === 'Lightning Bolt')).toBe(false);
  });
});
