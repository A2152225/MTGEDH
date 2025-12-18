/**
 * triggers/turn-phases.ts
 * 
 * Turn phase-related trigger detection and processing.
 * Includes upkeep, draw step, end step, and untap step triggers.
 * 
 * Phase ordering in MTG:
 * 1. Beginning Phase: Untap Step, Upkeep Step, Draw Step
 * 2. Pre-combat Main Phase
 * 3. Combat Phase: Beginning of Combat, Declare Attackers, Declare Blockers, Combat Damage, End of Combat
 * 4. Post-combat Main Phase
 * 5. Ending Phase: End Step, Cleanup Step
 */

import type { GameContext } from "../../context.js";
import { KNOWN_END_STEP_TRIGGERS } from "./card-data-tables.js";

// ============================================================================
// Type Definitions for Turn Phase Triggers
// ============================================================================

// NOTE: The canonical type definitions are in types.ts
// These local definitions are used for the implementation and will be
// exported from this module. They align with the types.ts definitions.

export interface EndStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'end_step_resource' | 'end_step_effect';
  description: string;
  effect?: string;
  mandatory: boolean;
  requiresChoice?: boolean;
  affectsAllPlayers?: boolean;
}

export interface DrawStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
}

export interface UntapStepEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  untapType: 'artifacts' | 'creatures' | 'all' | 'lands' | 'specific';
  onOtherPlayersTurn: boolean;
  onYourTurn: boolean;
}

export interface DoesntUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  affectedType: 'all_creatures' | 'all_lands' | 'all_permanents' | 'controller_creatures' | 'controller_lands' | 'specific_permanent';
  affectedController: 'all' | 'controller' | 'opponents';
  targetPermanentId?: string;
  description: string;
}

/**
 * Detect end step triggers from a card's oracle text
 */
export function detectEndStepTriggers(card: any, permanent: any): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known cards first
  let foundInKnownCards = false;
  for (const [knownName, info] of Object.entries(KNOWN_END_STEP_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_resource',
        description: info.effect,
        effect: info.effect,
        mandatory: info.mandatory,
        requiresChoice: info.requiresChoice,
        affectsAllPlayers: info.affectsAllPlayers,
      });
      foundInKnownCards = true;
      break; // Only match once in known cards
    }
  }
  
  // Generic detection: "At the beginning of each end step" or "At the beginning of your end step"
  // Skip generic detection if we already found this card in known cards to prevent duplicates
  if (!foundInKnownCards) {
    const endStepMatch = oracleText.match(/at the beginning of (?:each|your) end step,?\s*([^.]+)/i);
    if (endStepMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: endStepMatch[1].trim(),
        effect: endStepMatch[1].trim(),
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get all end step triggers for the active player's end step
 */
export function getEndStepTriggers(
  ctx: GameContext,
  activePlayerId: string
): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectEndStepTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      // "At the beginning of your end step" - only for controller
      if (lowerOracle.includes('your end step')) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
        }
      }
      // "At the beginning of each end step" - triggers regardless of whose turn
      else if (lowerOracle.includes('each end step')) {
        triggers.push(trigger);
      }
      // Default: assume "your end step" if not specified
      else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Draw Step Trigger System
// ============================================================================

/**
 * Detect draw step triggers from a card's oracle text
 * Pattern: "At the beginning of your draw step" or "At the beginning of each player's draw step"
 * 
 * IMPORTANT: This should only detect actual TRIGGERS, not replacement effects!
 * Cards like Font of Mythos, Howling Mine, Kami of the Crescent Moon, Rites of Flourishing, Puzzlebox
 * have text like "At the beginning of each player's draw step, that player draws X additional cards."
 * These are REPLACEMENT EFFECTS that modify the draw, not triggers that go on the stack.
 * 
 * Replacement effects should NOT require passing priority - they're handled automatically
 * by the draw calculation in game-state-effects.ts (calculateAdditionalDraws).
 */
export function detectDrawStepTriggers(card: any, permanent: any): DrawStepTrigger[] {
  const triggers: DrawStepTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = (card?.name || "Unknown").toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // List of cards that are replacement effects, NOT triggers
  // These modify the draw but don't use the stack
  const replacementEffectCards = [
    'font of mythos',
    'howling mine',
    'kami of the crescent moon',
    'rites of flourishing',
    'dictate of kruphix',
    'temple bell', // Activated ability, not a trigger
    'mikokoro, center of the sea', // Activated ability
    'geier reach sanitarium', // Activated ability
    'seizan, perverter of truth',
    'well of ideas',
    'minds aglow',
    'prosperity',
    'font of fortunes',
    'jace beleren',
    'anvil of bogardan',
    'spiteful visions',
    'nekusar',
    'teferi\'s puzzle box', // Puzzlebox
  ];
  
  // Check if this is a known replacement effect card
  if (replacementEffectCards.some(name => cardName.includes(name))) {
    // This is a replacement effect, not a trigger - return empty
    return triggers;
  }
  
  // Check if the text is just modifying draws (replacement effect pattern)
  // Pattern: "that player draws X additional cards" or "draw X additional cards"
  const lowerOracle = oracleText.toLowerCase();
  if (lowerOracle.includes('draw') && (lowerOracle.includes('additional card') || lowerOracle.includes('an extra card'))) {
    // This looks like a replacement effect that modifies draws
    // Don't treat it as a trigger
    return triggers;
  }
  
  // "At the beginning of your draw step" - actual triggers
  const yourDrawMatch = oracleText.match(/at the beginning of your draw step,?\s*([^.]+)/i);
  if (yourDrawMatch) {
    const effect = yourDrawMatch[1].trim();
    // Double-check it's not a draw modification
    if (!effect.toLowerCase().includes('draw') || !effect.toLowerCase().includes('additional')) {
      triggers.push({
        permanentId,
        cardName: card?.name || "Unknown",
        controllerId,
        description: effect,
        effect: effect,
        mandatory: true,
      });
    }
  }
  
  // "At the beginning of each player's draw step" - actual triggers
  const eachDrawMatch = oracleText.match(/at the beginning of each player's draw step,?\s*([^.]+)/i);
  if (eachDrawMatch) {
    const effect = eachDrawMatch[1].trim();
    // Double-check it's not a draw modification
    if (!effect.toLowerCase().includes('draw') || !effect.toLowerCase().includes('additional')) {
      triggers.push({
        permanentId,
        cardName: card?.name || "Unknown",
        controllerId,
        description: effect,
        effect: effect,
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get all draw step triggers for the active player's draw step
 */
export function getDrawStepTriggers(
  ctx: GameContext,
  activePlayerId: string
): DrawStepTrigger[] {
  const triggers: DrawStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectDrawStepTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      if (lowerOracle.includes('your draw step')) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
        }
      } else if (lowerOracle.includes('each player')) {
        triggers.push(trigger);
      } else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Untap Step Effects System
// ============================================================================

/**
 * Detect untap step effects from a card's oracle text
 * Handles cards like:
 * - Unwinding Clock: "Untap all artifacts you control during each other player's untap step"
 * - Seedborn Muse: "Untap all permanents you control during each other player's untap step"
 * - Prophet of Kruphix (banned): Similar to Seedborn Muse
 * - Wilderness Reclamation: "At the beginning of your end step, untap all lands you control"
 */
export function detectUntapStepEffects(card: any, permanent: any): UntapStepEffect[] {
  const effects: UntapStepEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Untap all artifacts you control during each other player's untap step" (Unwinding Clock)
  if (oracleText.includes('untap all artifacts') && oracleText.includes('other player')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Untap all artifacts you control during each other player's untap step",
      untapType: 'artifacts',
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  // "Untap all permanents you control during each other player's untap step" (Seedborn Muse)
  if (oracleText.includes('untap all permanents') && oracleText.includes('other player')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Untap all permanents you control during each other player's untap step",
      untapType: 'all',
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  // "Untap all creatures you control during each other player's untap step"
  if (oracleText.includes('untap all creatures') && oracleText.includes('other player')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Untap all creatures you control during each other player's untap step",
      untapType: 'creatures',
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  // Generic pattern: "untap all X you control during each other player's untap step"
  const untapOtherMatch = oracleText.match(/untap all (\w+)(?: you control)? during each other player's untap step/i);
  if (untapOtherMatch && !effects.length) {
    const type = untapOtherMatch[1].toLowerCase();
    let untapType: UntapStepEffect['untapType'] = 'specific';
    if (type === 'artifacts') untapType = 'artifacts';
    else if (type === 'creatures') untapType = 'creatures';
    else if (type === 'permanents') untapType = 'all';
    else if (type === 'lands') untapType = 'lands';
    
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Untap all ${type} you control during each other player's untap step`,
      untapType,
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  return effects;
}

/**
 * Get all untap step effects that apply during a specific player's untap step
 * @param ctx Game context
 * @param untapPlayerId The player whose untap step it is
 * @returns Effects that should trigger
 */
export function getUntapStepEffects(
  ctx: GameContext,
  untapPlayerId: string
): UntapStepEffect[] {
  const effects: UntapStepEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permEffects = detectUntapStepEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      // Check if this effect applies
      const isControllersTurn = permanent.controller === untapPlayerId;
      
      if (effect.onOtherPlayersTurn && !isControllersTurn) {
        // Effects like Unwinding Clock trigger on OTHER players' untap steps
        effects.push(effect);
      } else if (effect.onYourTurn && isControllersTurn) {
        // Effects that trigger on your own untap step
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply untap step effects (actually untap the permanents)
 * @param ctx Game context
 * @param effect The untap effect to apply
 */
export function applyUntapStepEffect(ctx: GameContext, effect: UntapStepEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== effect.controllerId) continue;
    if (!permanent.tapped) continue; // Already untapped
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'all':
        shouldUntap = true;
        break;
      case 'artifacts':
        shouldUntap = typeLine.includes('artifact');
        break;
      case 'creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'lands':
        shouldUntap = typeLine.includes('land');
        break;
      case 'specific':
        // Would need more specific matching based on the effect
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
// "Doesn't Untap" Effects
// ============================================================================

/**
 * Detect "doesn't untap" effects from a card's oracle text
 * Handles cards like:
 * - Claustrophobia: "Enchanted creature doesn't untap during its controller's untap step"
 * - Frozen/Sleep effects: "Target creature doesn't untap during its controller's next untap step"
 * - Stasis: "Players skip their untap steps"
 * - Rising Waters: "Lands don't untap during their controllers' untap steps"
 */
export function detectDoesntUntapEffects(card: any, permanent: any): DoesntUntapEffect[] {
  const effects: DoesntUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedTo = permanent?.attachedTo;
  
  // Aura pattern: "Enchanted creature doesn't untap during its controller's untap step"
  if (oracleText.includes('enchanted creature') && oracleText.includes("doesn't untap")) {
    if (attachedTo) {
      effects.push({
        permanentId,
        cardName,
        controllerId,
        affectedType: 'specific_permanent',
        affectedController: 'all',
        targetPermanentId: attachedTo,
        description: "Enchanted creature doesn't untap during its controller's untap step",
      });
    }
  }
  
  // Global effect: "Creatures don't untap during their controllers' untap steps"
  if (oracleText.includes('creatures') && oracleText.includes("don't untap") && oracleText.includes('controllers')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      affectedType: 'all_creatures',
      affectedController: 'all',
      description: "Creatures don't untap during their controllers' untap steps",
    });
  }
  
  // Global effect: "Lands don't untap during their controllers' untap steps"
  if (oracleText.includes('lands') && oracleText.includes("don't untap") && oracleText.includes('controllers')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      affectedType: 'all_lands',
      affectedController: 'all',
      description: "Lands don't untap during their controllers' untap steps",
    });
  }
  
  return effects;
}

/**
 * Check if a permanent is prevented from untapping by any "doesn't untap" effects
 */
export function isPermanentPreventedFromUntapping(
  ctx: GameContext,
  permanentToUntap: any,
  untapPlayerId: string
): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permTypeLine = (permanentToUntap?.card?.type_line || '').toLowerCase();
  const isCreature = permTypeLine.includes('creature');
  const isLand = permTypeLine.includes('land');
  const permController = permanentToUntap?.controller;
  
  // Check all permanents for "doesn't untap" effects
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const doesntUntapEffects = detectDoesntUntapEffects(permanent.card, permanent);
    
    for (const effect of doesntUntapEffects) {
      // Check if this effect applies to the permanent trying to untap
      
      // Specific permanent targeting (like Claustrophobia)
      if (effect.affectedType === 'specific_permanent') {
        if (effect.targetPermanentId === permanentToUntap.id) {
          return true; // This permanent is specifically prevented from untapping
        }
        continue;
      }
      
      // Check controller restriction
      let controllerMatches = false;
      switch (effect.affectedController) {
        case 'all':
          controllerMatches = true;
          break;
        case 'controller':
          controllerMatches = permController === effect.controllerId;
          break;
        case 'opponents':
          controllerMatches = permController !== effect.controllerId;
          break;
      }
      
      if (!controllerMatches) continue;
      
      // Check type restriction
      switch (effect.affectedType) {
        case 'all_creatures':
          if (isCreature) return true;
          break;
        case 'all_lands':
          if (isLand) return true;
          break;
        case 'all_permanents':
          return true;
        case 'controller_creatures':
          if (isCreature && permController === untapPlayerId) return true;
          break;
        case 'controller_lands':
          if (isLand && permController === untapPlayerId) return true;
          break;
      }
    }
  }
  
  // Also check if the permanent itself has a "doesn't untap" flag
  // This can be set by spells like Sleep or Hands of Binding
  if (permanentToUntap.doesntUntapNextTurn === true) {
    return true;
  }
  
  return false;
}
