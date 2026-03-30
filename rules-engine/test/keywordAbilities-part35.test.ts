import { describe, expect, it } from 'vitest';
import {
  undying,
  canTriggerUndying,
  returnsWithUndyingCounter,
  createUndyingReturnResult,
  cipher,
  encodeOnCreature,
  canTriggerCipherOnCombatDamage,
  createCipherCopyResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 35 (remaining Part 6 batch-1 stragglers)', () => {
  describe('Undying (702.93)', () => {
    it('should only return a creature that died without +1/+1 counters and has not returned already', () => {
      expect(canTriggerUndying(false)).toBe(true);
      expect(canTriggerUndying(true)).toBe(false);
      expect(returnsWithUndyingCounter(false, false)).toBe(true);
      expect(returnsWithUndyingCounter(false, true)).toBe(false);
    });

    it('should summarize when undying brings a creature back with a counter', () => {
      expect(createUndyingReturnResult(undying('young-wolf'), false)).toEqual({
        source: 'young-wolf',
        hadPlusOneCounters: false,
        canTrigger: true,
        returnsToBattlefield: true,
        plusOneCountersAdded: 1,
      });
      expect(createUndyingReturnResult(undying('strangleroot-geist'), true).returnsToBattlefield).toBe(false);
    });
  });

  describe('Cipher (702.99)', () => {
    it('should require an encoded creature to deal combat damage before a cipher copy can be cast', () => {
      const encoded = encodeOnCreature(cipher('hands-of-binding'), 'invisible-stalker');

      expect(canTriggerCipherOnCombatDamage(encoded, true)).toBe(true);
      expect(canTriggerCipherOnCombatDamage(encoded, false)).toBe(false);
      expect(canTriggerCipherOnCombatDamage(cipher('stolen-identity'), true)).toBe(false);
    });

    it('should summarize the encoded creature and copy-cast permission for cipher', () => {
      const encoded = encodeOnCreature(cipher('last-thoughts'), 'tormented-soul');

      expect(createCipherCopyResult(encoded, true)).toEqual({
        source: 'last-thoughts',
        encodedOn: 'tormented-soul',
        dealtCombatDamageToPlayer: true,
        canCastCopy: true,
      });
    });
  });
});