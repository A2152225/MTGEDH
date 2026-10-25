import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { triggerPermanentTargetedTriggersFromSpell } from '../src/state/modules/triggers/targeted.js';
import { queueCrimeTriggersForStackItem } from '../src/state/modules/triggers/crime-triggers.js';
import { emitNoncombatDamageEvent } from '../src/state/modules/triggers/noncombat-deals-damage.js';
import { cloneStackItemForAbilityCopy } from '../src/state/modules/triggerAbilityCopyUtils.js';
import { applyFightDamageBetweenCreatures } from '../src/state/modules/combat-damage-processing.js';
import { executeSpellEffect } from '../src/state/modules/executeSpellEffect-handlers/executeSpellEffectCore.js';

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Creature - Human') =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, card: { id: `${id}_c`, name, type_line: type, oracle_text: oracle, power: '2', toughness: '5' } });
const ctxOf = (battlefield: any[], stack: any[] = []) => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }, { id: 'p3', life: 40 }], life: { p1: 40, p2: 40, p3: 40 }, activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 4, battlefield, stack },
}) as any;
const trig = (ctx: any, name: string) => ctx.state.stack.filter((s: any) => s.type === 'triggered_ability' && String(s.sourceName || '').includes(name));

describe('round 7 parses', () => {
  it.each([
    'Whenever you attack with two or more creatures, draw a card.',
    'Whenever you cycle a card, draw a card.',
    'Whenever one or more tokens you control enter, draw a card.',
    'Whenever a source you control deals noncombat damage to an opponent, draw a card.',
    'Whenever you become the target of a spell or ability an opponent controls, draw a card.',
    'Whenever a Samurai or Warrior you control attacks alone, it gets +1/+1 until end of turn.',
  ])('%s is IR', (line) => { expect(parseTriggerClause(line, 'P')).toBeTruthy(); });
  it('plural verb needs a batched subject; "whenever you attack" still parses', () => {
    expect(parseTriggerClause('Whenever creatures enter, draw a card.', 'P')).toBeNull();
    expect(parseTriggerClause('Whenever you attack, draw a card.', 'P')).toBeTruthy();
  });
});

describe('attack with N or more creatures', () => {
  it('fires once with enough attackers, not with fewer', () => {
    const w = perm('w', 'p1', 'Warleader', 'Whenever you attack with three or more creatures, draw a card.', 'Enchantment');
    const a = perm('a', 'p1', 'A', ''); const b = perm('b', 'p1', 'B', ''); const c = perm('c', 'p1', 'C', '');
    const ctx = ctxOf([w, a, b, c]);
    expect(getAttackTriggersForCreatures(ctx, [a, b, c], 'p1', 'p2').filter((t: any) => t.permanentId === 'w')).toHaveLength(1);
    expect(getAttackTriggersForCreatures(ctx, [a, b], 'p1', 'p2').filter((t: any) => t.permanentId === 'w')).toHaveLength(0);
  });
});

describe('you become the target', () => {
  it('fires for the player target, not for a permanent of theirs, not for own spells', () => {
    const w = perm('w', 'p1', 'Shielded', 'Whenever you become the target of a spell or ability an opponent controls, draw a card.', 'Enchantment');
    const bear = perm('bear', 'p1', 'Bear', '');
    const ctx = ctxOf([w, bear], [{ id: 's1', type: 'spell', controller: 'p2', targets: ['p1'] }, { id: 's2', type: 'spell', controller: 'p2', targets: ['bear'] }, { id: 's3', type: 'spell', controller: 'p1', targets: ['p1'] }]);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', stackItemId: 's1', targetIds: ['p1'] } as any);
    expect(trig(ctx, 'Shielded')).toHaveLength(1);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', stackItemId: 's2', targetIds: ['bear'] } as any);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p1', stackItemId: 's3', targetIds: ['p1'] } as any);
    expect(trig(ctx, 'Shielded')).toHaveLength(1);
  });
  it('permanent lines do not match player targets', () => {
    const w = perm('w', 'p1', 'Watcher', 'Whenever a permanent becomes the target of a spell or ability, you gain 1 life.', 'Enchantment');
    const ctx = ctxOf([w], [{ id: 's1', type: 'spell', controller: 'p2', targets: ['p1'] }]);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', stackItemId: 's1', targetIds: ['p1'] } as any);
    expect(trig(ctx, 'Watcher')).toHaveLength(0);
  });
});

describe('copied abilities', () => {
  it('a copy fires becomes-target but commits no crime', () => {
    const heroic = perm('h', 'p2', 'Phalanx', 'Whenever Phalanx becomes the target of a spell or ability, put a +1/+1 counter on it.');
    const outlaw = perm('k', 'p1', 'Outlaw', 'Whenever you commit a crime, draw a card.', 'Enchantment');
    const ctx = ctxOf([heroic, outlaw], [{ id: 'a1', type: 'ability', controller: 'p1', source: 'k', targets: ['h'], description: 'deal 1 damage' }]);
    const copy = cloneStackItemForAbilityCopy(ctx, 'Strionic', 'p1' as any, 'a1');
    expect(copy).toBeTruthy();
    expect(trig(ctx, 'Phalanx')).toHaveLength(1);
    expect(trig(ctx, 'Outlaw')).toHaveLength(0);
  });
});

describe('crime: "a permanent" subject lines', () => {
  it('crime trigger fires for a spell targeting an opponent (pseudo-subject matches)', () => {
    const outlaw = perm('k', 'p1', 'Outlaw', 'Whenever you commit a crime, draw a card.', 'Enchantment');
    const ctx = ctxOf([outlaw], [{ id: 'x', type: 'spell', controller: 'p1', targets: ['p2'], card: { name: 'Shock', type_line: 'Instant', oracle_text: '' } }]);
    queueCrimeTriggersForStackItem(ctx, 'x');
    expect(trig(ctx, 'Outlaw')).toHaveLength(1);
    expect(parseTriggerClause('Whenever you commit a crime, draw a card.', 'P')!.condition.alternatives[0].subject.anyObject).toBe(true);
  });
});

describe('noncombat damage paths', () => {
  const watcher = () => perm('w', 'p1', 'Firesong', 'Whenever a source you control deals noncombat damage to an opponent, draw a card.', 'Enchantment');
  it('sourceless spell damage (stack item) fires for an opponent, not for yourself or an opponent source', () => {
    const ctx = ctxOf([watcher()], [{ id: 'sp', type: 'spell', controller: 'p1', card: { name: 'Shock', type_line: 'Instant', oracle_text: '' } }]);
    emitNoncombatDamageEvent(ctx, { sourceId: 'sp', controller: 'p1', playerIds: ['p2'] });
    expect(trig(ctx, 'Firesong')).toHaveLength(1);
    emitNoncombatDamageEvent(ctx, { sourceId: 'sp', controller: 'p1', playerIds: ['p1'] });
    emitNoncombatDamageEvent(ctx, { sourceName: 'Opp Shock', controller: 'p2', playerIds: ['p3'] });
    expect(trig(ctx, 'Firesong')).toHaveLength(1);
  });
  it('executeSpellEffect DamagePlayer without a permanent source fires', () => {
    const ctx = ctxOf([watcher()], [{ id: 'sp', type: 'spell', controller: 'p1', card: { name: 'Shock', type_line: 'Instant', oracle_text: '' } }]);
    executeSpellEffect(ctx, { kind: 'DamagePlayer', playerId: 'p2', amount: 2 } as any, 'p1' as any, 'Shock', undefined, 'sp');
    expect(trig(ctx, 'Firesong')).toHaveLength(1);
  });
  it('fight damage is a noncombat deals_damage event per creature', () => {
    const a = perm('a', 'p1', 'Brawler', 'Whenever Brawler deals damage to a creature, you gain 2 life.');
    const b = perm('b', 'p2', 'Bear', '');
    const ctx = ctxOf([a, b]);
    applyFightDamageBetweenCreatures(ctx, a, 2, b, 2);
    expect(trig(ctx, 'Brawler')).toHaveLength(1);
  });
  it('replay emits nothing', () => {
    const ctx = ctxOf([watcher()]);
    ctx.isReplaying = true;
    expect(emitNoncombatDamageEvent(ctx, { controller: 'p1', playerIds: ['p2'] })).toHaveLength(0);
  });
});
