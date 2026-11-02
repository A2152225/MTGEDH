import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { parseGraveyardKeywordCost } from '../src/state/modules/graveyardKeywordNonManaCost.js';
import { energyCostError, parseEnergyCost, payEnergyCost } from '../src/state/modules/equipNonManaCosts.js';
import { isAlternativeCostOptionPayable, parseAlternativeCostOptions } from '../src/state/modules/alternativeCostOptions.js';
import { altCostField } from '../src/socket/resolution-handlers/targetSelectionEquipAlternativeCost.js';

type Ev = Array<{ room?: string; event: string; payload: any }>;
const gameId = 'test_batch41_graveyard_keyword_costs';

function setup(graveyardCard: any, hand: any[], mana: Record<string, number>, energy = 0) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  const pid = 'p1';
  const s: any = game.state;
  s.players = [{ id: pid, name: 'P1', spectator: false, life: 40 }];
  s.zones = { [pid]: { hand, handCount: hand.length, library: [], libraryCount: 0, graveyard: [{ ...graveyardCard, zone: 'graveyard' }], graveyardCount: 1, exile: [], exileCount: 0 } };
  s.manaPool = { [pid]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...mana } };
  s.energy = { [pid]: energy };
  s.battlefield = []; s.turnPlayer = pid; s.priority = pid; s.phase = 'main'; s.step = 'MAIN1'; s.stack = [];
  const emitted: Ev = [];
  const io = { to: () => ({ emit: (event: string, payload: any) => emitted.push({ event, payload }) }), emit: (event: string, payload: any) => emitted.push({ event, payload }), sockets: { sockets: new Map() } } as any;
  const handlers: Record<string, Function> = {};
  const socket = { data: { playerId: pid, spectator: false, gameId }, rooms: new Set([gameId]), on: (e: string, h: Function) => { handlers[e] = h; }, emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any;
  registerInteractionHandlers(io, socket);
  return { game, s, pid, emitted, handlers };
}

const sunscourge = { id: 'sun_1', name: 'Sunscourge Champion', type_line: 'Creature — Human Wizard', mana_cost: '{2}{W}', power: '2', toughness: '3',
  oracle_text: 'When Sunscourge Champion enters the battlefield, you gain life equal to its power.\nEternalize—{2}{W}{W}, Discard a card. ({2}{W}{W}, Discard a card, Exile this card from your graveyard: Create a token that\'s a copy of it, except it\'s a 4/4 black Zombie Human Wizard with no mana cost. Eternalize only as a sorcery.)' };
const colossus = { id: 'col_1', name: 'Salvation Colossus', type_line: 'Artifact Creature — Construct', mana_cost: '{7}', power: '9', toughness: '9',
  oracle_text: 'Flying, trample\nWhenever you attack, other creatures you control get +2/+0 until end of turn.\nUnearth—Pay eight {E}. ({E} is an energy counter. Pay eight {E}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)' };

describe('batch41 graveyard keyword non-mana costs', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });
  afterEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });

  it('parses keyword costs with non-mana parts', () => {
    expect(parseGraveyardKeywordCost(sunscourge, 'eternalize')).toMatchObject({ manaCost: '{2}{W}{W}', discard: 1 });
    expect(parseGraveyardKeywordCost(colossus, 'unearth')).toMatchObject({ energy: 8 });
    expect(parseGraveyardKeywordCost({ oracle_text: 'Unearth {B}' }, 'unearth')).toBeNull();
    expect(parseEnergyCost('{E}{E}{E}')).toBe(3);
    expect(parseEnergyCost('Pay eight {E}')).toBe(8);
    expect(parseEnergyCost('{2}')).toBeNull();
  });

  it('eternalize with "Discard a card" pays mana, makes the token and queues a discard', async () => {
    const { s, pid, emitted, handlers } = setup(sunscourge, [{ id: 'h1', name: 'Island', type_line: 'Basic Land — Island' }], { white: 2, colorless: 2 });
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'sun_1', abilityId: 'eternalize' });
    expect(emitted.find(e => e.event === 'error')).toBeUndefined();
    expect(s.zones[pid].graveyard.length).toBe(0);
    expect(s.battlefield.some((p: any) => p.isToken)).toBe(true);
    const steps = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(steps.some(st => String(st.type).toLowerCase().includes('discard') && st.graveyardKeywordDiscardCost === 'eternalize')).toBe(true);
  });

  it('eternalize with an empty hand cannot be activated', async () => {
    const { s, pid, emitted, handlers } = setup(sunscourge, [], { white: 2, colorless: 2 });
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'sun_1', abilityId: 'eternalize' });
    expect(emitted.some(e => e.event === 'error')).toBe(true);
    expect(s.zones[pid].graveyard.length).toBe(1);
  });

  it('unearth "Pay eight {E}" spends energy instead of being free', async () => {
    const { s, pid, emitted, handlers } = setup(colossus, [], {}, 9);
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'col_1', abilityId: 'unearth' });
    expect(emitted.find(e => e.event === 'error')).toBeUndefined();
    expect(s.energy[pid]).toBe(1);
    expect(s.battlefield.some((p: any) => p.card?.name === 'Salvation Colossus')).toBe(true);
  });

  it('unearth "Pay eight {E}" is refused with too little energy', async () => {
    const { s, pid, emitted, handlers } = setup(colossus, [], {}, 3);
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'col_1', abilityId: 'unearth' });
    expect(emitted.some(e => e.event === 'error')).toBe(true);
    expect(s.energy[pid]).toBe(3);
    expect(s.zones[pid].graveyard.length).toBe(1);
  });

  it('reconfigure "Pay {2} or {E}{E}{E}" offers an energy alternative', () => {
    const opts = parseAlternativeCostOptions('{2} or {E}{E}{E}');
    expect(opts).toEqual(['{2}', '{E}{E}{E}']);
    const st: any = { energy: { p1: 3 }, battlefield: [], zones: { p1: { hand: [] } } };
    expect(isAlternativeCostOptionPayable(st, 'p1', '{E}{E}{E}', [], () => false)).toBe(true);
    st.energy.p1 = 2;
    expect(isAlternativeCostOptionPayable(st, 'p1', '{E}{E}{E}', [], () => false)).toBe(false);
    expect(energyCostError(st, 'p1', '{E}{E}{E}')).toBeTruthy();
    st.energy.p1 = 4;
    expect(payEnergyCost(st, 'p1', '{E}{E}{E}')).toBe(true);
    expect(st.energy.p1).toBe(1);
    expect(altCostField({ abilityType: 'reconfigure_attach' })).toBe('reconfigureCost');
    expect(altCostField({ abilityType: 'fortify' })).toBe('fortifyCost');
    expect(altCostField({ abilityType: 'equip' })).toBe('equipCost');
  });
});
