import { beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[]) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id || socket.data.playerId, socket])) },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId: string,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
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

describe('cost reduction cast integration', () => {
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  it('applies Ruby Medallion to flashback alternate cast from graveyard', async () => {
    const gameId = 'test_cost_reduction_flashback';
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'ruby_medallion_1',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Ruby Medallion',
          type_line: 'Artifact',
          oracle_text: 'Red spells you cast cost {1} less to cast.',
        },
      },
      {
        id: 'target_creature_1',
        controller: 'p2',
        owner: 'p2',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'lightning_bolt_1',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            colors: ['R'],
            oracle_text: 'Lightning Bolt deals 3 damage to any target.\nFlashback {2}{R}',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'lightning_bolt_1',
      abilityId: 'flashback',
      targets: ['target_creature_1'],
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.graveyardSpellCastManaPayment === true,
    );
    expect(paymentStep).toBeUndefined();

    const stack = (game.state as any).stack || [];
    expect(stack.some((entry: any) => String(entry?.card?.name || '') === 'Lightning Bolt')).toBe(true);
    expect(String(stack[0]?.card?.castWithAbility || '')).toBe('flashback');

    const activateEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.manaCost).toBe('{1}{R}');
    await resetGame(gameId);
  });

  it('applies Convergence of Dominion to unearth activation cost', async () => {
    const gameId = 'test_cost_reduction_unearth';
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: ['commander_card_1'] },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'convergence_1',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Convergence of Dominion',
          type_line: 'Artifact',
          oracle_text: 'As long as you control your commander, activated abilities of cards in your graveyard cost {2} less to activate. This effect can\'t reduce the mana in that ability\'s activation cost to less than one mana.',
        },
      },
      {
        id: 'commander_perm_1',
        controller: playerId,
        owner: playerId,
        isCommander: true,
        card: {
          id: 'commander_card_1',
          name: 'Atraxa, Praetors\' Voice',
          type_line: 'Legendary Creature — Phyrexian Angel Horror',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'bloodghast_1',
            name: 'Bloodghast',
            type_line: 'Creature — Vampire Spirit',
            mana_cost: '{B}{B}',
            oracle_text: 'Unearth {1}{B}',
            power: '2',
            toughness: '1',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'bloodghast_1',
      abilityId: 'unearth',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((perm: any) => String(perm?.card?.name || '') === 'Bloodghast')).toBe(true);
    expect((game.state as any).manaPool[playerId].black).toBe(0);
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).length).toBe(0);
    await resetGame(gameId);
  });

  it('queues Hakbal payment extras with Leyline WUBRG and Morophon reductions', async () => {
    const gameId = 'test_cost_reduction_hakbal';
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'leyline_1',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Leyline of Mutation',
          type_line: 'Enchantment',
          oracle_text: 'You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.',
        },
      },
      {
        id: 'morophon_1',
        controller: playerId,
        owner: playerId,
        chosenCreatureType: 'Merfolk',
        card: {
          name: 'Morophon, the Boundless',
          oracle_text: 'Changeling As Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast.',
        },
      },
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'hakbal_1',
            name: 'Hakbal of the Surging Soul',
            mana_cost: '{1}{G}{U}',
            type_line: 'Legendary Creature — Merfolk Scout',
            colors: ['G', 'U'],
            oracle_text: 'Mutate {1}{G}{U}\nAt the beginning of combat on your turn, each Merfolk you control explores.',
            power: '3',
            toughness: '3',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'hakbal_1' });

    const mutateModeStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.mutateCastModeChoice === true,
    ) as any;
    if (mutateModeStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(mutateModeStep.id),
        selections: { optionId: 'cast_normal' },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mutate', manaCost: '{1}' }),
      expect.objectContaining({ id: 'wubrg_external', manaCost: '{0}' }),
    ]));
    expect(String(paymentStep.manaCost || '')).toBe('{1}');
    await resetGame(gameId);
  });
});
