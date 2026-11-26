import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializeAIResolutionHandler, initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  chooseAIOpponentChosenTargets,
  opponentChoosesAllTargets,
} from '../src/socket/opponentChosenTargets.js';
import { splitMultiTargetClauseWithChoosers } from '../src/socket/game-actions-handlers/castSpellTargetPatternFallbacks.js';
import '../src/state/modules/priority.js';

// "Target X of an opponent's choice": the caster's spell/ability, but an opponent picks that target
// (Volcanic Offering, Evangelize, Preacher). Live path: requestCastSpell / activateBattlefieldAbility
// -> TARGET_SELECTION routed to the opponent -> submitResolutionResponse from the opponent's socket.
const gameId = 'test_opponent_chosen_targets';
type Emitted = Array<{ room?: string; event: string; payload: any }>;

const VOLCANIC = {
  id: 'volcanic_1', name: 'Volcanic Offering', type_line: 'Instant', mana_cost: '{4}{R}',
  oracle_text: "Destroy target nonbasic land you don't control and target nonbasic land of an opponent's choice you don't control.\nVolcanic Offering deals 7 damage to target creature you don't control and 7 damage to target creature of an opponent's choice you don't control.",
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

function perm(id: string, controller: string, name: string, typeLine: string, power?: string, cmc = 0) {
  return { id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {},
    card: { id: `${id}_card`, name, type_line: typeLine, cmc, ...(power ? { power, toughness: power } : {}), zone: 'battlefield' } };
}

const OPP_BOARD = (owner: string) => [
  perm(`${owner}_tower`, owner, 'Ancient Tower', 'Land'),
  perm(`${owner}_cave`, owner, 'Desert Cave', 'Land'),
  perm(`${owner}_small`, owner, 'Small Elf', 'Creature — Elf', '1', 1),
  perm(`${owner}_big`, owner, 'Big Wurm', 'Creature — Wurm', '5', 6),
];

function setup(players: Array<{ id: string; isAI?: boolean }>, battlefield: any[], hand: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  (game.state as any).players = players.map((p) => ({ id: p.id, name: p.id.toUpperCase(), spectator: false, life: 40, ...(p.isAI ? { isAI: true } : {}) }));
  (game.state as any).life = Object.fromEntries(players.map((p) => [p.id, 40]));
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = Object.fromEntries(players.map((p) => [p.id, { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }]));
  (game.state as any).zones = Object.fromEntries(players.map((p) => [p.id, {
    hand: p.id === 'p1' ? hand : [], handCount: p.id === 'p1' ? hand.length : 0,
    graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0,
  }]));
  (game as any).libraries = new Map(players.map((p) => [p.id, []]));
  (game.state as any).battlefield = battlefield;
  const emitted: Emitted = [];
  const io = createMockIo(emitted);
  const sockets: Record<string, Record<string, Function>> = {};
  for (const p of players) {
    const { socket, handlers } = createMockSocket(p.id, emitted);
    registerGameActions(io, socket);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);
    sockets[p.id] = handlers;
  }
  return { game, emitted, sockets };
}

const pendingTargetSteps = () => ResolutionQueueManager.getQueue(gameId).steps
  .filter((s: any) => s.type === ResolutionStepType.TARGET_SELECTION && s.status === 'pending') as any[];
const errors = (emitted: Emitted) => emitted.filter((e) => e.event === 'error').map((e) => e.payload);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("opponent-chosen targets (\"of an opponent's choice\")", () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
    initializeAIResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('Volcanic Offering: the opponent picks clauses 2 and 4 from their socket; targets keep printed order; caster pays', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([{ id: 'p1' }, { id: 'p2' }], OPP_BOARD('p2'), [{ ...VOLCANIC, zone: 'hand' }]);
    await sockets.p1.requestCastSpell({ gameId, cardId: 'volcanic_1' });
    expect(errors(emitted)).toEqual([]);

    const steps = pendingTargetSteps().sort((a, b) => a.targetClauseIndex - b.targetClauseIndex);
    expect(steps.map((s) => [s.targetClauseIndex, s.playerId])).toEqual([[0, 'p1'], [1, 'p2'], [2, 'p1'], [3, 'p2']]);
    expect(steps[1].opponentChosenTargets).toBe(true);
    expect(steps[1].targetsChosenFor).toBe('p1');
    expect(steps[3].validTargets.map((t: any) => t.id).sort()).toEqual(['p2_big', 'p2_small']);

    // The caster cannot answer the opponent's slot.
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(steps[3].id), selections: ['p2_big'] });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['NOT_YOUR_STEP']);
    expect(pendingTargetSteps().some((s) => s.id === steps[3].id)).toBe(true);
    emitted.length = 0;

    // The opponent answers both of its slots before the caster answers any.
    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(steps[1].id), selections: ['p2_cave'] });
    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(steps[3].id), selections: ['p2_small'] });
    const effectId = String(steps[0].spellCastContext.effectId);
    const castWaiting = (game.state as any).pendingSpellCasts?.[effectId];
    expect(castWaiting).toBeTruthy();
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s.type === ResolutionStepType.MANA_PAYMENT_CHOICE && s.status === 'pending')).toBe(false);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(steps[0].id), selections: ['p2_tower'] });
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(steps[2].id), selections: ['p2_big'] });
    expect(errors(emitted)).toEqual([]);
    expect((game.state as any).pendingSpellCasts?.[effectId]?.targets).toEqual(['p2_tower', 'p2_cave', 'p2_big', 'p2_small']);
    const payment = ResolutionQueueManager.getQueue(gameId).steps
      .find((s: any) => s.type === ResolutionStepType.MANA_PAYMENT_CHOICE && s.status === 'pending') as any;
    expect(payment?.playerId).toBe('p1');
  });

  it('several opponents: the caster picks which opponent chooses, then only that opponent gets the slots', async () => {
    await resetGame();
    const { emitted, sockets } = setup([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], [...OPP_BOARD('p2'), ...OPP_BOARD('p3')], [{ ...VOLCANIC, zone: 'hand' }]);
    await sockets.p1.requestCastSpell({ gameId, cardId: 'volcanic_1' });
    expect(errors(emitted)).toEqual([]);
    const chooser = pendingTargetSteps().find((s) => s.opponentTargetChooserSelection === true);
    expect(chooser?.playerId).toBe('p1');
    expect(chooser.validTargets.map((t: any) => t.id)).toEqual(['p2', 'p3']);
    expect(chooser.deferredOpponentTargetSteps.map((s: any) => s.targetClauseIndex)).toEqual([1, 3]);
    expect(pendingTargetSteps().filter((s) => s.opponentChosenTargets).length).toBe(0);

    const first = pendingTargetSteps().find((s) => s.targetClauseIndex === 0);
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(first.id), selections: ['p2_tower'] });
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(chooser.id), selections: ['p3'] });
    const routed = pendingTargetSteps().filter((s) => s.opponentChosenTargets);
    expect(errors(emitted)).toEqual([]);
    expect(routed.map((s) => [s.targetClauseIndex, s.playerId])).toEqual([[1, 'p3'], [3, 'p3']]);
    expect(routed[1].validTargets.map((t: any) => t.id).sort()).toEqual(['p2_big', 'p2_small', 'p3_big', 'p3_small']);
  });

  it('an AI opponent answers its slot with what it values least', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([{ id: 'p1' }, { id: 'p2', isAI: true }], OPP_BOARD('p2'), [{ ...VOLCANIC, zone: 'hand' }]);
    await sockets.p1.requestCastSpell({ gameId, cardId: 'volcanic_1' });
    for (let i = 0; i < 20 && pendingTargetSteps().some((s) => s.playerId === 'p2'); i++) await tick();
    expect(errors(emitted)).toEqual([]);
    expect(pendingTargetSteps().some((s) => s.playerId === 'p2')).toBe(false);
    const effectId = String(pendingTargetSteps()[0].spellCastContext.effectId);
    expect((game.state as any).pendingSpellCasts[effectId].targetsByClause['3']).toEqual(['p2_small']);
  });

  it('activated ability: "{T}: Destroy target creature of an opponent\'s choice they control" goes to that opponent', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([{ id: 'p1' }, { id: 'p2' }], [
      { id: 'src_1', controller: 'p1', owner: 'p1', tapped: false, summoningSickness: false, counters: {},
        card: { id: 'src_card', zone: 'battlefield', name: 'Test Preacher', type_line: 'Creature — Human Cleric', power: '1', toughness: '1',
          oracle_text: "{T}: Destroy target creature of an opponent's choice they control." } },
      perm('p1_bear', 'p1', 'My Bear', 'Creature — Bear', '2', 2),
      ...OPP_BOARD('p2'),
    ]);
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'src_1', abilityId: 'src_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = pendingTargetSteps()[0];
    expect(step?.playerId).toBe('p2');
    expect(step.targetsChosenFor).toBe('p1');
    expect(step.validTargets.map((t: any) => t.id).sort()).toEqual(['p2_big', 'p2_small']);
    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p2_small'] });
    expect(errors(emitted)).toEqual([]);
    const item = ((game.state as any).stack || []).find((s: any) => String(s.source) === 'src_1');
    expect(item?.controller).toBe('p1');
    expect(item?.targets).toEqual(['p2_small']);
  });

  it('helpers: clause flags, all-targets guard and the AI value order', () => {
    expect(splitMultiTargetClauseWithChoosers("Tap target creature you control and target creature of an opponent's choice they control"))
      .toEqual([{ text: 'target creature you control' }, { text: 'target creature', chosenByOpponent: true, restrictToChooserControlled: true }]);
    expect(opponentChoosesAllTargets("Gain control of target creature of an opponent's choice they control.")).toBe(true);
    expect(opponentChoosesAllTargets("{T}: This creature deals 1 damage to any target and 1 damage to any target of an opponent's choice.")).toBe(false);
    const game = { state: { battlefield: [...OPP_BOARD('p2'), perm('p1_x', 'p1', 'X', 'Creature', '3', 3)] } };
    const targets = ['p2_big', 'p2_small', 'p1_x'].map((id) => ({ id, type: 'permanent' }));
    expect(chooseAIOpponentChosenTargets(game, 'p2', { minTargets: 1, maxTargets: 1 }, targets)).toEqual(['p1_x']);
    expect(chooseAIOpponentChosenTargets(game, 'p2', { minTargets: 1, maxTargets: 1 }, targets.slice(0, 2))).toEqual(['p2_small']);
  });
});
