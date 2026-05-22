import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedLinkedExileCommanderSetup(game: any, ownerId: string, sourceControllerId: string) {
  (game.state as any).players = [
    { id: ownerId, name: 'P1', spectator: false, life: 40 },
    { id: sourceControllerId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [ownerId]: 40, [sourceControllerId]: 40 };
  (game.state as any).zones = {
    [ownerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
      commandZone: [],
      commandZoneCount: 0,
    },
    [sourceControllerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
      commandZone: [],
      commandZoneCount: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'commander_perm_1',
      controller: ownerId,
      owner: ownerId,
      tapped: false,
      isCommander: true,
      counters: {},
      card: {
        id: 'commander_card_1',
        name: 'Commander Example',
        type_line: 'Legendary Creature - Human Soldier',
        oracle_text: 'Test commander.',
        mana_cost: '{2}{W}',
        power: '3',
        toughness: '3',
      },
    },
    {
      id: 'oring_perm_1',
      controller: sourceControllerId,
      owner: sourceControllerId,
      tapped: false,
      counters: {},
      card: {
        id: 'oring_card_1',
        name: 'Oblivion Ring',
        type_line: 'Enchantment',
        oracle_text: 'When Oblivion Ring enters the battlefield, exile another target nonland permanent until Oblivion Ring leaves the battlefield.',
        mana_cost: '{2}{W}',
      },
    },
  ];
  (game.state as any).commandZone = {
    [ownerId]: {
      commanderIds: ['commander_card_1'],
      inCommandZone: [],
    },
  };
  (game as any).commandZone = (game.state as any).commandZone;
}

async function resolveCommanderChoice(game: any, gameId: string, playerId: string, selection: 'command' | 'stay') {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const step = queue.steps.find((entry: any) => entry?.type === 'option_choice' && entry?.commanderZoneChoice === true) as any;
  expect(step).toBeDefined();

  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket(playerId, emitted);
  socket.rooms.add(gameId);
  const io = createMockIo(emitted, [socket]);
  registerResolutionHandlers(io as any, socket as any);

  await handlers['submitResolutionResponse']({
    gameId,
    stepId: String(step.id || ''),
    selections: [selection],
    cancelled: false,
  });

  return step;
}

describe('Linked exile commander choice (integration)', () => {
  const gameId = 'test_linked_exile_commander_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('does not register a linked exile return when the targeted commander moves to the command zone instead', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedLinkedExileCommanderSetup(game, 'p1', 'p2');

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'oring_trigger_1',
        type: 'triggered_ability',
        controller: 'p2',
        source: 'oring_perm_1',
        sourceId: 'oring_perm_1',
        sourceName: 'Oblivion Ring',
        description: 'Exile target nonland permanent until Oblivion Ring leaves the battlefield.',
        effect: 'Exile target nonland permanent until Oblivion Ring leaves the battlefield.',
        mandatory: true,
        card: {
          id: 'oring_card_1',
          name: 'Oblivion Ring',
          type_line: 'Enchantment',
          oracle_text: 'When Oblivion Ring enters the battlefield, exile another target nonland permanent until Oblivion Ring leaves the battlefield.',
        },
        targets: ['commander_perm_1'],
      },
    } as any);

    game.resolveTopOfStack();

    const queuedStep = await resolveCommanderChoice(game, gameId, 'p1', 'command');
    expect((queuedStep as any)?.linkedExileData?.exilingPermanentId).toBe('oring_perm_1');
    expect((((game.state as any).zones?.p1?.commandZone || []) as any[]).map((card: any) => String(card?.id || ''))).toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
    expect((((game.state as any).linkedExiles || []) as any[])).toHaveLength(0);

    movePermanentToHand(game as any, 'oring_perm_1');

    expect((((game.state as any).battlefield || []) as any[]).map((permanent: any) => String(permanent?.card?.id || ''))).not.toContain('commander_card_1');
    expect((((game.state as any).linkedExiles || []) as any[])).toHaveLength(0);
  });

  it('registers the linked exile only after the targeted commander stays exiled and returns it when the source leaves', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedLinkedExileCommanderSetup(game, 'p1', 'p2');

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'oring_trigger_1',
        type: 'triggered_ability',
        controller: 'p2',
        source: 'oring_perm_1',
        sourceId: 'oring_perm_1',
        sourceName: 'Oblivion Ring',
        description: 'Exile target nonland permanent until Oblivion Ring leaves the battlefield.',
        effect: 'Exile target nonland permanent until Oblivion Ring leaves the battlefield.',
        mandatory: true,
        card: {
          id: 'oring_card_1',
          name: 'Oblivion Ring',
          type_line: 'Enchantment',
          oracle_text: 'When Oblivion Ring enters the battlefield, exile another target nonland permanent until Oblivion Ring leaves the battlefield.',
        },
        targets: ['commander_perm_1'],
      },
    } as any);

    game.resolveTopOfStack();

    await resolveCommanderChoice(game, gameId, 'p1', 'stay');

    expect((((game.state as any).zones?.p1?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.commandZone || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
    expect((((game.state as any).linkedExiles || []) as any[]).map((entry: any) => String(entry?.exiledCardId || ''))).toContain('commander_card_1');

    movePermanentToHand(game as any, 'oring_perm_1');

    const battlefieldCardIds = (((game.state as any).battlefield || []) as any[]).map((permanent: any) => String(permanent?.card?.id || ''));
    expect(battlefieldCardIds).toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
    expect((((game.state as any).linkedExiles || []) as any[])).toHaveLength(0);
  });

  it('does not return an immediately flickered commander that moves to the command zone instead', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedLinkedExileCommanderSetup(game, 'p1', 'p2');

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'cloudshift_spell_1',
        controller: 'p1',
        source: 'hand',
        card: {
          id: 'cloudshift_card_1',
          name: 'Cloudshift',
          type_line: 'Instant',
          mana_cost: '{W}',
          oracle_text: 'Exile target creature you control, then return that card to the battlefield under your control.',
        },
        targets: ['commander_perm_1'],
      },
    } as any);

    game.resolveTopOfStack();

    const queuedStep = await resolveCommanderChoice(game, gameId, 'p1', 'command');
    expect((queuedStep as any)?.flickerReturnData?.returnAt).toBe('immediate');

    const battlefieldCardIds = (((game.state as any).battlefield || []) as any[]).map((permanent: any) => String(permanent?.card?.id || ''));
    expect(battlefieldCardIds).not.toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.commandZone || []) as any[]).map((card: any) => String(card?.id || ''))).toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
    expect((((game.state as any).pendingFlickerReturns || []) as any[])).toHaveLength(0);
  });

  it('returns an immediately flickered commander after its owner chooses to leave it exiled', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedLinkedExileCommanderSetup(game, 'p1', 'p2');

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'cloudshift_spell_1',
        controller: 'p1',
        source: 'hand',
        card: {
          id: 'cloudshift_card_1',
          name: 'Cloudshift',
          type_line: 'Instant',
          mana_cost: '{W}',
          oracle_text: 'Exile target creature you control, then return that card to the battlefield under your control.',
        },
        targets: ['commander_perm_1'],
      },
    } as any);

    game.resolveTopOfStack();

    const queuedStep = await resolveCommanderChoice(game, gameId, 'p1', 'stay');
    expect((queuedStep as any)?.flickerReturnData?.returnAt).toBe('immediate');

    const commanderPermanents = (((game.state as any).battlefield || []) as any[]).filter((permanent: any) => String(permanent?.card?.id || '') === 'commander_card_1');
    expect(commanderPermanents).toHaveLength(1);
    expect(commanderPermanents[0]?.id).not.toBe('commander_perm_1');
    expect((((game.state as any).zones?.p1?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.commandZone || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
  });

  it('queues the commander exile choice for Dispatch when metalcraft is active', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { p1: 40, p2: 40 };
    (game.state as any).zones = {
      p1: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0, commandZone: [], commandZoneCount: 0,
      },
      p2: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0, commandZone: [], commandZoneCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'commander_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        isCommander: true,
        counters: {},
        card: {
          id: 'commander_card_1',
          name: 'Commander Example',
          type_line: 'Legendary Creature - Human Soldier',
          oracle_text: 'Test commander.',
          mana_cost: '{2}{W}',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'artifact_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        counters: {},
        card: { id: 'artifact_card_1', name: 'Test Relic', type_line: 'Artifact', oracle_text: '' },
      },
      {
        id: 'artifact_2',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        counters: {},
        card: { id: 'artifact_card_2', name: 'Test Relic Two', type_line: 'Artifact', oracle_text: '' },
      },
      {
        id: 'artifact_3',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        counters: {},
        card: { id: 'artifact_card_3', name: 'Test Relic Three', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).commandZone = {
      p1: {
        commanderIds: ['commander_card_1'],
        inCommandZone: [],
      },
    };
    (game as any).commandZone = (game.state as any).commandZone;

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'dispatch_spell_1',
        controller: 'p2',
        source: 'hand',
        card: {
          id: 'dispatch_card_1',
          name: 'Dispatch',
          type_line: 'Instant',
          mana_cost: '{W}',
          oracle_text: 'Tap target creature. Metalcraft — If you control three or more artifacts, exile that creature instead.',
        },
        targets: ['commander_perm_1'],
      },
    } as any);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.type === 'option_choice' && entry?.commanderZoneChoice === true) as any;
    expect(step).toBeDefined();
    expect(String(step?.fromZone || '')).toBe('exile');

    await resolveCommanderChoice(game, gameId, 'p1', 'command');

    expect((((game.state as any).zones?.p1?.commandZone || []) as any[]).map((card: any) => String(card?.id || ''))).toContain('commander_card_1');
    expect((((game.state as any).zones?.p1?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('commander_card_1');
  });
});