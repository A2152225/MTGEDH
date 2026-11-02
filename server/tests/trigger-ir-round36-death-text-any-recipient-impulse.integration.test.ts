import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { handleStepResponse } from '../src/socket/resolution-handlers/stepResponseHandlers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { getParsedAttacksUnblockedTriggers, queueParsedAttacksUnblockedTriggersOnce } from '../src/state/modules/triggers/combatBlockedIrTriggers.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { applyCreatureDamageFromSource } from '../src/state/modules/combat-damage-processing.js';
import { processDamageReceivedTriggers } from '../src/state/modules/triggers/damage-received.js';
import { applyDealCombatDamageTriggerQueue } from '../src/state/modules/turn-handlers/turnCombatDamageTriggerQueue.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
import { getTurnScopedSpellTriggerSources } from '../src/state/modules/triggers/turnScopedSpellTriggers.js';
const SPELLS: Record<string, [string, string, any[]?]> = {
  moon: ['Touch of Moonglove', 'Target creature you control gets +1/+0 and gains deathtouch until end of turn. Whenever a creature dealt damage by that creature dies this turn, its controller loses 2 life.', ['m1']],
  charge: ['Vigorous Charge', 'Kicker {W} (You may pay an additional {W} as you cast this spell.)\nTarget creature gains trample until end of turn. Whenever that creature deals combat damage this turn, if this spell was kicked, you gain life equal to that damage.', ['m1']],
  fury: ['Fire Giant\'s Fury', 'Target creature gets +2/+2 and gains trample until end of turn. Whenever it deals combat damage to a player this turn, exile that many cards from the top of your library. Until the end of your next turn, you may play those cards.', ['m1']],
  heist: ['Great Train Heist', 'Spree (Choose one or more additional costs.)\n+ {2} \u2014 Creatures you control get +1/+0 and gain first strike until end of turn.\n+ {R} \u2014 Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token.', ['p2']],
  blaze: ['Reckless Blaze', 'Reckless Blaze deals 5 damage to each creature. Whenever a creature you control dealt damage this way dies this turn, add {R}.'],
  ghired: ['Ghired\'s Belligerence', 'Ghired\'s Belligerence deals X damage divided as you choose among any number of target creatures. Whenever a creature dealt damage this way dies this turn, populate. (Create a token that\'s a copy of a creature token you control.)', []],
};
const bear = (id: string, controller: string) => ({ id, controller, owner: controller, tapped: false, card: { id: id + '_c', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });
const wall = (id: string, controller: string) => { const w: any = bear(id, controller); w.card.type_line = 'Creature - Wall'; w.card.toughness = '5'; return w; };
const texts = (g: any) => (g.state.turnScopedSpellTriggers || []).map((e: any) => e.card.oracle_text);
const perm = (g: any, id: string) => g.state.battlefield.find((p: any) => p.id === id);
const dmg = (p: any) => Number(p?.markedDamage || p?.damage || p?.damageMarked || 0);
function setup(gameId: string, key: string, battlefield: any[] = [], extra: any = {}, before?: (g: any) => void) {
  createGameIfNotExists(gameId, 'commander', 40);
  const g: any = ensureGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }, { id: 'p3', name: 'P3', life: 40 }];
  g.state.life = { p1: 40, p2: 40, p3: 40 };
  g.state.battlefield = battlefield;
  g.state.turnNumber = 7;
  g.state.activePlayer = 'p1';
  const zone = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 });
  g.state.zones = { p1: zone(), p2: zone(), p3: zone() };
  before?.(g);
  const [name, text, targets] = SPELLS[key];
  g.state.stack = [{ id: 'st_' + key, type: 'spell', controller: 'p1', card: { id: key, name, type_line: 'Instant', mana_cost: '{B}', cmc: 1, oracle_text: text }, targets: targets || [], ...extra }];
  resolveTopOfStack(g);
  g.state.stack = [];
  return g;
}

describe('round 36: turn-scoped death text, any-recipient combat damage, impulse rider, that player, damaged this way', () => {
  const prev = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });
  beforeEach(() => { process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY; else process.env.ORACLE_IR_TRIGGER_PRIMARY = prev; });
  const lib = (g: any, n: number) => { const cards = Array.from({ length: n }, (_, i) => ({ id: 'L' + i, name: 'Grizzly Bears', type_line: 'Creature - Bear' })); g.state.zones.p1.library = cards; g.state.zones.p1.libraryCount = n; if (g.libraries?.set) g.libraries.set('p1', cards.map((c: any) => ({ ...c }))); };
  const queue = (g: any, r: any) => applyDealCombatDamageTriggerQueue(g, g.state.battlefield, r);
  const drain = (g: any) => { for (let i = 0; i < 6 && g.state.stack.length; i += 1) resolveTopOfStack(g); };
  const fromSpell = (res: any[], key: string) => (res || []).filter((r: any) => String(r?.source?.permanentId || '').startsWith('turn-scoped:st_' + key));

  it('Touch of Moonglove: the death trigger effect has no leftover "this turn" prefix', () => {
    const g = setup('r36_moon', 'moon', [bear('m1', 'p1'), bear('o1', 'p2')]);
    applyCreatureDamageFromSource(g, perm(g, 'm1'), perm(g, 'o1'), 2);
    const res = getDeathTriggers(g, perm(g, 'o1'), 'p2');
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(String(res[0].effect)).toMatch(/^its controller loses 2 life/i);
  });

  it('Vigorous Charge (kicked): combat damage to a blocker gains life too (rule 510)', () => {
    const g = setup('r36_charge_c', 'charge', [bear('m1', 'p1')], { wasKicked: true });
    queue(g, { attackersThatDealtCreatureDamage: ['m1'], attackerDamageToCreatures: { m1: 3 } });
    drain(g);
    expect(g.state.life.p1).toBe(43);
  });

  it('Vigorous Charge (kicked): trample split fires once with the total', () => {
    const g = setup('r36_charge_t', 'charge', [bear('m1', 'p1')], { wasKicked: true });
    perm(g, 'm1').attacking = 'p2';
    queue(g, { attackersThatDealtDamage: { p2: ['m1'] }, attackerDamageToPlayers: { p2: { m1: 2 } }, attackersThatDealtCreatureDamage: ['m1'], attackerDamageToCreatures: { m1: 3 } });
    expect(g.state.stack.filter((s: any) => String(s.source || '').startsWith('turn-scoped:st_charge')).length).toBe(1);
    drain(g);
    expect(g.state.life.p1).toBe(45);
  });

  it('Fire Giant\'s Fury: exiles that many and grants play permission (not an optional trigger)', () => {
    const g = setup('r36_fury', 'fury', [bear('m1', 'p1')]);
    lib(g, 6); perm(g, 'm1').attacking = 'p2';
    queue(g, { attackersThatDealtDamage: { p2: ['m1'] }, attackerDamageToPlayers: { p2: { m1: 4 } } });
    expect(g.state.stack.some((s: any) => s.mandatory === true && /exile the top 4 cards/i.test(String(s.effect)))).toBe(true);
    drain(g);
    expect(g.state.zones.p1.library.length).toBe(2);
    expect(Object.keys(g.state.playableFromExile?.p1 || {}).length).toBe(4);
  });

  it('Great Train Heist: Treasure only for combat damage to the chosen opponent', () => {
    const g = setup('r36_heist', 'heist', [bear('m1', 'p1'), bear('m2', 'p1')]);
    const treasures = () => g.state.battlefield.filter((p: any) => /treasure/i.test(String(p?.card?.name || p?.card?.type_line || ''))).length;
    // Round 37: resolution no longer runs the delayed-trigger sentence.
    const base = treasures();
    expect(base).toBe(0);
    perm(g, 'm2').attacking = 'p3';
    queue(g, { attackersThatDealtDamage: { p3: ['m2'] }, attackerDamageToPlayers: { p3: { m2: 2 } } });
    drain(g);
    expect(treasures()).toBe(base);
    perm(g, 'm1').attacking = 'p2';
    queue(g, { attackersThatDealtDamage: { p2: ['m1'] }, attackerDamageToPlayers: { p2: { m1: 2 } } });
    drain(g);
    expect(treasures()).toBe(base + 1);
  });

  it('Reckless Blaze: only creatures you control that it damaged trigger', () => {
    const m1 = bear('m1', 'p1'); const o1 = bear('o1', 'p2');
    const g = setup('r36_blaze', 'blaze', [m1, o1]);
    expect(fromSpell(getDeathTriggers(g, m1, 'p1'), 'blaze').map((r: any) => String(r.effect))).toEqual([expect.stringMatching(/add \{R\}/i)]);
    expect(fromSpell(getDeathTriggers(g, o1, 'p2'), 'blaze')).toEqual([]);
  });

  it('Ghired\'s Belligerence: a creature it damaged dies -> populate; an undamaged one does not', () => {
    const g = setup('r36_ghired', 'ghired', [bear('o1', 'p2'), bear('o2', 'p2')]);
    perm(g, 'o1').markedDamage = 2; // damage dealt by the resolved spell (division prompt bypassed)
    expect(fromSpell(getDeathTriggers(g, perm(g, 'o1'), 'p2'), 'ghired').map((r: any) => String(r.effect))).toEqual([expect.stringMatching(/populate/i)]);
    expect(fromSpell(getDeathTriggers(g, perm(g, 'o2'), 'p2'), 'ghired')).toEqual([]);
  });
});
