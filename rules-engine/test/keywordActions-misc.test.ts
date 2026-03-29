/**
 * Focused tests for remaining lightweight keyword actions without dedicated direct coverage.
 */

import { describe, expect, it } from 'vitest';
import {
  assemble,
  beheldPermanent,
  canAssemble,
  canBeholdQuality,
  completeAssemble,
  createBeholdAction,
  getAssembledContraption,
  getBeholdedObjectId,
  isUnSetAssembleAction,
  SEE_UNSTABLE_FAQ,
  UN_SET_MECHANIC,
  wasBeheld,
} from '../src/keywordActions';

describe('Misc Keyword Actions', () => {
  describe('Behold (Rule 701.4)', () => {
    it('should record a beheld quality and the chosen object id', () => {
      const action = createBeholdAction('player1', 'artifact', 'revealed-card', 'card1');

      expect(action.type).toBe('behold');
      expect(wasBeheld(action, 'artifact')).toBe(true);
      expect(beheldPermanent(action)).toBe(false);
      expect(getBeholdedObjectId(action)).toBe('card1');
    });

    it('should validate quality matches for legendary and type-based behold actions', () => {
      expect(canBeholdQuality({ isLegendary: true, card: { type_line: 'Creature — Angel' } }, 'legendary')).toBe(true);
      expect(canBeholdQuality({ card: { type_line: 'Artifact Creature — Golem' } }, 'artifact')).toBe(true);
      expect(canBeholdQuality({ card: { type_line: 'Creature — Elf' } }, 'artifact')).toBe(false);
    });

    it('should distinguish permanent-based behold choices', () => {
      const action = createBeholdAction('player1', 'legendary', 'chosen-permanent', 'perm1');

      expect(beheldPermanent(action)).toBe(true);
      expect(getBeholdedObjectId(action)).toBe('perm1');
    });
  });

  describe('Assemble (Rule 701.45)', () => {
    it('should create and complete an assemble action with a chosen Contraption', () => {
      const action = assemble('player1');
      const completed = completeAssemble('player1', 'contraption1');

      expect(action.type).toBe('assemble');
      expect(canAssemble(['contraption1'])).toBe(true);
      expect(getAssembledContraption(completed)).toBe('contraption1');
    });

    it('should keep the Un-set placeholder behavior explicit', () => {
      expect(UN_SET_MECHANIC).toBe(true);
      expect(isUnSetAssembleAction()).toBe(true);
      expect(SEE_UNSTABLE_FAQ).toContain('Unstable FAQ');
    });
  });
});