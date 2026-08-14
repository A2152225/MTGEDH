import { describe, expect, it } from 'vitest';
import {
  getPermanentGoaders,
  isPermanentGoaded,
  permanentMustAttackIfAble,
  preferredForcedAttackTarget,
} from '../src/utils/combatGoad';

describe('combatGoad', () => {
  it('detects canonical goadedBy', () => {
    const perm = { goadedBy: ['p2'] };
    expect(isPermanentGoaded(perm)).toBe(true);
    expect(getPermanentGoaders(perm)).toEqual(['p2']);
    expect(permanentMustAttackIfAble(perm)).toBe(true);
  });

  it('detects legacy goaded object', () => {
    const perm = { goaded: { p2: true, p3: false } };
    expect(isPermanentGoaded(perm)).toBe(true);
    expect(getPermanentGoaders(perm)).toEqual(['p2']);
  });

  it('detects static goad even without listed goaders', () => {
    expect(isPermanentGoaded({ isStaticallyGoaded: true })).toBe(true);
    expect(getPermanentGoaders({ isStaticallyGoaded: true, staticGoadedBy: ['p2'] })).toEqual(['p2']);
  });

  it('prefers a non-goader defender', () => {
    const perm = { goadedBy: ['p2'] };
    expect(preferredForcedAttackTarget(perm, ['p2', 'p3'])).toBe('p3');
    expect(preferredForcedAttackTarget(perm, ['p2'])).toBe('p2');
  });

  it('treats mustAttackEachCombat as a forced attack', () => {
    expect(permanentMustAttackIfAble({ mustAttackEachCombat: true })).toBe(true);
    expect(isPermanentGoaded({ mustAttackEachCombat: true })).toBe(false);
  });
});
