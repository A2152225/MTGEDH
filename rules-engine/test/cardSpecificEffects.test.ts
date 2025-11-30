/**
 * Tests for card-specific effect modules
 */
import { describe, it, expect } from 'vitest';
import {
  // Fetchlands
  isFetchland,
  getFetchlandConfig,
  buildFetchlandSearchCriteria,
  // ETB Token Creators
  isETBTokenCreator,
  getETBTokenConfig,
  // Triggered Ability Cards
  hasSpecialTriggeredAbility,
  getTriggeredAbilityConfig,
  // Cast Triggers (pattern-based)
  hasCastTrigger,
  detectCastTrigger,
  wouldTriggerCastAbility,
  getStormCount,
  hasCascade,
  getCascadeCount,
  // Trigger Copying (pattern-based)
  hasTriggerCopying,
  detectTriggerCopying,
  getTokenMultiplier,
  getActivatedTriggerCopiers,
  // Cost Reduction
  hasCostReduction,
  getCostReductionConfig,
  applyCostReduction,
  // Activated Abilities
  hasSpecialActivatedAbility,
  getActivatedAbilityConfig,
  targetsStack,
  // Echo
  hasEcho,
  getEchoConfig,
  detectEchoFromText,
  // Additional Costs
  hasAdditionalCost,
  getAdditionalCostConfig,
  detectAdditionalCostFromText,
  // Search Effects
  hasSearchEffect,
  getSearchEffectConfig,
  parseSearchFilter,
  // Creature Count
  hasCreatureCountEffect,
  getCreatureCountEffectConfig,
  countCreaturesWithFilter,
  // Planeswalkers
  isSpecialPlaneswalker,
  getPlaneswalkerConfig,
  canActivatePlaneswalkerAbility,
  calculateNewLoyalty,
} from '../src/cards';

describe('Card-Specific Effects', () => {
  describe('Fetchlands', () => {
    it('should identify Polluted Delta as a fetchland', () => {
      expect(isFetchland('Polluted Delta')).toBe(true);
      expect(isFetchland('polluted delta')).toBe(true);
    });

    it('should identify Verdant Catacombs as a fetchland', () => {
      expect(isFetchland('Verdant Catacombs')).toBe(true);
    });

    it('should identify Evolving Wilds as a fetchland', () => {
      expect(isFetchland('Evolving Wilds')).toBe(true);
    });

    it('should return correct config for Polluted Delta', () => {
      const config = getFetchlandConfig('Polluted Delta');
      expect(config).toBeDefined();
      expect(config!.searchTypes).toContain('Island');
      expect(config!.searchTypes).toContain('Swamp');
      expect(config!.paysLife).toBe(1);
      expect(config!.entersTapped).toBe(false);
    });

    it('should return correct config for Evolving Wilds', () => {
      const config = getFetchlandConfig('Evolving Wilds');
      expect(config).toBeDefined();
      expect(config!.searchTypes).toContain('Basic Land');
      expect(config!.paysLife).toBe(0);
      expect(config!.entersTapped).toBe(true);
    });

    it('should build correct search criteria for true fetchlands', () => {
      const config = getFetchlandConfig('Polluted Delta')!;
      const criteria = buildFetchlandSearchCriteria(config);
      expect(criteria.cardTypes).toBeDefined();
      expect(criteria.cardTypes).toContain('Island');
      expect(criteria.cardTypes).toContain('Swamp');
    });

    it('should build correct search criteria for basic-only fetchlands', () => {
      const config = getFetchlandConfig('Evolving Wilds')!;
      const criteria = buildFetchlandSearchCriteria(config);
      expect(criteria.cardType).toBe('basic land');
    });

    it('should not identify non-fetchlands', () => {
      expect(isFetchland('Island')).toBe(false);
      expect(isFetchland('Sol Ring')).toBe(false);
    });
  });

  describe('ETB Token Creators', () => {
    it('should identify Deranged Hermit', () => {
      expect(isETBTokenCreator('Deranged Hermit')).toBe(true);
    });

    it('should identify Drey Keeper', () => {
      expect(isETBTokenCreator('Drey Keeper')).toBe(true);
    });

    it('should identify Skullport Merchant', () => {
      expect(isETBTokenCreator('Skullport Merchant')).toBe(true);
    });

    it('should identify Deep Forest Hermit', () => {
      expect(isETBTokenCreator('Deep Forest Hermit')).toBe(true);
    });

    it('should return correct config for Deranged Hermit', () => {
      const config = getETBTokenConfig('Deranged Hermit');
      expect(config).toBeDefined();
      expect(config!.tokenType).toBe('1/1 Squirrel');
      expect(config!.tokenCount).toBe(4);
      expect(config!.buffEffect).toBeDefined();
      expect(config!.buffEffect!.types).toContain('Squirrel');
    });

    it('should return correct config for Deep Forest Hermit with vanishing', () => {
      const config = getETBTokenConfig('Deep Forest Hermit');
      expect(config).toBeDefined();
      expect(config!.tokenCount).toBe(4);
      expect(config!.vanishingCounters).toBe(3);
    });

    it('should return correct config for Drey Keeper', () => {
      const config = getETBTokenConfig('Drey Keeper');
      expect(config).toBeDefined();
      expect(config!.tokenCount).toBe(2);
    });

    it('should return correct config for Skullport Merchant', () => {
      const config = getETBTokenConfig('Skullport Merchant');
      expect(config).toBeDefined();
      expect(config!.tokenType).toBe('Treasure');
      expect(config!.tokenCount).toBe(1);
    });
  });

  describe('Triggered Ability Cards', () => {
    it('should identify Tireless Provisioner', () => {
      expect(hasSpecialTriggeredAbility('Tireless Provisioner')).toBe(true);
    });

    it('should identify Deeproot Waters', () => {
      expect(hasSpecialTriggeredAbility('Deeproot Waters')).toBe(true);
    });

    it('should identify Aetherflux Reservoir', () => {
      expect(hasSpecialTriggeredAbility('Aetherflux Reservoir')).toBe(true);
    });

    it('should identify Smothering Tithe', () => {
      expect(hasSpecialTriggeredAbility('Smothering Tithe')).toBe(true);
    });

    it('should return correct config for Tireless Provisioner', () => {
      const config = getTriggeredAbilityConfig('Tireless Provisioner');
      expect(config).toBeDefined();
      expect(config!.requiresChoice).toBe(true);
      expect(config!.choiceOptions).toContain('Food');
      expect(config!.choiceOptions).toContain('Treasure');
    });

    it('should return correct config for Deeproot Waters with Merfolk filter', () => {
      const config = getTriggeredAbilityConfig('Deeproot Waters');
      expect(config).toBeDefined();
      expect(config!.creatureTypeFilter).toBe('Merfolk');
    });
  });

  describe('Cost Reduction Cards', () => {
    it('should identify Urza\'s Incubator', () => {
      expect(hasCostReduction("Urza's Incubator")).toBe(true);
    });

    it('should identify Morophon', () => {
      expect(hasCostReduction('Morophon, the Boundless')).toBe(true);
    });

    it('should return correct config for Urza\'s Incubator', () => {
      const config = getCostReductionConfig("Urza's Incubator");
      expect(config).toBeDefined();
      expect(config!.genericReduction).toBe(2);
      expect(config!.requiresTypeSelection).toBe(true);
    });

    it('should return correct config for Morophon with color reduction', () => {
      const config = getCostReductionConfig('Morophon, the Boundless');
      expect(config).toBeDefined();
      expect(config!.colorReduction).toBeDefined();
      expect(config!.colorReduction!.white).toBe(1);
      expect(config!.colorReduction!.blue).toBe(1);
      expect(config!.colorReduction!.black).toBe(1);
      expect(config!.colorReduction!.red).toBe(1);
      expect(config!.colorReduction!.green).toBe(1);
    });

    it('should apply cost reduction correctly', () => {
      const cost = { generic: 3, green: 2 };
      const config = getCostReductionConfig("Urza's Incubator")!;
      const reduced = applyCostReduction(cost, config);
      expect(reduced.generic).toBe(1); // 3 - 2 = 1
      expect(reduced.green).toBe(2); // Unchanged
    });

    it('should apply Morophon color reduction', () => {
      const cost = { generic: 2, white: 1, blue: 1, black: 1, red: 1, green: 1 };
      const config = getCostReductionConfig('Morophon, the Boundless')!;
      const reduced = applyCostReduction(cost, config);
      expect(reduced.white).toBe(0);
      expect(reduced.blue).toBe(0);
      expect(reduced.black).toBe(0);
      expect(reduced.red).toBe(0);
      expect(reduced.green).toBe(0);
      expect(reduced.generic).toBe(2); // Unchanged
    });
  });

  describe('Activated Ability Cards', () => {
    it('should identify Squirrel Nest', () => {
      expect(hasSpecialActivatedAbility('Squirrel Nest')).toBe(true);
    });

    it('should identify Drowner of Secrets', () => {
      expect(hasSpecialActivatedAbility('Drowner of Secrets')).toBe(true);
    });

    it('should identify Lullmage Mentor', () => {
      expect(hasSpecialActivatedAbility('Lullmage Mentor')).toBe(true);
    });

    it('should return correct config for Squirrel Nest', () => {
      const config = getActivatedAbilityConfig('Squirrel Nest');
      expect(config).toBeDefined();
      expect(config!.grantedAbility).toBeDefined();
      expect(config!.grantedAbility!.effect).toContain('Squirrel');
    });

    it('should return correct config for Drowner of Secrets', () => {
      const config = getActivatedAbilityConfig('Drowner of Secrets');
      expect(config).toBeDefined();
      expect(config!.tapAbility).toBeDefined();
      expect(config!.tapAbility!.requiresType).toBe('Merfolk');
      expect(config!.tapAbility!.requiresCount).toBe(1);
    });

    it('should return correct config for Lullmage Mentor', () => {
      const config = getActivatedAbilityConfig('Lullmage Mentor');
      expect(config).toBeDefined();
      expect(config!.tapAbility!.requiresCount).toBe(7);
      expect(config!.tapAbility!.effect).toContain('Counter');
      expect(config!.tapAbility!.targetType).toBe('spell');
      expect(config!.tapAbility!.stackInteraction).toBe(true);
    });

    it('should identify Lullmage Mentor as targeting stack', () => {
      expect(targetsStack('Lullmage Mentor')).toBe(true);
    });

    it('should not identify non-counterspell abilities as targeting stack', () => {
      expect(targetsStack('Drowner of Secrets')).toBe(false);
      expect(targetsStack('Squirrel Nest')).toBe(false);
    });
  });

  describe('Echo Cards', () => {
    it('should identify Deranged Hermit as having echo', () => {
      expect(hasEcho('Deranged Hermit')).toBe(true);
    });

    it('should return correct echo config', () => {
      const config = getEchoConfig('Deranged Hermit');
      expect(config).toBeDefined();
      expect(config!.echoCost).toBe('{3}{G}{G}');
      expect(config!.echoManaCost!.generic).toBe(3);
      expect(config!.echoManaCost!.green).toBe(2);
    });

    it('should detect echo from oracle text', () => {
      const result = detectEchoFromText('Echo {3}{G}{G}');
      expect(result.hasEcho).toBe(true);
      expect(result.cost).toBe('{3}{G}{G}');
    });
  });

  describe('Additional Cost Cards', () => {
    it('should identify Deadly Dispute', () => {
      expect(hasAdditionalCost('Deadly Dispute')).toBe(true);
    });

    it('should return correct config for Deadly Dispute', () => {
      const config = getAdditionalCostConfig('Deadly Dispute');
      expect(config).toBeDefined();
      expect(config!.costType).toBe('sacrifice');
      expect(config!.costFilter).toBe('artifact or creature');
    });

    it('should detect additional cost from oracle text', () => {
      const text = 'As an additional cost to cast this spell, sacrifice a creature.';
      const config = detectAdditionalCostFromText(text);
      expect(config).not.toBeNull();
      expect(config!.costType).toBe('sacrifice');
      expect(config!.costFilter).toBe('creature');
    });
  });

  describe('Search Effect Cards', () => {
    it('should identify Nature\'s Lore', () => {
      expect(hasSearchEffect("Nature's Lore")).toBe(true);
    });

    it('should identify Harvest Season', () => {
      expect(hasSearchEffect('Harvest Season')).toBe(true);
    });

    it('should return correct config for Nature\'s Lore', () => {
      const config = getSearchEffectConfig("Nature's Lore");
      expect(config).toBeDefined();
      expect(config!.searchFilter).toBe('Forest');
      expect(config!.entersTapped).toBe(false);
    });

    it('should return correct config for Harvest Season', () => {
      const config = getSearchEffectConfig('Harvest Season');
      expect(config).toBeDefined();
      expect(config!.searchFilter).toBe('basic land');
      expect(config!.countType).toBe('creatures');
    });

    it('should parse search filter correctly', () => {
      const filter = 'Plains, Island, Swamp, or Mountain';
      const types = parseSearchFilter(filter);
      expect(types).toContain('Plains');
      expect(types).toContain('Island');
      expect(types).toContain('Swamp');
      expect(types).toContain('Mountain');
    });
  });

  describe('Creature Count Cards', () => {
    it('should identify Shamanic Revelation', () => {
      expect(hasCreatureCountEffect('Shamanic Revelation')).toBe(true);
    });

    it('should return correct config for Shamanic Revelation', () => {
      const config = getCreatureCountEffectConfig('Shamanic Revelation');
      expect(config).toBeDefined();
      expect(config!.effectType).toBe('draw');
      expect(config!.perCreature).toBe(true);
      expect(config!.bonus).toBeDefined();
    });

    it('should count creatures correctly', () => {
      const creatures = [
        { power: 5, toughness: 5, types: ['Creature', 'Elf'] },
        { power: 2, toughness: 2, types: ['Creature', 'Elf'] },
        { power: 4, toughness: 4, types: ['Creature', 'Beast'] },
      ];
      expect(countCreaturesWithFilter(creatures)).toBe(3);
    });

    it('should count creatures with power filter', () => {
      const creatures = [
        { power: 5, toughness: 5 },
        { power: 2, toughness: 2 },
        { power: 4, toughness: 4 },
      ];
      expect(countCreaturesWithFilter(creatures, 'power 4 or greater')).toBe(2);
    });
  });

  describe('Planeswalker Cards', () => {
    it('should identify Elspeth, Storm Slayer', () => {
      expect(isSpecialPlaneswalker('Elspeth, Storm Slayer')).toBe(true);
    });

    it('should return correct config for Elspeth', () => {
      const config = getPlaneswalkerConfig('Elspeth, Storm Slayer');
      expect(config).toBeDefined();
      expect(config!.abilities).toHaveLength(3);
      expect(config!.staticAbilities).toBeDefined();
      expect(config!.staticAbilities![0]).toContain('twice');
    });

    it('should calculate planeswalker ability activation correctly', () => {
      expect(canActivatePlaneswalkerAbility(4, 1)).toBe(true);
      expect(canActivatePlaneswalkerAbility(4, -2)).toBe(true);
      expect(canActivatePlaneswalkerAbility(4, -6)).toBe(false);
      expect(canActivatePlaneswalkerAbility(6, -6)).toBe(true);
    });

    it('should calculate new loyalty correctly', () => {
      expect(calculateNewLoyalty(4, 1)).toBe(5);
      expect(calculateNewLoyalty(4, -2)).toBe(2);
    });
  });

  describe('Cast Triggers (Pattern-Based)', () => {
    it('should detect Storm keyword', () => {
      const grapeshot = 'Grapeshot deals 1 damage to any target.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)';
      expect(hasCastTrigger(grapeshot)).toBe(true);
      
      const info = detectCastTrigger(grapeshot);
      expect(info.hasStorm).toBe(true);
      expect(info.triggerType).toBe('self_cast');
    });

    it('should detect Cascade keyword', () => {
      const bloodbraidElf = 'Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.)\nHaste';
      expect(hasCastTrigger(bloodbraidElf)).toBe(true);
      expect(hasCascade(bloodbraidElf)).toBe(true);
      expect(getCascadeCount(bloodbraidElf)).toBe(1);
    });

    it('should detect multiple Cascades', () => {
      const maelstromWanderer = 'Cascade, cascade\nCreatures you control have haste.';
      expect(getCascadeCount(maelstromWanderer)).toBe(2);
      
      const apexDevastator = 'Cascade, cascade, cascade, cascade';
      expect(getCascadeCount(apexDevastator)).toBe(4);
    });

    it('should detect "when you cast this" triggers (Eldrazi)', () => {
      const kozilek = 'When you cast this spell, draw four cards.\nAnnihilator 4';
      expect(hasCastTrigger(kozilek)).toBe(true);
      
      const info = detectCastTrigger(kozilek);
      expect(info.triggerType).toBe('self_cast');
      expect(info.effect).toContain('draw four cards');
    });

    it('should detect "whenever you cast another" triggers', () => {
      const ulalek = 'Whenever you cast another Eldrazi spell, you may pay {C}{C}. If you do, copy all triggered abilities you control from that spell.';
      expect(hasCastTrigger(ulalek)).toBe(true);
      
      const info = detectCastTrigger(ulalek);
      expect(info.triggerType).toBe('other_cast');
      expect(info.creatureTypeFilter).toBe('eldrazi');
    });

    it('should calculate storm count correctly', () => {
      expect(getStormCount(1)).toBe(0);  // First spell, no copies
      expect(getStormCount(3)).toBe(2);  // Third spell, 2 copies
      expect(getStormCount(5)).toBe(4);  // Fifth spell, 4 copies
    });

    it('should detect if a spell triggers another cards cast ability', () => {
      const ulalek = 'Whenever you cast another Eldrazi spell, you may pay {C}{C}. If you do, copy all triggered abilities you control from that spell.';
      
      // Eldrazi should trigger
      expect(wouldTriggerCastAbility(ulalek, 'Creature — Eldrazi', ['Eldrazi'])).toBe(true);
      
      // Non-Eldrazi should not trigger
      expect(wouldTriggerCastAbility(ulalek, 'Creature — Human Wizard', ['Human', 'Wizard'])).toBe(false);
    });
  });

  describe('Trigger Copying (Pattern-Based)', () => {
    it('should detect "triggers an additional time" effects', () => {
      const panharmonicon = 'If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.';
      expect(hasTriggerCopying(panharmonicon)).toBe(true);
      
      const info = detectTriggerCopying(panharmonicon);
      expect(info.effectType).toBe('additional');
      expect(info.triggerFilter?.etbOnly).toBe(true);
    });

    it('should detect Yarok ETB doubling', () => {
      const yarok = 'If a permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.';
      expect(hasTriggerCopying(yarok)).toBe(true);
      
      const info = detectTriggerCopying(yarok);
      expect(info.triggerFilter?.etbOnly).toBe(true);
    });

    it('should detect Teysa death trigger doubling', () => {
      const teysa = 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.';
      expect(hasTriggerCopying(teysa)).toBe(true);
      
      const info = detectTriggerCopying(teysa);
      expect(info.triggerFilter?.deathOnly).toBe(true);
    });

    it('should detect Isshin attack trigger doubling', () => {
      const isshin = 'If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.';
      expect(hasTriggerCopying(isshin)).toBe(true);
      
      const info = detectTriggerCopying(isshin);
      expect(info.triggerFilter?.attackOnly).toBe(true);
    });

    it('should detect token doublers', () => {
      const anointedProcession = 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.';
      expect(hasTriggerCopying(anointedProcession)).toBe(true);
      
      const info = detectTriggerCopying(anointedProcession);
      expect(info.tokenDoubling).toBe(true);
    });

    it('should detect Doubling Season (tokens + counters)', () => {
      const doublingSeason = 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead. If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.';
      expect(hasTriggerCopying(doublingSeason)).toBe(true);
      
      const info = detectTriggerCopying(doublingSeason);
      expect(info.tokenDoubling).toBe(true);
    });

    it('should detect activated trigger copiers', () => {
      const strionicResonator = '{2}, {T}: Copy target triggered ability you control. You may choose new targets for the copy.';
      expect(hasTriggerCopying(strionicResonator)).toBe(true);
      
      const info = detectTriggerCopying(strionicResonator);
      expect(info.effectType).toBe('copy');
      expect(info.activationType).toBe('activated');
    });

    it('should detect colorless trigger copying (Echoes of Eternity)', () => {
      const echoes = 'Whenever a triggered ability of a colorless spell you control or another colorless permanent you control triggers, copy that ability. You may choose new targets for the copy.';
      expect(hasTriggerCopying(echoes)).toBe(true);
      
      const info = detectTriggerCopying(echoes);
      expect(info.triggerFilter?.colorlessOnly).toBe(true);
    });

    it('should calculate token multiplier correctly', () => {
      const battlefield = [
        { controller: 'player1', oracleText: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' },
      ];
      expect(getTokenMultiplier('player1', battlefield)).toBe(2);
    });

    it('should stack token doublers', () => {
      const battlefield = [
        { controller: 'player1', oracleText: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' },
        { controller: 'player1', oracleText: 'If an effect would create one or more creature tokens under your control, it creates twice that many of those tokens instead.' },
      ];
      expect(getTokenMultiplier('player1', battlefield)).toBe(4);
    });

    it('should not apply opponent token doublers', () => {
      const battlefield = [
        { controller: 'player2', oracleText: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' },
      ];
      expect(getTokenMultiplier('player1', battlefield)).toBe(1);
    });

    it('should find activated trigger copiers', () => {
      const battlefield = [
        { id: 'sr1', name: 'Strionic Resonator', controller: 'player1', oracleText: '{2}, {T}: Copy target triggered ability you control.', tapped: false },
      ];
      const copiers = getActivatedTriggerCopiers(battlefield);
      expect(copiers).toHaveLength(1);
      expect(copiers[0].name).toBe('Strionic Resonator');
    });

    it('should not find tapped trigger copiers', () => {
      const battlefield = [
        { id: 'sr1', name: 'Strionic Resonator', controller: 'player1', oracleText: '{2}, {T}: Copy target triggered ability you control.', tapped: true },
      ];
      const copiers = getActivatedTriggerCopiers(battlefield);
      expect(copiers).toHaveLength(0);
    });
  });
});
