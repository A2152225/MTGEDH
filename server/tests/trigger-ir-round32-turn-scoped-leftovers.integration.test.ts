import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { getBlockTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { queueLifegainTriggers } from '../src/state/modules/triggers/lifegain.js';
import { detectManaModifiers } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeModifiers.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const SPELLS: Record<string, [string, string, any[]?]> = {
  cure: ['False Cure', 'Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life they gained.'],
  muck: ['Bubbling Muck', 'Until end of turn, whenever a player taps a Swamp for mana, that player adds an additional {B}.'],
  mho: ["Mage Hunters' Onslaught", 'Destroy target creature or planeswalker.\nWhenever a creature blocks this turn, its controller loses 1 life.', ['victim']],
  draught: ["Benefactor's Draught", 'Untap all creatures. Until end of turn, whenever a creature an opponent controls blocks, draw a card.\nDraw a card.'],
  tide: ['Molten Tide', 'Until end of turn, whenever you tap a Mountain for mana, add an additional {R}.'],
  nox: ['Noxious Assault', 'Creatures you control get +2/+2 until end of turn. Whenever a creature blocks this turn, its controller gets a poison counter.'],
};
const bear = (id: string, controller: string) => ({ id, controller, owner: controller, tapped: false, card: { id: id + '_c', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });

function setup(gameId: string, key: string, battlefield: any[] = []) {
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
  const [name, text, targets] = SPELLS[key];
  g.state.stack = [{ id: 'st_' + key, type: 'spell', controller: 'p1', card: { id: key, name, type_line: 'Instant', mana_cost: '{B}', cmc: 1, oracle_text: text }, targets: targets || [] }];
  resolveTopOfStack(g);
  g.state.stack = [];
  return g;
}

// Mirrors combatDeclareBlockersRequest: the stack item binds the blocking creature as the pronoun subject.
function pushBlockTrigger(g: any, t: any) {
  const blockingCreatureId = String(t.value?.blockingCreatureId || '');
  g.state.stack.push({
    id: 'tr_' + t.permanentId, type: 'triggered_ability', controller: t.controllerId, source: t.permanentId,
    permanentId: t.permanentId, sourceName: t.cardName, description: t.description, triggerType: 'blocks',
    mandatory: true, value: t.value,
    ...(blockingCreatureId && blockingCreatureId !== t.permanentId ? { interveningIfSubjectPermanentId: blockingCreatureId } : {}),
  });
}

describe('round 32 turn-scoped leftovers: False Cure, Bubbling Muck, block watchers', () => {
  const prev = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });
  beforeEach(() => { process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY; else process.env.ORACLE_IR_TRIGGER_PRIMARY = prev; });

  it('False Cure: the player who gained life loses 2 per 1 gained (not the caster)', () => {
    const g = setup('r32_cure', 'cure');
    g.state.life.p2 = 43; g.state.players[1].life = 43;
    expect(queueLifegainTriggers(g, 'p2', 3).length).toBe(1);
    g.resolveTopOfStack();
    expect(g.state.life.p2).toBe(37);
    expect(g.state.life.p1).toBe(40);
    expect(g.state.life.p3).toBe(40);
  });

  it('Bubbling Muck: Swamps of every player get an extra {B} this turn only', () => {
    const g = setup('r32_muck', 'muck');
    const mods = detectManaModifiers(g.state, 'p2').filter((m: any) => /bubbling muck/i.test(String(m.cardName)));
    expect(mods.length).toBe(1);
    expect(mods[0]).toEqual(expect.objectContaining({ landTypeRequired: 'swamp', affectsAllPlayers: true, extraMana: { colors: ['B'], amount: 1 } }));
    g.state.turnNumber = 8;
    expect(detectManaModifiers(g.state, 'p2').some((m: any) => /bubbling muck/i.test(String(m.cardName)))).toBe(false);
  });

  it("Mage Hunters' Onslaught: each blocking creature's controller loses 1 life", () => {
    const b = bear('b1', 'p2'); (b as any).blocking = ['a1'];
    const g = setup('r32_mho', 'mho', [bear('a1', 'p1'), b, bear('victim', 'p3')]);
    const trig = getBlockTriggersForCreatures(g, [b], 'p2').filter((t: any) => String(t.permanentId).startsWith('turn-scoped:'));
    expect(trig.length).toBe(1);
    pushBlockTrigger(g, trig[0]);
    g.resolveTopOfStack();
    expect(g.state.life.p2).toBe(39);
    expect(g.state.life.p1).toBe(40);
    expect(g.state.battlefield.some((p: any) => p.id === 'victim')).toBe(false);
  });

  it("Noxious Assault: each blocking creature's controller gets a poison counter", () => {
    const b = bear('b1', 'p2'); (b as any).blocking = ['a1'];
    const g = setup('r32_nox', 'nox', [bear('a1', 'p1'), b]);
    const trig = getBlockTriggersForCreatures(g, [b], 'p2').filter((t: any) => String(t.permanentId).startsWith('turn-scoped:'));
    expect(trig.length).toBe(1);
    pushBlockTrigger(g, trig[0]);
    g.resolveTopOfStack();
    const poison = (who: string) => Number(g.state.poisonCounters?.[who] ?? g.state.players.find((p: any) => p.id === who)?.poisonCounters ?? 0);
    expect(poison('p2')).toBe(1);
    expect(poison('p1')).toBe(0);
  });

  it("Benefactor's Draught: only an opponent's blocking creature draws the caster a card", () => {
    const b = bear('b1', 'p2'); (b as any).blocking = ['a1'];
    const own = bear('b0', 'p1'); (own as any).blocking = ['a1'];
    const g = setup('r32_draught', 'draught', [bear('a1', 'p3'), b, own]);
    const lib = [{ id: 'l1', name: 'A' }, { id: 'l2', name: 'B' }, { id: 'l3', name: 'C' }];
    g.libraries.set('p1', lib.map((c) => ({ ...c, zone: 'library' })));
    g.state.zones.p1.libraryCount = 3;
    const handBefore = g.state.zones.p1.hand.length;
    expect(getBlockTriggersForCreatures(g, [own], 'p1').filter((t: any) => String(t.permanentId).startsWith('turn-scoped:')).length).toBe(0);
    const trig = getBlockTriggersForCreatures(g, [b], 'p2').filter((t: any) => String(t.permanentId).startsWith('turn-scoped:'));
    expect(trig.length).toBe(1);
    pushBlockTrigger(g, trig[0]);
    g.resolveTopOfStack();
    expect(g.state.zones.p1.hand.length).toBe(handBefore + 1);
    expect(g.state.zones.p2.hand.length).toBe(0);
    expect(g.libraries.get('p1').length).toBe(2);
  });

  it('Molten Tide: only the caster\'s Mountains add an extra {R} (generic oracle land-tap bonus)', () => {
    const g = setup('r32_tide', 'tide');
    const mods = (p: string) => detectManaModifiers(g.state, p).filter((m: any) => /molten tide/i.test(String(m.cardName)));
    expect(mods('p1')).toEqual([expect.objectContaining({ landTypeRequired: 'mountain', extraMana: { colors: ['R'], amount: 1 } })]);
    expect(mods('p2')).toEqual([]);
    g.state.turnNumber = 8;
    expect(mods('p1')).toEqual([]);
  });
});
