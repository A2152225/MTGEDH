import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { runWithSimultaneousEntryBatch } from '../src/state/modules/triggers/simultaneousEntryBatch.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { triggerPermanentTargetedTriggersFromSpell, triggerPermanentTargetedTriggersFromAbility } from '../src/state/modules/triggers/targeted.js';
import { queueCrimeTriggersForStackItem } from '../src/state/modules/triggers/crime-triggers.js';
import { queueSpellCopiedTriggers } from '../src/state/modules/triggers/spell-copied.js';
import { queueNoncombatDealsDamageTriggers } from '../src/state/modules/triggers/noncombat-deals-damage.js';
import { getSpellCastTriggersForCard } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerDetection.js';

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Creature - Human') =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_c`, name, type_line: type, oracle_text: oracle, power: '2', toughness: '2' } });
const ctxOf = (battlefield: any[], stack: any[] = []) => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 4, battlefield, stack },
}) as any;
const fromSource = (ctx: any, id: string) => ctx.state.stack.filter((s: any) => s.type === 'triggered_ability' && (s.source === id || s.sourceId === id || s.permanentId === id));

describe('attacks alone / battalion IR (no double-fire)', () => {
  it('attacks alone fires once when alone, never in a group', () => {
    const lone = perm('lone', 'p1', 'Lone Wolf', 'Whenever Lone Wolf attacks alone, it gets +2/+2 until end of turn.');
    const other = perm('o', 'p1', 'Bear', '');
    const ctx = ctxOf([lone, other]);
    expect(getAttackTriggersForCreatures(ctx, [lone], 'p1', 'p2').filter((t: any) => t.permanentId === 'lone')).toHaveLength(1);
    expect(getAttackTriggersForCreatures(ctx, [lone, other], 'p1', 'p2').filter((t: any) => t.permanentId === 'lone')).toHaveLength(0);
  });
  it('battalion fires once with three attackers, not with two', () => {
    const b = perm('bat', 'p1', 'Boros Elite', 'Battalion - Whenever Boros Elite and at least two other creatures attack, Boros Elite gets +2/+2 until end of turn.');
    const x = perm('x', 'p1', 'X', ''); const y = perm('y', 'p1', 'Y', '');
    const ctx = ctxOf([b, x, y]);
    expect(getAttackTriggersForCreatures(ctx, [b, x, y], 'p1', 'p2').filter((t: any) => t.permanentId === 'bat')).toHaveLength(1);
    expect(getAttackTriggersForCreatures(ctx, [b, x], 'p1', 'p2').filter((t: any) => t.permanentId === 'bat')).toHaveLength(0);
  });
});

describe('becomes the target: once per targeting', () => {
  const heroic = perm('h', 'p1', 'Phalanx', 'Whenever Phalanx becomes the target of a spell or ability, put a +1/+1 counter on it.');
  it('spell: repeated hooks for the same stack object fire once', () => {
    const ctx = ctxOf([heroic], [{ id: 's1', type: 'spell', controller: 'p2', targets: ['h'], card: { name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' } }]);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', stackItemId: 's1', targetIds: ['h'] } as any);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', stackItemId: 's1', targetIds: ['h'] } as any);
    triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', targetIds: ['h'] } as any);
    expect(ctx.state.stack.filter((s: any) => s.type === 'triggered_ability')).toHaveLength(1);
  });
  it('ability targeting fires once; a copy with new targets fires again', () => {
    const ctx = ctxOf([heroic], [{ id: 'a1', type: 'ability', controller: 'p2', targets: ['h'] }]);
    triggerPermanentTargetedTriggersFromAbility(ctx, { activatedBy: 'p2', sourcePermanentId: 'x', stackItemId: 'a1', targetIds: ['h'] } as any);
    triggerPermanentTargetedTriggersFromAbility(ctx, { activatedBy: 'p2', sourcePermanentId: 'x', stackItemId: 'a1', targetIds: ['h'] } as any);
    expect(ctx.state.stack.filter((s: any) => s.type === 'triggered_ability')).toHaveLength(1);
    ctx.state.stack.push({ id: 'cp', type: 'spell', controller: 'p2', isCopy: true, targets: ['h'], card: { name: 'Shock', type_line: 'Instant', oracle_text: '' } });
    queueSpellCopiedTriggers(ctx, 'cp');
    queueSpellCopiedTriggers(ctx, 'cp');
    expect(ctx.state.stack.filter((s: any) => s.type === 'triggered_ability')).toHaveLength(2);
  });
  it('replay emits nothing', () => {
    const ctx = ctxOf([heroic], [{ id: 's1', type: 'spell', controller: 'p2', targets: ['h'] }]);
    ctx.isReplaying = true;
    expect(triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: 'p2', stackItemId: 's1', targetIds: ['h'] } as any)).toHaveLength(0);
  });
});

describe('crimes from spells, activated and triggered abilities', () => {
  const you = perm('k', 'p1', 'Outlaw', 'Whenever you commit a crime, draw a card.');
  const any = perm('w', 'p3', 'Watcher', 'Whenever a player commits a crime, you gain 1 life.');
  const opp = perm('o', 'p2', 'Opp Bear', '');
  it.each(['ability', 'triggered_ability', 'spell'])('%s targeting an opponent permanent is a crime (once)', (type) => {
    const ctx = ctxOf([you, any, opp], [{ id: 'x1', type, controller: 'p1', targets: ['o'] }]);
    queueCrimeTriggersForStackItem(ctx, 'x1');
    queueCrimeTriggersForStackItem(ctx, 'x1');
    const trig = ctx.state.stack.filter((s: any) => s.type === 'triggered_ability');
    expect(trig.filter((s: any) => String(s.sourceName || '').includes('Outlaw'))).toHaveLength(1);
    expect(trig.filter((s: any) => String(s.sourceName || '').includes('Watcher'))).toHaveLength(1);
  });
  it('self-targets and copies are not crimes', () => {
    const ctx = ctxOf([you, any, opp], [{ id: 'x1', type: 'ability', controller: 'p1', targets: ['k'] }, { id: 'x2', type: 'spell', controller: 'p1', isCopy: true, targets: ['p2'] }]);
    queueCrimeTriggersForStackItem(ctx, 'x1');
    queueCrimeTriggersForStackItem(ctx, 'x2');
    expect(ctx.state.stack.filter((s: any) => s.type === 'triggered_ability')).toHaveLength(0);
  });
  it('legacy spell-cast path no longer fires crime (no double-fire)', () => {
    const game = { state: ctxOf([you, opp]).state };
    expect(getSpellCastTriggersForCard(game, 'p1', { id: 'c', name: 'Bolt', type_line: 'Instant', oracle_text: '' }, 'hand').filter((t) => t.permanentId === 'k')).toHaveLength(0);
  });
});

describe('noncombat deals damage', () => {
  it('"deals damage to an opponent" fires for opponents only, once per event', () => {
    const src = perm('s', 'p1', 'Pinger', 'Whenever Pinger deals damage to an opponent, draw a card.');
    const ctx = ctxOf([src]);
    queueNoncombatDealsDamageTriggers(ctx, 's', { playerIds: ['p2', 'p3'], permanentIds: [], legacyEffects: [] });
    expect(ctx.state.stack.filter((s: any) => s.type === 'triggered_ability')).toHaveLength(1);
    const ctx2 = ctxOf([src]);
    queueNoncombatDealsDamageTriggers(ctx2, 's', { playerIds: ['p1'], permanentIds: [], legacyEffects: [] });
    expect(ctx2.state.stack).toHaveLength(0);
  });
  it('"deals combat damage" lines do not fire on noncombat damage', () => {
    const src = perm('s', 'p1', 'Ninja', 'Whenever Ninja deals combat damage to a player, draw a card.');
    const ctx = ctxOf([src]);
    queueNoncombatDealsDamageTriggers(ctx, 's', { playerIds: ['p2'], permanentIds: [], legacyEffects: [] });
    expect(ctx.state.stack).toHaveLength(0);
  });
});

describe('"one or more tokens enter" runtime batching', () => {
  it('two createToken calls in one batch -> one trigger; outside a batch -> one each', () => {
    const a = 'a' as PlayerID;
    const game: any = createInitialGameState(`t_r6_${Math.random().toString(36).slice(2, 7)}`);
    game.applyEvent({ type: 'join', playerId: a, name: 'A' });
    game.state.turnPlayer = a; game.state.stack = [];
    game.state.battlefield.push({ id: 'src', controller: a, owner: a, tapped: false, counters: {}, card: { id: 'src_c', name: 'Watcher', type_line: 'Enchantment', oracle_text: 'Whenever one or more tokens you control enter, draw a card.' } });
    const n = () => game.state.stack.filter((s: any) => s?.sourceName === 'Watcher').length;
    runWithSimultaneousEntryBatch(() => {
      createToken(game, a, 'Soldier', 2, 1, 1, { colors: ['W'], typeLine: 'Token Creature - Soldier' });
      createToken(game, a, 'Treasure', 1, undefined as any, undefined as any, { typeLine: 'Token Artifact - Treasure' });
    });
    expect(n()).toBe(1);
    createToken(game, a, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature - Soldier' });
    createToken(game, a, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature - Soldier' });
    expect(n()).toBe(3);
  });
});
