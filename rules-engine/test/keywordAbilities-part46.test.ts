import { describe, expect, it } from 'vitest';
import {
  activateEmbalm,
  activateEternalize,
  aftermath,
  applyUndaunted,
  castFromGraveyard,
  chooseBackground,
  chooseCounters,
  createAftermathSummary,
  createEmbalmSummary,
  createEternalizeSummary,
  createFabricateSummary,
  createImproviseSummary,
  createPartnerSummary,
  createRenownSummary,
  createUndauntedSummary,
  embalm,
  eternalize,
  fabricate,
  improvise,
  partner,
  renown,
  tapArtifactsForImprovise,
  triggerRenown,
  undaunted,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 46 (late Part 7 summaries)', () => {
  describe('Renown (702.112)', () => {
    it('should summarize combat-damage triggering and renowned state', () => {
      expect(createRenownSummary(triggerRenown(renown('creature-1', 2)), true)).toEqual({
        source: 'creature-1',
        renownValue: 2,
        canTrigger: false,
        isRenowned: true,
      });
    });
  });

  describe('Improvise (702.126)', () => {
    it('should summarize tapped artifacts and generic-cost reduction', () => {
      expect(createImproviseSummary(tapArtifactsForImprovise(improvise('spell-1'), ['artifact-1', 'artifact-2']), '{4}{U}')).toEqual({
        source: 'spell-1',
        tappedArtifactCount: 2,
        manaValue: 2,
        reducedCost: '{2}{U}',
      });
    });
  });

  describe('Fabricate (702.123)', () => {
    it('should summarize the counters-vs-tokens choice and token count', () => {
      expect(createFabricateSummary(chooseCounters(fabricate('artifact-1', 3)))).toEqual({
        source: 'artifact-1',
        fabricateValue: 3,
        choseCounters: true,
        counterBranch: true,
        tokenBranch: false,
        tokenCount: 0,
      });
    });
  });

  describe('Partner (702.124)', () => {
    it('should summarize candidate legality and combined commander color identity', () => {
      expect(createPartnerSummary(chooseBackground('commander-1'), { hasBackgroundType: true }, [
        { colorIdentity: ['U', 'R'] },
        { colorIdentity: ['W'] },
      ])).toEqual({
        source: 'commander-1',
        partnerType: 'choose-background',
        canChooseCandidate: true,
        combinedColorIdentity: ['U', 'R', 'W'],
      });
    });
    it('should summarize basic partner pairing as commander-legal', () => {
      expect(createPartnerSummary(partner('commander-2'), { isLegendary: true }, [{ colorIdentity: ['B'] }])).toEqual({
        source: 'commander-2',
        partnerType: 'partner',
        canChooseCandidate: true,
        combinedColorIdentity: ['B'],
      });
    });
  });

  describe('Undaunted (702.125)', () => {
    it('should summarize active opponents and generic cost reduction', () => {
      expect(createUndauntedSummary(applyUndaunted(undaunted('spell-2'), 3), 3, '{6}{U}')).toEqual({
        source: 'spell-2',
        costReduction: 3,
        activeOpponents: 3,
        reducedCost: '{3}{U}',
      });
    });
  });

  describe('Aftermath (702.127)', () => {
    it('should summarize graveyard-only casting and exile replacement', () => {
      expect(createAftermathSummary(castFromGraveyard(aftermath('cut-ribbons')), 'graveyard', true, true)).toEqual({
        source: 'cut-ribbons',
        canCastFromGraveyard: true,
        canCastNow: true,
        wasCastFromGraveyard: true,
        exilesOnResolution: true,
      });
    });
  });

  describe('Embalm (702.128)', () => {
    it('should summarize graveyard sorcery activation and resulting token id', () => {
      expect(createEmbalmSummary(activateEmbalm(embalm('creature-2', '{3}{W}'), 'token-1'), 'graveyard', true)).toEqual({
        source: 'creature-2',
        embalmCost: '{3}{W}',
        canActivate: true,
        hasBeenEmbalmed: true,
        tokenId: 'token-1',
      });
    });
  });

  describe('Eternalize (702.129)', () => {
    it('should summarize graveyard sorcery activation and resulting 4/4 token id', () => {
      expect(createEternalizeSummary(activateEternalize(eternalize('creature-3', '{5}{B}'), 'token-2'), 'graveyard', true)).toEqual({
        source: 'creature-3',
        eternalizeCost: '{5}{B}',
        canActivate: true,
        hasBeenEternalized: true,
        tokenId: 'token-2',
      });
    });
  });
});