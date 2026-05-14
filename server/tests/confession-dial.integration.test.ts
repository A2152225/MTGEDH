import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { clearTemporaryGraveyardKeywordGrants } from '../src/state/modules/graveyard-permissions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

async function seedConfessionDialGame(gameId: string) {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).step = 'MAIN1';
  (game.state as any).phase = 'precombatMain';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 2 },
  };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        {
          id: 'legendary_target_1',
          name: 'Legendary Returnee',
          type_line: 'Legendary Creature — Human Rogue',
          mana_cost: '{2}{B}',
          manaCost: '{2}{B}',
          oracle_text: '',
          zone: 'graveyard',
        },
        {
          id: 'plain_creature_1',
          name: 'Plain Creature',
          type_line: 'Creature — Human Rogue',
          mana_cost: '{1}{B}',
          manaCost: '{1}{B}',
          oracle_text: '',
          zone: 'graveyard',
        },
        { id: 'filler_1', name: 'Filler One', type_line: 'Instant', oracle_text: '', zone: 'graveyard' },
        { id: 'filler_2', name: 'Filler Two', type_line: 'Sorcery', oracle_text: '', zone: 'graveyard' },
        { id: 'filler_3', name: 'Filler Three', type_line: 'Artifact', oracle_text: '', zone: 'graveyard' },
      ],
      graveyardCount: 5,
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'dial_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'dial_card_1',
        name: 'Confession Dial',
        type_line: 'Artifact',
        oracle_text: 'When this artifact enters, surveil 3.\n{T}: Target legendary creature card in your graveyard gains escape until end of turn. The escape cost is equal to its mana cost plus exile three other cards from your graveyard.',
      },
    },
  ];

  return { game, playerId };
}

describe('Confession Dial', () => {
  const baseGameId = 'test_confession_dial';
  const trackedGameIds = [
    `${baseGameId}_grant`,
    `${baseGameId}_escape`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
  });

  it('grants escape only to the targeted legendary creature card and clears at cleanup', async () => {
    const gameId = `${baseGameId}_grant`;
    const { game, playerId } = await seedConfessionDialGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'dial_1', abilityId: 'dial_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id || ''))).toEqual(['legendary_target_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['legendary_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('target legendary creature card in your graveyard gains escape until end of turn');

    game.resolveTopOfStack();

    const candidates = getCastableSpellCandidates({ state: (game.state as any) } as any, playerId as any, { mode: 'main' });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'legendary_target_1' }),
        castMethod: 'escape',
        manaCost: '{2}{B}',
      }),
    ]));
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'plain_creature_1')).toBe(false);

    expect(clearTemporaryGraveyardKeywordGrants((game.state as any))).toBe(1);
    expect(
      getCastableSpellCandidates({ state: (game.state as any) } as any, playerId as any, { mode: 'main' })
        .some((candidate: any) => candidate?.card?.id === 'legendary_target_1')
    ).toBe(false);
  });

  it('casts the targeted legend with escape by exiling three other cards from your graveyard', async () => {
    const gameId = `${baseGameId}_escape`;
    const { game, playerId } = await seedConfessionDialGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'dial_1', abilityId: 'dial_1-ability-0' });

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0] as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['legendary_target_1'],
      cancelled: false,
    });

    game.resolveTopOfStack();

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'legendary_target_1',
      abilityId: 'escape',
    });

    const exileStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => step.type === ResolutionStepType.GRAVEYARD_SELECTION && (step as any).graveyardCastExileAsCost === true) as any;
    expect(exileStep).toBeDefined();
    expect((exileStep.validTargets || []).map((target: any) => target.id).sort()).toEqual([
      'filler_1',
      'filler_2',
      'filler_3',
      'plain_creature_1',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(exileStep.id),
      selections: ['plain_creature_1', 'filler_1', 'filler_2'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('legendary_target_1');
    expect(stack[0]?.card?.castWithAbility).toBe('escape');

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id).sort()).toEqual(['filler_1', 'filler_2', 'plain_creature_1']);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['filler_3']);
    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
  });
});
