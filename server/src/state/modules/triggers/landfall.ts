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
  permanentId?: string;
  sourceId?: string;
  sourceZone?: 'battlefield' | 'graveyard';
  sourceCard?: any;
  interveningIfSubjectSnapshot?: any;
  cardName: string;
  controllerId: string;
  effect: string;
  mandatory: boolean;
  requiresChoice?: boolean;
  // For modal landfall triggers like Retreat to Emeria
  isModal?: boolean;
  modalOptions?: string[];
  // For triggers that require targeting (Geode Rager - "goad each creature target player controls")
  requiresTarget?: boolean;
  targetType?: 'player' | 'creature' | 'permanent';
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripZoneFromSourceSnapshot(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const { zone, ...rest } = card as any;
  return rest;
}

function canLandfallTriggerFromGraveyard(card: any): boolean {
  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  if (!oracleText) return false;
  if (/\bif\s+this\s+card\s+is\s+in\s+your\s+graveyard\b/i.test(oracleText)) {
    return true;
  }

  const cardName = String(card?.name || '').trim();
  if (!cardName) return false;

  return new RegExp(`\\bif\\s+${escapeRegExp(cardName)}\\s+is\\s+in\\s+your\\s+graveyard\\b`, 'i').test(oracleText);
}

function getControllerGraveyard(ctx: GameContext, controllerId: string): any[] {
  const zonesGraveyard = ctx.state?.zones?.[controllerId]?.graveyard;
  if (Array.isArray(zonesGraveyard)) return zonesGraveyard;

  const playerEntry = Array.isArray(ctx.state?.players)
    ? ctx.state.players.find((player: any) => String(player?.id || '') === String(controllerId || ''))
    : undefined;
  return Array.isArray(playerEntry?.graveyard) ? playerEntry.graveyard : [];
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
      // Check if the effect requires a target player (e.g., Geode Rager)
      // Pattern: "goad each creature target player controls"
      const targetPlayerMatch = effectText.toLowerCase().match(/target\s+player/);
      const targetCreatureMatch = effectText.toLowerCase().match(/target\s+creature/);
      
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        requiresTarget: !!(targetPlayerMatch || targetCreatureMatch),
        targetType: targetPlayerMatch ? 'player' : targetCreatureMatch ? 'creature' : undefined,
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
      // Check if the effect requires a target player (e.g., Geode Rager)
      const targetPlayerMatch = effectText.toLowerCase().match(/target\s+player/);
      const targetCreatureMatch = effectText.toLowerCase().match(/target\s+creature/);
      
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        requiresTarget: !!(targetPlayerMatch || targetCreatureMatch),
        targetType: targetPlayerMatch ? 'player' : targetCreatureMatch ? 'creature' : undefined,
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
    triggers.push(...permTriggers.map((trigger) => ({
      ...trigger,
      sourceId: trigger.permanentId,
      sourceZone: 'battlefield' as const,
      sourceCard: permanent.card,
    })));
  }

  const graveyard = getControllerGraveyard(ctx, landController);
  for (const card of graveyard) {
    if (!card || !canLandfallTriggerFromGraveyard(card)) continue;

    const pseudoPermanent = {
      id: String(card?.id || ''),
      controller: landController,
      card,
    };
    const graveyardTriggers = detectLandfallTriggers(card, pseudoPermanent);
    for (const trigger of graveyardTriggers) {
      triggers.push({
        ...trigger,
        permanentId: undefined,
        sourceId: String(card?.id || '').trim(),
        sourceZone: 'graveyard',
        sourceCard: { ...card },
        interveningIfSubjectSnapshot: stripZoneFromSourceSnapshot(card),
      });
    }
  }
  
  return triggers;
}
