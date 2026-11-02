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
  song: ['Song of Blood', 'Mill four cards. Whenever a creature attacks this turn, it gets +1/+0 until end of turn for each creature card put into your graveyard this way.'],
  hunter: ['Hunter\'s Insight', 'Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.', ['m1']],
  fury: ['Fire Giant\'s Fury', 'Target creature gets +2/+2 and gains trample until end of turn. Whenever it deals combat damage to a player this turn, exile that many cards from the top of your library. Until the end of your next turn, you may play those cards.', ['m1']],
  charge: ['Vigorous Charge', 'Kicker {W} (You may pay an additional {W} as you cast this spell.)\nTarget creature gains trample until end of turn. Whenever that creature deals combat damage this turn, if this spell was kicked, you gain life equal to that damage.', ['m1']],
  forth: ['Forth Eorlingas!', 'Create X 2/2 red Human Knight creature tokens with trample and haste.\nWhenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch.'],
  moon: ['Touch of Moonglove', 'Target creature you control gets +1/+0 and gains deathtouch until end of turn. Whenever a creature dealt damage by that creature dies this turn, its controller loses 2 life.', ['m1']],
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

describe('round 35: this-way counts and "that creature" combat watchers', () => {
  const prev = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });
  beforeEach(() => { process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY; else process.env.ORACLE_IR_TRIGGER_PRIMARY = prev; });

  const withLibState = (g: any, n: number) => { const cards = Array.from({ length: n }, (_, i) => ({ id: 'L' + i, name: i % 2 ? 'Forest' : 'Grizzly Bears', type_line: i % 2 ? 'Basic Land - Forest' : 'Creature - Bear' })); g.state.zones.p1.library = cards; g.state.zones.p1.libraryCount = n; if (g.libraries?.set) g.libraries.set('p1', cards.map((c: any) => ({ ...c }))); };
  const hit = (g: any, id: string, n: number) => applyDealCombatDamageTriggerQueue(g, g.state.battlefield, { attackersThatDealtDamage: { p2: [id] }, attackerDamageToPlayers: { p2: { [id]: n } } } as any);
  const drain = (g: any) => { for (let i = 0; i < 6 && g.state.stack.length; i += 1) resolveTopOfStack(g); };
  const withLib = (g: any, n: number) => withLibState(g, n);

  it('Song of Blood: the attack bonus scales with creature cards milled this way', () => {
    const g = setup('r35_song', 'song', [bear('m1', 'p1')], {}, (gg: any) => { withLibState(gg, 6); gg.state.zones.p1.graveyard = [{ id: 'old', type_line: 'Creature - Elf' }]; });
    const src = getTurnScopedSpellTriggerSources(g.state);
    expect(src.map((s: any) => s.card.oracle_text)).toEqual(['Whenever a creature attacks, it gets +2/+0 until end of turn.']);
  });

  it('Hunter\'s Insight: draws as many cards as the chosen creature dealt', () => {
    const g = setup('r35_hunter', 'hunter', [bear('m1', 'p1')]);
    withLib(g, 6); perm(g, 'm1').attacking = 'p2';
    hit(g, 'm1', 3);
    drain(g);
    expect(g.state.zones.p1.hand.length).toBe(3);
  });

  it('Fire Giant\'s Fury: exiles that many cards', () => {
    const g = setup('r35_fury', 'fury', [bear('m1', 'p1')]);
    withLib(g, 6); perm(g, 'm1').attacking = 'p2';
    hit(g, 'm1', 4);
    drain(g);
    expect(g.state.zones.p1.library.length).toBe(2);
  });

  it('Vigorous Charge: kicked gains life equal to the damage; unkicked does nothing', () => {
    const g = setup('r35_charge', 'charge', [bear('m1', 'p1')], { wasKicked: true });
    perm(g, 'm1').attacking = 'p2';
    hit(g, 'm1', 2);
    drain(g);
    expect(g.state.life.p1).toBe(42);
    const u = setup('r35_charge_u', 'charge', [bear('m1', 'p1')]);
    perm(u, 'm1').attacking = 'p2';
    hit(u, 'm1', 2);
    drain(u);
    expect(u.state.life.p1).toBe(40);
  });

  it('Forth Eorlingas!: combat damage to a player makes you the monarch', () => {
    const g = setup('r35_forth', 'forth', [bear('m1', 'p1')], { xValue: 0 });
    perm(g, 'm1').attacking = 'p2';
    hit(g, 'm1', 2);
    drain(g);
    expect(g.state.monarch).toBe('p1');
  });

  it('Touch of Moonglove: a creature dealt damage by the chosen creature dies, its controller loses 2', () => {
    const g = setup('r35_moon', 'moon', [bear('m1', 'p1'), bear('o1', 'p2')]);
    applyCreatureDamageFromSource(g, perm(g, 'm1'), perm(g, 'o1'), 2);
    const res = getDeathTriggers(g, perm(g, 'o1'), 'p2');
    expect(Array.isArray(res) ? res.length : 0).toBeGreaterThanOrEqual(1);
    expect(res[0]?.source?.permanentId).toBe('m1');
    expect(String(res[0]?.effect || '')).toMatch(/loses 2 life/i);
  });
});
