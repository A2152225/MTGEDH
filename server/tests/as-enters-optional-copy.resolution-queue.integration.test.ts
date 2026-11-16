import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { checkAsEntersCopyChoiceForNewPermanents } from '../src/state/modules/asEntersCopyChoice.js';

const CARDS = {
  'Sculpting Steel': 'You may have this artifact enter as a copy of any artifact on the battlefield.',
  'Mirror Image': 'You may have this creature enter as a copy of any creature you control.',
  'Mirrormade': 'You may have this enchantment enter as a copy of any artifact or enchantment on the battlefield.',
  'Copy Enchantment': 'You may have this enchantment enter as a copy of any enchantment on the battlefield.',
  'Waxen Shapethief': 'You may have this creature enter as a copy of any creature you control.',
};

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[], gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('optional enters-as-copy picker (Clone family type filters)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_copy_etb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('derives optional copy requirements with type and controller filters', () => {
    const steel = getAsEntersChoiceRequirements({ name: 'Sculpting Steel', oracle_text: CARDS['Sculpting Steel'] }).find((r) => r.kind === 'copy_permanent')!;
    expect(steel).toBeDefined();
    expect(steel.mandatory).toBe(false);
    expect(steel.copyType === 'artifact' || steel.copyTypes?.includes('artifact')).toBe(true);

    const image = getAsEntersChoiceRequirements({ name: 'Mirror Image', oracle_text: CARDS['Mirror Image'] }).find((r) => r.kind === 'copy_permanent')!;
    expect(image.controllerOnly).toBe(true);
    expect(image.copyType === 'creature' || image.copyTypes?.includes('creature')).toBe(true);

    const made = getAsEntersChoiceRequirements({ name: 'Mirrormade', oracle_text: CARDS['Mirrormade'] }).find((r) => r.kind === 'copy_permanent')!;
    const madeTypes = made.copyTypes || (made.copyType === 'artifact-or-enchantment' ? ['artifact', 'enchantment'] : [made.copyType]);
    expect(madeTypes).toEqual(expect.arrayContaining(['artifact', 'enchantment']));
    expect(made.mandatory).toBe(false);

    const copyEnc = getAsEntersChoiceRequirements({ name: 'Copy Enchantment', oracle_text: CARDS['Copy Enchantment'] }).find((r) => r.kind === 'copy_permanent')!;
    expect(copyEnc.copyType === 'enchantment' || copyEnc.copyTypes?.includes('enchantment')).toBe(true);

    const waxen = getAsEntersChoiceRequirements({ name: 'Waxen Shapethief', oracle_text: CARDS['Waxen Shapethief'] }).find((r) => r.kind === 'copy_permanent')!;
    expect(waxen.controllerOnly).toBe(true);
  });

  it('queues an optional picker and allows declining (cancel to skip)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).battlefield = [
      { id: 'sol_1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact' } },
      { id: 'steel_1', controller: p1, owner: p1, card: { name: 'Sculpting Steel', type_line: 'Artifact', oracle_text: CARDS['Sculpting Steel'] } },
    ];
    checkAsEntersCopyChoiceForNewPermanents(game, gameId);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.asEntersCopyChoice === true) as any;
    expect(step).toBeDefined();
    expect(step.mandatory).toBe(false);
    expect(step.minTargets).toBe(0);
    expect((step.validTargets || []).map((t: any) => t.id)).toEqual(['sol_1']);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [], cancelled: true });
    const steel = (game.state as any).battlefield.find((p: any) => p.id === 'steel_1');
    expect(steel.copiedFromPermanentId).toBeFalsy();
    expect(steel.card?.name).toBe('Sculpting Steel');
  });

  it('filters Mirror Image to creatures you control only', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    (game.state as any).battlefield = [
      { id: 'bear_1', controller: p1, owner: p1, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' } },
      { id: 'opp_1', controller: p2, owner: p2, card: { name: 'Serra Angel', type_line: 'Creature — Angel' } },
      { id: 'sol_1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact' } },
      { id: 'mirror_1', controller: p1, owner: p1, card: { name: 'Mirror Image', type_line: 'Creature — Shapeshifter', oracle_text: CARDS['Mirror Image'] } },
    ];
    checkAsEntersCopyChoiceForNewPermanents(game, gameId);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.asEntersCopyChoice === true) as any;
    expect(step).toBeDefined();
    expect((step.validTargets || []).map((t: any) => t.id)).toEqual(['bear_1']);
  });
});
