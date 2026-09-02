import { describe, expect, it } from 'vitest';

import { calculateMaxLandsPerTurn, recalculatePlayerEffects } from '../src/state/modules/game-state-effects.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { movePermanentToExile } from '../src/state/modules/counters_tokens.js';
import { movePermanentToLibrary } from '../src/state/modules/zones.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const EXPLORATION_ORACLE = 'You may play an additional land on each of your turns.';
const AZUSA_ORACLE = 'You may play two additional lands on each of your turns.';
const FASTBOND_ORACLE =
  "You may play any number of lands on each of your turns.\nWhenever you play a land, if it wasn't the first land you played this turn, this enchantment deals 1 damage to you.";
const ORRERY_ORACLE =
  "Each player may play an additional land on each of their turns.\nAt the beginning of each player's upkeep, if that player has no cards in hand, that player draws three cards.";
const CRUCIBLE_ORACLE = 'You may play lands from your graveyard.';
const BROODSHIP_ORACLE =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n" +
  '3+ | You may play an additional land on each of your turns.\n' +
  '8+ | Flying\n' +
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

function ctxFor(battlefield: any[]) {
  return { state: { battlefield } } as any;
}

function perm(
  id: string,
  controller: string,
  name: string,
  oracleText: string,
  extra?: { typeLine?: string; counters?: Record<string, number> },
) {
  const { typeLine, ...rest } = extra ?? {};
  return {
    id,
    controller,
    ...rest,
    card: { name, type_line: typeLine ?? 'Enchantment', oracle_text: oracleText },
  };
}

describe('calculateMaxLandsPerTurn is oracle-only (no ADDITIONAL_LAND_PLAY_CARDS table)', () => {
  it('grants +1 from Exploration oracle on an anonymous permanent', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Extra Drop', EXPLORATION_ORACLE)]);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(2);
    expect(calculateMaxLandsPerTurn(ctx, 'p2')).toBe(1);
  });

  it('grants +2 from Azusa oracle on an anonymous permanent', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Two Extra Drops', AZUSA_ORACLE)]);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(3);
  });

  it('grants unlimited lands from Fastbond oracle on an anonymous permanent', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Any Number Lands', FASTBOND_ORACLE)]);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(Number.POSITIVE_INFINITY);
  });

  it('grants +1 to opponents from Orrery-style each-player oracle', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Shared Extra Drop', ORRERY_ORACLE)]);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(2);
    expect(calculateMaxLandsPerTurn(ctx, 'p2')).toBe(2);
  });

  it('does not treat graveyard-play oracle as extra land drops', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Graveyard Lands', CRUCIBLE_ORACLE)]);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(1);
  });

  it('does not grant extra lands from leftover name fragments without extra-drop oracle', () => {
    const ctx = ctxFor([
      perm('fx1', 'p1', 'Loot, Fixture Explorer', CRUCIBLE_ORACLE),
      perm('fx2', 'p1', 'Exploration', CRUCIBLE_ORACLE),
    ]);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(1);
  });

  it('uses active station abilities, not the spacecraft name, for extra land drops', () => {
    const broodship = perm('ship1', 'p1', 'Exploration Broodship', BROODSHIP_ORACLE, {
      typeLine: 'Artifact — Spacecraft',
      counters: { charge: 2 },
    });
    expect(calculateMaxLandsPerTurn(ctxFor([broodship]), 'p1')).toBe(1);
    expect(
      calculateMaxLandsPerTurn(
        ctxFor([{ ...broodship, counters: { charge: 3 } }]),
        'p1',
      ),
    ).toBe(2);
  });

  it('drops extra land plays when the granting permanent is shuffled into the library', () => {
    const game = createInitialGameState('land_ltb_library');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).zones = {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    };
    game.libraries.set('p1' as any, []);
    game.libraries.set('p2' as any, []);
    (game.state as any).battlefield = [
      perm('fx1', 'p1', 'Fixture Extra Drop', EXPLORATION_ORACLE),
    ];
    (game.state as any).battlefield[0].owner = 'p1';
    recalculatePlayerEffects(game as any);
    expect((game.state as any).maxLandsPerTurn?.p1).toBe(2);
    expect(calculateMaxLandsPerTurn(game as any, 'p1')).toBe(2);

    expect(movePermanentToLibrary(game as any, 'fx1', 'shuffle')).toBe(true);
    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'fx1')).toBe(false);
    expect(calculateMaxLandsPerTurn(game as any, 'p1')).toBe(1);
    expect((game.state as any).maxLandsPerTurn?.p1).toBe(1);
  });

  it('drops extra land plays when the granting permanent is exiled', () => {
    const game = createInitialGameState('land_ltb_exile');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).zones = {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      perm('fx1', 'p1', 'Fixture Extra Drop', EXPLORATION_ORACLE),
    ];
    (game.state as any).battlefield[0].owner = 'p1';
    recalculatePlayerEffects(game as any);
    expect((game.state as any).maxLandsPerTurn?.p1).toBe(2);

    movePermanentToExile(game as any, 'fx1');
    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'fx1')).toBe(false);
    expect(calculateMaxLandsPerTurn(game as any, 'p1')).toBe(1);
    expect((game.state as any).maxLandsPerTurn?.p1).toBe(1);
  });
});
