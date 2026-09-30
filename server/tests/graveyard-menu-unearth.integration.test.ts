import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';

/**
 * Server side of the table graveyard right-click menu: Unearth (and the negative paths) through the
 * `activateGraveyardAbility` socket event the client now emits for menu clicks.
 */
const gameId = 'test_graveyard_menu_unearth';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

async function seedUnearthGame(manaPool: Record<string, number>) {
  await resetIntegrationGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const p1 = 'p1';
  const state = game.state as any;
  state.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  state.life = { [p1]: 40 };
  state.turnPlayer = p1;
  state.activePlayer = p1;
  state.priority = p1;
  state.phase = 'main';
  state.step = 'MAIN1';
  state.stack = [];
  state.battlefield = [];
  state.zones = {
    [p1]: {
      hand: [], handCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0,
      graveyard: [{
        id: 'unearth_card_1',
        name: 'Dregscape Zombie',
        type_line: 'Creature — Zombie',
        mana_cost: '{1}{B}',
        power: '2',
        toughness: '1',
        oracle_text: 'Unearth {B} ({B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
        zone: 'graveyard',
      }],
      graveyardCount: 1,
    },
  };
  state.manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...manaPool } };
  return { game, playerId: p1 };
}

describe('graveyard menu: Unearth via activateGraveyardAbility', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { await resetIntegrationGame(gameId); });
  afterEach(async () => { await resetIntegrationGame(gameId); });

  it('pays the unearth cost, returns the creature to the battlefield and schedules its exile', async () => {
    const { game, playerId } = await seedUnearthGame({ black: 1 });
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    registerInteractionHandlers(createMockIo(emitted) as any, socket as any);
    registerResolutionHandlers(createMockIo(emitted) as any, socket as any);

    await handlers['activateGraveyardAbility']({ gameId, cardId: 'unearth_card_1', abilityId: 'unearth' });

    const state = game.state as any;
    expect(state.zones[playerId].graveyard).toHaveLength(0);
    expect(state.battlefield).toHaveLength(1);
    expect(state.battlefield[0].card.name).toBe('Dregscape Zombie');
    expect(state.battlefield[0].unearthed).toBe(true);
    // Entry path stamps a real CR 613.7 timestamp immediately (not lazily on the next derived-effect sync).
    expect(Number(state.battlefield[0].timestamp)).toBeGreaterThan(1000);
    expect(state.manaPool[playerId].black).toBe(0);
    expect(state.pendingExileAtNextEndStep).toEqual([
      expect.objectContaining({ permanentId: state.battlefield[0].id, sourceName: 'Dregscape Zombie' }),
    ]);
    const persisted = [...getEvents(gameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(persisted?.payload?.abilityId).toBe('unearth');
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('refuses to unearth when the cost cannot be paid and leaves the card in the graveyard', async () => {
    const { game, playerId } = await seedUnearthGame({});
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    registerInteractionHandlers(createMockIo(emitted) as any, socket as any);
    registerResolutionHandlers(createMockIo(emitted) as any, socket as any);

    await handlers['activateGraveyardAbility']({ gameId, cardId: 'unearth_card_1', abilityId: 'unearth' });

    const state = game.state as any;
    expect(state.zones[playerId].graveyard).toHaveLength(1);
    expect(state.battlefield).toHaveLength(0);
    expect(emitted.some((entry) => entry.event === 'error' && entry.payload?.code === 'INSUFFICIENT_MANA')).toBe(true);
  });
});