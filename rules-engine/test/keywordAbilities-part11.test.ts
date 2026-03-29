/**
 * Tests for Part 11 keyword abilities (Rules 702.161-702.169).
 */

import { describe, expect, it } from 'vitest';
import {
  backup,
  bargain,
  canApplyLivingMetal,
  canCastConverted,
  canCastWithDisguise,
  canPayBargain,
  canTargetForBackup,
  canTurnDisguiseFaceUp,
  canUseSolvedAbility,
  craft,
  createForMirrodinRebelToken,
  DISGUISE_CAST_COST,
  disguise,
  disguiseCastFaceDown,
  disguiseTurnFaceUp,
  forMirrodin,
  FOR_MIRRODIN_REBEL_TOKEN,
  getBackupAbilities,
  getBackupTarget,
  getBackupValue,
  getBargainedPermanent,
  getCraftCost,
  getCraftedMaterials,
  getCraftMaterialsText,
  getDisguiseCost,
  getDisguiseX,
  getForMirrodinToken,
  getMTMTECost,
  getSolvedAbilityText,
  getTotalToxicValue,
  getToxicValue,
  hasCrafted,
  hasLivingMetalCreatureType,
  hasRedundantBackup,
  hasRedundantBargain,
  hasRedundantCraft,
  hasRedundantDisguise,
  hasRedundantForMirrodin,
  hasRedundantLivingMetal,
  hasRedundantMoreThanMeetsTheEye,
  hasRedundantSolved,
  hasRedundantToxic,
  isCaseSolved,
  isCreatureFromLivingMetal,
  isFaceDown,
  isSolvedAbilityActive,
  livingMetal,
  moreThanMeetsTheEye,
  parseCraft,
  parseDisguiseCost,
  parseMTMTECost,
  parseToxicValue,
  payBargain,
  shouldGrantAbilities,
  shouldTriggerForMirrodin,
  solveCase,
  solved,
  toxic,
  triggerBackup,
  triggerForMirrodin,
  updateLivingMetalTurn,
  wasBargained,
  wasConverted,
  castConverted,
  activateCraft,
  canActivateCraft,
  canApplyToxicToPlayer,
} from '../src/keywordAbilities';

describe('Part 11: Keyword Abilities (Rules 702.161-702.169)', () => {
  describe('Living Metal (702.161)', () => {
    it('should make the vehicle a creature only during your turn', () => {
      const ability = livingMetal('vehicle-1');
      const updated = updateLivingMetalTurn(ability, true);

      expect(canApplyLivingMetal(true)).toBe(true);
      expect(isCreatureFromLivingMetal(updated)).toBe(true);
      expect(hasLivingMetalCreatureType(updated)).toBe(true);
      expect(hasRedundantLivingMetal([ability, livingMetal('vehicle-2')])).toBe(true);
    });
  });

  describe('More Than Meets the Eye (702.162)', () => {
    it('should allow alternate converted casting and parse the keyword cost', () => {
      const ability = moreThanMeetsTheEye('transformer-1', '{2}{U}');
      const cast = castConverted(ability);

      expect(canCastConverted('hand')).toBe(true);
      expect(wasConverted(cast)).toBe(true);
      expect(getMTMTECost(cast)).toBe('{2}{U}');
      expect(parseMTMTECost('More Than Meets the Eye {2}{U}')).toBe('{2}{U}');
      expect(hasRedundantMoreThanMeetsTheEye([ability, moreThanMeetsTheEye('transformer-2', '{3}{U}')])).toBe(false);
    });
  });

  describe('For Mirrodin! (702.163)', () => {
    it('should create and attach to a Rebel token when the equipment enters', () => {
      const ability = forMirrodin('equipment-1');
      const triggered = triggerForMirrodin(ability, 'rebel-1');
      const token = createForMirrodinRebelToken('rebel-1', 'p1');

      expect(shouldTriggerForMirrodin(true)).toBe(true);
      expect(getForMirrodinToken(triggered)).toBe('rebel-1');
      expect(token.basePower).toBe(2);
      expect(token.baseToughness).toBe(2);
      expect(FOR_MIRRODIN_REBEL_TOKEN.name).toBe('Rebel');
      expect(hasRedundantForMirrodin([ability, forMirrodin('equipment-2')])).toBe(false);
    });
  });

  describe('Toxic (702.164)', () => {
    it('should sum total toxic values and apply only on combat damage to a player', () => {
      const toxicOne = toxic('creature-1', 1);
      const toxicTwo = toxic('creature-1', 2);

      expect(getToxicValue(toxicOne)).toBe(1);
      expect(getTotalToxicValue([toxicOne, toxicTwo])).toBe(3);
      expect(canApplyToxicToPlayer(true)).toBe(true);
      expect(parseToxicValue('Toxic 2')).toBe(2);
      expect(hasRedundantToxic([toxicOne, toxicTwo])).toBe(false);
    });
  });

  describe('Backup (702.165)', () => {
    it('should put counters on the target and grant abilities only to another creature', () => {
      const ability = backup('creature-1', 2, ['flying', 'lifelink']);
      const triggered = triggerBackup(ability, 'creature-2');

      expect(canTargetForBackup('creature-2')).toBe(true);
      expect(getBackupTarget(triggered)).toBe('creature-2');
      expect(getBackupValue(triggered)).toBe(2);
      expect(shouldGrantAbilities(triggered, false)).toBe(true);
      expect(getBackupAbilities(triggered)).toEqual(['flying', 'lifelink']);
      expect(hasRedundantBackup([ability, backup('creature-3', 1, ['menace'])])).toBe(false);
    });
  });

  describe('Bargain (702.166)', () => {
    it('should accept artifacts, enchantments, or tokens as the bargain payment', () => {
      const ability = bargain('spell-1');
      const paid = payBargain(ability, 'artifact-1');

      expect(canPayBargain({ card: { type_line: 'Artifact Creature — Golem' } })).toBe(true);
      expect(canPayBargain({ isToken: true })).toBe(true);
      expect(wasBargained(paid)).toBe(true);
      expect(getBargainedPermanent(paid)).toBe('artifact-1');
      expect(hasRedundantBargain([ability, bargain('spell-2')])).toBe(false);
    });
  });

  describe('Craft (702.167)', () => {
    it('should exile listed materials and return the source transformed', () => {
      const ability = craft('artifact-1', '{3}', 'artifact, creature card');
      const crafted = activateCraft(ability, ['mat-1', 'mat-2']);

      expect(canActivateCraft('battlefield', true, 2)).toBe(true);
      expect(hasCrafted(crafted)).toBe(true);
      expect(getCraftedMaterials(crafted)).toEqual(['mat-1', 'mat-2']);
      expect(getCraftCost(crafted)).toBe('{3}');
      expect(getCraftMaterialsText(crafted)).toBe('artifact, creature card');
      expect(parseCraft('Craft with artifact, creature card {3}')).toEqual({ materials: 'artifact, creature card', cost: '{3}' });
      expect(hasRedundantCraft([ability, craft('artifact-2', '{4}', 'artifact')])).toBe(false);
    });
  });

  describe('Disguise (702.168)', () => {
    it('should cast face down for {3} and turn face up as a special action', () => {
      const ability = disguise('card-1', '{2}{G}');
      const faceDown = disguiseCastFaceDown(ability);
      const faceUp = disguiseTurnFaceUp(faceDown, 4);

      expect(canCastWithDisguise('hand')).toBe(true);
      expect(DISGUISE_CAST_COST).toBe('{3}');
      expect(isFaceDown(faceDown)).toBe(true);
      expect(canTurnDisguiseFaceUp(faceDown, true)).toBe(true);
      expect(getDisguiseCost(faceUp)).toBe('{2}{G}');
      expect(getDisguiseX(faceUp)).toBe(4);
      expect(parseDisguiseCost('Disguise {2}{G}')).toBe('{2}{G}');
      expect(hasRedundantDisguise([ability, disguise('card-2', '{1}{G}')])).toBe(false);
    });
  });

  describe('Solved (702.169)', () => {
    it('should gate the linked ability text on the case being solved', () => {
      const ability = solved('case-1', 'activated', '{T}: Draw a card.');
      const solvedState = solveCase(ability);

      expect(isSolvedAbilityActive(ability)).toBe(false);
      expect(isCaseSolved(solvedState)).toBe(true);
      expect(canUseSolvedAbility(solvedState, 'activated')).toBe(true);
      expect(getSolvedAbilityText(solvedState)).toBe('{T}: Draw a card.');
      expect(hasRedundantSolved([ability, solved('case-2', 'static', 'Creatures you control get +1/+1.')])).toBe(false);
    });
  });
});