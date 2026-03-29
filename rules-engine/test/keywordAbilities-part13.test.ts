/**
 * Tests for Part 13 Keyword Abilities (Rules 702.177-702.183)
 * BRJOM through EMGS era mechanics
 */

import { describe, it, expect } from 'vitest';
import {
  activateExhaust,
  applySpeedSBA,
  canActivateExhaust,
  canCastWithHarmonize,
  canChooseTieredMode,
  canIncreaseSpeed,
  createJobSelectHeroToken,
  exhaust,
  getChosenTieredMode,
  getCurrentSpeed,
  getHarmonizeCostReduction,
  getHarmonizeReducedCost,
  getHeroToken,
  getMaxSpeedAbility,
  getMaxSpeedThreshold,
  harmonize,
  hasActivatedExhaust,
  hasRedundantExhaust,
  hasRedundantHarmonize,
  hasRedundantJobSelect,
  mobilize,
  executeMobilize,
  getMobilizeTokens,
  getMobilizeValue,
  hasRedundantMaxSpeed,
  hasRedundantMobilize,
  hasRedundantStartYourEngines,
  hasRedundantTiered,
  increaseSpeed,
  increaseSpeedBy,
  isMaxSpeedActive,
  jobSelect,
  JOB_SELECT_HERO_TOKEN,
  maxSpeed,
  parseMobilizeValue,
  parseExhaustActivation,
  parseHarmonizeCost,
  parseMaxSpeedAbility,
  MOBILIZE_WARRIOR_TOKEN,
  startYourEngines,
  tiered,
  triggerJobSelect,
  updateSpeed,
  wasHarmonized,
  castWithHarmonize,
  hasSpeed,
  chooseTieredMode,
} from '../src/keywordAbilities';

describe('Part 13: Keyword Abilities (Rules 702.177-702.183)', () => {
  describe('Exhaust (702.177)', () => {
    it('should activate only once and parse keyword activation text', () => {
      const ability = exhaust('engine', '{3}', 'Add {R}{R}{R}');
      const activated = activateExhaust(ability);

      expect(canActivateExhaust(ability)).toBe(true);
      expect(activated?.hasBeenActivated).toBe(true);
      expect(hasActivatedExhaust(activated!)).toBe(true);
      expect(canActivateExhaust(activated!)).toBe(false);
      expect(activateExhaust(activated!)).toBeNull();
      expect(parseExhaustActivation('Exhaust — {3}: Add {R}{R}{R}. Activate only once.')).toEqual({
        cost: '{3}',
        effect: 'Add {R}{R}{R}',
      });
      expect(hasRedundantExhaust([ability, exhaust('other', '{2}', 'Draw a card')])).toBe(false);
    });
  });

  describe('Start Your Engines! (702.179)', () => {
    it('should establish and increase speed using the speed rules helpers', () => {
      const ability = startYourEngines('vehicle');
      const afterSba = applySpeedSBA(ability);
      const afterTrigger = increaseSpeed(afterSba);
      const afterBigIncrease = increaseSpeedBy(ability, 3);

      expect(hasSpeed(ability)).toBe(false);
      expect(getCurrentSpeed(afterSba)).toBe(1);
      expect(canIncreaseSpeed(afterSba)).toBe(true);
      expect(getCurrentSpeed(afterTrigger!)).toBe(2);
      expect(canIncreaseSpeed(afterTrigger!)).toBe(false);
      expect(getCurrentSpeed(afterBigIncrease)).toBe(3);
      expect(hasRedundantStartYourEngines([ability, startYourEngines('vehicle-2')])).toBe(true);
    });
  });

  describe('Harmonize (702.180)', () => {
    it('should cast from graveyard, track reduction, and reduce generic mana only', () => {
      const ability = harmonize('spell', '{2}{G}');
      const cast = castWithHarmonize(ability, 'creature-1', 3);

      expect(canCastWithHarmonize('graveyard')).toBe(true);
      expect(canCastWithHarmonize('hand')).toBe(false);
      expect(wasHarmonized(cast)).toBe(true);
      expect(getHarmonizeCostReduction(cast)).toBe(3);
      expect(getHarmonizeReducedCost('{4}{G}{G}', 3)).toBe('{1}{G}{G}');
      expect(getHarmonizeReducedCost('{2}{G}', 4)).toBe('{G}');
      expect(parseHarmonizeCost('Harmonize {2}{G} (You may cast this card from your graveyard...)')).toBe('{2}{G}');
      expect(hasRedundantHarmonize([ability, harmonize('spell-2', '{3}{U}')])).toBe(false);
    });
  });

  describe('Max Speed (702.178)', () => {
    it('should grant an ability only once speed reaches the threshold', () => {
      const ability = maxSpeed('vehicle', 'Flying');
      const slow = updateSpeed(ability, 3);
      const fast = updateSpeed(ability, 4);

      expect(getMaxSpeedThreshold()).toBe(4);
      expect(getMaxSpeedAbility(ability)).toBe('Flying');
      expect(isMaxSpeedActive(slow)).toBe(false);
      expect(isMaxSpeedActive(fast)).toBe(true);
      expect(parseMaxSpeedAbility('Max speed — Flying')).toBe('Flying');
      expect(hasRedundantMaxSpeed([ability, maxSpeed('vehicle-2', 'Haste')])).toBe(false);
    });
  });

  describe('Mobilize (702.181)', () => {
    it('should create Mobilize ability with value', () => {
      const ability = mobilize('creature1', 3);
      
      expect(ability.type).toBe('mobilize');
      expect(ability.source).toBe('creature1');
      expect(ability.mobilizeValue).toBe(3);
      expect(ability.tokenIds).toEqual([]);
    });

    it('should get mobilize value', () => {
      const ability = mobilize('creature1', 5);
      expect(getMobilizeValue(ability)).toBe(5);
    });

    it('should have correct Warrior token characteristics', () => {
      expect(MOBILIZE_WARRIOR_TOKEN.name).toBe('Warrior');
      expect(MOBILIZE_WARRIOR_TOKEN.colors).toContain('R');
      expect(MOBILIZE_WARRIOR_TOKEN.power).toBe(1);
      expect(MOBILIZE_WARRIOR_TOKEN.toughness).toBe(1);
      expect(MOBILIZE_WARRIOR_TOKEN.entersTapped).toBe(true);
      expect(MOBILIZE_WARRIOR_TOKEN.entersAttacking).toBe(true);
      expect(MOBILIZE_WARRIOR_TOKEN.sacrificeAtEndStep).toBe(true);
    });

    it('should execute mobilize and create Warrior tokens', () => {
      const result = executeMobilize('creature1', 3, 'player1');
      
      expect(result.ability.type).toBe('mobilize');
      expect(result.ability.mobilizeValue).toBe(3);
      expect(result.tokens).toHaveLength(3);
      
      // Check each token
      for (const token of result.tokens) {
        expect(token.controller).toBe('player1');
        expect(token.tapped).toBe(true); // Enters tapped
        expect(token.isToken).toBe(true);
        expect(token.basePower).toBe(1);
        expect(token.baseToughness).toBe(1);
        expect(token.sacrificeAtEndStep).toBe(true);
        expect(token.isAttacking).toBe(true);
        expect((token.card as any).name).toBe('Warrior');
      }
    });

    it('should get mobilize tokens after execution', () => {
      const result = executeMobilize('creature1', 2, 'player1');
      const tokenIds = getMobilizeTokens(result.ability);
      
      expect(tokenIds).toHaveLength(2);
    });

    it('should not have redundant mobilize abilities', () => {
      const abilities = [
        mobilize('creature1', 2),
        mobilize('creature2', 3),
      ];
      
      expect(hasRedundantMobilize(abilities)).toBe(false);
    });

    it('should parse mobilize value from oracle text', () => {
      expect(parseMobilizeValue('Mobilize 2 (Whenever this creature attacks...)')).toBe(2);
      expect(parseMobilizeValue('Mobilize 5')).toBe(5);
      expect(parseMobilizeValue('Flying')).toBeNull();
      expect(parseMobilizeValue('')).toBeNull();
    });

    it('should create unique token IDs', () => {
      const result = executeMobilize('creature1', 3, 'player1');
      const ids = result.tokens.map(t => t.id);
      const uniqueIds = new Set(ids);
      
      expect(uniqueIds.size).toBe(3); // All IDs should be unique
    });

    it('should include log message in result', () => {
      const result = executeMobilize('creature1', 2, 'player1');
      
      expect(result.log).toContain('Mobilize 2');
      expect(result.log).toContain('Warrior');
    });
  });

  describe('Job Select (702.182)', () => {
    it('should create a Hero token and record the job select trigger result', () => {
      const ability = jobSelect('equipment-1');
      const triggered = triggerJobSelect(ability, 'hero-1');
      const token = createJobSelectHeroToken('hero-1', 'player1');

      expect(getHeroToken(triggered)).toBe('hero-1');
      expect(JOB_SELECT_HERO_TOKEN.name).toBe('Hero');
      expect(token.isToken).toBe(true);
      expect(token.basePower).toBe(1);
      expect(token.baseToughness).toBe(1);
      expect((token.card as any).type_line).toContain('Hero');
      expect(hasRedundantJobSelect([ability, jobSelect('equipment-2')])).toBe(false);
    });
  });

  describe('Tiered (702.183)', () => {
    it('should select a valid mode and return its associated cost', () => {
      const ability = tiered('limit-break', ['{1}{R}', '{2}{R}{R}', '{4}{R}{R}']);
      const chosen = chooseTieredMode(ability, 1);

      expect(canChooseTieredMode(ability, 1)).toBe(true);
      expect(canChooseTieredMode(ability, -1)).toBe(false);
      expect(canChooseTieredMode(ability, 3)).toBe(false);
      expect(getChosenTieredMode(chosen)).toBe(1);
      expect(hasRedundantTiered([ability, tiered('other', ['{1}{U}'])])).toBe(true);
    });
  });
});
