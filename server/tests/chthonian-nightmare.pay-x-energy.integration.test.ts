import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializeAIResolutionHandler, initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

// Round 8 item 2: Chthonian Nightmare's "Pay X {E}, Sacrifice a creature, Return this enchantment to
// its owner's hand: Return target creature card with mana value X from your graveyard to the
// battlefield. Activate only as a sorcery." CR 601.2b/602.2b: announce X, then targets legal for that
// X, then pay. Live path: activateBattlefieldAbility -> X_VALUE_SELECTION -> TARGET_SELECTION (target)
// -> TARGET_SELECTION (sacrifice) -> costs paid together -> stack -> resolve.
const gameId = 'test_chthonian_nightmare_pay_x_energy';
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
    io.sockets.sockets.set(id, socket); // emitToPlayer reaches this socket
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
const CHTHONIAN = "When this enchantment enters, you get {E}{E}{E} (three energy counters).\nPay X {E}, Sacrifice a creature, Return this enchantment to its owner's hand: Return target creature card with mana value X from your graveyard to the battlefield. Activate only as a sorcery.";
const GRAVEYARD = () => [
  { id: 'gy_bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2', mana_cost: '{1}{G}', cmc: 2, zone: 'graveyard' },
  { id: 'gy_wurm', name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4', mana_cost: '{4}{G}{G}', cmc: 6, zone: 'graveyard' },
  { id: 'gy_bolt', name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}', cmc: 1, zone: 'graveyard' },
];
const board = () => [
  perm('night', 'p1', 'Chthonian Nightmare', 'Enchantment', undefined, CHTHONIAN),
  perm('fodder', 'p1', 'Fodder Elf', 'Creature — Elf', '1'),
  perm('p2_bear', 'p2', 'Their Bear', 'Creature — Bear', '2'),
];
const zonesOf = (game: any) => (game.state as any).zones;
const onBattlefield = (game: any, id: string) => ((game.state as any).battlefield as any[]).some((p) => p.id === id || p.card?.id === id);

describe('Chthonian Nightmare: Pay X {E} (round 8 item 2)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
    initializeAIResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('announce X, choose a mana-value-X target, choose the sacrifice, then pay everything and return the card', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup(board(), [], GRAVEYARD());
    (game.state as any).energy = { p1: 3, p2: 0 };
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'night', abilityId: 'night_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const xStep = pendingSteps(ResolutionStepType.X_VALUE_SELECTION)[0];
    expect(xStep?.playerId).toBe('p1');
    expect(xStep.maxValue).toBe(3);
    expect(pendingSteps(ResolutionStepType.TARGET_SELECTION)).toEqual([]);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(xStep.id), selections: 2 });
    expect(errors(emitted)).toEqual([]);
    const targetStep = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(targetStep.validTargets.map((t: any) => t.id)).toEqual(['gy_bear']);
    // Nothing paid yet.
    expect((game.state as any).energy.p1).toBe(3);
    expect(onBattlefield(game, 'night')).toBe(true);
    expect(onBattlefield(game, 'fodder')).toBe(true);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(targetStep.id), selections: ['gy_bear'] });
    expect(errors(emitted)).toEqual([]);
    const sacStep = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(sacStep.validTargets.map((t: any) => t.id)).toEqual(['fodder']);
    expect((game.state as any).energy.p1).toBe(3);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(sacStep.id), selections: ['fodder'] });
    expect(errors(emitted)).toEqual([]);
    expect((game.state as any).energy.p1).toBe(1);
    expect(onBattlefield(game, 'fodder')).toBe(false);
    expect(zonesOf(game).p1.graveyard.map((c: any) => c.id)).toContain('fodder_card');
    expect(onBattlefield(game, 'night')).toBe(false);
    expect(zonesOf(game).p1.hand.map((c: any) => c.id)).toContain('night_card');
    const item = ((game.state as any).stack || []).find((s: any) => s.source === 'night');
    expect(item?.controller).toBe('p1');
    expect(item?.targets).toEqual(['gy_bear']);

    (game as any).resolveTopOfStack();
    expect(onBattlefield(game, 'gy_bear')).toBe(true);
    expect(zonesOf(game).p1.graveyard.map((c: any) => c.id)).not.toContain('gy_bear');
  });

  it('an X with no legal target is refused and nothing is paid', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup(board(), [], GRAVEYARD());
    (game.state as any).energy = { p1: 3, p2: 0 };
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'night', abilityId: 'night_card-ability-0' });
    const xStep = pendingSteps(ResolutionStepType.X_VALUE_SELECTION)[0];
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(xStep.id), selections: 3 });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['NO_VALID_TARGETS']);
    expect(pendingSteps()).toEqual([]);
    expect((game.state as any).energy.p1).toBe(3);
    expect(onBattlefield(game, 'night')).toBe(true);
    expect(onBattlefield(game, 'fodder')).toBe(true);
  });

  it('X above the energy you have is refused; so is activating while the stack is not empty', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup(board(), [], GRAVEYARD());
    (game.state as any).energy = { p1: 1, p2: 0 };
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'night', abilityId: 'night_card-ability-0' });
    const xStep = pendingSteps(ResolutionStepType.X_VALUE_SELECTION)[0];
    expect(xStep.maxValue).toBe(1);
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(xStep.id), selections: 2 });
    // The X prompt itself caps X at the energy you have (maxValue).
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['INVALID_SELECTION']);
    expect(pendingSteps(ResolutionStepType.TARGET_SELECTION)).toEqual([]);
    emitted.length = 0;

    (game.state as any).stack = [{ id: 'other', type: 'spell', controller: 'p2', card: { name: 'Something' } }];
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'night', abilityId: 'night_card-ability-0' });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['SORCERY_SPEED_ONLY']);
    // Only the first X prompt (left open by the invalid answer) exists; no new one was queued.
    expect(pendingSteps(ResolutionStepType.X_VALUE_SELECTION).map((s: any) => s.id)).toEqual([String(xStep.id)]);
  });
});
