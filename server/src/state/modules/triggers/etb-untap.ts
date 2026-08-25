// Origin: server/src/state/modules/triggered-abilities.ts
// Cluster: leftover ETB untap effects and ETB auto-sacrifice
// Public: detectETBUntapEffects, getETBUntapEffects, applyETBUntapEffect, checkETBAutoSacrifice, ETBUntapEffect

import type { GameContext } from "../../context.js";

// ============================================================================
// ETB-Triggered Untap Effects (Intruder Alarm, Thornbite Staff, etc.)
// ============================================================================

export interface ETBUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'all_creatures' | 'equipped_creature' | 'controller_creatures' | 'all_permanents';
  triggerCondition: 'creature_etb' | 'any_etb' | 'nontoken_creature_etb';
}

/**
 * Detect ETB-triggered untap effects from a card's oracle text
 * Handles cards like:
 * - Intruder Alarm: "Whenever a creature enters the battlefield, untap all creatures"
 * - Thornbite Staff: "Whenever a creature dies, untap equipped creature" (death trigger, but similar pattern)
 * - Jeskai Ascendancy: "Whenever you cast a noncreature spell, creatures you control get +1/+1 and untap"
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
    return effects; // Only creature ETBs trigger these effects
  }
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.id === enteringPermanent?.id) continue; // Skip the entering permanent itself
    
    const permEffects = detectETBUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      // Check trigger condition
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
// Kroxa-style ETB Auto-Sacrifice Triggers
// ============================================================================

/**
 * Known cards that sacrifice themselves on ETB unless cast with an alternate cost (Escape, etc.)
 */
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
    checkCondition: () => false, // Ox doesn't sacrifice, it has a different ETB
  },
  // Blitz creatures also have this pattern
  "jaxis, the troublemaker": {
    effect: "Sacrifice at end of turn if it entered with blitz",
    alternateCostKeyword: "blitz",
    checkCondition: (perm) => perm.blitzed === true,
  },
  // Ball Lightning style creatures
  "ball lightning": {
    effect: "At the beginning of the end step, sacrifice Ball Lightning.",
    alternateCostKeyword: "",
    checkCondition: () => true, // Always sacrifices at end step
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

/**
 * Check if a permanent should auto-sacrifice on ETB
 * Returns sacrifice info or null if it shouldn't sacrifice
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
        // Determine timing
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
      return null; // Condition not met (e.g., escaped)
    }
  }
  
  // Generic pattern: "When ~ enters the battlefield, sacrifice it unless" or "When ~ enters, sacrifice it unless"
  // Supports both old "enters the battlefield" and new Bloomburrow "enters" templates
  const sacrificeUnlessMatch = oracleText.match(
    /when (?:~|this creature) enters(?: the battlefield)?,?\s*sacrifice (?:~|it) unless ([^.]+)/i
  );
  if (sacrificeUnlessMatch) {
    // Check if the condition is met (e.g., "unless it escaped")
    const condition = sacrificeUnlessMatch[1].toLowerCase();
    
    if (condition.includes('escaped') && !permanent.escapedFrom) {
      return {
        shouldSacrifice: true,
        reason: `Sacrifice unless it escaped`,
        timing: 'immediate',
      };
    }
    
    // Other conditions would need specific checking
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
