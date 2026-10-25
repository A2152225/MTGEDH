import { describe, expect, it } from 'vitest';
import { permanentHasMustAttackRequirement } from '../../rules-engine/src/attackRestrictionText.js';
import { hasActivatableAbility } from '../src/state/modules/can-respond-handlers/canRespondActivatableAbilities.js';
import {
  appendGrantedLoyaltyAbilityLines,
  collectGrantedLoyaltyAbilityLines,
  extractPlaneswalkerLoyaltyGrants,
} from '../../shared/src/planeswalkerGrantedLoyaltyAbilities.js';
import { reconcileSoulbondPairing } from '../src/state/modules/soulbond.js';
import { detectEntersWithCounters } from '../src/state/modules/detectEntersWithCounters.js';
import { parseKickerCostOptions, sourceWasKickedWithCost } from '../src/state/modules/kickerCostUtils.js';
import {
  applyAssistContribution,
  hasAssist,
  maxAssistAmount,
  remainingCostAfterAssist,
} from '../src/state/modules/assistPayment.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const cr = (id: string, controller: string, oracle: string, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false,
  card: { id: `${id}c`, name: extra.name || id, type_line: extra.type_line || 'Creature - Test', oracle_text: oracle, power: '2', toughness: '3' },
  ...extra,
});

describe('batch 8: activation lock in client offers', () => {
  it('hasActivatableAbility is false for a creature under Arrest', () => {
    const c = cr('c', 'p1', '{T}: This creature deals 1 damage to any target.', { attachments: ['a'] });
    const arrest = cr('a', 'p2', "Enchanted creature can't attack or block, and its activated abilities can't be activated.", { type_line: 'Enchantment - Aura', attachedTo: 'c' });
    const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [c, arrest], manaPool: {}, turnPlayer: 'p1', phase: 'main1', zones: {} };
    expect(hasActivatableAbility({ state } as any, 'p1', c)).toBe(false);
  });
});

describe('batch 8: granted planeswalker loyalty abilities', () => {
  it('parses quoted grants with unicode minus', () => {
    expect(extractPlaneswalkerLoyaltyGrants('Planeswalkers you control have "[\u22124]: Draw a card."')).toEqual(['-4: Draw a card.']);
  });
  it('collects from same controller only and appends after printed lines', () => {
    const pw = cr('pw', 'p1', '+1: Scry 1.', { type_line: 'Legendary Planeswalker - Test' });
    const src = cr('s', 'p1', 'Planeswalkers you control have "[+1]: You gain 2 life."', { type_line: 'Enchantment' });
    const opp = cr('o', 'p2', 'Planeswalkers you control have "[-2]: Draw a card."', { type_line: 'Enchantment' });
    const bf = [pw, src, opp];
    expect(collectGrantedLoyaltyAbilityLines(bf, pw)).toEqual(['+1: You gain 2 life.']);
    const text = appendGrantedLoyaltyAbilityLines('+1: Scry 1.', bf, pw);
    expect(text.split('\n')[0]).toBe('+1: Scry 1.');
    expect(text).toContain('+1: You gain 2 life.');
  });
});

describe('batch 8: soulbond reconcile on control change', () => {
  it('unpairs when partner controller differs', () => {
    const a = cr('a', 'p1', 'Soulbond', { pairedWith: 'b' });
    const b = cr('b', 'p2', 'Soulbond', { pairedWith: 'a' });
    const state: any = { battlefield: [a, b] };
    expect(reconcileSoulbondPairing(state)).toBeGreaterThan(0);
    expect((a as any).pairedWith).toBeFalsy();
  });
});

describe('batch 8: opponents must attack', () => {
  it('Angler Turtle forces opposing creatures only', () => {
    const turtle = cr('t', 'p1', 'Hexproof\nCreatures your opponents control attack each combat if able.', { name: 'Angler Turtle' });
    const theirs = cr('x', 'p2', '');
    const mine = cr('y', 'p1', '');
    expect(permanentHasMustAttackRequirement(theirs, [turtle, theirs, mine])).toBe(true);
    expect(permanentHasMustAttackRequirement(mine, [turtle, theirs, mine])).toBe(false);
  });
});

describe('batch 8: escape entry counters', () => {
  it('adds escape counters only when escaped', () => {
    const card = { name: 'Phoenix of Ash', type_line: 'Creature', oracle_text: 'This creature escapes with two +1/+1 counters on it.' };
    expect(detectEntersWithCounters(card)['+1/+1']).toBeUndefined();
    expect(detectEntersWithCounters({ ...card, castWithAbility: 'escape' })['+1/+1']).toBe(2);
  });
  it('Polukranos escapes with twelve instead of six', () => {
    const card = { name: 'Polukranos, Unchained', type_line: 'Legendary Creature', oracle_text: 'Polukranos enters with six +1/+1 counters on it. It escapes with twelve +1/+1 counters on it instead.' };
    expect(detectEntersWithCounters(card)['+1/+1']).toBe(6);
    expect(detectEntersWithCounters({ ...card, castWithAbility: 'escape' })['+1/+1']).toBe(12);
  });
});

describe('batch 8: two-cost kicker', () => {
  it('parses and/or kicker into two costs and tracks each', () => {
    expect(parseKickerCostOptions('Kicker {1}{U} and/or {2}{B}')).toEqual(['{1}{U}', '{2}{B}']);
    const spell = { paidKickerCosts: ['{2}{B}'] };
    expect(sourceWasKickedWithCost(spell, '{2}{B}')).toBe(true);
    expect(sourceWasKickedWithCost(spell, '{1}{U}')).toBe(false);
  });
});

describe('batch 8: assist', () => {
  it('another player pays generic mana up to the cap', () => {
    const spell: any = { oracle_text: "Assist (Another player can pay up to {7} of this spell's cost.)" };
    expect(hasAssist(spell.oracle_text)).toBe(true);
    expect(maxAssistAmount('{7}{G}')).toBe(7);
    const state: any = { manaPool: { p2: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 } } };
    expect(applyAssistContribution(state, spell, 'p1', 'p1', 1, '{7}{G}').ok).toBe(false);
    expect(applyAssistContribution(state, spell, 'p1', 'p2', 8, '{7}{G}').reason).toBe('EXCEEDS_GENERIC_COST');
    const r = applyAssistContribution(state, spell, 'p1', 'p2', 4, '{7}{G}');
    expect(r.ok).toBe(true);
    expect(state.manaPool.p2.colorless + state.manaPool.p2.red).toBe(1);
    expect(remainingCostAfterAssist('{7}{G}', spell.assistPaid)).toBe('{3}{G}');
  });
});

describe('batch 8: census classifier', () => {
  it.each([
    ['Planeswalkers you control have "[+1]: You gain 2 life."', 'x'],
    ['Enchanted creature gets +2/+2 and is goaded.', 'x'],
    ['Creatures your opponents control attack each combat if able.', 'x'],
    ['This creature escapes with a +1/+1 counter on it.', 'x'],
    ['As long as this creature is paired with another creature, each of those creatures gets +1/+1.', 'x'],
  ])('%s is owned', (line, name) => {
    expect(classifyStaticCensusLine(line, name)?.system).toBeTruthy();
  });
});