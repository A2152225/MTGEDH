import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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

  it('replays Trap target-player resolution by clearing the queued player prompt and applying life loss', () => {
    const gameId = 't_venture_trap_target_player_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetPlayerId = 'p2' as PlayerID;

    addPlayer(game, playerId, 'P1');
    addPlayer(game, targetPlayerId, 'P2');

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 2,
      currentRoomId: 'trap',
      currentRoomName: 'Trap!',
      currentRoomEffect: 'Target player loses 5 life.',
      roomPath: ['secret_entrance', 'forge', 'trap'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_trap_prompt',
      queuedResolutionStep: {
        id: 'queued_trap_prompt_1',
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId,
        sourceId: 'venture_trap_prompt',
        sourceName: 'Trap!',
        description: 'Undercity: Trap! - Choose target player',
        mandatory: true,
        players: [playerId, targetPlayerId],
        dungeonTargetPlayerEffect: {
          dungeonId: 'undercity',
          roomId: 'trap',
          amount: 5,
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetPlayerResolve',
      playerId,
      selectedPlayerId: targetPlayerId,
      resolvedStepId: 'queued_trap_prompt_1',
      sourceId: 'venture_trap_prompt',
      sourceName: 'Trap!',
      dungeonId: 'undercity',
      currentRoomId: 'trap',
      amount: 5,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((((game.state as any).life || {})[targetPlayerId] ?? (game.state as any).players?.find((p: any) => p.id === targetPlayerId)?.life)).toBe(35);
  });

  it('replays Forge target-creature resolution by clearing the queued target prompt and applying counters', () => {
    const gameId = 't_venture_forge_target_creature_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetCreatureId = 'forge_target_replay_1';

    addPlayer(game, playerId, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'forge_target_replay_card_1',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 1,
      currentRoomId: 'forge',
      currentRoomName: 'Forge',
      currentRoomEffect: 'Put two +1/+1 counters on target creature.',
      roomPath: ['secret_entrance', 'forge'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_forge_prompt',
      queuedResolutionStep: {
        id: 'queued_forge_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_forge_prompt',
        sourceName: 'Forge',
        description: 'Undercity: Forge - Choose target creature',
        mandatory: true,
        validTargets: [
          {
            id: targetCreatureId,
            label: 'Grizzly Bears',
            description: 'Creature — Bear controlled by P2',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: 'undercity',
          roomId: 'forge',
          amount: 2,
          counterType: '+1/+1',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetCreatureResolve',
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: 'queued_forge_prompt_1',
      sourceId: 'venture_forge_prompt',
      sourceName: 'Forge',
      dungeonId: 'undercity',
      currentRoomId: 'forge',
      amount: 2,
      counterType: '+1/+1',
      goadedByPlayerId: playerId,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(targetCreature?.counters?.['+1/+1']).toBe(2);
  });

  it('replays Arena target-creature resolution by clearing the queued target prompt and applying goad', () => {
    const gameId = 't_venture_arena_target_creature_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetCreatureId = 'arena_target_replay_1';

    addPlayer(game, playerId, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');
    (game.state as any).turnNumber = 7;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'arena_target_replay_card_1',
          name: 'Hill Giant',
          type_line: 'Creature — Giant',
          power: '3',
          toughness: '3',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 2,
      currentRoomId: 'arena',
      currentRoomName: 'Arena',
      currentRoomEffect: 'Goad target creature.',
      roomPath: ['secret_entrance', 'forge', 'arena'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_arena_prompt',
      queuedResolutionStep: {
        id: 'queued_arena_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_arena_prompt',
        sourceName: 'Arena',
        description: 'Undercity: Arena - Choose target creature',
        mandatory: true,
        validTargets: [
          {
            id: targetCreatureId,
            label: 'Hill Giant',
            description: 'Creature — Giant controlled by P2',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: 'undercity',
          roomId: 'arena',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetCreatureResolve',
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: 'queued_arena_prompt_1',
      sourceId: 'venture_arena_prompt',
      sourceName: 'Arena',
      dungeonId: 'undercity',
      currentRoomId: 'arena',
      goadedByPlayerId: playerId,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(Array.isArray(targetCreature?.goadedBy) ? targetCreature.goadedBy : []).toContain(playerId);
    expect((targetCreature?.goadedUntil || {})[playerId]).toBe(8);
  });
});