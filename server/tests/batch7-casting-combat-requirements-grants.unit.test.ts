import { describe, expect, it } from 'vitest';
import { permanentHasMustAttackRequirement } from '../../rules-engine/src/attackRestrictionText.js';
import { getPermanentProtections } from '../src/state/modules/combat-mechanics.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { isSpellCastingProhibitedByStaticRestriction } from '../src/state/modules/staticCastingRestrictions.js';
import {
  findMustBeBlockedIfAbleViolation,
  resolveMustBeBlockedIfAbleAssignments,
} from '../src/socket/combat-handlers/combatMustBeBlockedIfAble.js';
import { ensureInitialDayNightDesignationFromBattlefield } from '../src/state/modules/day-night.js';
import { combatDamageAssignmentAmount } from '../src/state/modules/turn-handlers/turnCombatDamageByToughness.js';
import { permanentActivatedAbilitiesLockedByAttachment } from '../src/state/modules/staticActivationLockFromAttachments.js';

const cr = (id: string, controller: string, oracle: string, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false,
  card: { id: `${id}c`, name: extra.name || id, type_line: extra.type_line || 'Creature - Test', oracle_text: oracle, power: '2', toughness: '3' },
  ...extra,
});
const aura = (id: string, controller: string, oracle: string, attachedTo: string, extra: any = {}) =>
  cr(id, controller, oracle, { type_line: 'Enchantment - Aura', attachedTo, ...extra });
const base = (battlefield: any[], extra: any = {}): any => ({
  players: [{ id: 'p1' }, { id: 'p2' }], battlefield, turnPlayer: 'p1', phase: 'main1', spellsCastThisTurn: [], zones: {}, ...extra,
});
const bolt = { name: 'Bolt', type_line: 'Instant', mana_cost: '{R}' };
const bear = { name: 'Bear', type_line: 'Creature - Bear', mana_cost: '{1}{G}' };

describe('batch 7: casting limits', () => {
  it('Dromoka: opponents cannot cast during your turn only', () => {
    const dromoka = cr('d', 'p1', "Your opponents can't cast spells during your turn.");
    expect(isSpellCastingProhibitedByStaticRestriction(base([dromoka]), 'p2', bolt).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(base([dromoka]), 'p1', bolt).prohibited).toBe(false);
    expect(isSpellCastingProhibitedByStaticRestriction(base([dromoka], { turnPlayer: 'p2' }), 'p2', bolt).prohibited).toBe(false);
  });
  it('Marisi: opponents cannot cast during combat', () => {
    const marisi = cr('m', 'p1', "Your opponents can't cast spells during combat.");
    expect(isSpellCastingProhibitedByStaticRestriction(base([marisi], { phase: 'combat' }), 'p2', bolt).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(base([marisi]), 'p2', bolt).prohibited).toBe(false);
  });
  it('Rule of Law and Arcane Laboratory / Fires of Invention caps', () => {
    const rol = cr('r', 'p1', "Each player can't cast more than one spell each turn.");
    expect(isSpellCastingProhibitedByStaticRestriction(base([rol], { spellsCastThisTurn: [{ casterId: 'p2' }] }), 'p2', bolt).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(base([rol]), 'p2', bolt).prohibited).toBe(false);
    const lab = cr('a', 'p1', "Each player can't cast more than one noncreature spell each turn.");
    const cast = { spellsCastThisTurn: [{ casterId: 'p2', card: { type_line: 'Sorcery' } }] };
    expect(isSpellCastingProhibitedByStaticRestriction(base([lab], cast), 'p2', bolt).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(base([lab], cast), 'p2', bear).prohibited).toBe(false);
    const fires = cr('f', 'p1', 'You can cast no more than two spells each turn.');
    const two = { spellsCastThisTurn: [{ casterId: 'p1' }, { casterId: 'p1' }] };
    expect(isSpellCastingProhibitedByStaticRestriction(base([fires], two), 'p1', bolt).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(base([fires], { spellsCastThisTurn: [{ casterId: 'p2' }, { casterId: 'p2' }] }), 'p2', bolt).prohibited).toBe(false);
  });
});

describe('batch 7: attack / block requirements', () => {
  it('must attack from auras and Berzerker, not from goad reminder text', () => {
    expect(permanentHasMustAttackRequirement(cr('c1', 'p1', ''), [aura('e', 'p2', 'Enchanted creature gets +2/+2 and attacks each combat if able.', 'c1')])).toBe(true);
    expect(permanentHasMustAttackRequirement(cr('k', 'p1', 'Iron Golem attacks or blocks each combat if able.', { name: 'Iron Golem' }), [])).toBe(true);
    expect(permanentHasMustAttackRequirement(cr('c1', 'p1', ''), [aura('e', 'p2', 'Enchanted creature gets +2/+2 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)', 'c1')])).toBe(false);
  });
  it('Watchdog must block if able; resolve assigns it', () => {
    const attacker = cr('a1', 'p1', '', { attacking: 'p2' });
    const dog = cr('w1', 'p2', 'This creature blocks each combat if able.', { name: 'Watchdog' });
    const state = base([attacker, dog, cr('b2', 'p2', '')]);
    expect(findMustBeBlockedIfAbleViolation({ state, defendingPlayerId: 'p2', assignments: [] })).not.toBeNull();
    expect(findMustBeBlockedIfAbleViolation({ state, defendingPlayerId: 'p2', assignments: [{ blockerId: 'w1', attackerId: 'a1' }] })).toBeNull();
    expect(resolveMustBeBlockedIfAbleAssignments({ state, defendingPlayerId: 'p2', assignments: [] }))
      .toEqual([{ blockerId: 'w1', attackerId: 'a1' }]);
    const tapped = base([attacker, { ...dog, tapped: true }]);
    expect(findMustBeBlockedIfAbleViolation({ state: tapped, defendingPlayerId: 'p2', assignments: [] })).toBeNull();
  });
  it('Grand Melee: all creatures block each combat if able', () => {
    const state = base([cr('a1', 'p1', '', { attacking: 'p2' }), cr('b1', 'p2', ''), cr('g', 'p1', 'All creatures attack each combat if able.\nAll creatures block each combat if able.', { type_line: 'Enchantment' })]);
    expect(findMustBeBlockedIfAbleViolation({ state, defendingPlayerId: 'p2', assignments: [] })).not.toBeNull();
  });
});

describe('batch 7: day/night, protection, locks, damage by toughness', () => {
  it('becomes day as it enters when neither', () => {
    const state = base([cr('s', 'p1', "If it's neither day nor night, it becomes day as this creature enters.")]);
    ensureInitialDayNightDesignationFromBattlefield(state);
    expect(state.dayNight).toBe('day');
  });
  it('protection from the chosen color (aura and self)', () => {
    const host = cr('c1', 'p1', '');
    const ward = aura('w', 'p1', "Enchanted creature has protection from the chosen color. This effect doesn't remove this Aura.", 'c1', { chosenColor: 'red' });
    expect(getPermanentProtections(host, { battlefield: [host, ward] })).toContain('red');
    expect(getPermanentProtections(cr('o', 'p1', 'This creature has protection from the chosen color.', { chosenColor: 'black' }), { battlefield: [] })).toContain('black');
  });
  it('Arrest locks combat and activations; mana exemption honored', () => {
    const host = cr('h', 'p2', '{T}: Draw a card.');
    const arrest = aura('a', 'p1', "Enchanted creature can't attack or block, and its activated abilities can't be activated.", 'h');
    const state = base([host, arrest]);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, state)).toEqual(expect.arrayContaining(["can't attack", "can't block"]));
    expect(permanentActivatedAbilitiesLockedByAttachment(host, state, false).locked).toBe(true);
    const manaOk = base([host, aura('a', 'p1', "Enchanted permanent's activated abilities can't be activated unless they're mana abilities.", 'h')]);
    expect(permanentActivatedAbilitiesLockedByAttachment(host, manaOk, true).locked).toBe(false);
    expect(permanentActivatedAbilitiesLockedByAttachment(host, manaOk, false).locked).toBe(true);
  });
  it('assigns combat damage equal to toughness', () => {
    const x = cr('x', 'p1', '');
    const stats = { power: 0, toughness: 4 };
    const formation = cr('af', 'p1', 'Each creature you control assigns combat damage equal to its toughness rather than its power.');
    expect(combatDamageAssignmentAmount({ state: base([x, formation]) }, x, stats)).toBe(4);
    expect(combatDamageAssignmentAmount({ state: base([x, { ...formation, controller: 'p2' }]) }, x, stats)).toBe(0);
    const ghalta = cr('gh', 'p1', 'Each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power.');
    expect(combatDamageAssignmentAmount({ state: base([x, ghalta]) }, x, { power: 5, toughness: 4 })).toBe(5);
  });
});

describe('batch 7: paired / graveyard-count quoted grants', () => {
  it('soulbond grant reaches both paired creatures', () => {
    const lookout = cr('t', 'p1', 'Soulbond\nAs long as Tandem Lookout is paired with another creature, each of those creatures has "Whenever this creature deals damage to an opponent, draw a card."', { name: 'Tandem Lookout', pairedWith: 'q' });
    const partner = cr('q', 'p1', '', { pairedWith: 't' });
    const state = base([lookout, partner]);
    expect(getContinuousGrantedAbilitiesForPermanent(partner as any, state).join('|')).toMatch(/deals damage to an opponent, draw a card/i);
    const unpaired = { ...lookout, pairedWith: undefined };
    expect(getContinuousGrantedAbilitiesForPermanent(unpaired as any, base([unpaired]))).toEqual([]);
  });
  it('threshold grant only with seven cards in graveyard', () => {
    const sage = cr('cs', 'p1', 'Threshold - As long as there are seven or more cards in your graveyard, this creature has "When this creature enters, draw three cards, then discard two cards."', { name: 'Cephalid Sage' });
    const full = base([sage], { zones: { p1: { graveyard: new Array(7).fill({ id: 'g' }) } } });
    expect(getContinuousGrantedAbilitiesForPermanent(sage as any, full).join('|')).toMatch(/draw three cards/i);
    expect(getContinuousGrantedAbilitiesForPermanent(sage as any, base([sage], { zones: { p1: { graveyard: [] } } }))).toEqual([]);
  });
});
