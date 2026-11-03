import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

type Ev = Array<{ event: string; payload: any }>;
const gameId = 'test_batch45_cost_order';
const dread = { id: 'dr_1', name: 'Dread Test', type_line: 'Sorcery', mana_cost: '{2}{B}{B}', oracle_text: 'Return target creature card from your graveyard to the battlefield.\nFlashback\u2014Sacrifice three creatures.' };
const target = { id: 'tg_1', name: 'Target Guy', type_line: 'Creature \u2014 Ogre', oracle_text: '' };
const bear = (id: string, extra: any = {}) => ({ id, controller: 'p1', owner: 'p1', tapped: false, card: { id: id + '_c', name: 'Bear ' + id, type_line: 'Creature \u2014 Bear', oracle_text: '', ...extra } });

function setup(gy: any[], battlefield: any[], mana: Record<string, number>) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  const s: any = game.state;
  s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
  s.zones = { p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: gy.map(c => ({ ...c, zone: 'graveyard' })), graveyardCount: gy.length, exile: [], exileCount: 0 } };
  s.manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...mana } };
  s.battlefield = battlefield; s.turnPlayer = 'p1'; s.priority = 'p1'; s.phase = 'main'; s.step = 'MAIN1'; s.stack = [];
  const emitted: Ev = [];
  const io = { to: () => ({ emit: (event: string, payload: any) => emitted.push({ event, payload }) }), emit: (event: string, payload: any) => emitted.push({ event, payload }), sockets: { sockets: new Map() } } as any;
  const handlers: Record<string, Function> = {};
  const socket = { data: { playerId: 'p1', spectator: false, gameId }, rooms: new Set([gameId]), on: (e: string, h: Function) => { handlers[e] = h; }, emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any;
  registerInteractionHandlers(io, socket);
  registerResolutionHandlers(io, socket);
  return { game, s, emitted, handlers, io };
}

const escapeCard = { id: 'es_1', name: 'Escape Test', type_line: 'Sorcery', mana_cost: '{G}', oracle_text: 'Return target creature card from your graveyard to your hand.\nEscape {G}, Exile two other cards from your graveyard.' };
const retraceCard = { id: 'rt_1', name: 'Retrace Test', type_line: 'Sorcery', mana_cost: '{R}', oracle_text: 'Retrace Test deals 1 damage to any target.\nRetrace' };
const filler = (id: string) => ({ id, name: 'Filler ' + id, type_line: 'Instant', oracle_text: '' });
const steps = () => ResolutionQueueManager.getQueue(gameId).steps as any[];
const errs = (emitted: Ev) => JSON.stringify(emitted.filter(e => e.event === 'error'));

describe('batch45 graveyard-cast discard/exile costs are picked after targets (CR 601.2h)', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });
  afterEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });

  it('escape: target step comes first, exile picker follows and excludes the chosen target', async () => {
    const { s, emitted, handlers } = setup([escapeCard, target, filler('f1'), filler('f2')], [], { green: 1 });
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'es_1', abilityId: 'escape' });
    expect(errs(emitted)).toBe('[]');
    expect(steps().some(st => st.graveyardCastExileAsCost === true)).toBe(false);
    const tStep = steps().find(st => st.graveyardSpellCastTargetSelection === true);
    expect(tStep).toBeTruthy();
    expect(s.zones.p1.graveyard).toHaveLength(4);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(tStep.id), selections: ['tg_1'] });
    const xStep = steps().find(st => st.graveyardCastExileAsCost === true);
    expect(xStep).toBeTruthy();
    expect(xStep.validTargets.map((c: any) => c.id).sort()).toEqual(['f1', 'f2']);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(xStep.id), selections: ['f1', 'f2'] });
    expect(errs(emitted)).toBe('[]');
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0].targets).toEqual(['tg_1']);
    expect(s.zones.p1.exile.map((c: any) => c.id).sort()).toEqual(['f1', 'f2']);
  });

  it('retrace: discard picker is queued only after the target is chosen', async () => {
    const { s, emitted, handlers } = setup([retraceCard], [bear('b1')], { red: 1 });
    s.zones.p1.hand = [{ id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '', zone: 'hand' }]; s.zones.p1.handCount = 1;
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'rt_1', abilityId: 'retrace' });
    expect(errs(emitted)).toBe('[]');
    expect(steps().some(st => st.graveyardCastDiscardAsCost === true)).toBe(false);
    const tStep = steps().find(st => st.graveyardSpellCastTargetSelection === true);
    expect(tStep).toBeTruthy();
    await handlers['submitResolutionResponse']({ gameId, stepId: String(tStep.id), selections: ['b1'] });
    const dStep = steps().find(st => st.graveyardCastDiscardAsCost === true);
    expect(dStep).toBeTruthy();
    expect(dStep.targetsForCast).toEqual(['b1']);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(dStep.id), selections: ['land_1'] });
    expect(errs(emitted)).toBe('[]');
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0].targets).toEqual(['b1']);
    expect(s.zones.p1.hand).toHaveLength(0);
  });

  it('cancelling at the target step leaves hand and graveyard untouched', async () => {
    const { s, handlers } = setup([escapeCard, target, filler('f1'), filler('f2')], [], { green: 1 });
    s.zones.p1.hand = [filler('h1')]; s.zones.p1.handCount = 1;
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'es_1', abilityId: 'escape' });
    const tStep = steps().find(st => st.graveyardSpellCastTargetSelection === true);
    expect(tStep).toBeTruthy();
    await handlers['cancelResolutionStep']?.({ gameId, stepId: String(tStep.id) });
    ResolutionQueueManager.removeQueue(gameId);
    expect(s.zones.p1.graveyard.map((c: any) => c.id).sort()).toEqual(['es_1', 'f1', 'f2', 'tg_1']);
    expect(s.zones.p1.exile).toHaveLength(0);
    expect(s.zones.p1.hand.map((c: any) => c.id)).toEqual(['h1']);
    expect(s.stack).toHaveLength(0);
  });
});
