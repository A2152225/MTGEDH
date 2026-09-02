import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { millCardsFromLibrary } from '../src/state/modules/triggerLibraryMillUtils.js';
import { millPlayerCardsFromTrigger } from '../src/state/modules/triggerMillFromEffectUtils.js';
import { millUntilLand } from '../src/socket/util-handlers/playerStateZones.js';
import { hydrateOracleIRPlayerZonesFromContext } from '../src/state/modules/oracleIrServerZoneSync.js';
import { readPlayerZoneCards } from '../../rules-engine/src/oracleIRExecutorPlayerZoneAccess.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function libraryIds(game: any, playerId: string): string[] {
  const fromMap = ((game as any).libraries as Map<string, any[]>)?.get(playerId) || [];
  return fromMap.map((card: any) => String(card?.id || ''));
}

function zoneLibraryIds(game: any, playerId: string): string[] {
  return (game.state.zones?.[playerId]?.library || []).map((card: any) => String(card?.id || ''));
}

describe('dual library store save/load', () => {
  it('replays mill from the libraries Map when zones.library is the empty join default', () => {
    const game = createInitialGameState('t_mill_replay_map');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, [
      { id: 'top', name: 'Top', zone: 'library' },
      { id: 'keep', name: 'Keep', zone: 'library' },
    ]);
    game.state.zones[p1].library = [];
    game.state.zones[p1].libraryCount = 0;

    game.applyEvent({ type: 'mill', playerId: p1, count: 1 });

    expect(libraryIds(game, p1)).toEqual(['keep']);
    expect(zoneLibraryIds(game, p1)).toEqual(['keep']);
    expect((game.state.zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['top']);
  });

  it('replays mill from zones.library when the Map is empty and writes both stores', () => {
    const game = createInitialGameState('t_mill_replay_zones');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, []);
    game.state.zones[p1].library = [
      { id: 'top', name: 'Top', zone: 'library' },
      { id: 'keep', name: 'Keep', zone: 'library' },
    ];
    game.state.zones[p1].libraryCount = 2;

    game.applyEvent({ type: 'mill', playerId: p1, count: 1 });

    expect(libraryIds(game, p1)).toEqual(['keep']);
    expect(zoneLibraryIds(game, p1)).toEqual(['keep']);
    expect((game.state.zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['top']);
  });

  it('replays mill cardIds even when those cards are not on top', () => {
    const game = createInitialGameState('t_mill_replay_ids');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, [
      { id: 'keep', name: 'Keep', zone: 'library' },
      { id: 'mill_me', name: 'Mill Me', zone: 'library' },
    ]);
    game.state.zones[p1].library = [];

    game.applyEvent({ type: 'mill', playerId: p1, count: 1, cardIds: ['mill_me'] });

    expect(libraryIds(game, p1)).toEqual(['keep']);
    expect((game.state.zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['mill_me']);
  });

  it('millCardsFromLibrary persists cardIds', () => {
    const game = createInitialGameState('t_mill_persist_ids');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, [
      { id: 'm1', name: 'One', zone: 'library' },
      { id: 'm2', name: 'Two', zone: 'library' },
    ]);
    vi.mocked(appendEvent).mockClear();
    millCardsFromLibrary(game.state as any, p1, 2, game as any);
    const millAppends = vi.mocked(appendEvent).mock.calls.filter((call) => String(call[2] || '') === 'mill');
    expect(millAppends[0]?.[3]).toEqual(expect.objectContaining({
      playerId: p1,
      count: 2,
      cardIds: ['m1', 'm2'],
    }));
  });

  it('millUntilLand mills from the Map when zones.library is empty', () => {
    const game = createInitialGameState('t_mill_until_land_map');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, [
      { id: 'c1', name: 'Shock', type_line: 'Instant', zone: 'library' },
      { id: 'c2', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: 'c3', name: 'Keep', type_line: 'Instant', zone: 'library' },
    ]);
    game.state.zones[p1].library = [];

    const result = millUntilLand(game, p1);
    expect(result.milled.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(libraryIds(game, p1)).toEqual(['c3']);
    expect(zoneLibraryIds(game, p1)).toEqual(['c3']);
  });

  it('millPlayerCardsFromTrigger mills from zones.library when the Map is empty', () => {
    const game = createInitialGameState('t_mill_trigger_zones');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, []);
    game.state.zones[p1].library = [
      { id: 't1', name: 'Trigger Mill', zone: 'library' },
      { id: 't2', name: 'Keep', zone: 'library' },
    ];

    millPlayerCardsFromTrigger(game as any, p1, p1, 1, 'Test Source');
    expect(libraryIds(game, p1)).toEqual(['t2']);
    expect(zoneLibraryIds(game, p1)).toEqual(['t2']);
  });

  it('confirmGraveyardTargets library_top does not replace a populated zone library with an empty Map', () => {
    const game = createInitialGameState('t_gy_to_lib_dual');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, []);
    game.state.zones[p1].library = [
      { id: 'keep_a', name: 'Keep A', zone: 'library' },
      { id: 'keep_b', name: 'Keep B', zone: 'library' },
    ];
    game.state.zones[p1].graveyard = [{ id: 'from_gy', name: 'From GY', zone: 'graveyard' }];
    game.state.zones[p1].graveyardCount = 1;

    game.applyEvent({
      type: 'confirmGraveyardTargets',
      playerId: p1,
      selectedCardIds: ['from_gy'],
      destination: 'library_top',
    });

    expect(libraryIds(game, p1)).toEqual(['from_gy', 'keep_a', 'keep_b']);
    expect(zoneLibraryIds(game, p1)).toEqual(['from_gy', 'keep_a', 'keep_b']);
  });

  it('chooseLookedAtCardsDestinationResolve prefers the Map over an empty zones.library', () => {
    const game = createInitialGameState('t_look_dest_map');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game as any).libraries.set(p1, [
      { id: 'chosen', name: 'Chosen', zone: 'library' },
      { id: 'other', name: 'Other', zone: 'library' },
      { id: 'rest', name: 'Rest', zone: 'library' },
    ]);
    game.state.zones[p1].library = [];

    game.applyEvent({
      type: 'chooseLookedAtCardsDestinationResolve',
      playerId: p1,
      controllerId: p1,
      chosenCardId: 'chosen',
      chosenZone: 'hand',
      otherZone: 'bottom_library',
      topCardIds: ['chosen', 'other'],
    });

    expect((game.state.zones[p1].hand || []).map((c: any) => c.id)).toEqual(['chosen']);
    expect(libraryIds(game, p1)).toEqual(['rest', 'other']);
    expect(zoneLibraryIds(game, p1)).toEqual(['rest', 'other']);
  });

  it('hydrateOracleIRPlayerZonesFromContext does not copy an empty Map over a populated zones.library', () => {
    const p1 = 'p1';
    const state: any = {
      players: [{ id: p1, library: [], hand: [], graveyard: [], exile: [] }],
      zones: {
        [p1]: {
          library: [{ id: 'lib_1', name: 'Island', zone: 'library' }],
          hand: [{ id: 'h1', name: 'Bolt', zone: 'hand' }],
          graveyard: [{ id: 'g1', name: 'Dead', zone: 'graveyard' }],
          exile: [{ id: 'e1', name: 'Gone', zone: 'exile' }],
        },
      },
    };
    const ctx: any = {
      libraries: new Map([[p1, []]]),
      state,
    };

    hydrateOracleIRPlayerZonesFromContext(ctx, state);

    expect((state.players[0].library || []).map((c: any) => c.id)).toEqual(['lib_1']);
    expect((state.players[0].hand || []).map((c: any) => c.id)).toEqual(['h1']);
    expect((state.players[0].graveyard || []).map((c: any) => c.id)).toEqual(['g1']);
    expect((state.players[0].exile || []).map((c: any) => c.id)).toEqual(['e1']);
  });

  it('readPlayerZoneCards falls back to state.zones when player arrays are empty', () => {
    const player = { id: 'p1', library: [], hand: [], graveyard: [], exile: [] };
    const state: any = {
      players: [player],
      zones: {
        p1: {
          library: [{ id: 'lib_1' }],
          hand: [{ id: 'h1' }],
          graveyard: [{ id: 'g1' }],
          exile: [{ id: 'e1' }],
        },
      },
    };

    expect(readPlayerZoneCards(state, 'p1' as any, player, 'library').map((c: any) => c.id)).toEqual(['lib_1']);
    expect(readPlayerZoneCards(state, 'p1' as any, player, 'hand').map((c: any) => c.id)).toEqual(['h1']);
    expect(readPlayerZoneCards(state, 'p1' as any, player, 'graveyard').map((c: any) => c.id)).toEqual(['g1']);
    expect(readPlayerZoneCards(state, 'p1' as any, player, 'exile').map((c: any) => c.id)).toEqual(['e1']);
  });
});
