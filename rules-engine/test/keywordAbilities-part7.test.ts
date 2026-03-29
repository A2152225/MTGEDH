/**
 * Tests for Part 7 keyword abilities (Rules 702.112-702.129).
 */

import { describe, expect, it } from 'vitest';
import {
  activateCrew,
  activateEmbalm,
  activateEternalize,
  aftermath,
  applyUndaunted,
  awaken,
  canActivateCrew,
  canActivateEmbalm,
  canActivateEternalize,
  canAnyCreatureBlockSkulk,
  canCastAftermath,
  canCastAftermathFromZone,
  canCastAftermathNow,
  canChooseEscalateModes,
  canChoosePartnerCommander,
  canPartnerTogether,
  canSacrificeForEmerge,
  canTapForCrew,
  canTapForImprovise,
  canTargetLandForAwaken,
  canTriggerMelee,
  canTriggerMyriad,
  canTriggerRenown,
  canUseSurge,
  canUseSurgeFromTeam,
  castFromGraveyard,
  castWithAwaken,
  castWithEmerge,
  castWithSurge,
  chooseBackground,
  chooseCounters,
  chooseEscalateModes,
  chooseTokens,
  clearMeleeBonus,
  clearMyriadTokens,
  countActiveOpponents,
  crew,
  createEmbalmToken,
  createEternalizeToken,
  createFabricateServoTokens,
  devoid,
  embalm,
  emerge,
  escalate,
  eternalize,
  fabricate,
  FABRICATE_SERVO_TOKEN,
  friendsForever,
  getAwakenedLand,
  getAwakenValue,
  getCombinedPartnerColorIdentity,
  getCrewedCreatures,
  getCrewPowerShortfall,
  getEmbalmToken,
  getEmergeManaReduction,
  getEternalizeToken,
  getEscalateCostMultiplier,
  getFabricateTokens,
  getIllegalSkulkBlockers,
  getImprovisedArtifacts,
  getImprovisedCost,
  getImproviseManaValue,
  getIngestExileCount,
  getIngestTriggers,
  getMeleeBonus,
  getMeleeOpponentsAttacked,
  getModesChosen,
  getMyriadOpponents,
  getMyriadTokenCount,
  getMyriadTokensToExile,
  getReducedEmergeCost,
  getReducedUndauntedCost,
  getRenownValue,
  getSacrificedCreature,
  getSurgeCost,
  getUndauntedReduction,
  hasRedundantAftermath,
  hasRedundantAwaken,
  hasRedundantCrew,
  hasRedundantDevoid,
  hasRedundantEmbalm,
  hasRedundantEmerge,
  hasRedundantEscalate,
  hasRedundantEternalize,
  hasRedundantFabricate,
  hasRedundantImprovise,
  hasRedundantIngest,
  hasRedundantMelee,
  hasRedundantMyriad,
  hasRedundantPartner,
  hasRedundantRenown,
  hasRedundantSkulk,
  hasRedundantSurge,
  hasRedundantUndaunted,
  improvise,
  ingest,
  isCrewed,
  isEmbalmed,
  isEternalized,
  isRenowned,
  melee,
  myriad,
  parseAwaken,
  parseEmbalmCost,
  parseEmerge,
  parseEscalateCost,
  parseEternalizeCost,
  parseRenownValue,
  parseSurgeCost,
  partner,
  partnerWith,
  partnerWithRequirement,
  renown,
  shouldExileAftermath,
  shouldFabricateCounters,
  shouldFabricateTokens,
  shouldTriggerIngest,
  skulk,
  surge,
  tapArtifactsForImprovise,
  triggerIngest,
  triggerMelee,
  triggerMyriad,
  triggerRenown,
  undaunted,
  uncrew,
  wasAwakened,
  wasEmerged,
  wasSurged,
} from '../src/keywordAbilities';
import { applyDevoidToColors, appliesDevoidInZone, isColorless } from '../src/keywordAbilities/devoid';

describe('Part 7: Keyword Abilities (Rules 702.112-702.129)', () => {
  describe('Renown (702.112)', () => {
    it('should trigger once, mark the creature renowned, and parse renown values', () => {
      const ability = renown('creature-1', 2);
      const triggered = triggerRenown(ability);

      expect(canTriggerRenown(ability)).toBe(true);
      expect(canTriggerRenown(triggered)).toBe(false);
      expect(isRenowned(triggered)).toBe(true);
      expect(getRenownValue(triggered)).toBe(2);
      expect(parseRenownValue('Renown 2')).toBe(2);
      expect(hasRedundantRenown([ability, renown('creature-2', 3)])).toBe(false);
    });
  });

  describe('Awaken (702.113)', () => {
    it('should target your land when casting with awaken and parse the awaken rider', () => {
      const ability = awaken('spell-1', 3, '{4}{U}{U}');
      const cast = castWithAwaken(ability, 'land-1');

      expect(canTargetLandForAwaken({ controller: 'p1', card: { type_line: 'Land' } }, 'p1')).toBe(true);
      expect(canTargetLandForAwaken({ controller: 'p2', card: { type_line: 'Land' } }, 'p1')).toBe(false);
      expect(wasAwakened(cast)).toBe(true);
      expect(getAwakenedLand(cast)).toBe('land-1');
      expect(getAwakenValue(cast)).toBe(3);
      expect(parseAwaken('Awaken 3—{4}{U}{U}')).toEqual({ awakenValue: 3, awakenCost: '{4}{U}{U}' });
      expect(hasRedundantAwaken([ability, awaken('spell-2', 2, '{5}{U}')])).toBe(false);
    });
  });

  describe('Devoid (702.114)', () => {
    it('should make the object colorless in every zone', () => {
      const ability = devoid('spell-1');

      expect(ability.type).toBe('devoid');
      expect(isColorless(true)).toBe(true);
      expect(applyDevoidToColors(['U', 'R'])).toEqual([]);
      expect(applyDevoidToColors(undefined)).toEqual([]);
      expect(appliesDevoidInZone('hand')).toBe(true);
      expect(hasRedundantDevoid([ability, devoid('spell-2')])).toBe(true);
    });
  });

  describe('Ingest (702.115)', () => {
    it('should track combat-damage triggers and exile one top card per trigger', () => {
      const ability = ingest('creature-1');
      const triggered = triggerIngest(triggerIngest(ability));

      expect(shouldTriggerIngest(true)).toBe(true);
      expect(getIngestTriggers(triggered)).toBe(2);
      expect(getIngestExileCount()).toBe(1);
      expect(hasRedundantIngest([ability, ingest('creature-2')])).toBe(false);
    });
  });

  describe('Myriad (702.116)', () => {
    it('should count nondefending opponents, record created tokens, and clear them after combat', () => {
      const ability = myriad('creature-1');
      const triggered = triggerMyriad(ability, ['token-1', 'token-2']);
      const cleared = clearMyriadTokens(triggered);

      expect(getMyriadOpponents(['p2', 'p3', 'p4'], 'p2')).toEqual(['p3', 'p4']);
      expect(getMyriadTokenCount(['p2', 'p3', 'p4'], 'p2')).toBe(2);
      expect(canTriggerMyriad(true, 3)).toBe(true);
      expect(getMyriadTokensToExile(triggered)).toEqual(['token-1', 'token-2']);
      expect(cleared.tokensCreated).toEqual([]);
      expect(hasRedundantMyriad([ability, myriad('creature-2')])).toBe(false);
    });
  });

  describe('Surge (702.117)', () => {
    it('should allow team-based surge casting and parse surge costs', () => {
      const ability = surge('spell-1', '{1}{U}');
      const cast = castWithSurge(ability);

      expect(canUseSurge(true)).toBe(true);
      expect(canUseSurgeFromTeam(false, true)).toBe(true);
      expect(wasSurged(cast)).toBe(true);
      expect(getSurgeCost(cast)).toBe('{1}{U}');
      expect(parseSurgeCost('Surge {1}{U}')).toBe('{1}{U}');
      expect(hasRedundantSurge([ability, surge('spell-2', '{1}{U}')])).toBe(true);
    });
  });

  describe('Skulk (702.118)', () => {
    it('should reject larger blockers and report the illegal ones', () => {
      const ability = skulk('creature-1');

      expect(canAnyCreatureBlockSkulk(2, [{ power: 1 }, { power: 2 }])).toBe(true);
      expect(canAnyCreatureBlockSkulk(2, [{ power: 3 }, { power: 4 }])).toBe(false);
      expect(getIllegalSkulkBlockers(2, [{ id: 'a', power: 1 }, { id: 'b', power: 4 }])).toEqual(['b']);
      expect(hasRedundantSkulk([ability, skulk('creature-2')])).toBe(true);
    });
  });

  describe('Emerge (702.119)', () => {
    it('should sacrifice an appropriate permanent, reduce generic mana, and parse emerge variants', () => {
      const ability = emerge('spell-1', '{6}{U}', 'artifact');
      const cast = castWithEmerge(ability, 'artifact-creature-1', 5);

      expect(canSacrificeForEmerge({ card: { type_line: 'Artifact Creature — Drone' } }, 'artifact')).toBe(true);
      expect(canSacrificeForEmerge({ card: { type_line: 'Creature — Eldrazi' } }, 'artifact')).toBe(false);
      expect(wasEmerged(cast)).toBe(true);
      expect(getSacrificedCreature(cast)).toBe('artifact-creature-1');
      expect(getEmergeManaReduction(cast)).toBe(5);
      expect(getReducedEmergeCost('{6}{U}', 5)).toBe('{1}{U}');
      expect(parseEmerge('Emerge from artifact — {6}{U}')).toEqual({ quality: 'artifact', emergeCost: '{6}{U}' });
      expect(hasRedundantEmerge([ability, emerge('spell-2', '{6}{U}')])).toBe(true);
    });
  });

  describe('Escalate (702.120)', () => {
    it('should track chosen modes, calculate the extra-cost multiplier, and parse escalate costs', () => {
      const ability = escalate('spell-1', '{2}');
      const chosen = chooseEscalateModes(ability, 3);

      expect(canChooseEscalateModes(3, 1)).toBe(true);
      expect(canChooseEscalateModes(3, 4)).toBe(false);
      expect(getModesChosen(chosen)).toBe(3);
      expect(getEscalateCostMultiplier(chosen)).toBe(2);
      expect(parseEscalateCost('Escalate {2}')).toBe('{2}');
      expect(hasRedundantEscalate([ability, escalate('spell-2', '{3}')])).toBe(false);
    });
  });

  describe('Melee (702.121)', () => {
    it('should count distinct attacked opponents and clear the temporary bonus at end of turn', () => {
      const ability = melee('creature-1');
      const triggered = triggerMelee(ability, getMeleeOpponentsAttacked(['p2', 'p3', 'p2']));
      const cleared = clearMeleeBonus(triggered);

      expect(canTriggerMelee(true)).toBe(true);
      expect(getMeleeOpponentsAttacked(['p2', 'p3', 'p2'])).toBe(2);
      expect(getMeleeBonus(triggered)).toBe(2);
      expect(getMeleeBonus(cleared)).toBe(0);
      expect(hasRedundantMelee([ability, melee('creature-2')])).toBe(false);
    });
  });

  describe('Crew (702.122)', () => {
    it('should validate crew candidates, record the crewing creatures, and reset at end of turn', () => {
      const ability = crew('vehicle-1', 3);
      const activated = activateCrew(ability, ['c1', 'c2'], 4);
      const reset = uncrew(activated!);

      expect(canTapForCrew({ controller: 'p1', tapped: false, card: { type_line: 'Creature — Pilot' } }, 'p1')).toBe(true);
      expect(canTapForCrew({ controller: 'p1', tapped: true, card: { type_line: 'Creature — Pilot' } }, 'p1')).toBe(false);
      expect(canActivateCrew(ability, ['c1', 'c2'], 4)).toBe(true);
      expect(getCrewPowerShortfall(ability, 2)).toBe(1);
      expect(isCrewed(activated!)).toBe(true);
      expect(getCrewedCreatures(activated!)).toEqual(['c1', 'c2']);
      expect(isCrewed(reset)).toBe(false);
      expect(hasRedundantCrew([ability, crew('vehicle-2', 2)])).toBe(false);
    });
  });

  describe('Fabricate (702.123)', () => {
    it('should distinguish the counters and Servo-token branches', () => {
      const ability = fabricate('artifact-1', 2);
      const counters = chooseCounters(ability);
      const tokens = chooseTokens(ability, ['servo-1', 'servo-2']);
      const created = createFabricateServoTokens('p1', ['servo-1', 'servo-2']);

      expect(shouldFabricateCounters(counters)).toBe(true);
      expect(shouldFabricateTokens(tokens)).toBe(true);
      expect(getFabricateTokens(tokens)).toEqual(['servo-1', 'servo-2']);
      expect(created).toHaveLength(2);
      expect(created[0].basePower).toBe(1);
      expect(created[0].baseToughness).toBe(1);
      expect(FABRICATE_SERVO_TOKEN.name).toBe('Servo');
      expect(hasRedundantFabricate([ability, fabricate('artifact-2', 1)])).toBe(false);
    });
  });

  describe('Partner (702.124)', () => {
    it('should validate partner commander pairings and combine color identities', () => {
      const basic = partner('A');
      const other = partner('B');
      const namedA = partnerWith('Rowan', 'Will');
      const namedB = partnerWith('Will', 'Rowan');
      const friendsA = friendsForever('Alice');
      const friendsB = friendsForever('Bob');
      const background = chooseBackground('Commander');
      const requirementA = partnerWithRequirement('Hero', 'with another legendary creature');
      const requirementB = partnerWithRequirement('Other', 'with another legendary creature');

      expect(canChoosePartnerCommander(basic, { isLegendary: true })).toBe(true);
      expect(canChoosePartnerCommander(background, { hasBackgroundType: true })).toBe(true);
      expect(canPartnerTogether(basic, other)).toBe(true);
      expect(canPartnerTogether(namedA, namedB)).toBe(true);
      expect(canPartnerTogether(friendsA, friendsB)).toBe(true);
      expect(canPartnerTogether(requirementA, requirementB)).toBe(true);
      expect(getCombinedPartnerColorIdentity([{ colorIdentity: ['U', 'R'] }, { colorIdentity: ['R', 'W'] }])).toEqual(['U', 'R', 'W']);
      expect(hasRedundantPartner([basic, other])).toBe(false);
    });
  });

  describe('Undaunted (702.125)', () => {
    it('should count only active opponents and reduce generic mana accordingly', () => {
      const ability = undaunted('spell-1');
      const applied = applyUndaunted(ability, countActiveOpponents([true, false, true]));

      expect(countActiveOpponents([true, false, true])).toBe(2);
      expect(getUndauntedReduction(applied)).toBe(2);
      expect(getReducedUndauntedCost('{5}{R}', 2)).toBe('{3}{R}');
      expect(getReducedUndauntedCost('{2}', 3)).toBe('{0}');
      expect(hasRedundantUndaunted([ability, undaunted('spell-2')])).toBe(false);
    });
  });

  describe('Improvise (702.126)', () => {
    it('should tap artifacts for generic mana only and track the tapped artifacts', () => {
      const ability = improvise('spell-1');
      const tapped = tapArtifactsForImprovise(ability, ['artifact-1', 'artifact-2']);

      expect(canTapForImprovise({ controller: 'p1', tapped: false, card: { type_line: 'Artifact Creature — Thopter' } }, 'p1')).toBe(true);
      expect(canTapForImprovise({ controller: 'p1', tapped: true, card: { type_line: 'Artifact' } }, 'p1')).toBe(false);
      expect(getImprovisedArtifacts(tapped)).toEqual(['artifact-1', 'artifact-2']);
      expect(getImproviseManaValue(tapped)).toBe(2);
      expect(getImprovisedCost('{3}{U}', 2)).toBe('{1}{U}');
      expect(hasRedundantImprovise([ability, improvise('spell-2')])).toBe(true);
    });
  });

  describe('Aftermath (702.127)', () => {
    it('should allow casting only from graveyard at sorcery timing and then exile the spell', () => {
      const ability = aftermath('split-half');
      const cast = castFromGraveyard(ability);

      expect(canCastAftermath('graveyard')).toBe(true);
      expect(canCastAftermathFromZone('hand')).toBe(false);
      expect(canCastAftermathNow('graveyard', true, true)).toBe(true);
      expect(canCastAftermathNow('graveyard', false, true)).toBe(false);
      expect(shouldExileAftermath(cast)).toBe(true);
      expect(hasRedundantAftermath([ability, aftermath('other-half')])).toBe(true);
    });
  });

  describe('Embalm (702.128)', () => {
    it('should activate from graveyard at sorcery speed and create a white Zombie token copy', () => {
      const ability = embalm('creature-1', '{3}{W}');
      const activated = activateEmbalm(ability, 'token-1');
      const token = createEmbalmToken('token-1', 'p1', {
        name: 'Aven Wind Guide',
        type_line: 'Creature — Bird Warrior',
        power: '3',
        toughness: '3',
      });

      expect(canActivateEmbalm('graveyard', true)).toBe(true);
      expect(canActivateEmbalm('hand', true)).toBe(false);
      expect(isEmbalmed(activated)).toBe(true);
      expect(getEmbalmToken(activated)).toBe('token-1');
      expect(token.card.colors).toEqual(['W']);
      expect(String(token.card.type_line)).toContain('Zombie');
      expect(parseEmbalmCost('Embalm {3}{W}')).toBe('{3}{W}');
      expect(hasRedundantEmbalm([ability, embalm('creature-2', '{4}{W}')])).toBe(false);
    });
  });

  describe('Eternalize (702.129)', () => {
    it('should activate from graveyard at sorcery speed and create a black 4/4 Zombie token copy', () => {
      const ability = eternalize('creature-1', '{5}{B}{B}');
      const activated = activateEternalize(ability, 'token-2');
      const token = createEternalizeToken('token-2', 'p1', {
        name: 'Champion of Wits',
        type_line: 'Creature — Naga Wizard',
        power: '2',
        toughness: '1',
      });

      expect(canActivateEternalize('graveyard', true)).toBe(true);
      expect(canActivateEternalize('graveyard', false)).toBe(false);
      expect(isEternalized(activated)).toBe(true);
      expect(getEternalizeToken(activated)).toBe('token-2');
      expect(token.basePower).toBe(4);
      expect(token.baseToughness).toBe(4);
      expect(token.card.colors).toEqual(['B']);
      expect(parseEternalizeCost('Eternalize {5}{B}{B}')).toBe('{5}{B}{B}');
      expect(hasRedundantEternalize([ability, eternalize('creature-2', '{4}{B}{B}')])).toBe(false);
    });
  });
});