import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { handleBeamMeUpReturnCostSelection } from '../src/socket/resolution-handlers/targetSelectionGraveyardBeamMeUpHandler.js';
import { commitBeamMeUpReturnCost } from '../src/socket/interaction-handlers/interactionGraveyardCastBeamMeUp.js';
import { isLegendRuleExempt } from '../src/state/modules/legendRuleExemptions.js';
import { applyStateBasedActions } from '../src/rules-engine/index.js';
import { detectDoesntUntapEffects } from '../src/state/modules/triggers/turn-phases.js';
import { permanentUntapsOnOtherPlayersTurns } from '../src/state/modules/triggers/turn-phases-handlers/turnPhaseUntapStepEffects.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

type Ev = Array<{ event: string; payload: any }>;
const gameId = 'test_batch43_beam_defer';
const beamSorcery = { id: 'bm_1', name: 'Transporter Test', type_line: 'Sorcery', mana_cost: '{1}{U}', oracle_text: 'Draw two cards.\nBeam me up {2}{U}' };
const bear = (id: string, extra: any = {}) => ({ id, controller: 'p1', owner: 'p1', tapped: false, card: { id: id + '_c', name: 'Bear ' + id, type_line: 'Creature \u2014 Bear', oracle_text: '', ...extra } });
const legend = (id: string, controller = 'p1', extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name: 'Legend Guy', type_line: 'Legendary Creature \u2014 Sliver', oracle_text: '', power: '2', toughness: '2', ...extra } });
const src = (text: string, controller = 'p1') => ({ id: 'src_' + Math.random().toString(36).slice(2), controller, owner: controller, tapped: false, counters: {}, card: { name: 'Source', type_line: 'Artifact', oracle_text: text } });

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


describe('batch43 beam defer, legend-rule exemptions, untap families', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });
  afterEach(async () => { games.delete(gameId as any); await deleteGame(gameId); ResolutionQueueManager.removeQueue(gameId); });

  it('beam me up return is deferred until the cast commits; a cast still choosing targets leaves the creature in play', async () => {
    const targeted = { ...beamSorcery, oracle_text: 'Destroy target creature.\nBeam me up {2}{U}' };
    const { s, emitted, handlers, io, game } = setup([targeted], [bear('b1'), { ...bear('e1'), controller: 'p2', owner: 'p2' }], { blue: 1, colorless: 2 });
    await handlers['activateGraveyardAbility']({ gameId, cardId: 'bm_1', abilityId: 'beam-me-up' });
    expect(JSON.stringify(emitted.filter(e => e.event === 'error'))).toBe('[]');
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find(st => st.returnToHandForCost === true);
    expect(step).toBeTruthy();
    handleBeamMeUpReturnCostSelection(io, game, gameId, step, { playerId: 'p1', selections: ['b1'] } as any);
    expect(JSON.stringify(emitted.filter(e => e.event === 'error'))).toBe('[]');
    const pending = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find((x: any) => x !== step && x.returnToHandForCost !== true);
    expect(pending).toBeTruthy();
    expect(pending.beamedUpPermanentIdsForCost).toEqual(['b1']);
    expect(s.stack).toHaveLength(0);
    expect(s.battlefield.some((p: any) => p.id === 'b1')).toBe(true);
    expect(s.zones.p1.hand).toHaveLength(0);
    expect(s.zones.p1.graveyard).toHaveLength(1);
  });

  it('commitBeamMeUpReturnCost bounces only eligible creatures', () => {
    const errs: any[] = [];
    const game: any = { state: { battlefield: [bear('b1')], zones: { p1: { hand: [], graveyard: [], exile: [] } } }, libraries: new Map(), bumpSeq() {} };
    expect(commitBeamMeUpReturnCost(game, 'g', 'p1', ['zz'], (e) => errs.push(e))).toBe(false);
    expect(game.state.battlefield).toHaveLength(1);
    expect(commitBeamMeUpReturnCost(game, 'g', 'p1', undefined, (e) => errs.push(e))).toBe(true);
    expect(commitBeamMeUpReturnCost(game, 'g', 'p1', ['b1'], (e) => errs.push(e))).toBe(true);
    expect(game.state.battlefield).toHaveLength(0);
    expect(errs).toHaveLength(1);
  });

  it('legend rule exemptions by group', () => {
    const a = legend('l1'), b = legend('l2');
    expect(isLegendRuleExempt(a, [a, b])).toBe(false);
    expect(isLegendRuleExempt(a, [a, b, src('The "legend rule" doesn\'t apply to permanents you control.')])).toBe(true);
    expect(isLegendRuleExempt(a, [a, b, src('The \u201clegend rule\u201d doesn\'t apply to permanents you control.', 'p2')])).toBe(false);
    expect(isLegendRuleExempt(a, [a, b, src('The "legend rule" doesn\'t apply to Slivers you control.')])).toBe(true);
    expect(isLegendRuleExempt(a, [a, b, src('The "legend rule" doesn\'t apply to creature tokens you control.')])).toBe(false);
    const t: any = { ...a, isToken: true };
    expect(isLegendRuleExempt(t, [t, src('The "legend rule" doesn\'t apply to creature tokens you control.')])).toBe(true);
    expect(isLegendRuleExempt(a, [a, src('The "legend rule" doesn\'t apply.', 'p2')])).toBe(true);
  });

  it('SBA skips legend-rule violations for exempt legendaries', () => {
    const base: any = { players: [{ id: 'p1', life: 40 }], life: { p1: 40 }, zones: {}, stack: [] };
    expect(applyStateBasedActions({ ...base, battlefield: [legend('l1'), legend('l2')] } as any).legendRuleViolations).toHaveLength(2);
    expect(applyStateBasedActions({ ...base, battlefield: [legend('l1'), legend('l2'), src('The "legend rule" doesn\'t apply to permanents you control.')] } as any).legendRuleViolations || []).toHaveLength(0);
  });

  it('verifies the lands-don\'t-untap and creatures-untap-on-other-turns families', () => {
    const rising: any = src("Lands don't untap during their controllers' untap steps.");
    expect(detectDoesntUntapEffects(rising.card, rising).length).toBeGreaterThan(0);
    const muse: any = src("Untap all creatures you control during each other player's untap step.");
    const st: any = { battlefield: [muse, bear('b1'), { ...bear('b2'), controller: 'p2' }] };
    expect(permanentUntapsOnOtherPlayersTurns(st, st.battlefield[1])).toBe(true);
    expect(permanentUntapsOnOtherPlayersTurns(st, st.battlefield[2])).toBe(false);
  });

  it('census classifies the B43 families as owned elsewhere', () => {
    for (const l of ['The "legend rule" doesn\'t apply to permanents you control.', 'The "legend rule" doesn\'t apply to Slivers you control.',
      "Lands don't untap during their controllers' untap steps.", "Untap all creatures you control during each other player's untap step."]) {
      expect(classifyStaticCensusLine(l, 'X')?.system, l).toBeTruthy();
    }
  });
});
