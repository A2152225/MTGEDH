import { describe, it, expect } from 'vitest';
import { controlTypeAttackRestrictionReason, globalFlyingBlockOnlyFlyingReason } from '../src/socket/combat-handlers/combatBatch36Restrictions.js';
import { qualifiedUntapProhibitionSource } from '../src/state/modules/untapQualifierProhibitions.js';
import { detectDoesntUntapEffects } from '../src/state/modules/triggers/turn-phases.js';

const perm = (id: string, controller: string, type_line: string, oracle_text = '', extra: any = {}) =>
  ({ id, controller, card: { name: id, type_line, oracle_text, ...extra } });

describe('batch 36 statics', () => {
  it('Desperate Castaways needs an artifact to attack', () => {
    const c = perm('Desperate Castaways', 'p1', 'Creature \u2014 Human Pirate', "Desperate Castaways can't attack unless you control an artifact.");
    expect(controlTypeAttackRestrictionReason(c, [c])).toMatch(/artifact/);
    expect(controlTypeAttackRestrictionReason(c, [c, perm('Sol Ring', 'p1', 'Artifact')])).toBeNull();
    expect(controlTypeAttackRestrictionReason(c, [c, perm('Sol Ring', 'p2', 'Artifact')])).toMatch(/artifact/);
  });
  it('Dense Canopy: fliers block only fliers', () => {
    const canopy = perm('Dense Canopy', 'p3', 'Enchantment', 'Creatures with flying can block only creatures with flying.');
    const bird = perm('Bird', 'p2', 'Creature \u2014 Bird', 'Flying');
    const bear = perm('Bear', 'p1', 'Creature \u2014 Bear', '');
    const drake = perm('Drake', 'p1', 'Creature \u2014 Drake', 'Flying');
    const bf = [canopy, bird, bear, drake];
    expect(globalFlyingBlockOnlyFlyingReason(bird, bear, bf)).toMatch(/Dense Canopy/);
    expect(globalFlyingBlockOnlyFlyingReason(bird, drake, bf)).toBeNull();
    expect(globalFlyingBlockOnlyFlyingReason(bear, bear, bf)).toBeNull();
    expect(globalFlyingBlockOnlyFlyingReason(bird, bear, [bird, bear])).toBeNull();
  });
  it('Back to Basics stops only nonbasic lands', () => {
    const b2b = perm('Back to Basics', 'p2', 'Enchantment', "Nonbasic lands don't untap during their controllers' untap steps.");
    const forest = perm('Forest', 'p1', 'Basic Land \u2014 Forest');
    const dual = perm('Taiga', 'p1', 'Land \u2014 Mountain Forest');
    const bear = perm('Bear', 'p1', 'Creature \u2014 Bear');
    const bf = [b2b, forest, dual, bear];
    expect(qualifiedUntapProhibitionSource(bf, dual)).toBe('Back to Basics');
    expect(qualifiedUntapProhibitionSource(bf, forest)).toBeNull();
    expect(qualifiedUntapProhibitionSource(bf, bear)).toBeNull();
    // The legacy detector no longer reads qualified subjects as "all lands/creatures".
    expect(detectDoesntUntapEffects(b2b.card, b2b)).toEqual([]);
  });

  it('detectDoesntUntapEffects guards qualified subjects but keeps unqualified ones', () => {
    const q = [
      "Cumulative upkeep {2}. Creatures with flying don't untap during their controllers' untap steps.",
      "Creatures with flying don't untap during their controllers' untap steps.",
      "Creatures with power 3 or greater don't untap during their controllers' untap steps.",
      "Creatures with power 3 or less don't untap during their controllers' untap steps.",
      "Nonbasic lands don't untap during their controllers' untap steps.",
    ];
    for (const text of q) expect(detectDoesntUntapEffects({ name: 'Q', oracle_text: text }, { id: 'q', controller: 'p1' })).toEqual([]);
    const all = detectDoesntUntapEffects({ name: 'A', oracle_text: "Creatures don't untap during their controllers' untap steps." }, { id: 'a', controller: 'p1' });
    expect(all.map((x: any) => x.affectedType)).toEqual(['all_creatures']);
    const lands = detectDoesntUntapEffects({ name: 'R', oracle_text: "Lands don't untap during their controllers' untap steps." }, { id: 'r', controller: 'p1' });
    expect(lands.map((x: any) => x.affectedType)).toEqual(['all_lands']);
  });
});
