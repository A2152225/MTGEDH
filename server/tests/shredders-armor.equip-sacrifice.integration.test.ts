import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities.js';
import { equipSacrificeCandidates, parseEquipSacrificeCost } from '../src/state/modules/equipNonManaCosts.js';

const SHREDDER = "Equipped creature gets +2/+1.\nWhen this Equipment enters, attach it to target creature you control.\nEquip—Sacrifice another nonland permanent. Activate only once each turn.";

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


describe("Shredder's Armor Equip—Sacrifice another nonland permanent", () => {
  const gameId = 'test_shredders_armor_equip_sacrifice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('parses the nonland-permanent sacrifice equip cost', () => {
    const abilities = parseEquipAbilitiesFromOracle(SHREDDER);
    const sac = abilities.find((ability) => /sacrifice/i.test(ability.cost));
    expect(sac?.cost).toBe('Sacrifice another nonland permanent');
    expect(parseEquipSacrificeCost(sac?.cost)).toBe('nonland_permanent');
  });

  it('offers other nonland permanents and equips after the sacrifice prompt is paid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'armor_1',
        controller: p1,
        owner: p1,
        card: { name: "Shredder's Armor", type_line: 'Artifact — Equipment', oracle_text: SHREDDER },
      },
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      },
      {
        id: 'sol_1',
        controller: p1,
        owner: p1,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
      },
      {
        id: 'forest_1',
        controller: p1,
        owner: p1,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const candidates = equipSacrificeCandidates(game.state, p1, 'Sacrifice another nonland permanent', ['armor_1', 'bear_1']);
    expect(candidates.map((permanent: any) => permanent.id)).toEqual(['sol_1']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'armor_1', abilityId: 'armor_1-equip-0' });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error).toBeUndefined();
    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.type === 'target_selection' && step?.equipSacrificeStage !== true
    ) as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['bear_1'],
    });

    const sacStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.equipSacrificeStage === true) as any;
    expect(sacStep).toBeDefined();
    const sacIds = (sacStep.validTargets || []).map((target: any) => String(target.id));
    expect(sacIds).toContain('sol_1');
    expect(sacIds).not.toContain('forest_1');
    expect(sacIds).not.toContain('armor_1');
    expect(sacIds).not.toContain('bear_1');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(sacStep.id),
      selections: ['sol_1'],
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((permanent: any) => permanent.id === 'sol_1')).toBe(false);
    const armor = battlefield.find((permanent: any) => permanent.id === 'armor_1');
    const stack = (game.state as any).stack || [];
    const attachedOrStacked = String(armor?.attachedTo || '') === 'bear_1'
      || stack.some((item: any) => /equip/i.test(String(item?.abilityType || item?.description || item?.type || '')) || String(item?.targets?.[0] || item?.targetId || '') === 'bear_1');
    expect(attachedOrStacked).toBe(true);
  });
});
