import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities.js';

const SHREDDER = "Equipped creature gets +2/+1.\nWhen this Equipment enters, attach it to target creature you control.\nEquip—Sacrifice another nonland permanent. Activate only once each turn.";
const LEATHER = "Equipped creature gets +0/+1.\nEquip {0}. Activate only once each turn.";
const PLAIN_EQUIP = "Equipped creature gets +1/+1.\nEquip {0}.";

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Equip activate-only-once-each-turn gate', () => {
  const gameId = 'test_equip_activate_once_each_turn';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('parses the rider on the matching equip ability only', () => {
    const shredder = parseEquipAbilitiesFromOracle(SHREDDER);
    expect(shredder).toHaveLength(1);
    expect(shredder[0].onceEachTurn).toBe(true);
    const leather = parseEquipAbilitiesFromOracle(LEATHER);
    expect(leather[0].cost.replace(/\s+/g, '')).toBe('{0}');
    expect(leather[0].onceEachTurn).toBe(true);
    const mixed = parseEquipAbilitiesFromOracle('Equip {3}. Equip—Sacrifice a creature. Activate only once each turn.');
    const mana = mixed.find((ability) => /\{3\}/.test(ability.cost));
    const sac = mixed.find((ability) => /sacrifice/i.test(ability.cost));
    expect(mana?.onceEachTurn).toBeFalsy();
    expect(sac?.onceEachTurn).toBe(true);
    const plain = parseEquipAbilitiesFromOracle(PLAIN_EQUIP);
    expect(plain[0].onceEachTurn).toBeFalsy();
  });

  it("blocks a second Shredder's Armor equip activation the same turn after the first is paid", async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).phase = 'precombatMain';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      { id: 'armor_1', controller: p1, owner: p1, card: { name: "Shredder's Armor", type_line: 'Artifact — Equipment', oracle_text: SHREDDER } },
      { id: 'bear_1', controller: p1, owner: p1, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' } },
      { id: 'bear_2', controller: p1, owner: p1, card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '' } },
      { id: 'sol_1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' } },
      { id: 'sol_2', controller: p1, owner: p1, card: { name: 'Mind Stone', type_line: 'Artifact', oracle_text: '{T}: Add {C}.' } },
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'armor_1', abilityId: 'armor_1-equip-0' });
    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.type === 'target_selection' && step?.equipSacrificeStage !== true
    ) as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String(targetStep.id), selections: ['bear_1'] });
    const sacStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.equipSacrificeStage === true) as any;
    expect(sacStep).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: String(sacStep.id), selections: ['sol_1'] });

    const stackItem = ((game.state as any).stack || []).find((item: any) => String(item?.abilityType || '') === 'equip');
    expect(stackItem?.oncePerTurnActivated).toBe(true);

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'armor_1', abilityId: 'armor_1-equip-0' });
    const blocked = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'ABILITY_ALREADY_USED');
    expect(blocked).toBeTruthy();
    expect(String(blocked?.payload?.message || '')).toMatch(/once each turn|already/i);
  });

  it('blocks a second activation while the first equip prompt is still pending', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).phase = 'precombatMain';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      { id: 'leather_1', controller: p1, owner: p1, card: { name: 'Leather Armor', type_line: 'Artifact — Equipment', oracle_text: LEATHER } },
      { id: 'bear_1', controller: p1, owner: p1, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' } },
      { id: 'bear_2', controller: p1, owner: p1, card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '' } },
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'leather_1', abilityId: 'leather_1-equip-0' });
    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.type === 'target_selection' && String(step?.abilityType || '') === 'equip'
    );
    expect(targetStep).toBeDefined();

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'leather_1', abilityId: 'leather_1-equip-0' });
    const blocked = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'ABILITY_ALREADY_USED');
    expect(blocked).toBeTruthy();
  });

  it('lets a second equip go through the same turn when the rider is absent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).phase = 'precombatMain';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      { id: 'boots_1', controller: p1, owner: p1, card: { name: 'Plain Boots', type_line: 'Artifact — Equipment', oracle_text: PLAIN_EQUIP } },
      { id: 'bear_1', controller: p1, owner: p1, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' } },
      { id: 'bear_2', controller: p1, owner: p1, card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '' } },
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'boots_1', abilityId: 'boots_1-equip-0' });
    const first = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.type === 'target_selection' && String(step?.abilityType || '') === 'equip'
    ) as any;
    expect(first).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: String(first.id), selections: ['bear_1'] });

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'boots_1', abilityId: 'boots_1-equip-0' });
    const blocked = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'ABILITY_ALREADY_USED');
    expect(blocked).toBeUndefined();
  });
});
