import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getBeamMeUpInfo, getCastFromGraveyardActivationCost, getEligibleCreaturesForBeamMeUp } from '../src/socket/interaction-handlers/interactionGraveyardCastCostAndTimingRules.js';
import { handleBeamMeUpReturnCostSelection } from '../src/socket/resolution-handlers/targetSelectionGraveyardBeamMeUpHandler.js';
import { applyRecordedBeamUpReturnCost, applyRecordedGraveyardKeywordNonManaCost } from '../src/state/modules/apply-event-handlers/applyEventGraveyardCastCostReplay.js';
import { getGrantedReplicateManaCost, readReplicateManaCost, stampGrantedReplicateCost } from '../src/state/modules/replicateCastUtils.js';
import { findRevealUntilKindDrawSource } from '../src/state/modules/zones-handlers/zonesDrawReplacementRevealUntilKind.js';

type Ev = Array<{ event: string; payload: any }>;
const gameId = 'test_batch42_beam_me_up';
const beamSorcery = { id: 'bm_1', name: 'Transporter Test', type_line: 'Sorcery', mana_cost: '{1}{U}', oracle_text: 'Draw two cards.\nBeam me up {2}{U} (You may cast this card from your graveyard by paying {2}{U} and returning a creature you control to its owner\'s hand rather than paying its mana cost. If you do, exile it as it resolves.)' };
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
  return { game, s, emitted, handlers, io };
}

describe('batch42 beam me up + trek statics', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });
  afterEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });

  it('reads printed beam me up cost and Scotty main-phase grant', () => {
    expect(getBeamMeUpInfo(beamSorcery)).toMatchObject({ hasIt: true, cost: '{2}{U}' });
    const st: any = { turnPlayer: 'p1', phase: 'main', step: 'MAIN1', battlefield: [{ id: 'scotty', controller: 'p1', card: { name: 'Scotty', type_line: 'Legendary Creature', oracle_text: 'During your main phase, instant and sorcery cards in your graveyard have beam me up. Scotty can\'t be beamed up.' } }] };
    const bolt = { name: 'Shock', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Shock deals 2 damage to any target.' };
    expect(getBeamMeUpInfo(bolt, { game: { state: st }, playerId: 'p1' })).toMatchObject({ hasIt: true, cost: '{R}' });
    expect(getBeamMeUpInfo(bolt, { game: { state: { ...st, phase: 'combat', step: 'DECLARE_ATTACKERS' } }, playerId: 'p1' }).hasIt).toBe(false);
    expect(getBeamMeUpInfo({ ...bolt, type_line: 'Creature' }, { game: { state: st }, playerId: 'p1' }).hasIt).toBe(false);
    expect(getCastFromGraveyardActivationCost(bolt, 'beam-me-up', { game: { state: st }, playerId: 'p1' })).toMatchObject({ hasAbility: true, manaCost: '{R}' });
    st.battlefield[0].card.type_line = 'Legendary Creature \u2014 Human';
    expect(getEligibleCreaturesForBeamMeUp(st, 'p1')).toHaveLength(0);
  });

  it('marooned creatures cannot be beamed up', () => {
    const st: any = { battlefield: [bear('b1'), bear('b2'), { id: 'aura', controller: 'p2', attachedTo: 'b2', card: { name: 'Marooned', type_line: 'Enchantment \u2014 Aura', oracle_text: 'Enchant creature\nEnchanted creature can\'t attack or block and can\'t be beamed up.' } }] };
    expect(getEligibleCreaturesForBeamMeUp(st, 'p1').map((p: any) => p.id)).toEqual(['b1']);
  });

  it('casts from graveyard by returning a creature, exiles on resolution, records the bounce', async () => {
    const { s, emitted, handlers, io, game } = setup([beamSorcery], [bear('b1')], { blue: 1, colorless: 2 });
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'bm_1', abilityId: 'beam-me-up' });
    expect(emitted.find(e => e.event === 'error')).toBeUndefined();
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find(st => st.returnToHandForCost === true);
    expect(step).toBeTruthy();
    expect(step.validTargets.map((t: any) => t.id)).toEqual(['b1']);
    handleBeamMeUpReturnCostSelection(io, game, gameId, step, { playerId: 'p1', selections: ['b1'] } as any);
    expect(emitted.find(e => e.event === 'error')).toBeUndefined();
    expect(s.battlefield.some((p: any) => p.id === 'b1')).toBe(false);
    expect(s.zones.p1.hand.some((c: any) => String(c.name || '').includes('Bear'))).toBe(true);
    expect(s.zones.p1.graveyard).toHaveLength(0);
    const item = s.stack.find((it: any) => it.card?.name === 'Transporter Test');
    expect(item).toBeTruthy();
    expect(item.exileAfterResolution).toBe(true);
  });

  it('refuses beam me up without a creature to return', async () => {
    const { s, emitted, handlers } = setup([beamSorcery], [], { blue: 1, colorless: 2 });
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'bm_1', abilityId: 'beam-me-up' });
    expect(emitted.some(e => e.event === 'error')).toBe(true);
    expect(s.zones.p1.graveyard).toHaveLength(1);
  });

  it('replay helpers pay recorded energy/life and bounce recorded creatures', () => {
    const state: any = { energy: { p1: 9 }, life: { p1: 20 }, battlefield: [bear('b1')], zones: { p1: { hand: [], graveyard: [], exile: [] } } };
    const ctx: any = { state, libraries: new Map(), bumpSeq() {} };
    applyRecordedGraveyardKeywordNonManaCost(ctx, 'p1', 'Pay eight {E}');
    expect(state.energy.p1).toBe(1);
    applyRecordedGraveyardKeywordNonManaCost(ctx, 'p1', '{2}{B}, Pay 3 life');
    expect(state.life.p1).toBe(17);
    applyRecordedBeamUpReturnCost(ctx, ['b1', 'missing']);
    expect(state.battlefield).toHaveLength(0);
  });

  it('Hugh-style "X spells you cast have replicate {c}" is stamped on the cast card', () => {
    const st: any = { battlefield: [{ id: 'hugh', controller: 'p1', card: { name: 'Hugh', type_line: 'Creature', oracle_text: 'Instant and sorcery spells you cast have replicate {1}.' } }] };
    const spell: any = { name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.' };
    expect(getGrantedReplicateManaCost(st, 'p1' as any, spell)).toBe('{1}');
    expect(getGrantedReplicateManaCost(st, 'p1' as any, { name: 'Bear', type_line: 'Creature', oracle_text: '' })).toBeNull();
    stampGrantedReplicateCost(st, 'p1' as any, [spell]);
    expect(readReplicateManaCost(spell)).toBe('{1}');
  });

  it('finds Chekov/Abundance-style reveal-until-kind draw replacements', () => {
    const st: any = { battlefield: [{ id: 'ab', controller: 'p1', card: { name: 'Abundance', type_line: 'Enchantment', oracle_text: 'If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order.' } }] };
    expect(findRevealUntilKindDrawSource(st, 'p1')).toMatchObject({ sourceId: 'ab' });
    expect(findRevealUntilKindDrawSource(st, 'p2')).toBeNull();
  });
});
