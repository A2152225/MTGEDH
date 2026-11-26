import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server, Socket } from 'socket.io';

import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { getHookFailures, resetHookFailures } from '../../shared/src/hookFailureReporter.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { handleEndBecomeAuraEffectRequest } from '../src/socket/becomeAuraEndEffectSocketHandlers.js';
import {
  BECOME_AURA_END_EFFECT_EVENT,
  getBecomeAuraEndEffectActions,
  readNumericManaPool,
} from '../src/state/modules/becomeAuraEndEffectAction.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';

/**
 * Licid "You may pay {U} to end this effect." — live path: the real become_aura executor step builds the
 * Aura, then the `endBecomeAuraEffect` socket event pays the cost as a special action (Gliding Licid
 * ruling 2013-04-15: special action, can't be responded to) and the Licid is a creature again.
 */

const LICID_TEXT =
  '{U}, {T}: Gliding Licid loses this ability and becomes an Aura enchantment with enchant creature. Attach it to target creature. You may pay {U} to end this effect.\nEnchanted creature has flying.';

let GAME_ID = 'unit_become_aura_end_effect';
let counter = 0;
const createdGameIds: string[] = [];

function permanent(id: string, controller: string, name: string, typeLine: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}_card`, name, type_line: typeLine, power: '2', toughness: '2', oracle_text: id === 'licid' ? LICID_TEXT : '' },
  };
}

function setup(priority: string = 'p1', options: { blue?: number; island?: boolean } = {}) {
  GAME_ID = `unit_become_aura_end_effect_${++counter}`;
  createdGameIds.push(GAME_ID);
  createGameIfNotExists(GAME_ID, 'commander', 40);
  const game = ensureGame(GAME_ID)!;
  Object.assign(game.state, {
    players: [
      { id: 'p1', name: 'Alice', spectator: false },
      { id: 'p2', name: 'Bob', spectator: false },
    ],
    turnPlayer: 'p2',
    priority,
    phase: 'combat',
    step: 'DECLARE_ATTACKERS',
    stack: [],
    battlefield: [
      permanent('licid', 'p1', 'Gliding Licid', 'Creature \u2014 Licid'),
      permanent('bear', 'p2', 'Grizzly Bears', 'Creature \u2014 Bear'),
      ...(options.island
        ? [{ id: 'island', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: 'island_card', name: 'Island', type_line: 'Basic Land \u2014 Island', oracle_text: '({T}: Add {U}.)' } }]
        : []),
    ],
    manaPool: { p1: { white: 0, blue: options.blue ?? 1, black: 0, red: 0, green: 0, colorless: 0 } },
  });

  // Activate the Licid through the real rules-engine become_aura step.
  const steps = (parseOracleTextToIR(LICID_TEXT, 'Gliding Licid').abilities || [])
    .filter((ability) => ability.type === 'activated')
    .flatMap((ability) => ability.steps || []);
  const activated = applyOracleIRStepsToGameState(game.state, steps, {
    controllerId: 'p1',
    sourceId: 'licid',
    sourceName: 'Gliding Licid',
    targetPermanentId: 'bear',
    selectorContext: { chosenObjectIds: ['bear'] },
  });
  game.state.battlefield = activated.state.battlefield;
  return game;
}

function connect(playerId: string) {
  const errors: Array<{ code?: string; message?: string }> = [];
  const chats: Array<{ message?: string }> = [];
  const socket = {
    data: { gameId: GAME_ID, playerId },
    rooms: new Set([GAME_ID]),
    emit: (event: string, payload: { code?: string; message?: string }) => {
      if (event === 'error') errors.push(payload);
    },
  };
  const io = {
    to: () => ({ emit: (event: string, payload: { message?: string }) => { if (event === 'chat') chats.push(payload); } }),
    emit: () => {},
    sockets: { sockets: new Map() },
  };
  return { socket, io, errors, chats };
}

function bluePool(game: { state: object }): number {
  const pools = (game.state as { manaPool?: Record<string, Record<string, number>> }).manaPool;
  return Number(pools?.p1?.blue ?? 0);
}

function setBluePool(game: { state: object }, amount: number): void {
  const pools = (game.state as { manaPool?: Record<string, Record<string, number>> }).manaPool;
  if (pools?.p1) pools.p1.blue = amount;
}

// Fields the become-Aura effect and its payment touch. broadcastGame also enriches the live permanents
// from the card DB (colors, mana_cost, timestamps), which is not part of this event.
const EFFECT_FIELDS = ['tapped', 'type_line', 'attachedTo', 'attachments', 'isAura', 'enchantTarget', 'losesThisAbility', 'becameAuraFromTypeLine', 'auraEndEffectCost'] as const;

function effectFields(battlefield: unknown): Array<Record<string, unknown>> {
  const permanents: Array<Record<string, any>> = Array.isArray(battlefield) ? JSON.parse(JSON.stringify(battlefield)) : [];
  return permanents.map((perm) => {
    const projected: Record<string, unknown> = { id: perm.id, cardTypeLine: perm.card?.type_line };
    for (const key of EFFECT_FIELDS) if (key in perm) projected[key] = perm[key];
    return projected;
  });
}

function expectReplayMatchesLive(
  persisted: { type: string; payload?: unknown } | undefined,
  liveBattlefield: unknown,
  livePool: Record<string, number>,
  options: { blue?: number; island?: boolean } = {},
): void {
  expect(persisted).toBeDefined();
  const replayGame = setup('p2', options);
  const replayEvent = { type: persisted!.type, payload: persisted!.payload };
  replayGame.applyEvent!(replayEvent as unknown as Parameters<NonNullable<typeof replayGame.applyEvent>>[0]);
  expect(readNumericManaPool(replayGame.state, 'p1')).toEqual(livePool);
  expect(effectFields(replayGame.state.battlefield)).toEqual(effectFields(liveBattlefield));
  expect(getHookFailures().filter((failure) => /becomeAuraEndEffect/.test(failure.tag))).toEqual([]);
}

function findPermanent(game: { state: object }, id: string): Record<string, any> {
  const raw = (game.state as { battlefield?: unknown }).battlefield;
  const battlefield: Array<Record<string, any>> = Array.isArray(raw) ? raw : [];
  return battlefield.find((perm) => perm?.id === id) ?? {};
}

describe('endBecomeAuraEffect (Licid "pay {U} to end this effect")', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => resetHookFailures());

  afterEach(async () => {
    for (const gameId of createdGameIds.splice(0)) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as Parameters<typeof games.delete>[0]);
      await deleteGame(gameId);
    }
  });

  it('lists a payable action for the controller only, on an opponent\'s turn while holding priority', () => {
    const game = setup();
    expect(findPermanent(game, 'licid')).toMatchObject({ attachedTo: 'bear', isAura: true, auraEndEffectCost: '{U}' });

    const actions = getBecomeAuraEndEffectActions(game.state, 'p1');
    expect(actions).toEqual([
      expect.objectContaining({ permanentId: 'licid', cost: '{U}', attachedTo: 'bear', payable: true }),
    ]);
    expect(getBecomeAuraEndEffectActions(game.state, 'p2')).toEqual([]);
  });

  it('reports why the action is not payable without priority', () => {
    const game = setup('p2');
    const [action] = getBecomeAuraEndEffectActions(game.state, 'p1');
    expect(action).toMatchObject({ payable: false, unpayableReason: 'no_priority' });

    const { socket, io, errors } = connect('p1');
    handleEndBecomeAuraEffectRequest(io as unknown as Server, socket as unknown as Socket, { gameId: GAME_ID, permanentId: 'licid' });
    expect(errors).toEqual([expect.objectContaining({ code: 'NO_PRIORITY' })]);
    expect(findPermanent(game, 'licid')).toMatchObject({ attachedTo: 'bear', isAura: true });
  });

  it('rejects the opponent and keeps the Aura attached', () => {
    const game = setup('p2');
    const { socket, io, errors } = connect('p2');
    handleEndBecomeAuraEffectRequest(io as unknown as Server, socket as unknown as Socket, { gameId: GAME_ID, permanentId: 'licid' });
    expect(errors).toEqual([expect.objectContaining({ code: 'NOT_CONTROLLER' })]);
    expect(findPermanent(game, 'licid')).toMatchObject({ attachedTo: 'bear' });
  });

  it('pays {U}, turns the Licid back into an unattached creature, announces it and replays', () => {
    const game = setup();
    const { socket, io, errors, chats } = connect('p1');
    handleEndBecomeAuraEffectRequest(io as unknown as Server, socket as unknown as Socket, { gameId: GAME_ID, permanentId: 'licid' });

    expect(errors).toEqual([]);
    expect(bluePool(game)).toBe(0);
    const licid = findPermanent(game, 'licid');
    expect(licid.card.type_line).toBe('Creature \u2014 Licid');
    expect(licid.type_line).toBe('Creature \u2014 Licid');
    for (const key of ['attachedTo', 'isAura', 'auraEndEffectCost', 'losesThisAbility', 'becameAuraFromTypeLine']) {
      expect(licid).not.toHaveProperty(key);
    }
    expect(findPermanent(game, 'bear').attachments).not.toContain('licid');
    expect(game.state.stack).toEqual([]);
    expect(chats).toEqual([expect.objectContaining({ message: 'Alice paid {U} to end Gliding Licid\'s Aura effect.' })]);
    expect(getBecomeAuraEndEffectActions(game.state, 'p1')).toEqual([]);

    // Replay the persisted event on a fresh copy of the pre-payment state (pool rebuilt with the same {U}).
    const liveGameId = GAME_ID;
    const [persisted] = getEvents(liveGameId).filter((event) => event.type === BECOME_AURA_END_EFFECT_EVENT);
    expect(persisted?.payload).toMatchObject({ playerId: 'p1', permanentId: 'licid', cost: '{U}', payment: { paidFrom: 'pool' } });
    const liveBattlefield = JSON.parse(JSON.stringify(game.state.battlefield));
    const livePool = readNumericManaPool(game.state, 'p1');
    expectReplayMatchesLive(persisted, liveBattlefield, livePool);
  });

  it('pays from an untapped Island when the pool is empty, and replay taps the same land', () => {
    const game = setup('p1', { blue: 0, island: true });
    const { socket, io, errors } = connect('p1');
    handleEndBecomeAuraEffectRequest(io as unknown as Server, socket as unknown as Socket, { gameId: GAME_ID, permanentId: 'licid' });

    expect(errors).toEqual([]);
    expect(findPermanent(game, 'island').tapped).toBe(true);
    expect(findPermanent(game, 'licid')).not.toHaveProperty('attachedTo');
    const [persisted] = getEvents(GAME_ID).filter((event) => event.type === BECOME_AURA_END_EFFECT_EVENT);
    expect(persisted?.payload).toMatchObject({ payment: { paidFrom: 'sources', tappedPermanentIds: ['island'] } });
    expectReplayMatchesLive(
      persisted,
      JSON.parse(JSON.stringify(game.state.battlefield)),
      readNumericManaPool(game.state, 'p1'),
      { blue: 0, island: true },
    );
  });

  it('refuses when the controller cannot pay', () => {
    const game = setup();
    setBluePool(game, 0);
    const [action] = getBecomeAuraEndEffectActions(game.state, 'p1');
    expect(action).toMatchObject({ payable: false, unpayableReason: 'insufficient_mana' });
    const { socket, io, errors } = connect('p1');
    handleEndBecomeAuraEffectRequest(io as unknown as Server, socket as unknown as Socket, { gameId: GAME_ID, permanentId: 'licid' });
    expect(errors).toEqual([expect.objectContaining({ code: 'INSUFFICIENT_MANA' })]);
    expect(findPermanent(game, 'licid')).toMatchObject({ attachedTo: 'bear', isAura: true });
  });
});
