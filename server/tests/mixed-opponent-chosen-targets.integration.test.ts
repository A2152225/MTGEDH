import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializeAIResolutionHandler, initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { rewordTargetTextForChooser } from '../src/state/modules/opponentChosenTargetRouting.js';
import '../src/state/modules/priority.js';

// Round 8 item 4: one ability, two choosers (Cuombajj Witches, Diaochan, Arena), opponent-chosen
// trigger targets (Mausoleum Turnkey, Karplusan Minotaur), chooser-facing wording, and the replay
// record naming the real chooser. Live path: socket handlers -> resolution queue -> each player's socket.
const gameId = 'test_mixed_opponent_chosen_targets';
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
const stackItemFor = (game: any, source: string) => ((game.state as any).stack || []).find((s: any) => String(s.source || s.sourceId || '') === source);
const BOARD = () => [
  perm('p1_bear', 'p1', 'My Bear', 'Creature — Bear', '2'),
  perm('p2_small', 'p2', 'Small Elf', 'Creature — Elf', '1'),
  perm('p2_big', 'p2', 'Big Wurm', 'Creature — Wurm', '5'),
];

describe('mixed and trigger opponent-chosen targets (round 8 item 4)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
    initializeAIResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('Cuombajj Witches: the controller picks one target, then the opponent picks the other; one stack item with both', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('witches', 'p1', 'Cuombajj Witches', 'Creature — Human Wizard', '1',
        "{T}: This creature deals 1 damage to any target and 1 damage to any target of an opponent's choice."),
      ...BOARD(),
    ]);
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'witches', abilityId: 'witches_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const mine = pendingSteps(ResolutionStepType.TARGET_SELECTION);
    expect(mine.map((s) => [s.playerId, s.minTargets, s.maxTargets])).toEqual([['p1', 1, 1]]);
    expect(stackItemFor(game, 'witches')).toBeUndefined();

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(mine[0].id), selections: ['p2_big'] });
    expect(errors(emitted)).toEqual([]);
    const theirs = pendingSteps(ResolutionStepType.TARGET_SELECTION);
    expect(theirs.map((s) => [s.playerId, s.targetsChosenFor, s.minTargets, s.maxTargets])).toEqual([['p2', 'p1', 1, 1]]);
    expect(theirs[0].description).toContain('(you choose for P1)');
    expect(stackItemFor(game, 'witches')).toBeUndefined();

    // The controller cannot answer the opponent's part.
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(theirs[0].id), selections: ['p2'] });
    expect(errors(emitted).map((e: any) => e.code)).toEqual(['NOT_YOUR_STEP']);
    emitted.length = 0;

    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(theirs[0].id), selections: ['p1_bear'] });
    expect(errors(emitted)).toEqual([]);
    const item = stackItemFor(game, 'witches');
    expect(item?.controller).toBe('p1');
    expect(item?.targets).toEqual(['p2_big', 'p1_bear']);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'witches').tapped).toBe(true);
  });

  it('Diaochan-style with a mana cost: nothing is paid until the opponent has chosen too (CR 602.2b)', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('diao', 'p1', 'Test Diaochan', 'Creature — Human Advisor', '1',
        "{1}, {T}: Destroy target creature of your choice, then destroy target creature of an opponent's choice."),
      ...BOARD(),
    ]);
    (game.state as any).manaPool.p1.colorless = 1;
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'diao', abilityId: 'diao_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const mine = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(mine?.playerId).toBe('p1');
    expect((game.state as any).manaPool.p1.colorless).toBe(1);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'diao').tapped).toBe(false);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(mine.id), selections: ['p2_big'] });
    expect(errors(emitted)).toEqual([]);
    expect((game.state as any).manaPool.p1.colorless).toBe(1);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'diao').tapped).toBe(false);
    const theirs = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(theirs?.playerId).toBe('p2');

    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(theirs.id), selections: ['p1_bear'] });
    expect(errors(emitted)).toEqual([]);
    expect((game.state as any).manaPool.p1.colorless).toBe(0);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'diao').tapped).toBe(true);
    expect(stackItemFor(game, 'diao')?.targets).toEqual(['p2_big', 'p1_bear']);
  });

  it('Arena: the opponent only picks a creature they control, then both creatures are tapped and fight', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('arena', 'p1', 'Arena', 'Land', undefined,
        "{3}, {T}: Tap target creature you control and target creature of an opponent's choice they control. Those creatures fight each other. (Each deals damage equal to its power to the other.)"),
      ...BOARD(),
    ]);
    (game.state as any).manaPool.p1.colorless = 3;
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'arena', abilityId: 'arena_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const mine = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(mine?.playerId).toBe('p1');
    expect(mine.validTargets.map((t: any) => t.id)).toEqual(['p1_bear']);
    expect(pendingSteps(ResolutionStepType.TAP_UNTAP_TARGET)).toEqual([]);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(mine.id), selections: ['p1_bear'] });
    const theirs = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(theirs?.playerId).toBe('p2');
    expect(theirs.validTargets.map((t: any) => t.id).sort()).toEqual(['p2_big', 'p2_small']);
    expect(theirs.description).not.toMatch(/\byou control\b/);

    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(theirs.id), selections: ['p2_small'] });
    expect(errors(emitted)).toEqual([]);
    expect((game.state as any).manaPool.p1.colorless).toBe(0);
    expect(stackItemFor(game, 'arena')?.targets).toEqual(['p1_bear', 'p2_small']);

    (game as any).resolveTopOfStack();
    const bf: any[] = (game.state as any).battlefield;
    const bear = bf.find((p: any) => p.id === 'p1_bear');
    expect(bear?.tapped).toBe(true);
    expect(Number(bear?.damageMarked ?? bear?.damage ?? 0)).toBe(1);
    const elf = bf.find((p: any) => p.id === 'p2_small');
    expect(!elf || elf.tapped === true).toBe(true);
    expect(!elf || Number(elf.damageMarked ?? elf.damage ?? 0) >= 2).toBe(true);
  });

  it('chooser-facing wording names the controller instead of "you"', async () => {
    expect(rewordTargetTextForChooser("Choose target creature you don't control", 'P1')).toBe("Choose target creature P1 doesn't control");
    expect(rewordTargetTextForChooser('target creature you control', 'P1')).toBe('target creature P1 controls');
    expect(rewordTargetTextForChooser('Choose target card from your graveyard', 'P1')).toBe("Choose target card from P1's graveyard");

    await resetGame();
    const { emitted, sockets } = setup([
      perm('preach', 'p1', 'Test Preacher', 'Creature — Human Cleric', '1',
        "{T}: Destroy target creature of an opponent's choice you don't control."),
      ...BOARD(),
    ]);
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'preach', abilityId: 'preach_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(step?.playerId).toBe('p2');
    expect(`${step.description} ${step.targetDescription}`).not.toMatch(/\byou (?:don't )?control\b/);
  });

  it('Mausoleum Turnkey: the ETB graveyard target goes to the opponent; the card still returns to its controller', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([], [], [
      { id: 'gy_bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2', mana_cost: '{1}{G}', zone: 'graveyard' },
      { id: 'gy_wurm', name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4', mana_cost: '{4}{G}{G}', zone: 'graveyard' },
    ]);
    const turnkey = perm('turnkey', 'p1', 'Mausoleum Turnkey', 'Creature — Ogre Rogue', '3',
      "When this creature enters, return target creature card of an opponent's choice from your graveyard to your hand.");
    (game.state as any).battlefield.push(turnkey);
    queueSelfETBTriggersForPermanent(game as any, turnkey, 'p1' as any);
    const step = pendingSteps(ResolutionStepType.GRAVEYARD_SELECTION)[0];
    expect(step?.playerId).toBe('p2');
    expect(step.targetsChosenFor).toBe('p1');
    expect(step.targetPlayerId).toBe('p1');

    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['gy_bear'] });
    expect(errors(emitted)).toEqual([]);
    const trigger = ((game.state as any).stack || []).find((s: any) => s.type === 'triggered_ability');
    expect(trigger?.controller).toBe('p1');
    expect(trigger?.targets).toEqual(['gy_bear']);
    (game as any).resolveTopOfStack();
    expect((game.state as any).zones.p1.hand.map((c: any) => c.id)).toContain('gy_bear');
    expect((game.state as any).zones.p2.hand).toEqual([]);
  });

  it('Karplusan Minotaur: the lose-a-flip trigger\'s "any target of an opponent\'s choice" is chosen by the opponent', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([perm('mino', 'p1', 'Karplusan Minotaur', 'Creature — Minotaur Warrior', '3'), ...BOARD()]);
    (game.state as any).stack.push({
      id: 'trig_mino', type: 'triggered_ability', controller: 'p1', source: 'mino', permanentId: 'mino',
      sourceName: 'Karplusan Minotaur', triggerType: 'lose_coin_flip',
      description: "this creature deals 1 damage to any target of an opponent's choice",
      effect: "this creature deals 1 damage to any target of an opponent's choice",
      requiresTarget: true, targetType: 'any',
    });
    (game as any).resolveTopOfStack();
    const step = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(step?.playerId).toBe('p2');
    expect(step.targetsChosenFor).toBe('p1');
    expect(step.targetedTriggeredAbilityController).toBe('p1');
    await sockets.p2.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['p1_bear'] });
    expect(errors(emitted)).toEqual([]);
    const bear = (game.state as any).battlefield.find((p: any) => p.id === 'p1_bear');
    const bearDamage = Number(bear?.damageMarked ?? bear?.damage ?? 0);
    expect(bearDamage).toBe(1);
    expect(((game.state as any).stack || []).some((s: any) => s.id === 'trig_mino')).toBe(false);
  });

  it('single-target cast: the replay record names the opponent who chooses', async () => {
    await resetGame();
    const card = { id: 'edict_1', name: 'Test Edict', type_line: 'Sorcery', mana_cost: '{B}', zone: 'hand',
      oracle_text: "Destroy target creature of an opponent's choice they control." };
    const { emitted, sockets } = setup(BOARD(), [card]);
    const start = getEvents(gameId).length;
    await sockets.p1.requestCastSpell({ gameId, cardId: 'edict_1' });
    expect(errors(emitted)).toEqual([]);
    const step = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(step?.playerId).toBe('p2');
    const recorded = getEvents(gameId).slice(start)
      .map((e: any) => e?.payload?.queuedResolutionStep || (e?.payload?.queuedResolutionSteps || []).slice(-1)[0])
      .filter(Boolean)
      .find((s: any) => String(s.id) === String(step.id));
    expect(recorded?.playerId).toBe('p2');
    expect(recorded?.targetsChosenFor).toBe('p1');
    expect(recorded?.opponentChosenTargets).toBe(true);
  });
});
