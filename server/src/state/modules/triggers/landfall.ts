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
    /landfall\s*[—-]\s*whenever a land enters the battlefield under your control,?\s*([^.]+)/i
  );
  if (landfallMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: landfallMatch[1].trim(),
      mandatory: !landfallMatch[1].toLowerCase().includes('you may'),
      requiresChoice: landfallMatch[1].toLowerCase().includes('you may'),
    });
  }
  
  // Also check for non-keyworded landfall: "Whenever a land enters the battlefield under your control"
  const genericLandfallMatch = oracleText.match(
    /whenever a land enters the battlefield under your control,?\s*([^.]+)/i
  );
  if (genericLandfallMatch && !landfallMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: genericLandfallMatch[1].trim(),
      mandatory: !genericLandfallMatch[1].toLowerCase().includes('you may'),
      requiresChoice: genericLandfallMatch[1].toLowerCase().includes('you may'),
    });
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
