import { describe, expect, it } from 'vitest';
import {
  absorb,
  annihilator,
  bushido,
  createAbsorbSummary,
  createAnnihilatorSummary,
  createBushidoSummary,
  createFrenzySummary,
  createHorsemanshipSummary,
  frenzy,
  horsemanship,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 49 (Part 17 summaries)', () => {
  describe('Absorb (702.64)', () => {
    it('should summarize prevented and remaining damage', () => {
      expect(createAbsorbSummary(absorb('lichenthrope', 2), 5)).toEqual({
        source: 'lichenthrope',
        absorbValue: 2,
        preventedDamage: 2,
        remainingDamage: 3,
      });
    });
  });

  describe('Annihilator (702.86)', () => {
    it('should summarize attack-trigger readiness and defending player context', () => {
      expect(createAnnihilatorSummary(annihilator('ulamog', 4), true, 'player-b')).toEqual({
        source: 'ulamog',
        annihilatorCount: 4,
        triggers: true,
        defendingPlayerId: 'player-b',
      });
    });
  });

  describe('Bushido (702.45)', () => {
    it('should summarize trigger conditions and resulting stat bonuses', () => {
      expect(createBushidoSummary(bushido('hand-of-honor', 2), true, false)).toEqual({
        source: 'hand-of-honor',
        bushidoValue: 2,
        triggers: true,
        powerBonus: 2,
        toughnessBonus: 2,
      });
    });
  });

  describe('Frenzy (702.68)', () => {
    it('should summarize unblocked attack pressure', () => {
      expect(createFrenzySummary(frenzy('goblin-berserker', 3), true, false)).toEqual({
        source: 'goblin-berserker',
        frenzyValue: 3,
        triggers: true,
        powerBonus: 3,
        toughnessBonus: 0,
      });
    });
  });

  describe('Horsemanship (702.31)', () => {
    it('should summarize blocker eligibility and evasion relevance', () => {
      expect(createHorsemanshipSummary(horsemanship('riding-red-hare'), false, false)).toEqual({
        source: 'riding-red-hare',
        attackerHasHorsemanship: true,
        blockerCanBlock: false,
        evasionRelevant: true,
      });
    });
  });
});