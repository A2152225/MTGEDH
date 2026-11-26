import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

// Keeper of the Dead: "Choose target opponent who has at least two fewer creature cards in their graveyard
// than you do ... Destroy target nonblack creature that player controls." (dependent targets, CR 601.2c)
// plus CR 602.2b: no legal target means nothing is paid, tapped or logged.
const gameId = 'test_keeper_of_the_dead_dependent_target';
type Emitted = Array<{ room?: string; event: string; payload: any }>;
const KEEPER = {
  name: 'Keeper of the Dead', type_line: 'Creature — Human Wizard', mana_cost: '{1}{B}{B}', power: '1', toughness: '2',
  oracle_text: '{B}, {T}: Choose target opponent who has at least two fewer creature cards in their graveyard than you do as you activate this ability. Destroy target nonblack creature that player controls.',
};

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
    data: { playerId, spectator: false },
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

const creatureCards = (owner: string, n: number) => Array.from({ length: n }, (_, i) => ({
  id: `${owner}_gy_${i}`, name: `Dead ${i}`, type_line: 'Creature — Zombie', zone: 'graveyard', owner,
}));

function creature(id: string, controller: string, name: string, colors: string[], typeLine = 'Creature — Bear') {
  return { id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {},
    card: { id: `${id}_card`, name, type_line: typeLine, colors, power: '2', toughness: '2', zone: 'battlefield' } };
}

function setup(sourceCard: any, p1Graveyard: number, extraBattlefield: any[], pool: Record<string, number>) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const zones = (owner: string, gy: number) => ({ hand: [], handCount: 0, graveyard: creatureCards(owner, gy), graveyardCount: gy, library: [], libraryCount: 0, exile: [], exileCount: 0 });
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...pool },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = { p1: zones('p1', p1Graveyard), p2: zones('p2', 0) };
  (game as any).libraries = new Map([['p1', []], ['p2', []]]);
  (game.state as any).battlefield = [
    { id: 'src_1', controller: 'p1', owner: 'p1', tapped: false, summoningSickness: false, counters: {}, card: { id: 'src_card', zone: 'battlefield', ...sourceCard } },
    ...extraBattlefield,
  ];
  const emitted: Emitted = [];
  const { socket, handlers } = createMockSocket('p1', emitted);
  const io = createMockIo(emitted);
  registerInteractionHandlers(io, socket);
  registerResolutionHandlers(io, socket);
  return { game, emitted, handlers };
}

const errors = (emitted: Emitted) => emitted.filter((e) => e.event === 'error').map((e) => e.payload);
const paidChat = (emitted: Emitted) => emitted.filter((e) => e.event === 'chat' && /paid .* to activate/i.test(String(e.payload?.message || '')));
const targetStep = () => ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;

describe('Keeper of the Dead dependent targets and pre-cost target validation', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('targets [opponent, nonblack creature they control] and destroys that creature on resolution', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup(KEEPER, 3, [
      creature('p2_bear', 'p2', 'Grizzly Bears', ['G']),
      creature('p2_zombie', 'p2', 'Black Zombie', ['B'], 'Creature — Zombie'),
      creature('p1_bear', 'p1', 'My Bears', ['G']),
    ], { black: 1 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = targetStep();
    expect(step?.dependentPlayerTargetFromController).toBe(true);
    expect((step.validTargets || []).map((t: any) => t.id)).toEqual(['p2_bear']);

    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2_bear'] });
    expect(errors(emitted)).toEqual([]);
    const item = ((game.state as any).stack || []).find((s: any) => String(s.source) === 'src_1');
    expect(item?.targets).toEqual(['p2', 'p2_bear']);

    game.resolveTopOfStack();
    const ids = (game.state as any).battlefield.map((p: any) => p.id);
    expect(ids).not.toContain('p2_bear');
    expect(ids).toContain('p2_zombie');
    expect(ids).toContain('p1_bear');
  });

  it('rejects with no legal target before paying {B}, tapping, or logging the payment (CR 602.2b)', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup(KEEPER, 1, [creature('p2_bear', 'p2', 'Grizzly Bears', ['G'])], { black: 1 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['NO_VALID_TARGETS']);
    expect(paidChat(emitted)).toEqual([]);
    expect((game.state as any).manaPool.p1.black).toBe(1);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'src_1')?.tapped).toBe(false);
    expect(targetStep()).toBeUndefined();
  });

  it('a plain "{1}, {T}: Destroy target tapped creature" with no tapped creature pays nothing', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup({
      name: 'Test Assassin', type_line: 'Creature — Human Assassin', power: '1', toughness: '1',
      oracle_text: '{1}, {T}: Destroy target tapped creature.',
    }, 0, [creature('p2_bear', 'p2', 'Grizzly Bears', ['G'])], { colorless: 1 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['NO_VALID_TARGETS']);
    expect(paidChat(emitted)).toEqual([]);
    expect((game.state as any).manaPool.p1.colorless).toBe(1);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'src_1')?.tapped).toBe(false);
  });
});
