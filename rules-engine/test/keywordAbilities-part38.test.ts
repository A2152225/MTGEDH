import { describe, expect, it } from 'vitest';
import {
  activateBoast,
  activateEncore,
  applyCompleated,
  boast,
  castWithCleave,
  castWithDisturb,
  cleave,
  compleated,
  createBoastSummary,
  createCleaveSummary,
  createCompleatedSummary,
  createDecayedSummary,
  createDemonstrateSummary,
  createDisturbSummary,
  createEncoreSummary,
  createForetellSummary,
  createTrainingSummary,
  decayed,
  disturb,
  encore,
  foretell,
  foretellCard,
  getCleavedText,
  demonstrate,
  triggerDecayed,
  triggerDemonstrate,
  training,
  triggerTraining,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 38 (remaining Part 9 summaries)', () => {
  describe('Encore (702.141)', () => {
    it('should summarize graveyard activation timing and token count for encore', () => {
      expect(createEncoreSummary(activateEncore(encore('araumi-card', '{5}{U}'), ['token-1', 'token-2']), 'graveyard', true, 2)).toEqual({
        source: 'araumi-card',
        canActivate: true,
        encoreCost: '{5}{U}',
        hasBeenEncored: true,
        tokenCount: 2,
        opponentCount: 2,
      });
    });
  });

  describe('Boast (702.142)', () => {
    it('should summarize attack gating and the once-per-turn boast activation', () => {
      expect(createBoastSummary(activateBoast({ ...boast('viking-1', '{1}{R}', 'Draw a card.'), attackedThisTurn: true }))).toEqual({
        source: 'viking-1',
        attackedThisTurn: true,
        activatedThisTurn: true,
        canActivate: false,
        effect: 'Draw a card.',
      });
    });
  });

  describe('Foretell (702.143)', () => {
    it('should summarize when a foretold card becomes castable on a later turn', () => {
      expect(createForetellSummary(foretellCard(foretell('doomskar', '{1}{W}{W}'), 3), 4)).toEqual({
        source: 'doomskar',
        actionCost: '{2}',
        foretellCost: '{1}{W}{W}',
        isForetold: true,
        turnForetold: 3,
        canCastNow: true,
      });
    });
  });

  describe('Demonstrate (702.144)', () => {
    it('should summarize created copies and whether an opponent received one', () => {
      expect(createDemonstrateSummary(triggerDemonstrate(demonstrate('creative-technique'), 'p2', 'copy-you', 'copy-opponent'))).toEqual({
        source: 'creative-technique',
        hasCopied: true,
        chosenOpponent: 'p2',
        copyCount: 2,
        givesOpponentCopy: true,
      });
    });
  });

  describe('Disturb (702.146)', () => {
    it('should summarize graveyard casting and transformed entry for disturb', () => {
      expect(createDisturbSummary(castWithDisturb(disturb('baithook-angler', '{2}{U}')), 'graveyard')).toEqual({
        source: 'baithook-angler',
        disturbCost: '{2}{U}',
        canCastFromGraveyard: true,
        wasDisturbed: true,
        entersBackFaceUp: true,
      });
    });
  });

  describe('Decayed (702.147)', () => {
    it('should summarize attack allowance, block prohibition, and sacrifice timing', () => {
      expect(createDecayedSummary(triggerDecayed(decayed('zombie-token')))).toEqual({
        source: 'zombie-token',
        canBlock: false,
        canAttack: true,
        hasAttacked: true,
        sacrificesAtEndOfCombat: true,
      });
    });
  });

  describe('Cleave (702.148)', () => {
    it('should summarize the cleaved effective text and alternate-cost usage', () => {
      expect(createCleaveSummary(castWithCleave(cleave('spell-1', '{4}{W}', 'Destroy target [attacking] creature.'), getCleavedText('Destroy target [attacking] creature.')))).toEqual({
        source: 'spell-1',
        cleaveCost: '{4}{W}',
        wasCleaved: true,
        effectiveText: 'Destroy target creature.',
        usesAlternateText: true,
      });
    });
  });

  describe('Training (702.149)', () => {
    it('should summarize trigger availability and counters added from training', () => {
      expect(createTrainingSummary(triggerTraining(training('initiate', 2), 3), [1, 4])).toEqual({
        source: 'initiate',
        power: 3,
        timesTriggered: 1,
        canTrigger: true,
        countersAdded: 1,
      });
    });
  });

  describe('Compleated (702.150)', () => {
    it('should summarize life-paid phyrexian symbols and resulting starting loyalty', () => {
      expect(createCompleatedSummary(applyCompleated(compleated('ajani-planeswalker'), 2), 5)).toEqual({
        source: 'ajani-planeswalker',
        phyrexianManaPaid: 2,
        loyaltyReduction: 4,
        startingLoyalty: 1,
        usedLifePayment: true,
      });
    });
  });
});