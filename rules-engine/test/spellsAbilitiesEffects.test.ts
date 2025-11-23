/**
 * Tests for Section 6: Spells, Abilities, and Effects
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 601: Casting Spells
  CastingStep,
  createCastingProcess,
  announceSpell,
  chooseModes,
  chooseTargets,
  determineTotalCost,
  payCosts,
  isSpellIllegal,
  
  // Rule 602: Activating Abilities
  ActivationStep,
  createActivationProcess,
  canActivateWithRestrictions,
  
  // Rule 603: Triggered Abilities
  TriggerType,
  createTriggerInstance,
  putTriggersOnStack,
  
  // Rule 608: Resolving
  checkResolutionLegality,
  getDestinationAfterResolution,
  
  // Rule 611: Continuous Effects
  EffectDuration,
  createContinuousEffect,
  hasEffectExpired,
  
  // Rule 613: Layers
  Layer,
  PTSublayer,
  
  // Rule 614: Replacement Effects
  ReplacementType,
  createReplacementEffect,
  applySelfReplacementFirst,
  
  // Rule 615: Prevention Effects
  createPreventionShield,
  applyPrevention,
} from '../src/types/spellsAbilitiesEffects';

describe('Rule 601: Casting Spells', () => {
  it('should create casting process in announce step', () => {
    const process = createCastingProcess('lightning-bolt', 'player1');
    
    expect(process.spellId).toBe('lightning-bolt');
    expect(process.controllerId).toBe('player1');
    expect(process.currentStep).toBe(CastingStep.ANNOUNCE);
    expect(process.complete).toBe(false);
  });
  
  it('should progress through casting steps in order', () => {
    let process = createCastingProcess('counterspell', 'player1');
    
    // Step 1: Announce
    process = announceSpell(process);
    expect(process.currentStep).toBe(CastingStep.CHOOSE_MODES);
    
    // Step 2: Choose modes (none for Counterspell)
    process = chooseModes(process);
    expect(process.currentStep).toBe(CastingStep.CHOOSE_TARGETS);
    
    // Step 3: Choose targets
    process = chooseTargets(process, ['spell1']);
    expect(process.currentStep).toBe(CastingStep.CHOOSE_PAYMENT);
    expect(process.targets).toEqual(['spell1']);
  });
  
  it('should determine total cost with mana and additional costs', () => {
    let process = createCastingProcess('chord-of-calling', 'player1');
    process = { ...process, currentStep: CastingStep.CHOOSE_PAYMENT };
    
    const manaCost = { green: 1, generic: 2 };
    const additionalCosts = [{ type: 'tap' as const, sourceId: 'creature1' }];
    
    process = determineTotalCost(process, manaCost, additionalCosts);
    
    expect(process.manaCost).toEqual(manaCost);
    expect(process.additionalCosts).toEqual(additionalCosts);
    expect(process.totalCost?.type).toBe('composite');
    expect(process.currentStep).toBe(CastingStep.ACTIVATE_MANA);
  });
  
  it('should complete casting process when costs are paid', () => {
    let process = createCastingProcess('shock', 'player1');
    process = { ...process, currentStep: CastingStep.PAY_COSTS };
    
    process = payCosts(process);
    
    expect(process.currentStep).toBe(CastingStep.SPELL_CAST);
    expect(process.complete).toBe(true);
  });
  
  it('should detect illegal spell when all targets become illegal', () => {
    const targets = ['creature1', 'creature2'];
    const legalTargets = ['creature3']; // Neither target is legal
    
    const illegal = isSpellIllegal(targets, legalTargets);
    
    expect(illegal).toBe(true);
  });
  
  it('should not consider spell illegal if any target is still legal', () => {
    const targets = ['creature1', 'creature2'];
    const legalTargets = ['creature1', 'creature3']; // creature1 is still legal
    
    const illegal = isSpellIllegal(targets, legalTargets);
    
    expect(illegal).toBe(false);
  });
  
  it('should not consider spell illegal if it has no targets', () => {
    const targets: string[] = [];
    const legalTargets = ['creature1'];
    
    const illegal = isSpellIllegal(targets, legalTargets);
    
    expect(illegal).toBe(false);
  });
});

describe('Rule 602: Activating Activated Abilities', () => {
  it('should create activation process', () => {
    const process = createActivationProcess(
      'llanowar-tap',
      'player1',
      'llanowar-elves'
    );
    
    expect(process.abilityId).toBe('llanowar-tap');
    expect(process.controllerId).toBe('player1');
    expect(process.sourceId).toBe('llanowar-elves');
    expect(process.currentStep).toBe(ActivationStep.ANNOUNCE);
  });
  
  it('should allow activation with no restrictions', () => {
    const restriction = {};
    const context = {
      hasPriority: true,
      isMainPhase: false,
      isOwnTurn: false,
      isStackEmpty: false,
      isCombat: false,
      activationsThisTurn: 0,
      sourceTapped: false
    };
    
    const canActivate = canActivateWithRestrictions(restriction, context);
    
    expect(canActivate).toBe(true);
  });
  
  it('should enforce "activate only as a sorcery" restriction', () => {
    const restriction = { onlyAsSorcery: true };
    
    // Should fail without sorcery timing
    let context = {
      hasPriority: true,
      isMainPhase: true,
      isOwnTurn: true,
      isStackEmpty: false, // Stack not empty
      isCombat: false,
      activationsThisTurn: 0,
      sourceTapped: false
    };
    
    expect(canActivateWithRestrictions(restriction, context)).toBe(false);
    
    // Should succeed with sorcery timing
    context = { ...context, isStackEmpty: true };
    expect(canActivateWithRestrictions(restriction, context)).toBe(true);
  });
  
  it('should enforce "activate only during combat" restriction', () => {
    const restriction = { onlyDuringCombat: true };
    
    let context = {
      hasPriority: true,
      isMainPhase: false,
      isOwnTurn: true,
      isStackEmpty: true,
      isCombat: false,
      activationsThisTurn: 0,
      sourceTapped: false
    };
    
    expect(canActivateWithRestrictions(restriction, context)).toBe(false);
    
    context = { ...context, isCombat: true };
    expect(canActivateWithRestrictions(restriction, context)).toBe(true);
  });
  
  it('should enforce per-turn activation limit', () => {
    const restriction = { limitPerTurn: 1 };
    
    let context = {
      hasPriority: true,
      isMainPhase: true,
      isOwnTurn: true,
      isStackEmpty: true,
      isCombat: false,
      activationsThisTurn: 0,
      sourceTapped: false
    };
    
    expect(canActivateWithRestrictions(restriction, context)).toBe(true);
    
    context = { ...context, activationsThisTurn: 1 };
    expect(canActivateWithRestrictions(restriction, context)).toBe(false);
  });
  
  it('should enforce tap requirement', () => {
    const restriction = { requiresTap: true };
    
    let context = {
      hasPriority: true,
      isMainPhase: true,
      isOwnTurn: true,
      isStackEmpty: true,
      isCombat: false,
      activationsThisTurn: 0,
      sourceTapped: true // Already tapped
    };
    
    expect(canActivateWithRestrictions(restriction, context)).toBe(false);
    
    context = { ...context, sourceTapped: false };
    expect(canActivateWithRestrictions(restriction, context)).toBe(true);
  });
});

describe('Rule 603: Handling Triggered Abilities', () => {
  it('should create trigger instance when ability triggers', () => {
    const ability = {
      id: 'etb-trigger',
      sourceId: 'acidic-slime',
      controllerId: 'player1',
      trigger: {
        type: TriggerType.WHEN,
        event: 'enters-the-battlefield'
      },
      effect: 'Destroy target artifact, enchantment, or land'
    };
    
    const instance = createTriggerInstance(ability, 100);
    
    expect(instance.abilityId).toBe('etb-trigger');
    expect(instance.sourceId).toBe('acidic-slime');
    expect(instance.timestamp).toBe(100);
    expect(instance.hasTriggered).toBe(true);
    expect(instance.onStack).toBe(false);
  });
  
  it('should put triggers on stack in APNAP order', () => {
    const triggers = [
      {
        abilityId: 'trigger1',
        sourceId: 'source1',
        controllerId: 'player2',
        timestamp: 101,
        hasTriggered: true,
        onStack: false
      },
      {
        abilityId: 'trigger2',
        sourceId: 'source2',
        controllerId: 'player1', // Active player
        timestamp: 100,
        hasTriggered: true,
        onStack: false
      },
      {
        abilityId: 'trigger3',
        sourceId: 'source3',
        controllerId: 'player1', // Active player
        timestamp: 102,
        hasTriggered: true,
        onStack: false
      }
    ];
    
    const onStack = putTriggersOnStack(triggers, 'player1');
    
    // Active player's triggers first, then by timestamp
    expect(onStack[0].abilityId).toBe('trigger2'); // player1, earliest
    expect(onStack[1].abilityId).toBe('trigger3'); // player1, later
    expect(onStack[2].abilityId).toBe('trigger1'); // player2
    expect(onStack.every(t => t.onStack)).toBe(true);
  });
});

describe('Rule 608: Resolving Spells and Abilities', () => {
  it('should check resolution legality with all legal targets', () => {
    const context = {
      objectId: 'lightning-bolt',
      controllerId: 'player1',
      targets: ['creature1'],
      isSpell: true
    };
    
    const result = checkResolutionLegality(context, ['creature1', 'creature2']);
    
    expect(result.illegal).toBe(false);
  });
  
  it('should detect illegal resolution when all targets are illegal', () => {
    const context = {
      objectId: 'murder',
      controllerId: 'player1',
      targets: ['creature1'],
      isSpell: true
    };
    
    const result = checkResolutionLegality(context, ['creature2']); // creature1 not legal
    
    expect(result.illegal).toBe(true);
    expect(result.reason).toBe('All targets are illegal');
  });
  
  it('should not check legality for targetless spells', () => {
    const context = {
      objectId: 'wrath-of-god',
      controllerId: 'player1',
      targets: [],
      isSpell: true
    };
    
    const result = checkResolutionLegality(context, []);
    
    expect(result.illegal).toBe(false);
  });
  
  it('should send instant to graveyard after resolution', () => {
    const destination = getDestinationAfterResolution(true, false);
    
    expect(destination).toBe('graveyard');
  });
  
  it('should send permanent spell to battlefield after resolution', () => {
    const destination = getDestinationAfterResolution(true, true);
    
    expect(destination).toBe('battlefield');
  });
  
  it('should make ability cease to exist after resolution', () => {
    const destination = getDestinationAfterResolution(false, false);
    
    expect(destination).toBe('ceases');
  });
});

describe('Rule 611: Continuous Effects', () => {
  it('should create continuous effect', () => {
    const effect = createContinuousEffect(
      'glorious-anthem',
      EffectDuration.CONTINUOUS,
      Layer.POWER_TOUGHNESS_EFFECTS,
      '+1/+1 to creatures you control',
      100,
      ['creature1', 'creature2']
    );
    
    expect(effect.sourceId).toBe('glorious-anthem');
    expect(effect.duration).toBe(EffectDuration.CONTINUOUS);
    expect(effect.layer).toBe(Layer.POWER_TOUGHNESS_EFFECTS);
    expect(effect.affectedObjects).toEqual(['creature1', 'creature2']);
  });
  
  it('should expire "until end of turn" effect at end of turn', () => {
    const effect = createContinuousEffect(
      'giant-growth',
      EffectDuration.UNTIL_END_OF_TURN,
      Layer.POWER_TOUGHNESS_EFFECTS,
      '+3/+3',
      100
    );
    
    expect(hasEffectExpired(effect, {
      isEndOfTurn: false,
      isEndOfCombat: false,
      conditionMet: true
    })).toBe(false);
    
    expect(hasEffectExpired(effect, {
      isEndOfTurn: true,
      isEndOfCombat: false,
      conditionMet: true
    })).toBe(true);
  });
  
  it('should expire "until end of combat" effect at end of combat', () => {
    const effect = createContinuousEffect(
      'righteousness',
      EffectDuration.UNTIL_END_OF_COMBAT,
      Layer.POWER_TOUGHNESS_EFFECTS,
      '+7/+7',
      100
    );
    
    expect(hasEffectExpired(effect, {
      isEndOfTurn: false,
      isEndOfCombat: true,
      conditionMet: true
    })).toBe(true);
  });
  
  it('should expire "as long as" effect when condition not met', () => {
    const effect = createContinuousEffect(
      'crusade',
      EffectDuration.AS_LONG_AS,
      Layer.POWER_TOUGHNESS_EFFECTS,
      '+1/+1 to white creatures',
      100
    );
    
    expect(hasEffectExpired(effect, {
      isEndOfTurn: false,
      isEndOfCombat: false,
      conditionMet: true
    })).toBe(false);
    
    expect(hasEffectExpired(effect, {
      isEndOfTurn: false,
      isEndOfCombat: false,
      conditionMet: false
    })).toBe(true);
  });
  
  it('should never expire continuous static ability effect', () => {
    const effect = createContinuousEffect(
      'muraganda-petroglyphs',
      EffectDuration.CONTINUOUS,
      Layer.POWER_TOUGHNESS_EFFECTS,
      '+2/+2',
      100
    );
    
    expect(hasEffectExpired(effect, {
      isEndOfTurn: true,
      isEndOfCombat: true,
      conditionMet: false
    })).toBe(false);
  });
});

describe('Rule 613: Interaction of Continuous Effects (Layers)', () => {
  it('should define seven layers', () => {
    expect(Layer.COPY_EFFECTS).toBe(1);
    expect(Layer.CONTROL_EFFECTS).toBe(2);
    expect(Layer.TEXT_CHANGING_EFFECTS).toBe(3);
    expect(Layer.TYPE_CHANGING_EFFECTS).toBe(4);
    expect(Layer.COLOR_CHANGING_EFFECTS).toBe(5);
    expect(Layer.ABILITY_EFFECTS).toBe(6);
    expect(Layer.POWER_TOUGHNESS_EFFECTS).toBe(7);
  });
  
  it('should define power/toughness sublayers', () => {
    expect(PTSublayer.CHARACTERISTIC_DEFINING).toBe('a');
    expect(PTSublayer.SET_TO_VALUE).toBe('b');
    expect(PTSublayer.MODIFY).toBe('c');
    expect(PTSublayer.COUNTERS).toBe('d');
    expect(PTSublayer.SWITCH).toBe('e');
  });
});

describe('Rule 614: Replacement Effects', () => {
  it('should create replacement effect', () => {
    const effect = createReplacementEffect(
      'torpor-orb',
      ReplacementType.INSTEAD,
      'enters-the-battlefield-trigger',
      'does not trigger'
    );
    
    expect(effect.sourceId).toBe('torpor-orb');
    expect(effect.type).toBe(ReplacementType.INSTEAD);
    expect(effect.event).toBe('enters-the-battlefield-trigger');
    expect(effect.self).toBe(false);
  });
  
  it('should create self-replacement effect', () => {
    const effect = createReplacementEffect(
      'guildgate',
      ReplacementType.ENTERS,
      'enters-battlefield',
      'enters tapped',
      true // self
    );
    
    expect(effect.self).toBe(true);
  });
  
  it('should apply self-replacement effects first', () => {
    const effects = [
      createReplacementEffect('effect1', ReplacementType.INSTEAD, 'damage', 'prevent', false),
      createReplacementEffect('source1', ReplacementType.ENTERS, 'etb', 'etb-tapped', true),
      createReplacementEffect('effect2', ReplacementType.INSTEAD, 'damage', 'prevent', false)
    ];
    
    const ordered = applySelfReplacementFirst(effects, 'source1');
    
    // Self-replacement for source1 should be first
    expect(ordered[0].sourceId).toBe('source1');
    expect(ordered[0].self).toBe(true);
  });
});

describe('Rule 615: Prevention Effects', () => {
  it('should create prevention shield', () => {
    const shield = createPreventionShield('holy-day', 5, 'player1');
    
    expect(shield.sourceId).toBe('holy-day');
    expect(shield.amount).toBe(5);
    expect(shield.damageTarget).toBe('player1');
    expect(shield.shield).toBe(true);
  });
  
  it('should apply prevention to damage', () => {
    const prevention = createPreventionShield('circle-of-protection-red', 3);
    
    const result = applyPrevention(5, prevention);
    
    expect(result.remainingDamage).toBe(2); // 5 - 3 = 2
    expect(result.shieldRemaining).toBeUndefined(); // Shield used up
  });
  
  it('should leave shield remaining if damage less than prevention', () => {
    const prevention = createPreventionShield('story-circle', 10);
    
    const result = applyPrevention(3, prevention);
    
    expect(result.remainingDamage).toBe(0);
    expect(result.shieldRemaining).toBe(7); // 10 - 3 = 7
  });
  
  it('should prevent all damage when amount undefined', () => {
    const prevention = {
      id: 'prevent-all',
      sourceId: 'fog',
      shield: false
    };
    
    const result = applyPrevention(100, prevention);
    
    expect(result.remainingDamage).toBe(0);
  });
});
