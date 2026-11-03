import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { castSpell } from '../src/state/modules/stackCastSpellUtils.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { recordDilemmaFaced, getDilemmasFacedThisTurn } from '../src/state/modules/triggers/trekPlayerEventTriggers.js';
import '../src/state/modules/priority.js';

const noopIo = { to: () => ({ emit: () => {} }), emit: () => {} } as any;
const zone = () => ({ hand: [] as any[], handCount: 0, graveyard: [] as any[], graveyardCount: 0, exile: [], exileCount: 0, library: [] as any[], libraryCount: 0 });
const SEVEN = 'Whenever you face a dilemma, draw a card. (You face a dilemma as you choose one or more modes for a spell or ability.)';
const LORCA = 'Whenever you face a dilemma, you may pay {B}. If you do, return this card from your graveyard to your hand. (You face a dilemma as you choose one or more modes for a spell or ability.)';
const MODAL = 'Choose one \u2014\n\u2022 You gain 2 life.\n\u2022 You gain 5 life.';

describe('round 38: face a dilemma runtime', () => {
  const gameId = 'r38_dilemma';
  const reset = async () => { ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); await deleteGame(gameId); };
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo); });
  beforeEach(reset);
  afterEach(reset);
  const seed = () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game: any = ensureGame(gameId);
    game.gameId = gameId;
    Object.assign(game.state, { players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }], life: { p1: 40, p2: 40 }, dilemmasFacedThisTurn: {}, phase: 'main1', step: 'MAIN1', turnPlayer: 'p1', priority: 'p1', stack: [], battlefield: [], zones: { p1: zone(), p2: zone() }, manaPool: { p1: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 } } });
    game.libraries = new Map([['p1', [{ id: 'l1', name: 'Island', type_line: 'Basic Land' }]], ['p2', []]]);
    return game;
  };
  const respond = async (stepId: string, selections: any) => {
    const handlers: Record<string, Function> = {};
    const socket: any = { data: { playerId: 'p1', spectator: false }, rooms: new Set([gameId]), on: (e: string, h: Function) => { handlers[e] = h; }, emit: () => {} };
    const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
    registerResolutionHandlers(io, socket); registerInteractionHandlers(io, socket);
    await handlers.submitResolutionResponse({ gameId, stepId, selections });
  };

  const seven = () => ({ id: 'seven', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'seven_c', name: 'Seven of Nine', type_line: 'Legendary Creature', oracle_text: SEVEN } });
  const sevenTriggers = (game: any) => game.state.stack.filter((s: any) => s.type === 'triggered_ability' && s.sourceName === 'Seven of Nine').length;

  it('casting a modal spell faces a dilemma once and triggers Seven of Nine', () => {
    const game = seed();
    game.state.battlefield.push(seven());
    game.state.zones.p1.hand.push({ id: 'cmd', name: 'Test Command', type_line: 'Instant', mana_cost: '{1}', oracle_text: MODAL, selectedModes: ['mode_1'] });
    castSpell(game, 'p1' as any, 'cmd');
    expect(getDilemmasFacedThisTurn(game.state, 'p1')).toBe(1);
    expect(game.state.stack.map((s: any) => s.type)).toEqual(['spell', 'triggered_ability']);
    expect(sevenTriggers(game)).toBe(1);
  });

  it('activated ability with modes chosen on activation faces one dilemma per stack item', () => {
    const game = seed();
    game.state.battlefield.push(seven());
    const item: any = { id: 'abil1' };
    const r = tryApplyOracleIRToActivatedAbility(game, { controller: 'p1' as any, sourceName: 'Modal Rock', oracleText: MODAL, sourceItem: item, selectedModeIds: ['mode_2'] });
    expect(r.handled).toBe(true);
    expect(game.state.life.p1).toBe(45);
    expect(getDilemmasFacedThisTurn(game.state, 'p1')).toBe(1);
    tryApplyOracleIRToActivatedAbility(game, { controller: 'p1' as any, sourceName: 'Modal Rock', oracleText: MODAL, sourceItem: item, selectedModeIds: ['mode_2'] });
    expect(getDilemmasFacedThisTurn(game.state, 'p1')).toBe(1);
    expect(sevenTriggers(game)).toBe(1);
  });

  it('activated ability whose mode is chosen at resolution faces a dilemma when the mode prompt is answered', async () => {
    const game = seed();
    game.state.battlefield.push(seven());
    const r = tryApplyOracleIRToActivatedAbility(game, { controller: 'p1' as any, sourceName: 'Modal Rock', oracleText: MODAL, sourceItem: { id: 'abil2' } });
    expect(r.pendingOptional).toBe(true);
    expect(getDilemmasFacedThisTurn(game.state, 'p1')).toBe(0);
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[])[0];
    expect(step.type).toBe('mode_selection');
    await respond(step.id, [step.modes[0].id]);
    expect(game.state.life.p1).toBe(42);
    expect(getDilemmasFacedThisTurn(game.state, 'p1')).toBe(1);
    expect(sevenTriggers(game)).toBe(1);
  });

  it('Gabriel Lorca: dilemma trigger from the graveyard, pay {B}, returns to hand', async () => {
    const game = seed();
    game.state.zones.p1.graveyard.push({ id: 'lorca', owner: 'p1', name: 'Gabriel Lorca, Mirror Menace', type_line: 'Legendary Creature', oracle_text: LORCA });
    recordDilemmaFaced(game, 'p1', 1);
    expect(game.state.stack[0]?.sourceZone).toBe('graveyard');
    game.resolveTopOfStack();
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[])[0];
    expect(step?.optionalPaymentManaCost).toBe('{B}');
    await respond(step.id, ['pay_mana']);
    for (let i = 0; i < 3 && game.state.stack.length; i++) game.resolveTopOfStack();
    expect(game.state.manaPool.p1.black).toBe(0);
    expect(game.state.zones.p1.hand.map((c: any) => c.id)).toEqual(['lorca']);
    expect(game.state.zones.p1.graveyard).toHaveLength(0);
  });
});
