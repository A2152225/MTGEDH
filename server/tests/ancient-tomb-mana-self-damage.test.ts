import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { getManaAbilityLifeEffect } from '../src/socket/interaction-handlers/interactionActivateBattlefieldAbilityHelpers.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { inferLegacyManaLifeEffect } from '../src/state/modules/applyEventReplayZoneCommanderManaHelpers.js';
import { resolveManaAbilityLifeEffect } from '../src/state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const ANCIENT_TOMB_ORACLE = '{T}: Add {C}{C}. This land deals 2 damage to you.';
const TALISMAN_ORACLE = '{T}: Add {C}.\n{T}: Add {U} or {R}. This artifact deals 1 damage to you.';
const CONFLUENCE_ORACLE = '{T}: Add one mana of any color. Whenever Mana Confluence is tapped for mana, it deals 1 damage to you.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
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

describe('Ancient Tomb mana self-damage', () => {
  const activateGameId = 'test_ancient_tomb_activate_damage';
  const paymentGameId = 'test_ancient_tomb_payment_damage';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(activateGameId);
    await resetGame(paymentGameId);
  });

  afterEach(async () => {
    await resetGame(activateGameId);
    await resetGame(paymentGameId);
  });

  it('infers 2 damage from the {C}{C} ability even when the mana is colorless', () => {
    const card = { name: 'Ancient Tomb', oracle_text: ANCIENT_TOMB_ORACLE };
    expect(getManaAbilityLifeEffect(card, false)).toEqual({ amount: 2, isDamage: true });
    expect(resolveManaAbilityLifeEffect({ card, producesColoredMana: false })).toEqual({ amount: 2, isDamage: true });
    expect(inferLegacyManaLifeEffect({ card }, 'C')).toEqual({ amount: 2, isDamage: true });
  });

  it('does not treat the colorless Talisman tap as the pain ability', () => {
    const card = { name: 'Talisman of Creativity', oracle_text: TALISMAN_ORACLE };
    expect(getManaAbilityLifeEffect(card, false)).toEqual({ amount: 0, isDamage: false });
    expect(getManaAbilityLifeEffect(card, true)).toEqual({ amount: 1, isDamage: true });
    expect(resolveManaAbilityLifeEffect({
      card,
      abilityText: '{T}: Add {C}.',
      producesColoredMana: false,
    })).toEqual({ amount: 0, isDamage: false });
  });

  it('does not treat Mana Confluence whenever-damage as part of the colorless Ancient Tomb path', () => {
    const tomb = { name: 'Ancient Tomb', oracle_text: ANCIENT_TOMB_ORACLE };
    expect(getManaAbilityLifeEffect(tomb, false)).toEqual({ amount: 2, isDamage: true });
    const confluence = { name: 'Mana Confluence', oracle_text: CONFLUENCE_ORACLE };
    expect(getManaAbilityLifeEffect(confluence, true)).toEqual({ amount: 1, isDamage: true });
  });

  it('deals 2 when Ancient Tomb is tapped via its printed ability', async () => {
    createGameIfNotExists(activateGameId, 'commander', 40);
    const game = ensureGame(activateGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'tomb_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'tomb_card_1',
          name: 'Ancient Tomb',
          type_line: 'Land',
          oracle_text: ANCIENT_TOMB_ORACLE,
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(activateGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: activateGameId,
      permanentId: 'tomb_1',
      abilityId: 'tomb_card_1-ability-0',
    });

    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(2);
    expect((game.state as any).life?.[playerId]).toBe(38);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(2);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(2);
  });

  it('deals 2 when Ancient Tomb is tapped as spell payment', async () => {
    createGameIfNotExists(paymentGameId, 'commander', 40, undefined, 'p1');
    const game = ensureGame(paymentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'tomb_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'tomb_card_1',
          name: 'Ancient Tomb',
          type_line: 'Land',
          oracle_text: ANCIENT_TOMB_ORACLE,
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'sol_ring_1',
            name: 'Sol Ring',
            mana_cost: '{1}',
            manaCost: '{1}',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = paymentGameId;
    socket.rooms.add(paymentGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: paymentGameId,
      cardId: 'sol_ring_1',
      payment: [{
        permanentId: 'tomb_1',
        paymentSourceId: 'tomb_1::tomb_card_1-ability-0',
        abilityId: 'tomb_card_1-ability-0',
        mana: 'C',
        producedColors: ['C', 'C'],
        count: 2,
      }],
      skipInteractivePrompts: true,
    });

    expect((game.state as any).life?.[playerId]).toBe(38);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(2);
    const tomb = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'tomb_1');
    expect(tomb?.tapped).toBe(true);
  });
});
