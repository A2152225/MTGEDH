import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('disturb graveyard replay semantics (integration)', () => {
  const gameId = 'test_disturb_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('live disturb removes the card from graveyard and pushes a transformed stack item', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'disturb_card_1',
            name: 'Baithook Angler',
            type_line: 'Creature - Human Peasant',
            oracle_text: 'Disturb {2}{U}',
            power: '2',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const beforeNoncreatureCount = Number((game.state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'disturb_card_1',
      abilityId: 'disturb',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('disturb_card_1');
    expect(stack[0]?.card?.castWithAbility).toBe('disturb');
    expect(Boolean(stack[0]?.card?.transformed)).toBe(true);
    expect(Boolean((game.state as any).castFromGraveyardThisTurn?.[playerId])).toBe(true);
    expect(Boolean((game.state as any).cardLeftGraveyardThisTurn?.[playerId])).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays disturb by rebuilding the transformed stack item and graveyard-cast tracking', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'disturb_card_1',
            name: 'Baithook Angler',
            type_line: 'Creature - Human Peasant',
            oracle_text: 'Disturb {2}{U}',
            power: '2',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'disturb_card_1',
      abilityId: 'disturb',
      stackId: 'stack_disturb_live_1',
      manaCost: '{2}{U}',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(Boolean((game.state as any).castFromGraveyardThisTurn?.[playerId])).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe('stack_disturb_live_1');
    expect(stack[0]?.card?.id).toBe('disturb_card_1');
    expect(stack[0]?.card?.castWithAbility).toBe('disturb');
    expect(Boolean(stack[0]?.card?.transformed)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('live disturb uses the transformed back face for noncreature spell bookkeeping', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'disturb_aura_1',
            name: 'Lantern Bearer',
            type_line: 'Creature - Spirit',
            oracle_text: 'Disturb {3}{U}',
            layout: 'transform',
            card_faces: [
              {
                name: 'Lantern Bearer',
                type_line: 'Creature - Spirit',
                oracle_text: 'Disturb {3}{U}',
                mana_cost: '{U}',
                colors: ['U'],
              },
              {
                name: 'Lanterns\' Lift',
                type_line: 'Enchantment - Aura',
                oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.',
                mana_cost: '{3}{U}',
                colors: ['U'],
              },
            ],
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'creature_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_target_card',
          name: 'Target Creature',
          type_line: 'Creature - Spirit',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const beforeNoncreatureCount = Number((game.state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'disturb_aura_1',
      abilityId: 'disturb',
      targets: ['creature_target_1'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.name).toBe('Lanterns\' Lift');
    expect(stack[0]?.card?.type_line).toBe('Enchantment - Aura');
    expect(stack[0]?.card?.faceIndex).toBe(1);
    expect(stack[0]?.targets).toEqual(['creature_target_1']);
    expect((game.state as any).noncreatureSpellsCastThisTurn?.[playerId]).toBe(beforeNoncreatureCount + 1);
  });

  it('live disturb Aura queues target selection before casting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'disturb_aura_queued_1',
            name: 'Lantern Bearer',
            type_line: 'Creature - Spirit',
            oracle_text: 'Disturb {3}{U}',
            layout: 'transform',
            card_faces: [
              {
                name: 'Lantern Bearer',
                type_line: 'Creature - Spirit',
                oracle_text: 'Disturb {3}{U}',
                mana_cost: '{U}',
                colors: ['U'],
              },
              {
                name: 'Lanterns\' Lift',
                type_line: 'Enchantment - Aura',
                oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.',
                mana_cost: '{3}{U}',
                colors: ['U'],
              },
            ],
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'creature_target_queued_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_target_card_queued',
          name: 'Queued Target Creature',
          type_line: 'Creature - Spirit',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'disturb_aura_queued_1',
      abilityId: 'disturb',
    });

    expect((game.state as any).stack || []).toHaveLength(0);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.sourceName).toBe('Lanterns\' Lift');
    expect(targetStep.targetTypes).toEqual(['aura_target']);
    expect(targetStep.targetDescription).toBe('Enchant creature');
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['creature_target_queued_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['creature_target_queued_1'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.name).toBe('Lanterns\' Lift');
    expect(stack[0]?.card?.type_line).toBe('Enchantment - Aura');
    expect(stack[0]?.targets).toEqual(['creature_target_queued_1']);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays a queued disturb Aura target-selection prompt before the cast is completed', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'disturb_aura_replay_queued_1',
            name: 'Lantern Bearer',
            type_line: 'Creature - Spirit',
            oracle_text: 'Disturb {3}{U}',
            layout: 'transform',
            card_faces: [
              {
                name: 'Lantern Bearer',
                type_line: 'Creature - Spirit',
                oracle_text: 'Disturb {3}{U}',
                mana_cost: '{U}',
                colors: ['U'],
              },
              {
                name: 'Lanterns\' Lift',
                type_line: 'Enchantment - Aura',
                oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.',
                mana_cost: '{3}{U}',
                colors: ['U'],
              },
            ],
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'creature_target_replay_queued_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_target_card_replay_queued',
          name: 'Replay Target Creature',
          type_line: 'Creature - Spirit',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'disturb_aura_replay_queued_1',
      abilityId: 'disturb',
      queuedResolutionStep: {
        id: 'queued_disturb_aura_target_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'disturb_aura_replay_queued_1',
        sourceName: 'Lanterns\' Lift',
        description: 'Choose Enchant creature for Lanterns\' Lift',
        mandatory: true,
        validTargets: [
          {
            id: 'creature_target_replay_queued_1',
            label: 'Replay Target Creature',
            description: 'Creature - Spirit',
            type: 'permanent',
            controller: playerId,
            typeLine: 'Creature - Spirit',
          },
        ],
        targetTypes: ['aura_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'Enchant creature',
        graveyardSpellCastTargetSelection: true,
        cardId: 'disturb_aura_replay_queued_1',
        abilityId: 'disturb',
        cardName: 'Lanterns\' Lift',
        manaCost: '{3}{U}',
      },
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['disturb_aura_replay_queued_1']);
    expect((zones?.exile || []).map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).stack || []).toHaveLength(0);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect(String(targetStep.id || '')).toBe('queued_disturb_aura_target_1');
    expect(targetStep.sourceName).toBe('Lanterns\' Lift');
    expect(targetStep.targetTypes).toEqual(['aura_target']);
    expect(targetStep.targetDescription).toBe('Enchant creature');
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['creature_target_replay_queued_1']);
  });

  it('replay disturb uses the transformed back face for noncreature spell bookkeeping', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'disturb_aura_1',
            name: 'Lantern Bearer',
            type_line: 'Creature - Spirit',
            oracle_text: 'Disturb {3}{U}',
            layout: 'transform',
            card_faces: [
              {
                name: 'Lantern Bearer',
                type_line: 'Creature - Spirit',
                oracle_text: 'Disturb {3}{U}',
                mana_cost: '{U}',
                colors: ['U'],
              },
              {
                name: 'Lanterns\' Lift',
                type_line: 'Enchantment - Aura',
                oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.',
                mana_cost: '{3}{U}',
                colors: ['U'],
              },
            ],
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'creature_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_target_card',
          name: 'Target Creature',
          type_line: 'Creature - Spirit',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).stack = [];
    const beforeNoncreatureCount = Number((game.state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'disturb_aura_1',
      abilityId: 'disturb',
      stackId: 'stack_disturb_aura_1',
      manaCost: '{3}{U}',
      targets: ['creature_target_1'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.name).toBe('Lanterns\' Lift');
    expect(stack[0]?.card?.type_line).toBe('Enchantment - Aura');
    expect(stack[0]?.card?.faceIndex).toBe(1);
    expect(stack[0]?.targets).toEqual(['creature_target_1']);
    expect((game.state as any).noncreatureSpellsCastThisTurn?.[playerId]).toBe(beforeNoncreatureCount + 1);
  });
});