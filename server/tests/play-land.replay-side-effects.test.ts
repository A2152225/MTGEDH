import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { playLand } from '../src/state/modules/stackPlayLandUtils.js';
import type { PlayerID } from '../../shared/src';

describe('playLand replay side effects', () => {
  it('does not push live ETB triggers onto the stack while replaying events', () => {
    const boilerworks = {
      id: 'izzet_boilerworks_1',
      name: 'Izzet Boilerworks',
      type_line: 'Land',
      oracle_text: 'Izzet Boilerworks enters the battlefield tapped.\nWhen Izzet Boilerworks enters the battlefield, return a land you control to its owner\'s hand.',
    };

    const ctx: any = {
      isReplaying: true,
      gameId: 't_play_land_replay',
      libraries: new Map<string, any[]>(),
      state: {
        players: [{ id: 'p1', name: 'P1' }],
        zones: {
          p1: {
            hand: [{ ...boilerworks, zone: 'hand' }],
            handCount: 1,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          },
        },
        battlefield: [],
        stack: [],
      },
      bumpSeq: () => undefined,
    };

    ctx.libraries.set('p1', []);

    playLand(ctx, 'p1' as PlayerID, boilerworks);

    expect((ctx.state.stack || []).length).toBe(0);
    expect((ctx.state.battlefield || []).length).toBe(1);
    expect((ctx.state.battlefield || [])[0]?.card?.name).toBe('Izzet Boilerworks');
  });

  it('replays playLand via applyEvent without duplicating ETB stack items when triggers are persisted separately', () => {
    const gameId = 't_play_land_replay_apply_event';
    const playerId = 'p1' as PlayerID;
    const orchard = {
      id: 'forbidden_orchard_1',
      name: 'Forbidden Orchard',
      type_line: 'Land',
      oracle_text: '{T}: Add one mana of any color.\nWhenever you tap Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token with flying.',
    };
    const boilerworks = {
      id: 'izzet_boilerworks_1',
      name: 'Izzet Boilerworks',
      type_line: 'Land',
      oracle_text: 'Izzet Boilerworks enters the battlefield tapped.\nWhen Izzet Boilerworks enters the battlefield, return a land you control to its owner\'s hand.',
    };

    const game = createInitialGameState(gameId);
    game.applyEvent({ type: 'join', playerId, name: 'P1' });
    (game.state as any).zones = {
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
    (game.state as any).battlefield = [{
      id: 'perm_orchard',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: { ...orchard, zone: 'battlefield' },
    }];
    (game.state as any).stack = [];

    game.replay([{
      type: 'playLand',
      playerId,
      card: boilerworks,
      fromZone: 'hand',
      permanentId: 'perm_boilerworks',
      entersTapped: true,
    }] as any);

    expect((game.state as any).stack?.length || 0).toBe(0);
    expect((game.state as any).zones?.[playerId]?.hand?.map((card: any) => card.name) || []).toEqual([]);
  });
});
