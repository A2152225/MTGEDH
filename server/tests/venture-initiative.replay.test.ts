import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('venture and initiative replay semantics', () => {
  it('replays ventureChooseDungeonResolve by restoring the chosen dungeon, including Undercity', () => {
    const game = createInitialGameState('t_venture_choose_dungeon_resolve_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseDungeonResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      currentRoomEffect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      roomPath: ['secret_entrance'],
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      roomPath: ['secret_entrance'],
    });
  });

  it('replays ventureChooseDungeonResolve and applies deterministic entry effects', () => {
    const game = createInitialGameState('t_venture_choose_dungeon_effect_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseDungeonResolve',
      playerId,
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      roomIndex: 0,
      currentRoomId: 'yawning_portal',
      currentRoomName: 'Yawning Portal',
      currentRoomEffect: 'You gain 1 life.',
      roomPath: ['yawning_portal'],
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      currentRoomId: 'yawning_portal',
    });
    expect((((game.state as any).life || {})[playerId] ?? (game.state as any).players?.[0]?.life)).toBe(41);
  });

  it('replays ventureChooseRoomResolve by restoring the chosen next room snapshot', () => {
    const game = createInitialGameState('t_venture_choose_room_resolve_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 1,
      currentRoomId: 'mine_tunnels',
      currentRoomName: 'Mine Tunnels',
      currentRoomEffect: 'Create a Treasure token.',
      roomPath: ['cave_entrance', 'mine_tunnels'],
      completed: false,
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 1,
      currentRoomId: 'mine_tunnels',
      currentRoomName: 'Mine Tunnels',
      roomPath: ['cave_entrance', 'mine_tunnels'],
    });
  });

  it('replays ventureChooseRoomResolve completion by recording completion and clearing active progress', () => {
    const game = createInitialGameState('t_venture_choose_room_complete_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');
    game.libraries.set(playerId, [
      {
        id: 'replay_draw_1',
        name: 'Replay Draw',
        zone: 'library',
      } as any,
    ]);

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 3,
      currentRoomId: 'temple_of_dumathoin',
      currentRoomName: 'Temple of Dumathoin',
      currentRoomEffect: 'Draw a card.',
      roomPath: ['cave_entrance', 'goblin_lair', 'dark_pool', 'temple_of_dumathoin'],
      completed: true,
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toBeUndefined();
    expect((((game.state as any).completedDungeons || {})[playerId])).toBe(1);
    expect((((game.state as any).completedDungeonNames || {})[playerId] || [])).toContain('Lost Mine of Phandelver');
    expect((((game.state as any).zones || {})[playerId]?.hand || []).map((card: any) => card.id)).toContain('replay_draw_1');
  });
});