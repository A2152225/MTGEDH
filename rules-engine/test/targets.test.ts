/**
 * Tests for Rule 115: Targets
 */
import { describe, it, expect } from 'vitest';
import {
  TargetType,
  TargetingContext,
  isLegalTargetByDefault,
  isValidAnyTarget,
  canTargetItself,
  changeTargets,
  changeOneTarget,
  chooseNewTargets,
  isTargeted,
  doesYouIndicateTarget,
  Target
} from '../src/types/targets';
import { Zone } from '../src/types/objects';

describe('Rule 115: Targets', () => {
  describe('Rule 115.1 - Target declaration', () => {
    it('should define target types', () => {
      expect(TargetType.PERMANENT).toBe('permanent');
      expect(TargetType.PLAYER).toBe('player');
      expect(TargetType.SPELL).toBe('spell');
      expect(TargetType.CREATURE).toBe('creature');
      expect(TargetType.ANY_TARGET).toBe('any_target');
    });

    it('should define targeting contexts', () => {
      expect(TargetingContext.INSTANT_SORCERY_SPELL).toBe('instant_sorcery_spell');
      expect(TargetingContext.ACTIVATED_ABILITY).toBe('activated_ability');
      expect(TargetingContext.TRIGGERED_ABILITY).toBe('triggered_ability');
    });
  });

  describe('Rule 115.2 - Only permanents are legal targets by default', () => {
    it('should allow permanents on battlefield as targets', () => {
      expect(isLegalTargetByDefault(TargetType.PERMANENT, Zone.BATTLEFIELD)).toBe(true);
      expect(isLegalTargetByDefault(TargetType.CREATURE, Zone.BATTLEFIELD)).toBe(true);
    });

    it('should not allow permanents in other zones by default', () => {
      expect(isLegalTargetByDefault(TargetType.PERMANENT, Zone.GRAVEYARD)).toBe(false);
      expect(isLegalTargetByDefault(TargetType.PERMANENT, Zone.HAND)).toBe(false);
    });

    it('should allow players as targets', () => {
      expect(isLegalTargetByDefault(TargetType.PLAYER, Zone.BATTLEFIELD)).toBe(true);
    });

    it('should allow spells only on stack', () => {
      expect(isLegalTargetByDefault(TargetType.SPELL, Zone.STACK)).toBe(true);
      expect(isLegalTargetByDefault(TargetType.SPELL, Zone.HAND)).toBe(false);
    });
  });

  describe('Rule 115.4 - "Any target" means creature, player, planeswalker, or battle', () => {
    it('should validate any target types', () => {
      expect(isValidAnyTarget(TargetType.CREATURE)).toBe(true);
      expect(isValidAnyTarget(TargetType.PLAYER)).toBe(true);
      expect(isValidAnyTarget(TargetType.PLANESWALKER)).toBe(true);
      expect(isValidAnyTarget(TargetType.BATTLE)).toBe(true);
    });

    it('should reject non-any-target types', () => {
      expect(isValidAnyTarget(TargetType.SPELL)).toBe(false);
      expect(isValidAnyTarget(TargetType.CARD)).toBe(false);
    });
  });

  describe('Rule 115.5 - Spell/ability on stack is illegal target for itself', () => {
    it('should not allow targeting itself', () => {
      expect(canTargetItself('spell-1', 'spell-1')).toBe(false);
    });

    it('should allow targeting other spells', () => {
      expect(canTargetItself('spell-1', 'spell-2')).toBe(true);
    });
  });

  describe('Rule 115.7a - Change the target(s)', () => {
    it('should change all targets when valid', () => {
      const original: Target[] = [
        {
          id: 'target-1',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        },
        {
          id: 'target-2',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        }
      ];

      const newTargets = changeTargets(original, ['target-3', 'target-4']);
      expect(newTargets).not.toBeNull();
      expect(newTargets![0].id).toBe('target-3');
      expect(newTargets![1].id).toBe('target-4');
    });

    it('should return null if target count mismatch', () => {
      const original: Target[] = [
        {
          id: 'target-1',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        }
      ];

      const result = changeTargets(original, ['target-2', 'target-3']);
      expect(result).toBeNull();
    });
  });

  describe('Rule 115.7b - Change a target (singular)', () => {
    it('should change only one target', () => {
      const original: Target[] = [
        {
          id: 'target-1',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        },
        {
          id: 'target-2',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        }
      ];

      const result = changeOneTarget(original, 0, 'target-3');
      expect(result).not.toBeNull();
      expect(result![0].id).toBe('target-3');
      expect(result![1].id).toBe('target-2');
    });

    it('should return null for invalid index', () => {
      const original: Target[] = [
        {
          id: 'target-1',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        }
      ];

      expect(changeOneTarget(original, 5, 'target-2')).toBeNull();
      expect(changeOneTarget(original, -1, 'target-2')).toBeNull();
    });
  });

  describe('Rule 115.7d - Choose new targets', () => {
    it('should change specified targets and leave others unchanged', () => {
      const original: Target[] = [
        {
          id: 'target-1',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        },
        {
          id: 'target-2',
          type: TargetType.CREATURE,
          isLegal: false,  // Can leave illegal targets unchanged
          wasLegalOnSelection: true
        },
        {
          id: 'target-3',
          type: TargetType.CREATURE,
          isLegal: true,
          wasLegalOnSelection: true
        }
      ];

      const changes = new Map<number, string>();
      changes.set(0, 'new-target-1');
      changes.set(2, 'new-target-3');

      const result = chooseNewTargets(original, changes);
      expect(result[0].id).toBe('new-target-1');
      expect(result[1].id).toBe('target-2'); // Unchanged
      expect(result[2].id).toBe('new-target-3');
    });
  });

  describe('Rule 115.10 - "target" keyword required for targeting', () => {
    it('should detect targeted spells/abilities', () => {
      expect(isTargeted('Destroy target creature')).toBe(true);
      expect(isTargeted('Target player draws two cards')).toBe(true);
      expect(isTargeted('Deal 3 damage to any target')).toBe(true);
    });

    it('should not detect non-targeted spells/abilities', () => {
      expect(isTargeted('Destroy all creatures')).toBe(false);
      expect(isTargeted('Each player draws a card')).toBe(false);
      expect(isTargeted('You gain 3 life')).toBe(false);
    });
  });

  describe('Rule 115.10b - "you" does not indicate a target', () => {
    it('should confirm "you" is not a target', () => {
      expect(doesYouIndicateTarget()).toBe(false);
    });
  });
});
