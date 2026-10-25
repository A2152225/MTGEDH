import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { applyManaAbilityLifeEffectToState } from '../src/state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js';
import { notifyNoncombatPlayerDamage } from '../src/state/modules/triggers/player-dealt-damage-ir.js';
import { collectRecipientVariantCombatDamageTriggers } from '../src/state/modules/turn-handlers/turnCombatDamageRecipientVariantTriggers.js';
import { applyCombatDamageToPlaneswalker } from '../src/state/modules/turn-handlers/turnCombatDamagePermanentApply.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

const perm = (id: string, controller: string, name: string, oracle: string, type: string, extra: any = {}) =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle } });
const ctxOf = (battlefield: any[], isReplaying = false) => ({
  gameId: 'unknown', isReplaying,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack: [] },
}) as any;
const trig = (ctx: any) => ctx.state.stack.filter((s: any) => s.type === 'triggered_ability');
const painWatcher = () => perm('w', 'p1', 'Pain Watcher', "Whenever you're dealt noncombat damage, draw a card.", 'Creature');

describe('round 12: socket and mana noncombat damage paths', () => {
  it('mana-ability self damage fires the hook once', () => {
    const ctx = ctxOf([painWatcher()]);
    applyManaAbilityLifeEffectToState(ctx.state, 'p1', { amount: 1, isDamage: true } as any, ctx);
    expect(trig(ctx).length).toBe(1);
  });
  it('mana-ability life loss (not damage) does not fire', () => {
    const ctx = ctxOf([painWatcher()]);
    applyManaAbilityLifeEffectToState(ctx.state, 'p1', { amount: 1, isDamage: false } as any, ctx);
    expect(trig(ctx).length).toBe(0);
  });
  it('replay ctx skips', () => {
    const ctx = ctxOf([painWatcher()], true);
    applyManaAbilityLifeEffectToState(ctx.state, 'p1', { amount: 1, isDamage: true } as any, ctx);
    notifyNoncombatPlayerDamage(ctx, 'p1', 2);
    expect(trig(ctx).length).toBe(0);
  });
  it('socket-style game object works as ctx', () => {
    const game = ctxOf([painWatcher()]);
    notifyNoncombatPlayerDamage(game, 'p1', 2);
    expect(trig(game).length).toBe(1);
  });
});

const pending = () => [] as Array<{ stackItem: any; reason: string }>;

describe('round 12: deals combat damage (no recipient)', () => {
  const setup = () => {
    const attacker = perm('a', 'p1', 'Bearer', '', 'Creature', { attachments: ['j'] });
    const jitte = perm('j', 'p1', 'Jitte', 'Whenever equipped creature deals combat damage, put two charge counters on this Equipment.', 'Artifact - Equipment', { attachedTo: 'a' });
    return { attacker, jitte, bf: [attacker, jitte] };
  };
  it('fires once when trample hits a player and a creature', () => {
    const { bf } = setup();
    const out = pending();
    collectRecipientVariantCombatDamageTriggers(ctxOf(bf), bf, { attackersThatDealtDamage: ['a'], attackersThatDealtCreatureDamage: ['a'] }, out, false);
    expect(out.length).toBe(1);
    expect(out[0].stackItem.permanentId).toBe('j');
  });
  it('fires when only a creature was hit', () => {
    const { bf } = setup();
    const out = pending();
    collectRecipientVariantCombatDamageTriggers(ctxOf(bf), bf, { attackersThatDealtCreatureDamage: ['a'] }, out, false);
    expect(out.length).toBe(1);
  });
  it('does not fire for an unequipped attacker or during replay', () => {
    const { bf } = setup();
    const other = perm('b', 'p1', 'Other', '', 'Creature');
    const out = pending();
    collectRecipientVariantCombatDamageTriggers(ctxOf([...bf, other]), [...bf, other], { attackersThatDealtDamage: ['b'] }, out, false);
    expect(out.length).toBe(0);
    collectRecipientVariantCombatDamageTriggers(ctxOf(bf), bf, { attackersThatDealtDamage: ['a'] }, out, true);
    expect(out.length).toBe(0);
  });
});

describe('round 12: planeswalker recipient', () => {
  const setup = () => {
    const attacker = perm('a', 'p1', 'Raider', 'Whenever this creature deals combat damage to a player or planeswalker, draw a card.', 'Creature');
    const pw = perm('pw', 'p2', 'Walker', '', 'Legendary Planeswalker', { counters: { loyalty: 5 }, loyalty: 5 });
    return { attacker, pw, bf: [attacker, pw] };
  };
  it('planeswalker damage fires the "player or planeswalker" line with the walker controller as target', () => {
    const { attacker, pw, bf } = setup();
    const ctx = ctxOf(bf);
    const res = applyCombatDamageToPlaneswalker(ctx, pw, 3, attacker.card, attacker);
    expect(res.appliedAmount).toBe(3);
    const out = pending();
    collectRecipientVariantCombatDamageTriggers(ctx, bf, {}, out, false);
    expect(out.length).toBe(1);
    expect(out[0].stackItem.targetPlayer).toBe('p2');
    // ledger is consumed
    const again = pending();
    collectRecipientVariantCombatDamageTriggers(ctx, bf, {}, again, false);
    expect(again.length).toBe(0);
  });
  it('a plain "to a player" line does not fire on planeswalker damage', () => {
    const attacker = perm('a', 'p1', 'Raider', 'Whenever this creature deals combat damage to a player, draw a card.', 'Creature');
    const pw = perm('pw', 'p2', 'Walker', '', 'Legendary Planeswalker', { counters: { loyalty: 5 }, loyalty: 5 });
    const ctx = ctxOf([attacker, pw]);
    applyCombatDamageToPlaneswalker(ctx, pw, 2, attacker.card, attacker);
    const out = pending();
    collectRecipientVariantCombatDamageTriggers(ctx, [attacker, pw], {}, out, false);
    expect(out.length).toBe(0);
  });
});

describe('round 12 parses', () => {
  it.each([
    ['Whenever equipped creature deals combat damage, put two charge counters on this Equipment.', 'deals_combat_damage'],
    ['Whenever this creature attacks while you control a creature with power 4 or greater, draw a card.', 'attacks'],
    ["Whenever a time counter is removed from this card while it's exiled, draw a card.", 'counter_removed'],
    ['When the fourth plan counter is put on this enchantment, draw a card.', 'counter_placed'],
    ['When a spell or ability an opponent controls causes you to discard this card, draw a card.', 'discards'],
    ['When you next cast an instant or sorcery spell this turn, copy that spell.', 'spell_cast'],
  ])('%s', (text, event) => {
    expect(parseTriggerClause(text)?.condition.event).toBe(event);
  });
  it('power-N attacks keeps an intervening-if', () => {
    expect(parseTriggerClause('Whenever this creature attacks while you control a creature with power 4 or greater, draw a card.')?.interveningIf).toBe('you control a creature with power 4 or greater');
  });
  it('legacy-runtime-only wordings never match through IR', () => {
    const oracle = 'When the fourth plan counter is put on this enchantment, draw a card.';
    const ench = perm('e', 'p1', 'Plan', oracle, 'Enchantment', { counters: { plan: 4 } });
    expect(collectMatchingParsedEventLines({ ctx: ctxOf([ench]), oracleText: oracle, event: 'counter_placed' as any, subjectPermanent: ench, subjectControllerId: 'p1', sourcePermanent: ench } as any).length).toBe(0);
  });
});
