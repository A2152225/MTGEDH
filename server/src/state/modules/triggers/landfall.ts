/**
 * triggers/landfall.ts
 * 
 * Landfall trigger detection and processing.
 * Includes triggers that fire when lands enter the battlefield.
 * 
 * NOTE: As of Bloomburrow (2024), Wizards updated oracle text templates to often
 * exclude "the battlefield" from ETB text. For example:
 * - Old: "Whenever a land enters the battlefield under your control"
 * - New: "Whenever a land you control enters"
 * 
 * This module handles both old and new oracle text patterns.
 */

import type { GameContext } from "../../context.js";

export interface LandfallTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  mandatory: boolean;
  requiresChoice?: boolean;
  // For modal landfall triggers like Retreat to Emeria
  isModal?: boolean;
  modalOptions?: string[];
}

/**
 * Detect landfall triggers from a permanent's oracle text
 * 
 * Handles multiple oracle text patterns:
 * - "Landfall — Whenever a land you control enters, ..." (new Bloomburrow style)
 * - "Landfall — Whenever a land enters the battlefield under your control, ..." (old style)
 * - "Whenever a land you control enters, ..." (non-keyworded, new style)
 * - "Whenever a land enters the battlefield under your control, ..." (non-keyworded, old style)
 * 
 * @param card The card data
 * @param permanent The permanent data
 */
export function detectLandfallTriggers(card: any, permanent: any): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const oracleText = String(card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Early return if no oracle text
  if (!oracleText) {
    return triggers;
  }
  
  // Pattern for Landfall keyword ability
  // Handles both old and new Bloomburrow-style oracle text:
  // - "Landfall — Whenever a land you control enters, ..." (new style, e.g., Geode Rager post-update)
  // - "Landfall — Whenever a land enters the battlefield under your control, ..." (old style)
  // - "Landfall — Whenever a land enters under your control, ..." (hybrid)
  const landfallMatch = oracleText.match(
    /landfall\s*[—-]\s*whenever a land (?:you control enters|enters(?: the battlefield)?(?: under your control)?),?\s*([^]*?)(?:\n\n|$)/i
  );
  if (landfallMatch) {
    const effectText = landfallMatch[1].trim();
    
    // Check if this is a modal trigger (has "choose one" or "choose two" etc.)
    const modalMatch = effectText.match(/choose\s+(one|two|three|four|any number)\s*[—-]\s*((?:•[^•]+)+)/i);
    
    if (modalMatch) {
      // Parse the modal options (split by bullet points)
      const optionsPart = modalMatch[2];
      const options = optionsPart.split('•').filter(o => o.trim()).map(o => o.trim());
      
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: true, // Modal triggers require a choice
        requiresChoice: true,
        isModal: true,
        modalOptions: options,
      });
    } else {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
      });
    }
  }
  
  // Also check for non-keyworded landfall patterns (cards without "Landfall" keyword)
  // Handles both old and new Bloomburrow-style oracle text:
  // - "Whenever a land you control enters, ..." (new style)
  // - "Whenever a land enters the battlefield under your control, ..." (old style)
  // - "Whenever a land enters under your control, ..." (hybrid)
  const genericLandfallMatch = oracleText.match(
    /whenever a land (?:you control enters|enters(?: the battlefield)?(?: under your control)?),?\s*([^]*?)(?:\n\n|$)/i
  );
  if (genericLandfallMatch && !landfallMatch) {
    const effectText = genericLandfallMatch[1].trim();
    
    // Check if this is a modal trigger
    const modalMatch = effectText.match(/choose\s+(one|two|three|four|any number)\s*[—-]\s*((?:•[^•]+)+)/i);
    
    if (modalMatch) {
      const optionsPart = modalMatch[2];
      const options = optionsPart.split('•').filter(o => o.trim()).map(o => o.trim());
      
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: true,
        requiresChoice: true,
        isModal: true,
        modalOptions: options,
      });
    } else {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
      });
    }
  }
  
  return triggers;
}

/**
 * Get all landfall triggers when a land enters the battlefield
 * 
 * @param ctx Game context
 * @param landController The player who played/controls the land that entered
 */
export function getLandfallTriggers(
  ctx: GameContext,
  landController: string
): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Landfall triggers only fire for the controller when THEIR land enters
    // (The effect may target opponents, but the trigger is on your own lands)
    if (permanent.controller !== landController) continue;
    
    const permTriggers = detectLandfallTriggers(permanent.card, permanent);
    triggers.push(...permTriggers);
  }
  
  return triggers;
}
