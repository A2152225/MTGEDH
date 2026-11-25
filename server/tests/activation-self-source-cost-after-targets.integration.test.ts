import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

// CR 602.2b: targets are chosen before "Sacrifice this" / "Exile this" costs are paid.
// Outcome sweep family #1 (Crypt Creeper, Shock Troops, Vial of Dragonfire, Perpetual Timepiece...).
const gameId = 'test_activation_self_source_cost_after_targets';
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

function setup(sourceCard: any, extraBattlefield: any[] = [], pool: Record<string, number> = {}) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const emptyZones = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 });
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
  (game.state as any).zones = { p1: emptyZones(), p2: emptyZones() };
  (game as any).libraries = new Map([['p1', []], ['p2', []]]);
  (game.state as any).battlefield = [
    { id: 'src_1', controller: 'p1', owner: 'p1', tapped: false, summoningSickness: false, card: { id: 'src_card', zone: 'battlefield', ...sourceCard } },
    ...extraBattlefield,
  ];
  const emitted: Emitted = [];
  const { socket, handlers } = createMockSocket('p1', emitted);
  const io = createMockIo(emitted);
  registerInteractionHandlers(io, socket);
  registerResolutionHandlers(io, socket);
  return { game, emitted, handlers };
}

function targetStep() {
  return ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
}

describe('self-source activation costs are paid after targets are chosen (CR 602.2b)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('Shock Troops: source stays until a target is chosen, then is sacrificed with LKI on the stack item', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup({
      name: 'Shock Troops', type_line: 'Creature — Human Soldier', power: '2', toughness: '2',
      oracle_text: 'Sacrifice this creature: It deals 2 damage to any target.',
    });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    const step = targetStep();
    expect(step).toBeTruthy();
    expect(step.deferredSelfSourceCost).toBe('sacrifice');
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(true);

    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2'] });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(false);
    expect((game.state as any).zones.p1.graveyard.map((c: any) => c.name)).toContain('Shock Troops');
    const item = ((game.state as any).stack || []).find((s: any) => String(s.source) === 'src_1');
    expect(item).toBeTruthy();
    expect(item.targets).toEqual(['p2']);
    expect(item.sacrificedPermanents).toEqual(['src_1']);
    expect(item.lastSacrificedPermanents?.[0]?.name).toBe('Shock Troops');
    expect(item.sourceLastKnown?.power).toBe(2);
  });

  it('Perpetual Timepiece: "Exile this" cost is paid after targets and the source lands in exile', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup({
      name: 'Perpetual Timepiece', type_line: 'Artifact', mana_cost: '{2}',
      oracle_text: '{T}: Mill two cards.\n{2}, Exile this artifact: Shuffle any number of target cards from your graveyard into your library.',
    }, [], { colorless: 2 });
    (game.state as any).zones.p1.graveyard = [
      { id: 'gy_1', name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'graveyard' },
      { id: 'gy_2', name: 'Island', type_line: 'Basic Land — Island', zone: 'graveyard' },
    ];
    (game.state as any).zones.p1.graveyardCount = 2;
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-1' });
    const preErrors = emitted.filter((e) => e.event === 'error').map((e) => e.payload);
    expect(preErrors).toEqual([]);
    const step = targetStep();
    expect(step).toBeTruthy();
    expect(step.deferredSelfSourceCost).toBe('exile');
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(true);

    const gyIds = (step.validTargets || []).map((t: any) => String(t.id));
    expect(gyIds.length, JSON.stringify(step).slice(0, 1500)).toBeGreaterThan(0);
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: gyIds.slice(0, Math.max(1, Math.min(gyIds.length, Number(step.maxTargets) || 1))) });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(false);
    expect((game.state as any).zones.p1.exile.map((c: any) => c.name)).toContain('Perpetual Timepiece');
    expect((game.state as any).zones.p1.graveyard.map((c: any) => c.name)).not.toContain('Perpetual Timepiece');
    const item = ((game.state as any).stack || []).find((s: any) => String(s.source) === 'src_1');
    expect(item?.targets?.length).toBeGreaterThan(0);
  });

  it('pay-life + sacrifice-self: life is paid with the sacrifice, after targets, not at activation', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup({
      name: 'Test Powder Keg', type_line: 'Artifact',
      oracle_text: 'Pay 2 life, Sacrifice this artifact: This artifact deals 3 damage to any target.',
    });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    const step = targetStep();
    expect(step?.deferredSelfSourceCost).toBe('sacrifice');
    expect(step?.deferredLifePaymentForCost).toBe(2);
    expect((game.state as any).life.p1).toBe(40);

    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2'] });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    expect((game.state as any).life.p1).toBe(38);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(false);
  });

  it('printed-name self cost ("Sacrifice Test Legend") is recognized as a self sacrifice', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup({
      name: 'Test Legend, the Bold', type_line: 'Legendary Creature — Human Warrior', power: '3', toughness: '3',
      oracle_text: 'Sacrifice Test Legend: Test Legend deals 3 damage to any target.',
    });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    const step = targetStep();
    expect(step?.deferredSelfSourceCost).toBe('sacrifice');
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(true);
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2'] });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'src_1')).toBe(false);
    expect((game.state as any).zones.p1.graveyard.map((c: any) => c.name)).toContain('Test Legend, the Bold');
  });
});
