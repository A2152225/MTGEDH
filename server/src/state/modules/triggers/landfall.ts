/**
 * triggers/landfall.ts
 * 
 * Landfall trigger detection and processing.
 * Includes triggers that fire when lands enter the battlefield.
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
 */
export function detectLandfallTriggers(card: any, permanent: any): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Pattern: "Landfall — Whenever a land enters the battlefield under your control,"
  const landfallMatch = oracleText.match(
    /landfall\s*[—-]\s*whenever a land enters the battlefield under your control,?\s*([^]*?)(?:\n\n|$)/i
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
  
  // Also check for non-keyworded landfall: "Whenever a land enters the battlefield under your control"
  const genericLandfallMatch = oracleText.match(
    /whenever a land enters the battlefield under your control,?\s*([^]*?)(?:\n\n|$)/i
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
 */
export function getLandfallTriggers(
  ctx: GameContext,
  landController: string
): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    // Landfall triggers only fire for the controller
    if (permanent.controller !== landController) continue;
    
    const permTriggers = detectLandfallTriggers(permanent.card, permanent);
    triggers.push(...permTriggers);
  }
  
  return triggers;
}
