import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { nextStep } from '../src/state/modules/turn.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const WELL_TEXT = 'Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.';
const GHOST_TEXT = 'Flying\nWhenever you gain life, you may pay that much life. If you do, draw that many cards.\n{T}: Each opponent loses 1 life and you gain 1 life.';
const CRADLE_TEXT = 'Whenever you gain life, you may pay {1}. If you do, put a +1/+1 counter on target creature for each 1 life you gained.';
const WALL_TEXT = 'Defender, flying\nAt the beginning of your end step, you may gain life equal to the power of target creature you control.';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, playerId, gameId },
    rooms: new Set<string>([gameId]),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

function libraryCards(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${index + 1}`,
    name: `Card ${index + 1}`,
    type_line: 'Instant',
    zone: 'library',
  }));
}

function installLibrary(game: any, playerId: string, cards: any[]) {
  const player = (game.state.players || []).find((entry: any) => entry.id === playerId);
  if (player) player.library = cards.map((card) => ({ ...card }));
  const zones = (game.state as any).zones[playerId];
  zones.library = cards.map((card) => ({ ...card }));
  zones.libraryCount = cards.length;
  zones.hand = [];
  zones.handCount = 0;
  game.libraries = game.libraries || new Map();
  game.libraries.set(playerId, cards.map((card) => ({ ...card })));
}

function handCount(game: any, playerId: string): number {
  const zoneHand = (game.state as any).zones?.[playerId]?.hand;
  if (Array.isArray(zoneHand)) return zoneHand.length;
  const player = (game.state.players || []).find((entry: any) => entry.id === playerId);
  return Array.isArray(player?.hand) ? player.hand.length : 0;
}

function lifeOf(game: any, playerId: string): number {
  const mapped = Number((game.state as any).life?.[playerId]);
  if (Number.isFinite(mapped)) return mapped;
  const player = (game.state.players || []).find((entry: any) => entry.id === playerId);
  return Number(player?.life);
}

async function answerStep(
  handlers: Record<string, Function>,
  gameId: string,
  playerId: string,
  selections: unknown,
  cancelled = false,
) {
  const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)[0] as any;
  expect(step, `expected a pending step for ${playerId}`).toBeTruthy();
  await handlers.submitResolutionResponse({
    gameId,
    stepId: step.id,
    selections,
    cancelled,
  });
  return step;
}

describe('optional lifegain payments (Well, Ghost Counsel, Cradle, Wall)', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    if (previousSpellPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
  });

  async function boot(gameId: string, players: Array<{ id: string; life?: number }>) {
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40, undefined, players[0].id);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    (game.state as any).players = players.map((player) => ({
      id: player.id,
      name: player.id,
      spectator: false,
      life: player.life ?? 40,
      library: [],
      hand: [],
    }));
    (game.state as any).life = Object.fromEntries(players.map((player) => [player.id, player.life ?? 40]));
    (game.state as any).zones = {};
    for (const player of players) {
      (game.state as any).zones[player.id] = {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      };
    }
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).turnPlayer = players[0].id;
    (game.state as any).priority = players[0].id;
    (game.state as any).activePlayer = players[0].id;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).manaPool = {
      [players[0].id]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 5 },
    };
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(players[0].id, gameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io, socket);
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);
    return { game, handlers, p1: players[0].id };
  }

  it('Well of Lost Dreams lets the player pay X at most the life gained and draw X', async () => {
    const gameId = 'test_well_pay_x';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    installLibrary(game, p1, libraryCards('well', 5));
    (game.state as any).battlefield = [{
      id: 'well_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'well_card',
        name: 'Well of Lost Dreams',
        type_line: 'Artifact',
        oracle_text: WELL_TEXT,
      },
    }];

    await handlers.adjustLife({ gameId, delta: 3, targetPlayerId: p1 });
    const trigger = ((game.state as any).stack || []).find((item: any) => item.sourceName === 'Well of Lost Dreams');
    expect(trigger?.effect).toMatch(/if you do, draw x cards/i);
    expect(trigger?.effectData?.lifeGained).toBe(3);

    game.resolveTopOfStack();
    const xStep = await answerStep(handlers, gameId, p1, { xValue: 4 });
    expect(xStep.type).toBe(ResolutionStepType.X_VALUE_SELECTION);
    expect(Number(xStep.maxX)).toBe(3);

    expect(handCount(game, p1)).toBe(3);
    expect((game.state as any).manaPool[p1].colorless).toBe(2);
    expect(((game.state as any).stack || []).some((item: any) => item.sourceName === 'Well of Lost Dreams')).toBe(false);
    await resetGame(gameId);
  });

  it('Well of Lost Dreams draws nothing when the payment is declined', async () => {
    const gameId = 'test_well_decline';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    installLibrary(game, p1, libraryCards('welld', 5));
    (game.state as any).battlefield = [{
      id: 'well_1',
      controller: p1,
      owner: p1,
      card: { id: 'well_card', name: 'Well of Lost Dreams', type_line: 'Artifact', oracle_text: WELL_TEXT },
    }];

    await handlers.adjustLife({ gameId, delta: 3, targetPlayerId: p1 });
    game.resolveTopOfStack();
    const step = ResolutionQueueManager.getStepsForPlayer(gameId, p1 as any)[0];
    expect(step?.type).toBe(ResolutionStepType.X_VALUE_SELECTION);
    await handlers.cancelResolutionStep({ gameId, stepId: step!.id });

    expect(handCount(game, p1)).toBe(0);
    expect((game.state as any).manaPool[p1].colorless).toBe(5);
    await resetGame(gameId);
  });

  it('Niv-Mizzet, Ghost Counsel pays the life gained and draws that many', async () => {
    const gameId = 'test_ghost_pay_life';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }, { id: 'p2', life: 40 }]);
    installLibrary(game, p1, libraryCards('ghost', 4));
    (game.state as any).battlefield = [{
      id: 'ghost_1',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      card: {
        id: 'ghost_card',
        name: 'Niv-Mizzet, Ghost Counsel',
        type_line: 'Legendary Creature — Dragon Avatar',
        oracle_text: GHOST_TEXT,
        power: '2',
        toughness: '2',
      },
    }];

    await handlers.adjustLife({ gameId, delta: 2, targetPlayerId: p1 });
    expect(lifeOf(game, p1)).toBe(42);
    game.resolveTopOfStack();
    const may = await answerStep(handlers, gameId, p1, ['yes']);
    expect(may.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(String(may.description || '')).toMatch(/pay that much life/i);

    expect(lifeOf(game, p1)).toBe(40);
    expect(handCount(game, p1)).toBe(2);
    await resetGame(gameId);
  });

  it('Niv-Mizzet, Ghost Counsel draws nothing when the life payment is declined', async () => {
    const gameId = 'test_ghost_decline';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    installLibrary(game, p1, libraryCards('ghostd', 4));
    (game.state as any).battlefield = [{
      id: 'ghost_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'ghost_card',
        name: 'Niv-Mizzet, Ghost Counsel',
        type_line: 'Legendary Creature — Dragon Avatar',
        oracle_text: GHOST_TEXT,
      },
    }];

    await handlers.adjustLife({ gameId, delta: 2, targetPlayerId: p1 });
    game.resolveTopOfStack();
    await answerStep(handlers, gameId, p1, ['no']);
    expect(lifeOf(game, p1)).toBe(42);
    expect(handCount(game, p1)).toBe(0);
    await resetGame(gameId);
  });

  it('Ghost Counsel tap drains an opponent, gains 1, and retriggers lifegain', async () => {
    const gameId = 'test_ghost_tap';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }, { id: 'p2', life: 40 }]);
    (game.state as any).battlefield = [{
      id: 'ghost_1',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      card: {
        id: 'ghost_card',
        name: 'Niv-Mizzet, Ghost Counsel',
        type_line: 'Legendary Creature — Dragon Avatar',
        oracle_text: GHOST_TEXT,
        power: '2',
        toughness: '2',
      },
    }];

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'ghost_1',
      abilityId: 'ghost_card-ability-0',
    });
    const activated = ((game.state as any).stack || []).find((item: any) => item.type === 'activated_ability' || item.source === 'ghost_1');
    expect(activated).toBeTruthy();
    game.resolveTopOfStack();

    expect(lifeOf(game, 'p2')).toBe(39);
    expect(lifeOf(game, p1)).toBe(41);
    const retrigger = ((game.state as any).stack || []).find((item: any) => item.sourceName === 'Niv-Mizzet, Ghost Counsel' && item.triggerType === 'lifegain');
    expect(retrigger?.effectData?.lifeGained).toBe(1);
    await resetGame(gameId);
  });

  it('Cradle of Vitality pays {1} and puts counters equal to that life-gain event', async () => {
    const gameId = 'test_cradle_pay';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    (game.state as any).lifeGainedThisTurn = { [p1]: 5 };
    (game.state as any).battlefield = [
      {
        id: 'cradle_1',
        controller: p1,
        owner: p1,
        card: { id: 'cradle_card', name: 'Cradle of Vitality', type_line: 'Enchantment', oracle_text: CRADLE_TEXT },
      },
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        power: 2,
        toughness: 2,
        counters: {},
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ];

    await handlers.adjustLife({ gameId, delta: 2, targetPlayerId: p1 });
    game.resolveTopOfStack();
    const targetStep = await answerStep(handlers, gameId, p1, ['bear_1']);
    expect(targetStep.type).toBe(ResolutionStepType.TARGET_SELECTION);
    const payStep = await answerStep(handlers, gameId, p1, ['yes']);
    expect(payStep.type).toBe(ResolutionStepType.OPTION_CHOICE);

    const bear = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bear_1');
    expect(bear?.counters?.['+1/+1']).toBe(2);
    expect((game.state as any).manaPool[p1].colorless).toBe(4);
    await resetGame(gameId);
  });

  it('Cradle of Vitality puts no counters when the player declines {1}', async () => {
    const gameId = 'test_cradle_decline';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    (game.state as any).battlefield = [
      {
        id: 'cradle_1',
        controller: p1,
        owner: p1,
        card: { id: 'cradle_card', name: 'Cradle of Vitality', type_line: 'Enchantment', oracle_text: CRADLE_TEXT },
      },
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ];

    await handlers.adjustLife({ gameId, delta: 2, targetPlayerId: p1 });
    game.resolveTopOfStack();
    await answerStep(handlers, gameId, p1, ['bear_1']);
    await answerStep(handlers, gameId, p1, ['no']);
    const bear = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bear_1');
    expect(Number(bear?.counters?.['+1/+1'] || 0)).toBe(0);
    expect((game.state as any).manaPool[p1].colorless).toBe(5);
    await resetGame(gameId);
  });

  it('Wall of Reverence end-step life gain offers Cradle of Vitality', async () => {
    const gameId = 'test_wall_cradle';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    (game.state as any).battlefield = [
      {
        id: 'wall_1',
        controller: p1,
        owner: p1,
        power: 1,
        toughness: 4,
        card: {
          id: 'wall_card',
          name: 'Wall of Reverence',
          type_line: 'Creature — Wall',
          oracle_text: WALL_TEXT,
          power: '1',
          toughness: '4',
        },
      },
      {
        id: 'cradle_1',
        controller: p1,
        owner: p1,
        card: { id: 'cradle_card', name: 'Cradle of Vitality', type_line: 'Enchantment', oracle_text: CRADLE_TEXT },
      },
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        power: 4,
        toughness: 4,
        basePower: 4,
        counters: {},
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '4', toughness: '4' },
      },
    ];
    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    nextStep(game as any);
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 5 },
    };

    const wallTrigger = ((game.state as any).stack || []).find((item: any) => item.sourceName === 'Wall of Reverence');
    expect(wallTrigger).toBeTruthy();
    expect(wallTrigger.requiresTarget).toBe(true);
    game.resolveTopOfStack();
    const targetStep = await answerStep(handlers, gameId, p1, ['bear_1']);
    expect(targetStep.type).toBe(ResolutionStepType.TARGET_SELECTION);
    const mayStep = await answerStep(handlers, gameId, p1, ['yes']);
    expect(mayStep.type).toBe(ResolutionStepType.OPTION_CHOICE);

    expect(lifeOf(game, p1)).toBe(44);
    const cradle = ((game.state as any).stack || []).find((item: any) => item.sourceName === 'Cradle of Vitality');
    expect(cradle?.triggerType).toBe('lifegain');
    expect(cradle?.effectData?.lifeGained).toBe(4);

    game.resolveTopOfStack();
    await answerStep(handlers, gameId, p1, ['bear_1']);
    await answerStep(handlers, gameId, p1, ['yes']);
    const bear = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bear_1');
    expect(bear?.counters?.['+1/+1']).toBe(4);
    await resetGame(gameId);
  });

  it('Wall of Reverence gains no life when the end-step ability is declined', async () => {
    const gameId = 'test_wall_decline';
    const { game, handlers, p1 } = await boot(gameId, [{ id: 'p1' }]);
    (game.state as any).battlefield = [
      {
        id: 'wall_1',
        controller: p1,
        owner: p1,
        power: 1,
        toughness: 4,
        card: { id: 'wall_card', name: 'Wall of Reverence', type_line: 'Creature — Wall', oracle_text: WALL_TEXT, power: '1', toughness: '4' },
      },
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        power: 4,
        toughness: 4,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '4', toughness: '4' },
      },
    ];
    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    nextStep(game as any);
    game.resolveTopOfStack();
    await answerStep(handlers, gameId, p1, ['bear_1']);
    await answerStep(handlers, gameId, p1, ['no']);
    expect(lifeOf(game, p1)).toBe(40);
    expect(((game.state as any).stack || []).length).toBe(0);
    await resetGame(gameId);
  });
});
