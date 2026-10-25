import { describe, it, expect } from 'vitest';
import { getBlockedTriggersForCreatures, getBlockTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getParsedAttacksUnblockedTriggers } from '../src/state/modules/triggers/combatBlockedIrTriggers.js';

function perm(id: string, controller: string, card: any, extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name: id, ...card }, ...extra };
}
const bear = (id: string, controller: string, extra: any = {}, type = 'Creature - Bear') =>
  perm(id, controller, { type_line: type, power: '2', toughness: '2', oracle_text: '' }, extra);

function ctxFor(battlefield: any[]) {
  const state: any = { seq: 1, stack: [], battlefield, turnPlayer: 'p1', activePlayer: 'p1', phase: 'combat', step: 'DECLARE_BLOCKERS',
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    zones: { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } } };
  return { state, bumpSeq() { state.seq++; } } as any;
}

describe('IR becomes_blocked / attacks_unblocked / blockPartner emitters', () => {
  it('"a creature you control becomes blocked" fires once per blocked attacker you control', () => {
    const watcher = perm('Watcher', 'p1', { type_line: 'Enchantment', oracle_text: 'Whenever a creature you control becomes blocked, it gets +1/+1 until end of turn.' });
    const a1 = bear('A1', 'p1', { attacking: 'p2', blockedBy: ['B1', 'B2'] });
    const b1 = bear('B1', 'p2', { blocking: ['A1'] });
    const b2 = bear('B2', 'p2', { blocking: ['A1'] });
    const foe = bear('F1', 'p2', { attacking: 'p1', blockedBy: ['X'] });
    const ctx = ctxFor([watcher, a1, b1, b2, foe]);
    const out = getBlockedTriggersForCreatures(ctx, [a1, foe], 'p2').filter((t) => t.permanentId === 'Watcher');
    expect(out).toHaveLength(1);
    expect(out[0].value.blockedCreatureId).toBe('A1');
  });

  it('enchanted creature becomes blocked triggers for the aura only', () => {
    const aura = perm('Aura', 'p1', { type_line: 'Enchantment - Aura', oracle_text: 'Enchant creature\nWhenever enchanted creature becomes blocked, it gets +2/+0 until end of turn.' }, { attachedTo: 'A1' });
    const a1 = bear('A1', 'p1', { attacking: 'p2', blockedBy: ['B1'] });
    const a2 = bear('A2', 'p1', { attacking: 'p2', blockedBy: ['B2'] });
    const ctx = ctxFor([aura, a1, a2, bear('B1', 'p2', { blocking: ['A1'] }), bear('B2', 'p2', { blocking: ['A2'] })]);
    const out = getBlockedTriggersForCreatures(ctx, [a1, a2], 'p2').filter((t) => t.permanentId === 'Aura');
    expect(out).toHaveLength(1);
    expect(out[0].value.blockedCreatureId).toBe('A1');
  });

  it('"becomes blocked by an artifact creature" fires once per matching blocker only', () => {
    const a1 = perm('Hunter', 'p1', { type_line: 'Creature - Human', power: '2', toughness: '2', oracle_text: 'Whenever this creature becomes blocked by an artifact creature, destroy that creature.' }, { attacking: 'p2', blockedBy: ['Golem', 'Bear2'] });
    const golem = bear('Golem', 'p2', { blocking: ['Hunter'] }, 'Artifact Creature - Golem');
    const ctx = ctxFor([a1, golem, bear('Bear2', 'p2', { blocking: ['Hunter'] })]);
    const out = getBlockedTriggersForCreatures(ctx, [a1], 'p2').filter((t) => t.permanentId === 'Hunter');
    expect(out).toHaveLength(1);
    expect(out[0].value.blockingCreatureIds).toEqual(['Golem']);
    const a2 = perm('Hunter2', 'p1', { type_line: 'Creature - Human', power: '2', toughness: '2', oracle_text: 'Whenever this creature becomes blocked by an artifact creature, destroy that creature.' }, { attacking: 'p2', blockedBy: ['Bear3'] });
    const ctx2 = ctxFor([a2, bear('Bear3', 'p2', { blocking: ['Hunter2'] })]);
    expect(getBlockedTriggersForCreatures(ctx2, [a2], 'p2').filter((t) => t.permanentId === 'Hunter2')).toHaveLength(0);
  });

  it('self "becomes blocked" fires exactly once (legacy duplicate retired)', () => {
    const a1 = perm('Gorilla', 'p1', { type_line: 'Creature - Ape', power: '3', toughness: '3', oracle_text: 'Whenever Gorilla becomes blocked, it gets +2/+2 until end of turn.' }, { attacking: 'p2', blockedBy: ['B1'] });
    const ctx = ctxFor([a1, bear('B1', 'p2', { blocking: ['Gorilla'] })]);
    const out = getBlockedTriggersForCreatures(ctx, [a1], 'p2').filter((t) => t.permanentId === 'Gorilla');
    expect(out).toHaveLength(1);
  });

  it('self "blocks or becomes blocked" fires once as attacker and once as blocker', () => {
    const text = 'Whenever this creature blocks or becomes blocked, it gets +1/+1 until end of turn.';
    const a1 = perm('Samurai', 'p1', { type_line: 'Creature - Samurai', power: '2', toughness: '2', oracle_text: text }, { attacking: 'p2', blockedBy: ['B1'] });
    const ctx = ctxFor([a1, bear('B1', 'p2', { blocking: ['Samurai'] })]);
    expect(getBlockedTriggersForCreatures(ctx, [a1], 'p2').filter((t) => t.permanentId === 'Samurai')).toHaveLength(1);
    const blocker = perm('Samurai2', 'p2', { type_line: 'Creature - Samurai', power: '2', toughness: '2', oracle_text: text }, { blocking: ['X1'] });
    const ctx2 = ctxFor([blocker, bear('X1', 'p1', { attacking: 'p2', blockedBy: ['Samurai2'] })]);
    expect(getBlockTriggersForCreatures(ctx2, [blocker], 'p2').filter((t) => t.permanentId === 'Samurai2')).toHaveLength(1);
  });

  it('blocks emitter supplies blockPartner for "blocks ... by an artifact creature" style filters', () => {
    const self = 'Whenever this creature blocks or becomes blocked by an artifact creature, destroy that creature.';
    const blocker = perm('Smasher', 'p2', { type_line: 'Creature - Ogre', power: '2', toughness: '2', oracle_text: self }, { blocking: ['Golem'] });
    const golem = bear('Golem', 'p1', { attacking: 'p2', blockedBy: ['Smasher'] }, 'Artifact Creature - Golem');
    const ctx = ctxFor([blocker, golem]);
    expect(getBlockTriggersForCreatures(ctx, [blocker], 'p2').filter((t) => t.permanentId === 'Smasher')).toHaveLength(1);
    const blocker2 = perm('Smasher2', 'p2', { type_line: 'Creature - Ogre', power: '2', toughness: '2', oracle_text: self }, { blocking: ['Bear9'] });
    const ctx2 = ctxFor([blocker2, bear('Bear9', 'p1', { attacking: 'p2', blockedBy: ['Smasher2'] })]);
    expect(getBlockTriggersForCreatures(ctx2, [blocker2], 'p2').filter((t) => t.permanentId === 'Smasher2')).toHaveLength(0);
  });

  it('attacks and isn\'t blocked fires for unblocked attackers of the defending player only', () => {
    const watcher = perm('Rogue Lord', 'p1', { type_line: 'Creature - Rogue', power: '1', toughness: '1', oracle_text: 'Whenever a creature you control attacks and isn\'t blocked, draw a card.' });
    const selfy = perm('Ninja', 'p1', { type_line: 'Creature - Ninja', power: '1', toughness: '1', oracle_text: 'Whenever this creature attacks and isn\'t blocked, you gain 1 life.' }, { attacking: 'p2' });
    const blocked = bear('A2', 'p1', { attacking: 'p2', blockedBy: ['B1'] });
    const ctx = ctxFor([watcher, selfy, blocked, bear('B1', 'p2', { blocking: ['A2'] })]);
    const out = getParsedAttacksUnblockedTriggers(ctx, 'p2');
    expect(out.filter((t) => t.permanentId === 'Rogue Lord')).toHaveLength(1);
    expect(out.filter((t) => t.permanentId === 'Ninja')).toHaveLength(1);
    expect(getParsedAttacksUnblockedTriggers(ctx, 'p1')).toHaveLength(0);
  });
});
