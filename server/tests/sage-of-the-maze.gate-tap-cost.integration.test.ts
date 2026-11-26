import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializeAIResolutionHandler, initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

// Round 8 item 5: Sage of the Maze's "Tap an untapped Gate you control: Untap this creature."
// Live path: activateBattlefieldAbility -> TAP_UNTAP_TARGET cost prompt -> the Gate is tapped and the
// ability untaps Sage. With no Gate the activation is refused with INSUFFICIENT_TARGETS (correct).
const gameId = 'test_sage_of_the_maze_gate_cost';
type Emitted = Array<{ room?: string; event: string; payload: any }>;

function createMockIo(emitted: Emitted) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Emitted) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
  return { socket, handlers };
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { await deleteGame(gameId); } catch { /* fresh db */ }
}

function perm(id: string, controller: string, name: string, typeLine: string, power?: string, oracle = '') {
  return { id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {}, damage: 0,
    card: { id: `${id}_card`, name, type_line: typeLine, oracle_text: oracle, ...(power ? { power, toughness: power } : {}), zone: 'battlefield' } };
}

function setup(battlefield: any[], hand: any[] = [], graveyardP1: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const players = ['p1', 'p2'];
  (game as any).gameId = gameId;
  (game.state as any).players = players.map((id) => ({ id, name: id.toUpperCase(), spectator: false, life: 40 }));
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = Object.fromEntries(players.map((id) => [id, { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }]));
  (game.state as any).zones = Object.fromEntries(players.map((id) => [id, {
    hand: id === 'p1' ? hand : [], handCount: id === 'p1' ? hand.length : 0,
    graveyard: id === 'p1' ? graveyardP1 : [], graveyardCount: id === 'p1' ? graveyardP1.length : 0,
    library: [], libraryCount: 0, exile: [], exileCount: 0,
  }]));
  (game as any).libraries = new Map(players.map((id) => [id, []]));
  (game.state as any).battlefield = battlefield;
  const emitted: Emitted = [];
  const io = createMockIo(emitted);
  const sockets: Record<string, Record<string, Function>> = {};
  for (const id of players) {
    const { socket, handlers } = createMockSocket(id, emitted);
    registerGameActions(io, socket);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);
    sockets[id] = handlers;
  }
  return { game, emitted, sockets };
}

const pendingSteps = (type?: string) => ResolutionQueueManager.getQueue(gameId).steps
  .filter((s: any) => s.status === 'pending' && (!type || s.type === type)) as any[];
const errors = (emitted: Emitted) => emitted.filter((e) => e.event === 'error').map((e) => e.payload);
const SAGE_TEXT = "{T}: Add two mana in any combination of colors.\n{T}: Until end of turn, target land you control becomes an X/X Citizen creature with haste in addition to its other types, where X is twice the number of Gates you control. Activate only as a sorcery.\nTap an untapped Gate you control: Untap this creature.";

describe('Sage of the Maze: tap a Gate to untap (round 8 item 5)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
    initializeAIResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('taps the chosen Gate and untaps Sage', async () => {
    await resetGame();
    const sage = { ...perm('sage', 'p1', 'Sage of the Maze', 'Creature — Elf Wizard', '1', SAGE_TEXT), tapped: true };
    const { game, emitted, sockets } = setup([
      sage,
      perm('gate', 'p1', 'Azorius Guildgate', 'Land — Gate'),
      perm('forest', 'p1', 'Forest', 'Basic Land — Forest'),
      perm('p2_gate', 'p2', 'Rakdos Guildgate', 'Land — Gate'),
    ]);
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'sage', abilityId: 'sage_card-ability-2' });
    expect(errors(emitted)).toEqual([]);
    const step = pendingSteps(ResolutionStepType.TAP_UNTAP_TARGET)[0];
    expect(step?.playerId).toBe('p1');

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['gate'] });
    expect(errors(emitted)).toEqual([]);
    const bf: any[] = (game.state as any).battlefield;
    expect(bf.find((p) => p.id === 'gate').tapped).toBe(true);
    expect(bf.find((p) => p.id === 'forest').tapped).toBe(false);
    expect(bf.find((p) => p.id === 'p2_gate').tapped).toBe(false);
    const stack: any[] = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(stack[0].controller).toBe('p1');
    (game as any).resolveTopOfStack();
    expect(((game.state as any).stack || []).length).toBe(0);
    const sageAfter = ((game.state as any).battlefield as any[]).find((p) => p.id === 'sage');
    expect(sageAfter.tapped).toBe(false);
  });

  it('only Gates the activator controls count; with none the activation is refused', async () => {
    await resetGame();
    const { emitted, sockets } = setup([
      { ...perm('sage', 'p1', 'Sage of the Maze', 'Creature — Elf Wizard', '1', SAGE_TEXT), tapped: true },
      perm('forest', 'p1', 'Forest', 'Basic Land — Forest'),
      perm('p2_gate', 'p2', 'Rakdos Guildgate', 'Land — Gate'),
    ]);
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'sage', abilityId: 'sage_card-ability-2' });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['INSUFFICIENT_TARGETS']);
    expect(pendingSteps()).toEqual([]);
  });
});
