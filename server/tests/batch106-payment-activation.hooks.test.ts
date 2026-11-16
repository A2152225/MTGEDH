import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';
import { canPayManaCost } from '../src/state/modules/mana-check-handlers/manaCheckCanPayManaCost.js';
import { canPayManaCostWithAvailableSources } from '../src/state/modules/mana-check-handlers/manaCheckCanPayWithSources.js';
import { payAbilityManaCostFromPool, validateAbilityManaCostFromPool } from '../src/socket/util-handlers/manaPoolCostPayment.js';
import { parseKickerReturnCreature, takeKickerReturnCreatureAdditionalCost } from '../src/state/modules/kickerReturnCreatureCost.js';
import { collectAttackPermanentCosts, SELF_SACRIFICE_ATTACK_COST_RE } from '../src/socket/combat-handlers/attackCostPermanentPayment.js';
import { canPayLifeAmount, payLifeAmount } from '../src/state/modules/batch97PayLife.js';
import { parseCantPayLifeToCastOrActivateNonMana, playersCannotPayLifeToCastOrActivateNonMana } from '../src/state/modules/karnsSylexPayLifeRestriction.js';
import { canPlayerPayLife } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js';
import { getForetellActionGenericCost, parseFirstForetellCostsZero, recordForetellActionThisTurn } from '../src/state/modules/foretellFirstCostGrant.js';
import { abilityTextIsOnceEachTurn } from '../src/state/modules/equipOnceEachTurn.js';
import { listCraftGrantedActivatedAbilityLines } from '../src/state/modules/batch106CraftGrantedActivated.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';

const AGATHA = 'You may spend mana as though it were mana of any color to activate abilities of creatures you control.\nCreatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with Agatha\'s Soul Cauldron.';
const LOCUS = 'Locus of Enlightenment has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each turn.';
const MERFOLK = "Kicker—Return a creature you control to its owner's hand.\nIf Arctic Merfolk was kicked, it enters with a +1/+1 counter on it.";
const DRAGON = "Flying\nExalted Dragon can't attack unless you sacrifice a land.";
const SYLEX = "Karn's Sylex enters the battlefield tapped.\nPlayers can't pay life to cast spells or to activate abilities that aren't mana abilities.\n{X}, {T}, Exile Karn's Sylex: Destroy each nonland permanent with mana value X or less.";
const RANAR = 'Flying, vigilance\nThe first card you foretell each turn costs {0} to foretell.';
const LOCOMOTIVE = 'When this Vehicle becomes crewed, create two Treasure tokens and exile the top card of your library. Until the end of your next turn, you may play that card.\nCrew 3. Activate only once each turn.';

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    card: {
      id: `${id}-card`,
      name,
      oracle_text: oracle,
      type_line: extra.type_line || 'Creature',
      mana_cost: extra.mana_cost,
      power: extra.power ?? 2,
      toughness: extra.toughness ?? 2,
    },
    ...extra,
  };
}

function emptyPool() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

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

describe("B106 Agatha's Soul Cauldron mana spend-as-though payment hook", () => {
  const creature = perm('bear', 'p1', 'Bear', '{1}{U}: Draw a card.', { type_line: 'Creature — Bear' });
  const cauldron = perm('ag', 'p1', "Agatha's Soul Cauldron", AGATHA, { type_line: 'Legendary Artifact' });
  const state = {
    battlefield: [cauldron, creature],
    manaPool: { p1: { ...emptyPool(), red: 2 } },
  };

  it('lets a creature ability spend off-color mana when the Cauldron is out', () => {
    const pool = { ...emptyPool(), red: 2 };
    const parsed = { colors: { U: 1 }, generic: 1, hasX: false };
    expect(canPayManaCost(pool, parsed, 40, undefined, { state, playerId: 'p1', activatingCreatureAbility: true })).toBe(true);
    expect(canPayManaCost(pool, parsed, 40, undefined, { state, playerId: 'p1', activatingCreatureAbility: false })).toBe(false);
    expect(validateAbilityManaCostFromPool(state, 'p1', '{1}{U}', creature).ok).toBe(true);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parsed, 40, {
      restrictedSpendPurpose: { isCreature: true, isActivatedAbility: true },
    })).toBe(true);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parsed, 40, {
      restrictedSpendPurpose: { isCreature: true, isActivatedAbility: false },
    })).toBe(false);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parsed, 40)).toBe(false);
    const paid = payAbilityManaCostFromPool(state, 'p1', '{1}{U}', creature);
    expect(paid.ok).toBe(true);
    expect((state.manaPool.p1.red || 0) + (state.manaPool.p1.blue || 0) + (state.manaPool.p1.colorless || 0)).toBe(0);
  });

  it('does not let a non-creature pay off-color mana for its ability', () => {
    const rock = perm('sr', 'p1', 'Sol Ring', '{T}: Add {C}{C}.', { type_line: 'Artifact' });
    const local = { battlefield: [cauldron, rock], manaPool: { p1: { ...emptyPool(), red: 2 } } };
    expect(validateAbilityManaCostFromPool(local, 'p1', '{U}', rock).ok).toBe(false);
  });
});

describe('B106 Locus / Activate only once each turn on granted abilities', () => {
  it('appends the once-each-turn rider to craft-granted lines and recognizes it', () => {
    expect(abilityTextIsOnceEachTurn('{T}: Add {C}{C}. Activate only once each turn.')).toBe(true);
    expect(abilityTextIsOnceEachTurn('{T}: Add {C}{C}.')).toBe(false);
    const locus = perm('loc', 'p1', 'Locus of Enlightenment', LOCUS, {
      type_line: 'Artifact',
      craftedFromCards: [
        { id: 'ex1', name: 'Wizard Mentor', type_line: 'Creature', oracle_text: '{T}: Draw a card.' },
      ],
    });
    const lines = listCraftGrantedActivatedAbilityLines(locus, { battlefield: [locus] });
    expect(lines.some((line) => /draw a card/i.test(line) && /activate only once each turn/i.test(line))).toBe(true);
  });
});

describe('B106 Arctic Merfolk kicker return a creature', () => {
  it('parses the kicker and only queues the return cost when kicker is chosen', () => {
    expect(parseKickerReturnCreature(MERFOLK)).toBe(true);
    expect(takeKickerReturnCreatureAdditionalCost({ oracleText: MERFOLK })).toBeNull();
    expect(takeKickerReturnCreatureAdditionalCost({ oracleText: MERFOLK, alternateCostId: 'kicker' })).toEqual({
      type: 'return',
      amount: 1,
      filter: 'creature',
      kickerReturnCreature: true,
    });
  });
});

describe('B106 Exalted Dragon sacrifice a land to attack', () => {
  it('collects a sacrifice-land attack cost for the dragon', () => {
    expect(SELF_SACRIFICE_ATTACK_COST_RE.test(DRAGON.replace(/\u2019/g, "'"))).toBe(true);
    const dragon = perm('ed', 'p1', 'Exalted Dragon', DRAGON, { type_line: 'Creature — Dragon' });
    const forest = perm('f1', 'p1', 'Forest', '', { type_line: 'Basic Land — Forest' });
    const reqs = collectAttackPermanentCosts(
      { battlefield: [dragon, forest] },
      'p1',
      [{ creatureId: 'ed', targetPlayerId: 'p2' }],
    );
    expect(reqs.some((req) => req.kind === 'sacrifice' && req.permanentType === 'land' && req.attackerIds.includes('ed'))).toBe(true);
  });
});

describe("B106 Karn's Sylex pay-life restriction", () => {
  const sylexState = {
    battlefield: [perm('ks', 'p1', "Karn's Sylex", SYLEX, { type_line: 'Legendary Artifact' })],
    life: { p1: 40, p2: 40 },
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
  };

  it('parses the Sylex wording and does not apply a global canPlayerPayLife ban', () => {
    expect(parseCantPayLifeToCastOrActivateNonMana(SYLEX)).toBe(true);
    expect(playersCannotPayLifeToCastOrActivateNonMana(sylexState, 'p1')).toBe(true);
    expect(canPlayerPayLife(sylexState as any, 'p1')).toBe(true);
  });

  it('blocks payLifeAmount for spell or non-mana ability costs, but not other life payments', () => {
    expect(canPayLifeAmount(sylexState, 'p1', 3, { forSpellOrNonManaAbility: true })).toBe(false);
    const blocked = payLifeAmount(sylexState, 'p1', 3, { forSpellOrNonManaAbility: true });
    expect(blocked.paid).toBe(false);
    expect(sylexState.life.p1).toBe(40);

    expect(canPayLifeAmount(sylexState, 'p1', 2)).toBe(true);
    const shock = payLifeAmount(sylexState, 'p1', 2);
    expect(shock.paid).toBe(true);
    expect(sylexState.life.p1).toBe(38);

    expect(canPayLifeAmount(sylexState, 'p1', 1, { forSpellOrNonManaAbility: true, isManaAbility: true })).toBe(true);
  });
});

describe('B106 Ranar first foretell costs {0}', () => {
  it('makes only the first foretell action each turn free', () => {
    expect(parseFirstForetellCostsZero(RANAR)).toBe(true);
    const state: any = {
      turnNumber: 3,
      battlefield: [perm('ranar', 'p1', 'Ranar the Ever-Watchful', RANAR, { type_line: 'Legendary Creature — Spirit Warrior' })],
    };
    expect(getForetellActionGenericCost(state, 'p1')).toBe(0);
    expect(getForetellActionGenericCost(state, 'p2')).toBe(2);
    recordForetellActionThisTurn(state, 'p1');
    expect(getForetellActionGenericCost(state, 'p1')).toBe(2);
    state.turnNumber = 4;
    expect(getForetellActionGenericCost(state, 'p1')).toBe(0);
  });
});

describe("B106 live activation gates for Locus and Luxurious Locomotive", () => {
  const gameId = 'test_b106_payment_activation_hooks';

  async function resetGame() {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(); });
  afterEach(async () => { await resetGame(); });

  it('blocks a second activation of a once-each-turn granted-style ability the same turn', async () => {
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
    (game.state as any).manaPool = { [p1]: emptyPool() };
    (game.state as any).battlefield = [
      perm('loc', p1, 'Locus of Enlightenment', '{T}: Draw a card. Activate only once each turn.', { type_line: 'Artifact' }),
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'loc', abilityId: 'loc-0' });
    const firstError = emitted.find((entry) => entry.event === 'error');
    expect(firstError).toBeUndefined();

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'loc', abilityId: 'loc-0' });
    const blocked = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'ABILITY_ALREADY_USED');
    expect(blocked).toBeTruthy();
    expect(String(blocked?.payload?.message || '')).toMatch(/once each turn|already/i);
  });

  it("blocks a second Crew activation of Luxurious Locomotive the same turn while the first is pending", async () => {
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
      perm('loco', p1, 'Luxurious Locomotive', LOCOMOTIVE, { type_line: 'Artifact — Vehicle', power: 6, toughness: 5 }),
      perm('bear1', p1, 'Grizzly Bears', '', { type_line: 'Creature — Bear', power: 2, toughness: 2 }),
      perm('bear2', p1, 'Runeclaw Bear', '', { type_line: 'Creature — Bear', power: 2, toughness: 2 }),
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'loco', abilityId: 'loco-crew-0' });
    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    const crewStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.crewAbility === true);
    expect(crewStep).toBeDefined();

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'loco', abilityId: 'loco-crew-0' });
    const blocked = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'ABILITY_ALREADY_USED');
    expect(blocked).toBeTruthy();
  });

  it('queues a return-a-creature prompt when Arctic Merfolk is kicked', async () => {
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
    (game.state as any).manaPool = { [p1]: { ...emptyPool(), blue: 1, colorless: 1 } };
    (game.state as any).battlefield = [
      perm('bear', p1, 'Grizzly Bears', '', { type_line: 'Creature — Bear' }),
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [{
          id: 'merfolk_1',
          name: 'Arctic Merfolk',
          mana_cost: '{1}{U}',
          manaCost: '{1}{U}',
          type_line: 'Creature — Merfolk',
          oracle_text: MERFOLK,
        }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers.castSpellFromHand({
      gameId,
      cardId: 'merfolk_1',
      alternateCostId: 'kicker',
    });
    const returnStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      String(step?.costType || '') === 'return' || /return/i.test(String(step?.description || ''))
    );
    expect(emitted.find((entry) => entry.event === 'error'), JSON.stringify(emitted.filter((e) => e.event === 'error' || e.event === 'chat'))).toBeUndefined();
    expect(returnStep).toBeDefined();

    emitted.length = 0;
    await handlers.submitResolutionResponse({
      gameId,
      stepId: String((returnStep as any).id),
      selections: ['bear'],
    });
    expect(emitted.find((entry) => entry.event === 'error'), JSON.stringify(emitted.filter((e) => e.event === 'error'))).toBeUndefined();
    const zonesAfter = (game.state as any).zones[p1];
    expect((zonesAfter.hand || []).some((card: any) => String(card?.id || '') === 'bear' || String(card?.name || '') === 'Grizzly Bears')).toBe(true);
    expect(((game.state as any).battlefield || []).some((entry: any) => String(entry?.id || '') === 'bear')).toBe(false);
    const stackItem = ((game.state as any).stack || []).find((item: any) =>
      String(item?.card?.name || item?.name || '') === 'Arctic Merfolk'
    );
    expect(stackItem).toBeDefined();
    expect(Boolean(stackItem.wasKicked || stackItem.card?.wasKicked)).toBe(true);

    resolveTopOfStack(game as any);
    const merfolk = ((game.state as any).battlefield || []).find((entry: any) =>
      String(entry?.card?.name || entry?.name || '') === 'Arctic Merfolk'
    );
    expect(merfolk).toBeDefined();
    const plusCounters = Number(
      merfolk?.counters?.['+1/+1']
      ?? merfolk?.counters?.p1p1
      ?? merfolk?.card?.counters?.['+1/+1']
      ?? 0,
    );
    expect(plusCounters).toBeGreaterThanOrEqual(1);
  });

  it("blocks a non-mana Pay-N-life activation when Karn's Sylex is out, but still allows a mana ability", async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).phase = 'precombatMain';
    (game.state as any).stack = [];
    (game.state as any).manaPool = { [p1]: emptyPool() };
    (game.state as any).battlefield = [
      perm('sylex', p1, "Karn's Sylex", SYLEX, { type_line: 'Legendary Artifact' }),
      perm('drawer', p1, 'Life Drawer', 'Pay 2 life: Draw a card.', { type_line: 'Creature — Advisor' }),
      perm('well', p1, 'Life Well', '{T}, Pay 1 life: Add {C}.', { type_line: 'Artifact' }),
    ];
    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'drawer', abilityId: 'drawer-0' });
    const blocked = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'CANNOT_PAY_COST');
    expect(blocked).toBeTruthy();
    expect(String(blocked?.payload?.message || '')).toMatch(/can't pay life/i);
    expect(Number((game.state as any).life[p1])).toBe(40);

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'well', abilityId: 'well-0' });
    const manaError = emitted.find((entry) => entry.event === 'error' && /can't pay life/i.test(String(entry.payload?.message || '')));
    expect(manaError).toBeUndefined();
  });
});
