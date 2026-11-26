import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

// CR 602.2b: targets are chosen before costs are paid. Live path: activateBattlefieldAbility ->
// target prompt (nothing paid yet) -> submitResolutionResponse -> cost paid, ability on the stack.
const gameId = 'test_activation_targets_before_costs';
type Emitted = Array<{ room?: string; event: string; payload: any }>;

function createMockIo(emitted: Emitted) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { await deleteGame(gameId); } catch { /* fresh db */ }
}

function perm(id: string, controller: string, card: any, extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {}, card: { id: `${id}_card`, zone: 'battlefield', ...card }, ...extra };
}
const bear = (id: string, controller: string) => perm(id, controller, { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2', oracle_text: '' });

function setup(battlefield: any[], pool: Record<string, number>) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
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
  const zones = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 });
  (game.state as any).zones = { p1: zones(), p2: zones() };
  (game as any).libraries = new Map([['p1', []], ['p2', []]]);
  (game.state as any).battlefield = battlefield;
  const emitted: Emitted = [];
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: 'p1', spectator: false }, rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
  const io = createMockIo(emitted);
  registerInteractionHandlers(io, socket);
  registerResolutionHandlers(io, socket);
  return { game, emitted, handlers };
}

const pending = () => ResolutionQueueManager.getQueue(gameId).steps.filter((s: any) => s.status === 'pending') as any[];
const errors = (emitted: Emitted) => emitted.filter((e) => e.event === 'error').map((e) => e.payload);
const poolOf = (game: any) => (game.state as any).manaPool.p1;
const permOf = (game: any, id: string) => (game.state as any).battlefield.find((p: any) => p.id === id);

describe('activation targets before costs (CR 602.2b)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('grant family: "{1}{R}, {T}: Target creature you control gains haste" pays only after the target is chosen', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup([
      perm('src_1', 'p1', { name: 'Test Palace', type_line: 'Land', oracle_text: '{1}{R}, {T}: Target creature you control gains haste until end of turn.' }),
      bear('p1_bear', 'p1'),
    ], { red: 1, colorless: 1 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_1_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = pending().find((s) => s.type === ResolutionStepType.TARGET_SELECTION);
    expect(step?.deferredActivationCost).toBeTruthy();
    expect([poolOf(game).red, poolOf(game).colorless]).toEqual([1, 1]);
    expect(permOf(game, 'src_1').tapped).toBe(false);

    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p1_bear'] });
    expect(errors(emitted)).toEqual([]);
    expect([poolOf(game).red, poolOf(game).colorless]).toEqual([0, 0]);
    expect(permOf(game, 'src_1').tapped).toBe(true);
  });

  it('cancelling the target prompt pays nothing', async () => {
    await resetGame();
    const { game, handlers } = setup([
      perm('src_1', 'p1', { name: 'Test Palace', type_line: 'Land', oracle_text: '{1}{R}, {T}: Target creature you control gains haste until end of turn.' }),
      bear('p1_bear', 'p1'),
    ], { red: 1, colorless: 1 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_1_card-ability-0' });
    const step = pending().find((s) => s.type === ResolutionStepType.TARGET_SELECTION);
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: [], cancelled: true });
    expect([poolOf(game).red, poolOf(game).colorless]).toEqual([1, 1]);
    expect(permOf(game, 'src_1').tapped).toBe(false);
  });

  it('generic path: "{2}, {T}: Destroy target creature" chooses the target, then pays and stacks it', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup([
      perm('src_1', 'p1', { name: 'Test Assassin', type_line: 'Artifact', oracle_text: '{2}, {T}: Destroy target creature.' }),
      bear('p2_bear', 'p2'),
    ], { colorless: 2 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_1_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = pending().find((s) => s.type === ResolutionStepType.TARGET_SELECTION);
    expect(poolOf(game).colorless).toBe(2);
    expect(permOf(game, 'src_1').tapped).toBe(false);
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2_bear'] });
    expect(errors(emitted)).toEqual([]);
    expect(poolOf(game).colorless).toBe(0);
    expect(permOf(game, 'src_1').tapped).toBe(true);
    expect(((game.state as any).stack || []).find((s: any) => s.source === 'src_1')?.targets).toEqual(['p2_bear']);
  });

  it('tap-other cost: target prompt first, then the tap prompt, then pay and stack with that target', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup([
      perm('src_1', 'p1', { name: 'Test Drummer', type_line: 'Artifact', oracle_text: '{1}, Tap an untapped creature you control: Target player loses 1 life.' }),
      bear('p1_bear', 'p1'),
    ], { colorless: 1 });
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_1_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const targetStep = pending()[0];
    expect(targetStep?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(targetStep?.preCostAbilityTargetSelection).toBe(true);
    expect(pending().some((s) => s.type === ResolutionStepType.TAP_UNTAP_TARGET)).toBe(false);

    await handlers.submitResolutionResponse({ gameId, stepId: String(targetStep.id), selections: ['p2'] });
    const tapStep = pending().find((s) => s.type === ResolutionStepType.TAP_UNTAP_TARGET);
    expect(tapStep?.preselectedAbilityTargets).toEqual(['p2']);
    expect(poolOf(game).colorless).toBe(1);
    expect(permOf(game, 'p1_bear').tapped).toBe(false);

    await handlers.submitResolutionResponse({ gameId, stepId: String(tapStep.id), selections: { targetIds: ['p1_bear'], action: 'tap' } });
    expect(errors(emitted)).toEqual([]);
    expect(poolOf(game).colorless).toBe(0);
    expect(permOf(game, 'p1_bear').tapped).toBe(true);
    expect(pending().filter((s) => s.type === ResolutionStepType.TARGET_SELECTION)).toEqual([]);
    expect(((game.state as any).stack || []).find((s: any) => s.source === 'src_1')?.targets).toEqual(['p2']);
  });

  it('planeswalker loyalty cost is paid after the target is chosen', async () => {
    await resetGame();
    const { game, emitted, handlers } = setup([
      perm('pw_1', 'p1', { name: 'Test Walker', type_line: 'Legendary Planeswalker \u2014 Test', oracle_text: '-2: Destroy target creature.', loyalty: '4' }, { counters: { loyalty: 4 }, loyalty: 4 }),
      bear('p2_bear', 'p2'),
    ], {});
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'pw_1', abilityId: 'pw-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = pending().find((s) => s.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeTruthy();
    expect(permOf(game, 'pw_1').counters.loyalty).toBe(4);
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2_bear'] });
    expect(errors(emitted)).toEqual([]);
    expect(permOf(game, 'pw_1').counters.loyalty).toBe(2);
  });
});
