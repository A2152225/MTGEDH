/**
 * Tests for autoResolve.ts - Auto-resolve and auto-choice system
 * 
 * Tests the ability for players to set automatic responses to common triggers
 * like Rhystic Study, Smothering Tithe, etc.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutoResolveType,
  KNOWN_PAY_OR_TRIGGERS,
  createDefaultPreferences,
  setAutoResolveSetting,
  removeAutoResolveSetting,
  getAutoResolveBehavior,
  shouldAutoResolve,
  isKnownPayOrTrigger,
  getPayOrTriggerDefinition,
  applyAutoResolve,
  getAutoResolveOptionsForTrigger,
  serializePreferences,
  deserializePreferences,
  type PlayerAutoResolvePreferences,
} from '../src/autoResolve';

describe('Auto-Resolve System', () => {
  let preferences: PlayerAutoResolvePreferences;

  beforeEach(() => {
    preferences = createDefaultPreferences('player1');
  });

  describe('createDefaultPreferences', () => {
    it('should create default preferences with ALWAYS_ASK behavior', () => {
      expect(preferences.playerId).toBe('player1');
      expect(preferences.defaultBehavior).toBe(AutoResolveType.ALWAYS_ASK);
      expect(preferences.settings.size).toBe(0);
    });
  });

  describe('setAutoResolveSetting', () => {
    it('should add a new auto-resolve setting', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Rhystic Study',
        AutoResolveType.AUTO_PAY
      );

      expect(updated.settings.size).toBe(1);
      const setting = updated.settings.get('Rhystic Study');
      expect(setting).toBeDefined();
      expect(setting?.behavior).toBe(AutoResolveType.AUTO_PAY);
    });

    it('should update an existing setting', () => {
      let updated = setAutoResolveSetting(
        preferences,
        'Rhystic Study',
        AutoResolveType.AUTO_PAY
      );
      updated = setAutoResolveSetting(
        updated,
        'Rhystic Study',
        AutoResolveType.AUTO_DECLINE
      );

      expect(updated.settings.size).toBe(1);
      const setting = updated.settings.get('Rhystic Study');
      expect(setting?.behavior).toBe(AutoResolveType.AUTO_DECLINE);
    });

    it('should support permanent-specific settings', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Rhystic Study',
        AutoResolveType.AUTO_PAY,
        'perm-123'
      );

      const key = 'Rhystic Study:perm-123';
      expect(updated.settings.has(key)).toBe(true);
    });
  });

  describe('removeAutoResolveSetting', () => {
    it('should remove a setting', () => {
      let updated = setAutoResolveSetting(
        preferences,
        'Smothering Tithe',
        AutoResolveType.AUTO_DECLINE
      );
      updated = removeAutoResolveSetting(updated, 'Smothering Tithe');

      expect(updated.settings.size).toBe(0);
    });

    it('should remove permanent-specific settings', () => {
      let updated = setAutoResolveSetting(
        preferences,
        'Smothering Tithe',
        AutoResolveType.AUTO_DECLINE,
        'perm-456'
      );
      updated = removeAutoResolveSetting(updated, 'Smothering Tithe', 'perm-456');

      expect(updated.settings.size).toBe(0);
    });
  });

  describe('getAutoResolveBehavior', () => {
    it('should return default behavior when no setting exists', () => {
      const behavior = getAutoResolveBehavior(preferences, 'Unknown Card');
      expect(behavior).toBe(AutoResolveType.ALWAYS_ASK);
    });

    it('should return the configured behavior', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Mystic Remora',
        AutoResolveType.AUTO_PAY
      );
      const behavior = getAutoResolveBehavior(updated, 'Mystic Remora');
      expect(behavior).toBe(AutoResolveType.AUTO_PAY);
    });

    it('should prefer permanent-specific settings over card name settings', () => {
      let updated = setAutoResolveSetting(
        preferences,
        'Rhystic Study',
        AutoResolveType.AUTO_PAY
      );
      updated = setAutoResolveSetting(
        updated,
        'Rhystic Study',
        AutoResolveType.AUTO_DECLINE,
        'perm-123'
      );

      // With permanent ID, should get permanent-specific setting
      expect(getAutoResolveBehavior(updated, 'Rhystic Study', 'perm-123'))
        .toBe(AutoResolveType.AUTO_DECLINE);
      
      // Without permanent ID, should get card name setting
      expect(getAutoResolveBehavior(updated, 'Rhystic Study'))
        .toBe(AutoResolveType.AUTO_PAY);
    });
  });

  describe('shouldAutoResolve', () => {
    it('should not auto-resolve when behavior is ALWAYS_ASK', () => {
      const result = shouldAutoResolve(preferences, 'Any Card');
      expect(result.autoResolve).toBe(false);
    });

    it('should auto-resolve when behavior is AUTO_PAY', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Smothering Tithe',
        AutoResolveType.AUTO_PAY
      );
      const result = shouldAutoResolve(updated, 'Smothering Tithe');
      expect(result.autoResolve).toBe(true);
      expect(result.behavior).toBe(AutoResolveType.AUTO_PAY);
    });
  });

  describe('Known Pay-Or Triggers', () => {
    it('should recognize Rhystic Study as a known trigger', () => {
      expect(isKnownPayOrTrigger('Rhystic Study')).toBe(true);
    });

    it('should recognize Smothering Tithe as a known trigger', () => {
      expect(isKnownPayOrTrigger('Smothering Tithe')).toBe(true);
    });

    it('should not recognize unknown cards', () => {
      expect(isKnownPayOrTrigger('Lightning Bolt')).toBe(false);
    });

    it('should return correct definition for Rhystic Study', () => {
      const def = getPayOrTriggerDefinition('Rhystic Study');
      expect(def).toBeDefined();
      expect(def?.paymentCost).toBe('{1}');
      expect(def?.affectsController).toBe(true);
      expect(def?.affectsOpponent).toBe(true);
    });

    it('should return correct definition for Smothering Tithe', () => {
      const def = getPayOrTriggerDefinition('Smothering Tithe');
      expect(def).toBeDefined();
      expect(def?.paymentCost).toBe('{2}');
      expect(def?.declineEffect).toContain('Treasure');
    });
  });

  describe('applyAutoResolve', () => {
    it('should not apply when no auto-resolve is set', () => {
      const result = applyAutoResolve(preferences, 'Rhystic Study');
      expect(result.applied).toBe(false);
    });

    it('should apply AUTO_PASS correctly', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Rhystic Study',
        AutoResolveType.AUTO_PASS
      );
      const result = applyAutoResolve(updated, 'Rhystic Study');
      expect(result.applied).toBe(true);
      expect(result.action).toBe('pass');
    });

    it('should apply AUTO_PAY correctly', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Smothering Tithe',
        AutoResolveType.AUTO_PAY
      );
      const result = applyAutoResolve(updated, 'Smothering Tithe');
      expect(result.applied).toBe(true);
      expect(result.action).toBe('pay');
    });

    it('should apply AUTO_DECLINE correctly', () => {
      const updated = setAutoResolveSetting(
        preferences,
        'Mystic Remora',
        AutoResolveType.AUTO_DECLINE
      );
      const result = applyAutoResolve(updated, 'Mystic Remora');
      expect(result.applied).toBe(true);
      expect(result.action).toBe('decline');
    });
  });

  describe('getAutoResolveOptionsForTrigger', () => {
    it('should include pay/decline options for known triggers', () => {
      const options = getAutoResolveOptionsForTrigger('Rhystic Study');
      expect(options.length).toBeGreaterThan(2);
      expect(options.some(o => o.value === AutoResolveType.AUTO_PAY)).toBe(true);
      expect(options.some(o => o.value === AutoResolveType.AUTO_DECLINE)).toBe(true);
    });

    it('should include basic options for unknown triggers', () => {
      const options = getAutoResolveOptionsForTrigger('Unknown Card');
      expect(options.some(o => o.value === AutoResolveType.ALWAYS_ASK)).toBe(true);
      expect(options.some(o => o.value === AutoResolveType.AUTO_PASS)).toBe(true);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize preferences correctly', () => {
      let updated = setAutoResolveSetting(
        preferences,
        'Rhystic Study',
        AutoResolveType.AUTO_PAY
      );
      updated = setAutoResolveSetting(
        updated,
        'Smothering Tithe',
        AutoResolveType.AUTO_DECLINE
      );

      const serialized = serializePreferences(updated);
      expect(serialized.settings.length).toBe(2);

      const deserialized = deserializePreferences(serialized);
      expect(deserialized.settings.size).toBe(2);
      expect(getAutoResolveBehavior(deserialized, 'Rhystic Study'))
        .toBe(AutoResolveType.AUTO_PAY);
      expect(getAutoResolveBehavior(deserialized, 'Smothering Tithe'))
        .toBe(AutoResolveType.AUTO_DECLINE);
    });
  });

  describe('KNOWN_PAY_OR_TRIGGERS coverage', () => {
    it('should have all expected triggers defined', () => {
      const expectedTriggers = [
        'Rhystic Study',
        'Smothering Tithe',
        'Mystic Remora',
        'Propaganda',
        'Ghostly Prison',
        'Sphere of Safety',
      ];

      for (const trigger of expectedTriggers) {
        expect(KNOWN_PAY_OR_TRIGGERS[trigger]).toBeDefined();
      }
    });

    it('should have valid definitions for all triggers', () => {
      for (const [name, def] of Object.entries(KNOWN_PAY_OR_TRIGGERS)) {
        expect(def.cardName).toBe(name);
        expect(def.triggerDescription).toBeDefined();
        expect(typeof def.affectsController).toBe('boolean');
        expect(typeof def.affectsOpponent).toBe('boolean');
      }
    });
  });
});
