import { describe, it, expect } from 'vitest';
import {
  // Replicate (702.56)
  replicate,
  payReplicate,
  getReplicateCopies,
  // Forecast (702.57)
  forecast,
  canActivateForecast,
  activateForecast,
  resetForecast,
  // Graft (702.58)
  graft,
  moveGraftCounter,
  canGraft,
  // Recover (702.59)
  recover,
  // Ripple (702.60)
  ripple,
  getRippleRevealCount,
  // Split Second (702.61)
  splitSecond,
  canActDuringSplitSecond,
  // Suspend (702.62)
  suspend,
  removeTimeCounter,
  canCastSuspended,
  // Vanishing (702.63)
  vanishing,
  removeVanishingCounter,
  shouldSacrificeVanishing,
  // Absorb (702.64)
  absorb,
  applyAbsorb,
  // Aura Swap (702.65)
  auraSwap,
  // Delve (702.66)
  delve,
  exileForDelve,
  getDelveCostReduction,
  // Fortify (702.67)
  fortify,
  attachFortification,
  detachFortification,
  // Frenzy (702.68)
  frenzy,
  getFrenzyBonus,
  // Gravestorm (702.69)
  gravestorm,
  getGravestormCopies,
  // Poisonous (702.70)
  poisonous,
  getPoisonCounters,
  // Transfigure (702.71)
  transfigure,
  // Champion (702.72)
  champion,
  setChampionedCard,
  hasChampionedCard,
  // Changeling (702.73)
  changeling,
  hasCreatureType
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 4 (Rules 702.56-702.73)', () => {
  describe('Replicate (Rule 702.56)', () => {
    it('should create a replicate ability', () => {
      const ability = replicate('Pyromatics', '{1}{R}');
      
      expect(ability.type).toBe('replicate');
      expect(ability.source).toBe('Pyromatics');
      expect(ability.cost).toBe('{1}{R}');
      expect(ability.timesPaid).toBe(0);
    });

    it('should track replicate payments', () => {
      let ability = replicate('Thunderheads', '{2}{U}');
      
      ability = payReplicate(ability, 2);
      expect(ability.timesPaid).toBe(2);
      expect(getReplicateCopies(ability)).toBe(2);
      
      ability = payReplicate(ability, 1);
      expect(getReplicateCopies(ability)).toBe(3);
    });
  });

  describe('Forecast (Rule 702.57)', () => {
    it('should create a forecast ability', () => {
      const ability = forecast('Pride of the Clouds', '{2}{W}{U}', 'Create a 1/1 Bird token');
      
      expect(ability.type).toBe('forecast');
      expect(ability.source).toBe('Pride of the Clouds');
      expect(ability.cost).toBe('{2}{W}{U}');
      expect(ability.activatedThisTurn).toBe(false);
    });

    it('should only activate during upkeep on your turn', () => {
      const ability = forecast('Proclamation of Rebirth', '{2}{W}', 'Return target creature');
      
      expect(canActivateForecast(ability, true, true)).toBe(true);
      expect(canActivateForecast(ability, false, true)).toBe(false);
      expect(canActivateForecast(ability, true, false)).toBe(false);
    });

    it('should only activate once per turn', () => {
      let ability = forecast('Skyclaw Thrash', '{3}{R}', 'Deal 3 damage');
      
      expect(canActivateForecast(ability, true, true)).toBe(true);
      
      ability = activateForecast(ability);
      expect(canActivateForecast(ability, true, true)).toBe(false);
      
      ability = resetForecast(ability);
      expect(canActivateForecast(ability, true, true)).toBe(true);
    });
  });

  describe('Graft (Rule 702.58)', () => {
    it('should create a graft ability', () => {
      const ability = graft('Cytoplast Root-Kin', 4);
      
      expect(ability.type).toBe('graft');
      expect(ability.source).toBe('Cytoplast Root-Kin');
      expect(ability.count).toBe(4);
      expect(ability.countersRemaining).toBe(4);
    });

    it('should move graft counters', () => {
      let ability = graft('Llanowar Reborn', 1);
      
      expect(canGraft(ability)).toBe(true);
      
      ability = moveGraftCounter(ability);
      expect(ability.countersRemaining).toBe(0);
      expect(canGraft(ability)).toBe(false);
    });

    it('should not move counters when none remain', () => {
      let ability = graft('Helium Squirter', 2);
      
      ability = moveGraftCounter(ability);
      ability = moveGraftCounter(ability);
      expect(ability.countersRemaining).toBe(0);
      
      ability = moveGraftCounter(ability);
      expect(ability.countersRemaining).toBe(0);
    });
  });

  describe('Recover (Rule 702.59)', () => {
    it('should create a recover ability', () => {
      const ability = recover('Krovikan Rot', '{1}{B}{B}');
      
      expect(ability.type).toBe('recover');
      expect(ability.source).toBe('Krovikan Rot');
      expect(ability.cost).toBe('{1}{B}{B}');
    });
  });

  describe('Ripple (Rule 702.60)', () => {
    it('should create a ripple ability', () => {
      const ability = ripple('Surging Flame', 4);
      
      expect(ability.type).toBe('ripple');
      expect(ability.source).toBe('Surging Flame');
      expect(ability.count).toBe(4);
    });

    it('should calculate reveal count based on library size', () => {
      const ability = ripple('Surging Sentinels', 4);
      
      expect(getRippleRevealCount(ability, 10)).toBe(4);
      expect(getRippleRevealCount(ability, 2)).toBe(2);
      expect(getRippleRevealCount(ability, 0)).toBe(0);
    });
  });

  describe('Split Second (Rule 702.61)', () => {
    it('should create a split second ability', () => {
      const ability = splitSecond('Sudden Shock');
      
      expect(ability.type).toBe('splitSecond');
      expect(ability.source).toBe('Sudden Shock');
    });

    it('should only allow mana abilities during split second', () => {
      expect(canActDuringSplitSecond(true)).toBe(true);
      expect(canActDuringSplitSecond(false)).toBe(false);
    });
  });

  describe('Suspend (Rule 702.62)', () => {
    it('should create a suspend ability', () => {
      const ability = suspend('Rift Bolt', 1, '{R}');
      
      expect(ability.type).toBe('suspend');
      expect(ability.source).toBe('Rift Bolt');
      expect(ability.count).toBe(1);
      expect(ability.cost).toBe('{R}');
      expect(ability.timeCounters).toBe(1);
    });

    it('should remove time counters', () => {
      let ability = suspend('Ancestral Vision', 4, '{U}');
      
      expect(canCastSuspended(ability)).toBe(false);
      
      ability = removeTimeCounter(ability);
      expect(ability.timeCounters).toBe(3);
      
      ability = removeTimeCounter(ability);
      ability = removeTimeCounter(ability);
      ability = removeTimeCounter(ability);
      expect(ability.timeCounters).toBe(0);
      expect(canCastSuspended(ability)).toBe(true);
    });
  });

  describe('Vanishing (Rule 702.63)', () => {
    it('should create a vanishing ability', () => {
      const ability = vanishing('Reality Acid', 3);
      
      expect(ability.type).toBe('vanishing');
      expect(ability.source).toBe('Reality Acid');
      expect(ability.count).toBe(3);
      expect(ability.timeCounters).toBe(3);
    });

    it('should remove time counters and trigger sacrifice', () => {
      let ability = vanishing('Keldon Marauders', 2);
      
      expect(shouldSacrificeVanishing(ability)).toBe(false);
      
      ability = removeVanishingCounter(ability);
      expect(ability.timeCounters).toBe(1);
      expect(shouldSacrificeVanishing(ability)).toBe(false);
      
      ability = removeVanishingCounter(ability);
      expect(ability.timeCounters).toBe(0);
      expect(shouldSacrificeVanishing(ability)).toBe(true);
    });

    it('should not remove counters below zero', () => {
      let ability = vanishing('Aeon Chronicler', 1);
      
      ability = removeVanishingCounter(ability);
      expect(ability.timeCounters).toBe(0);
      
      ability = removeVanishingCounter(ability);
      expect(ability.timeCounters).toBe(0);
    });
  });

  describe('Absorb (Rule 702.64)', () => {
    it('should create an absorb ability', () => {
      const ability = absorb('Vigean Hydropon', 3);
      
      expect(ability.type).toBe('absorb');
      expect(ability.source).toBe('Vigean Hydropon');
      expect(ability.count).toBe(3);
    });

    it('should reduce damage', () => {
      const ability = absorb('Lichenthrope', 2);
      
      expect(applyAbsorb(ability, 5)).toBe(3);
      expect(applyAbsorb(ability, 2)).toBe(0);
      expect(applyAbsorb(ability, 1)).toBe(0);
    });
  });

  describe('Aura Swap (Rule 702.65)', () => {
    it('should create an aura swap ability', () => {
      const ability = auraSwap('Arcanum Wings', '{2}{U}');
      
      expect(ability.type).toBe('auraSwap');
      expect(ability.source).toBe('Arcanum Wings');
      expect(ability.cost).toBe('{2}{U}');
    });
  });

  describe('Delve (Rule 702.66)', () => {
    it('should create a delve ability', () => {
      const ability = delve('Treasure Cruise');
      
      expect(ability.type).toBe('delve');
      expect(ability.source).toBe('Treasure Cruise');
      expect(ability.cardsExiled).toBe(0);
    });

    it('should track exiled cards for cost reduction', () => {
      let ability = delve('Dig Through Time');
      
      expect(getDelveCostReduction(ability)).toBe(0);
      
      ability = exileForDelve(ability);
      ability = exileForDelve(ability);
      ability = exileForDelve(ability);
      
      expect(ability.cardsExiled).toBe(3);
      expect(getDelveCostReduction(ability)).toBe(3);
    });
  });

  describe('Fortify (Rule 702.67)', () => {
    it('should create a fortify ability', () => {
      const ability = fortify('Darksteel Garrison', '{3}');
      
      expect(ability.type).toBe('fortify');
      expect(ability.source).toBe('Darksteel Garrison');
      expect(ability.cost).toBe('{3}');
      expect(ability.attachedTo).toBeUndefined();
    });

    it('should attach and detach fortifications', () => {
      let ability = fortify('Fortified Area', '{2}');
      
      ability = attachFortification(ability, 'Plains-1');
      expect(ability.attachedTo).toBe('Plains-1');
      
      ability = detachFortification(ability);
      expect(ability.attachedTo).toBeUndefined();
    });
  });

  describe('Frenzy (Rule 702.68)', () => {
    it('should create a frenzy ability', () => {
      const ability = frenzy('Goblin Berserker', 2);
      
      expect(ability.type).toBe('frenzy');
      expect(ability.source).toBe('Goblin Berserker');
      expect(ability.count).toBe(2);
    });

    it('should provide power bonus when unblocked', () => {
      const ability = frenzy('Mogg Flunkies', 1);
      
      expect(getFrenzyBonus(ability)).toBe(1);
    });
  });

  describe('Gravestorm (Rule 702.69)', () => {
    it('should create a gravestorm ability', () => {
      const ability = gravestorm('Bitter Ordeal', 3);
      
      expect(ability.type).toBe('gravestorm');
      expect(ability.source).toBe('Bitter Ordeal');
      expect(ability.permanentsDiedThisTurn).toBe(3);
    });

    it('should calculate copies based on permanents died', () => {
      const ability = gravestorm('Bitter Ordeal', 5);
      
      expect(getGravestormCopies(ability)).toBe(5);
    });
  });

  describe('Poisonous (Rule 702.70)', () => {
    it('should create a poisonous ability', () => {
      const ability = poisonous('Virulent Sliver', 1);
      
      expect(ability.type).toBe('poisonous');
      expect(ability.source).toBe('Virulent Sliver');
      expect(ability.count).toBe(1);
    });

    it('should determine poison counters to give', () => {
      const ability = poisonous('Snake Cult Initiation', 3);
      
      expect(getPoisonCounters(ability)).toBe(3);
    });
  });

  describe('Transfigure (Rule 702.71)', () => {
    it('should create a transfigure ability', () => {
      const ability = transfigure('Fleshwrither', '{1}{B}{B}');
      
      expect(ability.type).toBe('transfigure');
      expect(ability.source).toBe('Fleshwrither');
      expect(ability.cost).toBe('{1}{B}{B}');
    });
  });

  describe('Champion (Rule 702.72)', () => {
    it('should create a champion ability', () => {
      const ability = champion('Changeling Hero', 'Shapeshifter');
      
      expect(ability.type).toBe('champion');
      expect(ability.source).toBe('Changeling Hero');
      expect(ability.objectType).toBe('Shapeshifter');
      expect(ability.championedCard).toBeUndefined();
    });

    it('should track championed card', () => {
      let ability = champion('Changeling Berserker', 'Shapeshifter');
      
      expect(hasChampionedCard(ability)).toBe(false);
      
      ability = setChampionedCard(ability, 'card-123');
      expect(hasChampionedCard(ability)).toBe(true);
      expect(ability.championedCard).toBe('card-123');
    });
  });

  describe('Changeling (Rule 702.73)', () => {
    it('should create a changeling ability', () => {
      const ability = changeling('Chameleon Colossus');
      
      expect(ability.type).toBe('changeling');
      expect(ability.source).toBe('Chameleon Colossus');
    });

    it('should have all creature types', () => {
      const ability = changeling('Amoeboid Changeling');
      
      expect(hasCreatureType(ability, 'Human')).toBe(true);
      expect(hasCreatureType(ability, 'Zombie')).toBe(true);
      expect(hasCreatureType(ability, 'Dragon')).toBe(true);
      expect(hasCreatureType(ability, 'Sliver')).toBe(true);
      expect(hasCreatureType(ability, 'Anything')).toBe(true);
    });
  });
});
