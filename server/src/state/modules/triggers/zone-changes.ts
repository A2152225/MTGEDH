/**
 * triggers/zone-changes.ts
 * 
 * Zone change trigger detection and processing.
 * Includes ETB (enters the battlefield), death/dies, and LTB (leaves the battlefield) triggers.
 * 
 * Categories:
 * - ETB triggers: detectETBTriggers, getETBTriggersForPermanent
 * - ETB untap effects: detectETBUntapEffects, getETBUntapEffects, applyETBUntapEffect
 * - Death triggers: detectDeathTriggers, getDeathTriggers, getDeathTriggersForCreature
 * - Undying/Persist: processUndyingPersist
 * - Auto-sacrifice: checkETBAutoSacrifice
 */

import type { GameContext } from "../../context.js";
import {
  KNOWN_DEATH_TRIGGERS,
  KNOWN_ETB_TRIGGERS,
} from "./card-data-tables.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface TriggeredAbility {
  permanentId: string;
  cardName: string;
  triggerType?: string;
  description: string;
  effect?: string;
  mandatory?: boolean;
  millAmount?: number;
  manaCost?: string;
  requiresChoice?: boolean;
  nontokenOnly?: boolean;
  colorRestriction?: string;
  creatureOnly?: boolean;
  modalOptions?: string[];
  tokenInfo?: any;
}

export interface ETBUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'all_creatures' | 'controller_creatures' | 'all_permanents' | 'equipped_creature';
  triggerCondition: 'creature_etb' | 'any_etb' | 'nontoken_creature_etb';
}

export interface DeathTriggerResult {
  source: {
    permanentId: string;
    cardName: string;
    controllerId: string;
  };
  effect: string;
  targets?: string[];
  requiresSacrificeSelection?: boolean;
  sacrificeFrom?: string;
}

// ============================================================================
// Known ETB Sacrifice Cards
// ============================================================================

const KNOWN_ETB_SACRIFICE_UNLESS: Record<string, { 
  effect: string; 
  alternateCostKeyword: string; 
  checkCondition: (permanent: any) => boolean;
}> = {
  "kroxa, titan of death's hunger": {
    effect: "When Kroxa enters the battlefield, sacrifice it unless it escaped.",
    alternateCostKeyword: "escape",
    checkCondition: (perm) => !perm.escapedFrom,
  },
  "uro, titan of nature's wrath": {
    effect: "When Uro enters the battlefield, sacrifice it unless it escaped.",
    alternateCostKeyword: "escape",
    checkCondition: (perm) => !perm.escapedFrom,
  },
  "ox of agonas": {
    effect: "When Ox of Agonas enters the battlefield, discard your hand, then draw three cards.",
    alternateCostKeyword: "escape",
    checkCondition: () => false,
  },
  "jaxis, the troublemaker": {
    effect: "Sacrifice at end of turn if it entered with blitz",
    alternateCostKeyword: "blitz",
    checkCondition: (perm) => perm.blitzed === true,
  },
  "ball lightning": {
    effect: "At the beginning of the end step, sacrifice Ball Lightning.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
  "groundbreaker": {
    effect: "At the beginning of the end step, sacrifice Groundbreaker.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
  "spark elemental": {
    effect: "At the beginning of the end step, sacrifice Spark Elemental.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
};

// ============================================================================
// Death Trigger Detection
// ============================================================================

/**
 * Detect death triggers from a permanent's abilities
 */
export function detectDeathTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      const triggerType = info.triggerOn === 'controlled' ? 'creature_dies' 
        : info.triggerOn === 'any' ? 'any_creature_dies' 
        : 'dies';
      triggers.push({
        permanentId,
        cardName,
        triggerType,
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  // Undying - if no +1/+1 counter, return with one
  if (lowerOracle.includes("undying")) {
    const hasPlusCounter = (counters["+1/+1"] || counters["plus1plus1"] || 0) > 0;
    if (!hasPlusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'undying',
        description: "Return to battlefield with +1/+1 counter",
        mandatory: true,
      });
    }
  }
  
  // Persist - if no -1/-1 counter, return with one
  if (lowerOracle.includes("persist")) {
    const hasMinusCounter = (counters["-1/-1"] || counters["minus1minus1"] || 0) > 0;
    if (!hasMinusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'persist',
        description: "Return to battlefield with -1/-1 counter",
        mandatory: true,
      });
    }
  }
  
  // Generic "when ~ dies" triggers
  const diesMatch = oracleText.match(/when(?:ever)?\s+(?:~|this creature)\s+dies,?\s*([^.]+)/i);
  if (diesMatch && !triggers.some(t => t.triggerType === 'dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dies',
      description: diesMatch[1].trim(),
      effect: diesMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever a creature you control dies"
  const controlledDiesMatch = oracleText.match(/whenever a creature you control dies,?\s*([^.]+)/i);
  if (controlledDiesMatch && !triggers.some(t => t.triggerType === 'creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_dies',
      description: controlledDiesMatch[1].trim(),
      effect: controlledDiesMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever a creature dies"
  const anyDiesMatch = oracleText.match(/whenever a creature dies,?\s*([^.]+)/i);
  if (anyDiesMatch && !triggers.some(t => t.triggerType === 'any_creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_creature_dies',
      description: anyDiesMatch[1].trim(),
      effect: anyDiesMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Process death triggers when a creature dies
 */
export function getDeathTriggersForCreature(
  ctx: GameContext, 
  dyingPermanent: any,
  dyingController: string
): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the dying creature itself for death triggers
  const selfTriggers = detectDeathTriggers(dyingPermanent.card, dyingPermanent);
  triggers.push(...selfTriggers);
  
  // Check all other permanents for "whenever a creature dies" triggers
  for (const permanent of battlefield) {
    if (!permanent || permanent.id === dyingPermanent.id) continue;
    
    const permTriggers = detectDeathTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      // "Whenever a creature you control dies" - only trigger for controller's creatures
      if (trigger.triggerType === 'creature_dies') {
        if (permanent.controller === dyingController) {
          triggers.push(trigger);
        }
      }
      // "Whenever a creature dies" - triggers for any creature
      else if (trigger.triggerType === 'any_creature_dies') {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Handle undying/persist return from graveyard
 */
export function processUndyingPersist(
  ctx: GameContext,
  card: any,
  owner: string,
  ability: 'undying' | 'persist'
): void {
  const battlefield = ctx.state?.battlefield || [];
  const counterType = ability === 'undying' ? '+1/+1' : '-1/-1';
  
  // Create permanent on battlefield with counter
  const newPermanent = {
    id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    controller: owner,
    owner: owner,
    tapped: false,
    counters: { [counterType]: 1 },
    card: { ...card, zone: "battlefield" },
    returnedWith: ability,
  };
  
  battlefield.push(newPermanent as any);
  ctx.bumpSeq();
}

/**
 * Find all death triggers that should fire when a creature dies
 */
export function getDeathTriggers(
  ctx: GameContext,
  dyingCreature: any,
  dyingCreatureController: string
): DeathTriggerResult[] {
  const results: DeathTriggerResult[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const dyingTypeLine = (dyingCreature?.card?.type_line || '').toLowerCase();
  const isCreature = dyingTypeLine.includes('creature');
  
  if (!isCreature) return results;
  
  // Check all permanents on the battlefield for death triggers
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const card = permanent.card;
    if (!card) continue;
    
    const cardName = (card.name || '').toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    const permanentController = permanent.controller;
    
    // Check known death trigger cards
    for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
      if (cardName.includes(knownName)) {
        let shouldTrigger = false;
        
        switch (info.triggerOn) {
          case 'controlled':
            shouldTrigger = dyingCreatureController === permanentController;
            break;
          case 'any':
            shouldTrigger = true;
            break;
          case 'own':
            shouldTrigger = false;
            break;
        }
        
        if (shouldTrigger) {
          const requiresSacrifice = info.effect.toLowerCase().includes('sacrifice');
          
          results.push({
            source: {
              permanentId: permanent.id,
              cardName: card.name,
              controllerId: permanentController,
            },
            effect: info.effect,
            requiresSacrificeSelection: requiresSacrifice,
          });
        }
      }
    }
    
    // Generic detection: "Whenever a creature you control dies"
    if (oracleText.includes('whenever a creature you control dies') && 
        dyingCreatureController === permanentController) {
      const effectMatch = oracleText.match(/whenever a creature you control dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = effectMatch[1].trim();
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // Generic detection: "Whenever a creature dies"
    if (oracleText.includes('whenever a creature dies') && 
        !oracleText.includes('whenever a creature you control dies')) {
      const effectMatch = oracleText.match(/whenever a creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = effectMatch[1].trim();
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
  }
  
  return results;
}

/**
 * Get list of players who need to sacrifice a creature due to Grave Pact-style effects
 */
export function getPlayersWhoMustSacrifice(
  ctx: GameContext,
  triggerController: string
): string[] {
  const players = ctx.state?.players || [];
  return players
    .map((p: any) => p.id)
    .filter((pid: string) => pid !== triggerController);
}

// ============================================================================
// ETB Trigger Detection
// ============================================================================

/**
 * Detect ETB triggers from a card
 */
export function detectETBTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known ETB trigger cards first
  for (const [knownName, info] of Object.entries(KNOWN_ETB_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      let triggerType: string;
      switch (info.triggerOn) {
        case 'another_permanent':
          triggerType = 'another_permanent_etb';
          break;
        case 'any_permanent':
          triggerType = 'permanent_etb';
          break;
        case 'creature':
          triggerType = 'creature_etb';
          break;
        default:
          triggerType = 'etb';
      }
      
      const trigger: TriggeredAbility = {
        permanentId,
        cardName,
        triggerType,
        description: info.effect,
        effect: info.effect,
        millAmount: info.millAmount,
        mandatory: true,
      };
      
      if (info.searchFilter) {
        (trigger as any).searchFilter = info.searchFilter;
        (trigger as any).searchDestination = info.searchDestination || 'hand';
        (trigger as any).searchEntersTapped = info.searchEntersTapped || false;
      }
      
      triggers.push(trigger);
    }
  }
  
  // "When ~ enters the battlefield" pattern
  const cardNameEscaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const etbPattern = new RegExp(`when\\s+(?:~|this creature|this permanent|${cardNameEscaped})\\s+enters(?: the battlefield)?,?\\s*([^.]+)`, 'i');
  const etbMatch = oracleText.match(etbPattern);
  if (etbMatch && !triggers.some(t => t.triggerType === 'etb' || t.triggerType === 'etb_sacrifice_unless_pay')) {
    const effectText = etbMatch[1].trim();
    
    // Check for "sacrifice ~ unless you pay" pattern
    const sacrificeUnlessPayMatch = effectText.match(/sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i);
    if (sacrificeUnlessPayMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb_sacrifice_unless_pay',
        description: effectText,
        effect: effectText,
        manaCost: sacrificeUnlessPayMatch[1],
        mandatory: true,
        requiresChoice: true,
      });
    } else {
      const trigger: TriggeredAbility = {
        permanentId,
        cardName,
        triggerType: 'etb',
        description: effectText,
        effect: effectText,
        mandatory: true,
      };
      
      // Check if this trigger requires targeting
      // Patterns: "target player", "target opponent", "target creature", etc.
      if (/\btarget\s+(?:player|opponent|creature|permanent|land|artifact|enchantment)/i.test(effectText)) {
        (trigger as any).requiresTarget = true;
        
        // Determine target type
        if (/\btarget\s+(?:player|opponent)/i.test(effectText)) {
          (trigger as any).targetType = 'player';
        } else if (/\btarget\s+creature/i.test(effectText)) {
          (trigger as any).targetType = 'creature';
        } else if (/\btarget\s+(?:permanent|land|artifact|enchantment)/i.test(effectText)) {
          (trigger as any).targetType = 'permanent';
        }
        
        // Store the full effect for later execution
        (trigger as any).targetEffect = effectText;
      }
      
      triggers.push(trigger);
    }
  }
  
  // "Whenever a creature enters the battlefield under your control"
  const creatureETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (creatureETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    const isNontokenOnly = oracleText.includes('nontoken creature');
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb',
      description: creatureETBMatch[1].trim(),
      effect: creatureETBMatch[1].trim(),
      mandatory: true,
      nontokenOnly: isNontokenOnly,
    });
  }
  
  // Equipment ETB
  const equipmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) equipments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (equipmentETBMatch && !triggers.some(t => t.triggerType === 'equipment_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_etb',
      description: equipmentETBMatch[1].trim(),
      effect: equipmentETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // Artifact ETB
  const artifactETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?artifacts? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (artifactETBMatch && !triggers.some(t => t.triggerType === 'artifact_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'artifact_etb',
      description: artifactETBMatch[1].trim(),
      effect: artifactETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // Enchantment ETB
  const enchantmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?enchantments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (enchantmentETBMatch && !triggers.some(t => t.triggerType === 'enchantment_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_etb',
      description: enchantmentETBMatch[1].trim(),
      effect: enchantmentETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // Equipment cast trigger
  const equipmentCastMatch = oracleText.match(/whenever you (?:cast|play) (?:a|an) equipment(?: spell)?,?\s*([^.]+)/i);
  if (equipmentCastMatch && !triggers.some(t => t.triggerType === 'equipment_cast')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_cast',
      description: equipmentCastMatch[1].trim(),
      effect: equipmentCastMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever another creature enters the battlefield" (any player)
  const anotherCreatureAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? enters?(?: the battlefield)?(?!.*under your control),?\s*([^.]+)/i);
  if (anotherCreatureAnyETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures? enters?/i);
    const colorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb',
      description: anotherCreatureAnyETBMatch[1].trim(),
      effect: anotherCreatureAnyETBMatch[1].trim(),
      mandatory: true,
      colorRestriction: colorRestriction && colorRestriction !== 'another' && colorRestriction !== 'one or more' ? colorRestriction : undefined,
    } as any);
  }
  
  // "Whenever another permanent you control enters"
  const hasPermanentControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control|under your control)/.test(oracleText) ||
                                         /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control )?enters?(?: the battlefield)? under your control/.test(oracleText);
  if (hasPermanentControlRestriction) {
    const anotherPermanentControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
    if (anotherPermanentControlledETBMatch && !triggers.some(t => t.triggerType === 'another_permanent_etb')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'another_permanent_etb',
        description: anotherPermanentControlledETBMatch[1].trim(),
        effect: anotherPermanentControlledETBMatch[1].trim(),
        mandatory: true,
      } as any);
    }
  }
  
  // "Whenever another permanent enters the battlefield" (any player, no control restriction)
  const anotherPermanentAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? enters?(?: the battlefield)?,?\s*([^.]+)/i);
  const hasNoControlRestriction = !/you control|under your control|an opponent controls|under an opponent's control/.test(oracleText);
  if (anotherPermanentAnyETBMatch && hasNoControlRestriction && !triggers.some(t => t.triggerType === 'permanent_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_etb',
      description: anotherPermanentAnyETBMatch[1].trim(),
      effect: anotherPermanentAnyETBMatch[1].trim(),
      mandatory: true,
    } as any);
  }
  
  // "Whenever another creature enters the battlefield under your control"
  const anotherCreatureControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  const hasControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control|under your control)/.test(oracleText) ||
                                 /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control )?enters?(?: the battlefield)? under your control/.test(oracleText);
  if (anotherCreatureControlledETBMatch && hasControlRestriction && !triggers.some(t => t.triggerType === 'another_permanent_etb' || t.triggerType === 'creature_etb')) {
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures?/i);
    const colorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_etb',
      description: anotherCreatureControlledETBMatch[1].trim(),
      effect: anotherCreatureControlledETBMatch[1].trim(),
      mandatory: true,
      colorRestriction: colorRestriction && colorRestriction !== 'another' && colorRestriction !== 'one or more' ? colorRestriction : undefined,
      creatureOnly: true,
    } as any);
  }
  
  // "Whenever a creature an opponent controls enters"
  const opponentCreatureETBMatch = oracleText.match(/whenever (?:a|another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:an opponent controls )?enters?(?: the battlefield)?(?: under (?:an opponent's|their) control)?,?\s*([^.]+)/i);
  const hasOpponentRestriction = /creatures? (?:an opponent controls|under an opponent's control)/.test(oracleText) ||
                                  /creatures? enters?(?: the battlefield)? under (?:an opponent's|their) control/.test(oracleText);
  if (opponentCreatureETBMatch && hasOpponentRestriction && !triggers.some(t => t.triggerType === 'opponent_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_etb',
      description: opponentCreatureETBMatch[1].trim(),
      effect: opponentCreatureETBMatch[1].trim(),
      mandatory: !opponentCreatureETBMatch[1].toLowerCase().includes('you may'),
    } as any);
  }
  
  // "As [this] enters the battlefield, choose" - Modal permanents
  const modalETBMatch = oracleText.match(/as (?:~|this (?:creature|permanent|enchantment)) enters(?: the battlefield)?,?\s*choose\s+([^.]+)/i);
  if (modalETBMatch) {
    const choiceText = modalETBMatch[1].trim();
    const options = choiceText.split(/\s+or\s+/i).map(opt => opt.trim().replace(/[.,]$/, ''));
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'etb_modal_choice',
      description: `Choose: ${options.join(' or ')}`,
      effect: choiceText,
      mandatory: true,
      requiresChoice: true,
      modalOptions: options,
    } as any);
  }
  
  // Job Select (Final Fantasy set)
  const hasJobSelect = lowerOracle.includes('job select') || 
    (lowerOracle.includes('create') && lowerOracle.includes('hero') && lowerOracle.includes('token') && lowerOracle.includes('attach'));
  if (hasJobSelect && !triggers.some(t => t.triggerType === 'job_select')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'job_select',
      description: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
      effect: 'create_hero_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Hero',
        power: 1,
        toughness: 1,
        types: ['Creature'],
        subtypes: ['Hero'],
        colors: [],
      },
    } as any);
  }
  
  // Living Weapon
  const hasLivingWeapon = lowerOracle.includes('living weapon') ||
    (lowerOracle.includes('create') && lowerOracle.includes('germ') && lowerOracle.includes('token') && lowerOracle.includes('attach'));
  if (hasLivingWeapon && !triggers.some(t => t.triggerType === 'living_weapon')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'living_weapon',
      description: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
      effect: 'create_germ_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Phyrexian Germ',
        power: 0,
        toughness: 0,
        types: ['Creature'],
        subtypes: ['Phyrexian', 'Germ'],
        colors: ['B'],
      },
    } as any);
  }
  
  return triggers;
}

/**
 * Check if a permanent has ETB triggers that should fire when a permanent enters
 */
export function getETBTriggersForPermanent(card: any, permanent: any): TriggeredAbility[] {
  return detectETBTriggers(card, permanent);
}

// ============================================================================
// ETB Untap Effects (Intruder Alarm, etc.)
// ============================================================================

/**
 * Detect ETB-triggered untap effects from a card's oracle text
 */
export function detectETBUntapEffects(card: any, permanent: any): ETBUntapEffect[] {
  const effects: ETBUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a creature enters the battlefield, untap all creatures" (Intruder Alarm)
  if (oracleText.includes('whenever a creature enters') && oracleText.includes('untap all creatures')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a creature enters the battlefield, untap all creatures",
      untapType: 'all_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // "Whenever a creature enters the battlefield under your control, untap" patterns
  // Supports both old "enters the battlefield" and new Bloomburrow "enters" templates
  if ((oracleText.includes('whenever a creature enters the battlefield under your control') ||
       oracleText.includes('whenever a creature enters under your control')) && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a creature enters under your control, untap target creature",
      untapType: 'controller_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // Generic pattern: "whenever a creature enters the battlefield" + "untap"
  const creatureETBUntapMatch = oracleText.match(/whenever a creature enters (?:the battlefield)?[^.]*untap ([^.]+)/i);
  if (creatureETBUntapMatch && !effects.length) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a creature enters the battlefield, untap ${creatureETBUntapMatch[1]}`,
      untapType: 'all_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // "Whenever a nontoken creature enters" patterns
  if (oracleText.includes('whenever a nontoken creature enters') && oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a nontoken creature enters the battlefield, untap",
      untapType: 'all_creatures',
      triggerCondition: 'nontoken_creature_etb',
    });
  }
  
  return effects;
}

/**
 * Get ETB untap effects that should trigger when a creature enters
 */
export function getETBUntapEffects(
  ctx: GameContext,
  enteringPermanent: any,
  isToken: boolean
): ETBUntapEffect[] {
  const effects: ETBUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check if the entering permanent is a creature
  const typeLine = (enteringPermanent?.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  
  if (!isCreature) {
    return effects;
  }
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.id === enteringPermanent?.id) continue;
    
    const permEffects = detectETBUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      if (effect.triggerCondition === 'creature_etb') {
        effects.push(effect);
      } else if (effect.triggerCondition === 'nontoken_creature_etb' && !isToken) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply an ETB untap effect (actually untap the permanents)
 */
export function applyETBUntapEffect(ctx: GameContext, effect: ETBUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'all_creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'controller_creatures':
        shouldUntap = typeLine.includes('creature') && permanent.controller === effect.controllerId;
        break;
      case 'all_permanents':
        shouldUntap = true;
        break;
      case 'equipped_creature':
        // Would need to track equipment attachment
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// Auto-Sacrifice ETB (Kroxa, etc.)
// ============================================================================

/**
 * Check if a permanent should auto-sacrifice on ETB
 */
export function checkETBAutoSacrifice(card: any, permanent: any): { 
  shouldSacrifice: boolean; 
  reason: string;
  timing: 'immediate' | 'end_step';
} | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_ETB_SACRIFICE_UNLESS)) {
    if (cardName.includes(knownName)) {
      if (info.checkCondition(permanent)) {
        let timing: 'immediate' | 'end_step' = 'immediate';
        if (oracleText.includes('at the beginning of the end step') || 
            oracleText.includes('end of turn')) {
          timing = 'end_step';
        }
        
        return {
          shouldSacrifice: true,
          reason: info.effect,
          timing,
        };
      }
      return null;
    }
  }
  
  // Generic pattern: "When ~ enters the battlefield, sacrifice it unless" or "When ~ enters, sacrifice it unless"
  // Supports both old "enters the battlefield" and new Bloomburrow "enters" templates
  const sacrificeUnlessMatch = oracleText.match(
    /when (?:~|this creature) enters(?: the battlefield)?,?\s*sacrifice (?:~|it) unless ([^.]+)/i
  );
  if (sacrificeUnlessMatch) {
    const condition = sacrificeUnlessMatch[1].toLowerCase();
    
    if (condition.includes('escaped') && !permanent.escapedFrom) {
      return {
        shouldSacrifice: true,
        reason: `Sacrifice unless it escaped`,
        timing: 'immediate',
      };
    }
  }
  
  // Pattern: "At the beginning of the end step, sacrifice ~"
  const endStepSacrificeMatch = oracleText.match(
    /at the beginning of (?:the )?end step,?\s*sacrifice (?:~|this creature)/i
  );
  if (endStepSacrificeMatch) {
    return {
      shouldSacrifice: true,
      reason: "Sacrifice at end of turn",
      timing: 'end_step',
    };
  }
  
  return null;
}
