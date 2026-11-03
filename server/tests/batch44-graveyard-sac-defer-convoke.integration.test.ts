import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { validateDeferredGraveyardCastCosts, commitDeferredGraveyardCastCosts } from '../src/socket/interaction-handlers/graveyardCastDeferredCosts.js';
import { templateConvokeGrantMatch } from '../src/state/modules/spellConvokeGrantTemplate.js';
import { getActiveConvokeGrantSources } from '../src/state/modules/casting-modifiers.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

type Ev = Array<{ event: string; payload: any }>;
const gameId = 'test_batch44_sac_defer';
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

describe('batch44 deferred graveyard-cast sacrifice and convoke template', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });
  afterEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });

  it('sacrifice-as-cost is only recorded at pick time and paid when the cast commits', async () => {
    const { s, emitted, handlers } = setup([dread, target], [bear('s1'), bear('s2'), bear('s3')], {});
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'dr_1', abilityId: 'flashback' });
    expect(JSON.stringify(emitted.filter(e => e.event === 'error'))).toBe('[]');
    const sacStep = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find(st => st.graveyardCastSacrificeAsCost === true);
    expect(sacStep).toBeTruthy();
    await handlers['submitResolutionResponse']({ gameId, stepId: String(sacStep.id), selections: ['s1', 's2', 's3'] });
    expect(JSON.stringify(emitted.filter(e => e.event === 'error'))).toBe('[]');
    const tStep = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find(st => st.graveyardSpellCastTargetSelection === true);
    expect(tStep).toBeTruthy();
    expect(tStep.sacrificedPermanentIdsForCost).toEqual(['s1', 's2', 's3']);
    // Pending window: nothing paid yet, so a cancel here strands nothing.
    expect(s.battlefield.map((p: any) => p.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(getEvents(gameId).some((e: any) => e.type === 'sacrificeSelectionResolve')).toBe(false);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(tStep.id), selections: ['tg_1'] });
    expect(JSON.stringify(emitted.filter(e => e.event === 'error'))).toBe('[]');
    expect(s.battlefield).toHaveLength(0);
    expect(s.stack).toHaveLength(1);
    const ev = [...getEvents(gameId)].reverse().find((e: any) => e.type === 'sacrificeSelectionResolve') as any;
    expect(ev.payload.permanentIds).toEqual(['s1', 's2', 's3']);
  });

  it('commit re-validates: a picked permanent that left play fails the cast without paying anything', () => {
    const errs: any[] = [];
    const game: any = { state: { battlefield: [bear('a'), bear('b')], zones: { p1: { hand: [], graveyard: [], exile: [] } } }, libraries: new Map(), bumpSeq() {} };
    const base = { game, gameId: 'g44', playerId: 'p1', cardId: 'x', emitError: (e: any) => errs.push(e) };
    expect(validateDeferredGraveyardCastCosts({ ...base, sacrificedPermanentIdsForCost: ['a', 'gone'] })).toBe(false);
    expect(commitDeferredGraveyardCastCosts({ ...base, sacrificedPermanentIdsForCost: ['a', 'gone'] })).toBe(false);
    expect(game.state.battlefield).toHaveLength(2);
    expect(validateDeferredGraveyardCastCosts({ ...base, sacrificedPermanentIdsForCost: ['a', 'a'] })).toBe(false);
    expect(commitDeferredGraveyardCastCosts({ ...base, sacrificedPermanentIdsForCost: ['a'] })).toBe(true);
    expect(game.state.battlefield.map((p: any) => p.id)).toEqual(['b']);
  });

  it('convoke grant template handles zone and type qualifiers', () => {
    const inst = { type_line: 'Instant', mana_cost: '{1}{R}' };
    const crit = { type_line: 'Creature \u2014 Elf', mana_cost: '{G}' };
    expect(templateConvokeGrantMatch('Spells you cast from exile have convoke.', inst, 'exile')).toBe(true);
    expect(templateConvokeGrantMatch('Spells you cast from exile have convoke.', inst, 'hand')).toBe(false);
    expect(templateConvokeGrantMatch('Noncreature spells you cast from exile have convoke.', crit, 'exile')).toBe(false);
    expect(templateConvokeGrantMatch('Noncreature spells you cast from exile have convoke.', inst, 'exile')).toBe(true);
    expect(templateConvokeGrantMatch('Instant and sorcery spells you cast have convoke.', inst, 'hand')).toBe(true);
    expect(templateConvokeGrantMatch('Instant and sorcery spells you cast have convoke.', crit, 'hand')).toBe(false);
    expect(templateConvokeGrantMatch('The first spell you cast each turn has convoke.', inst)).toBe(null);
    const st: any = { battlefield: [{ id: 'hb', controller: 'p1', card: { name: 'Hoarding Broodlord', type_line: 'Creature', oracle_text: 'Spells you cast from exile have convoke.' } }] };
    expect(getActiveConvokeGrantSources(st, 'p1' as any, inst, 'exile')).toContain('Hoarding Broodlord');
    expect(getActiveConvokeGrantSources(st, 'p1' as any, inst, 'hand')).not.toContain('Hoarding Broodlord');
  });

  it('census classifies the B44 convoke template', () => {
    for (const l of ['Spells you cast from exile have convoke.', 'Noncreature spells you cast from exile have convoke.']) {
      expect(classifyStaticCensusLine(l, 'X')?.system, l).toBeTruthy();
    }
  });
});
