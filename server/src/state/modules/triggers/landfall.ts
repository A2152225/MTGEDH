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
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from './triggerConditionFamilyMatch.js';
import { triggerSubjectIRVerdict } from './triggerIRVerdict.js';

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
  /** Required land subtype for typed_land_enter (e.g. "forest", "gate"). */
  requiredLandType?: string;
  triggerType?: string;
  /** Foe-liage: only while the watcher's controller is the turn player. */
  duringSourceControllerTurn?: boolean;
}

/** Rule 205.3i land types — used so "Whenever a creature you control enters" is not typed landfall. */
const KNOWN_LAND_SUBTYPES = new Set([
  'plains',
  'island',
  'swamp',
  'mountain',
  'forest',
  'cave',
  'desert',
  'gate',
  'lair',
  'locus',
  'mine',
  'planet',
  'power-plant',
  'sphere',
  'tower',
  'town',
  "urza's",
]);

export function isKnownLandSubtype(raw: string): boolean {
  return KNOWN_LAND_SUBTYPES.has(String(raw || '').trim().toLowerCase());
}

/**
 * True when an ETB subject phrase is landfall territory (generic land or a land subtype),
 * so it must not also be classified as creature_etb.
 */
export function isLandfallEtbSubjectPhrase(rawPhrase: string): boolean {
  const phrase = String(rawPhrase || '').toLowerCase().trim();
  if (!phrase) return false;
  if (phrase === 'land' || /\blands?\b/.test(phrase)) return true;
  if (isKnownLandSubtype(phrase)) return true;
  // Dual land-subtype subjects: "Swamp or Forest", "Island or Swamp"
  if (/\bor\b/.test(phrase)) {
    const parts = phrase.split(/\s+or\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((part) => isKnownLandSubtype(part.replace(/^an?\s+/i, '')))) {
      return true;
    }
  }
  // "basic Forest", "Snow-Covered Mountain", etc.
  const tokens = phrase.split(/[\s/]+/).map((t) => t.replace(/[^a-z'-]/g, '')).filter(Boolean);
  return tokens.some((token) => isKnownLandSubtype(token));
}

function enteringLandMatchesRequiredType(enteringLand: any, requiredLandType?: string): boolean {
  const required = String(requiredLandType || '').trim().toLowerCase();
  if (!required) return true;
  // No entering land provided (detect-only / legacy callers): do not filter out.
  if (!enteringLand) return true;
  // Dual subtypes are encoded as "swamp|forest".
  if (required.includes('|')) {
    return required.split('|').some((part) => enteringLandMatchesRequiredType(enteringLand, part.trim()));
  }
  const typeLine = String(enteringLand?.card?.type_line || enteringLand?.type_line || '').toLowerCase();
  if (!typeLine) return false;
  // Power-Plant / Urza's need exact subtype token checks beyond simple includes for short words.
  if (required === "urza's") {
    return /\burza'?s\b/.test(typeLine);
  }
  if (required === 'power-plant') {
    return typeLine.includes('power-plant') || typeLine.includes('powerplant');
  }
  return new RegExp(`\\b${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
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
    const effectText = timingTriggerEffect(oracleText, landfallMatch);
    
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
  
  // Land enters from a zone other than hand (The Lost and the Damned, etc.)
  const landEntersNotHandMatch = oracleText.match(
    /whenever a land you control enters from anywhere other than your hand(?:\s+or\s+you cast\b[^,]*)?,?\s*([^.]+)/i,
  );
  if (landEntersNotHandMatch) {
    const effectText = timingTriggerEffect(oracleText, landEntersNotHandMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
    });
  }

  // Also check for non-keyworded landfall patterns (cards without "Landfall" keyword)
  // Handles both old and new Bloomburrow-style oracle text:
  // - "Whenever a land you control enters, ..." (new style)
  // - "Whenever a land enters the battlefield under your control, ..." (old style)
  // - "Whenever a land enters under your control, ..." (hybrid)
  const genericLandfallMatch = oracleText.match(
    /whenever a land (?:you control enters(?: from anywhere other than your hand)?|enters(?: the battlefield)?(?: under your control)?(?: from anywhere other than your hand)?),?\s*([^]*?)(?:\n\n|$)/i
  );
  const hybridLandEnterMatch = oracleText.match(
    /\bor\s+(?:a |an )?(\w+(?:\s+\w+)*) you control enters(?: from [^,]+)?,?\s*([^.]+)/i,
  );
  if (hybridLandEnterMatch && !landfallMatch && !genericLandfallMatch) {
    const effectText = timingTriggerEffect(oracleText, hybridLandEnterMatch, 2);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        triggerType: 'hybrid_land_you_control_enters' as any,
      } as LandfallTrigger);
    }
  }

  const whenLandYouControlEntersMatch = oracleText.match(
    /when a land you control enters,?\s*([^.]+)/i,
  );
  if (
    whenLandYouControlEntersMatch &&
    !landfallMatch &&
    !genericLandfallMatch &&
    !triggers.some((t) => (t as any).triggerType === 'when_land_you_control_enters')
  ) {
    const effectText = timingTriggerEffect(oracleText, whenLandYouControlEntersMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      triggerType: 'when_land_you_control_enters' as any,
    } as LandfallTrigger);
  }

  const typedLandEnterMatch = oracleText.match(
    /whenever a ([\w'-]+) you control enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (typedLandEnterMatch && !triggers.some((t) => (t as any).triggerType === 'typed_land_enter')) {
    const landType = String(typedLandEnterMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, typedLandEnterMatch, 2);
    // Only real land subtypes (Forest, Gate, Desert, ...). Never "creature", "permanent", etc.
    if (effectText && landType !== 'land' && isKnownLandSubtype(landType)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        triggerType: 'typed_land_enter' as any,
        requiredLandType: landType,
      } as LandfallTrigger);
    }
  }

  // Dual land-subtype landfall (Slimefoot / Tireless Angler):
  // "Whenever a Swamp or Forest enters under your control, ..."
  // "Whenever an Island or Swamp enters the battlefield under your control, ..."
  const dualTypedLandEnterMatch = oracleText.match(
    /whenever an? ([\w'-]+)\s+or\s+([\w'-]+) enters(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i,
  );
  if (dualTypedLandEnterMatch && !triggers.some((t) => (t as any).triggerType === 'typed_land_enter')) {
    const landTypeA = String(dualTypedLandEnterMatch[1] || '').trim().toLowerCase();
    const landTypeB = String(dualTypedLandEnterMatch[2] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, dualTypedLandEnterMatch, 3);
    if (
      effectText
      && isKnownLandSubtype(landTypeA)
      && isKnownLandSubtype(landTypeB)
    ) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        triggerType: 'typed_land_enter' as any,
        // Pipe-delimited dual subtype; matcher treats either subtype as a hit.
        requiredLandType: `${landTypeA}|${landTypeB}`,
      } as LandfallTrigger);
    }
  }

  // "Whenever a Forest enters" / "Whenever a Mountain enters" (any controller; Baru, etc.)
  const anyTypedLandEnterMatch = oracleText.match(
    /whenever a ([\w'-]+) enters(?: the battlefield)?(?!,?\s*if\s+it\s+was\s+kicked),?\s*([^.]+)/i,
  );
  if (
    anyTypedLandEnterMatch
    && !/you control enters/i.test(String(anyTypedLandEnterMatch[0] || ''))
    && !triggers.some((t) => (t as any).triggerType === 'any_typed_land_enter')
  ) {
    const landType = String(anyTypedLandEnterMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, anyTypedLandEnterMatch, 2);
    if (effectText && landType !== 'land' && isKnownLandSubtype(landType)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        triggerType: 'any_typed_land_enter' as any,
        requiredLandType: landType,
      } as LandfallTrigger);
    }
  }

  const enchantedPlayerLandEnterMatch = oracleText.match(
    /whenever a land enchanted player controls enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (enchantedPlayerLandEnterMatch && !triggers.some((t) => (t as any).triggerType === 'enchanted_player_land_enter')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerLandEnterMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_player_land_enter' as any,
    } as LandfallTrigger);
  }

  const exiledNameOpponentLandEnterMatch = oracleText.match(
    /whenever a land an opponent controls with the same name as the exiled card enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    exiledNameOpponentLandEnterMatch &&
    !triggers.some((t) => (t as any).triggerType === 'exiled_name_opponent_land_enter')
  ) {
    const effectText = timingTriggerEffect(oracleText, exiledNameOpponentLandEnterMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      triggerType: 'exiled_name_opponent_land_enter' as any,
    } as LandfallTrigger);
  }

  const opponentLandEnterMatch = oracleText.match(
    /whenever a (?:(nonbasic|basic|snow)\s+)?land an opponent controls enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (opponentLandEnterMatch && !triggers.some((t) => (t as any).triggerType === 'opponent_land_enter')) {
    const effectText = timingTriggerEffect(oracleText, opponentLandEnterMatch, 2);
    const landQualifier = String(opponentLandEnterMatch[1] || '').trim().toLowerCase();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      triggerType: 'opponent_land_enter' as any,
      ...(landQualifier ? { requiredLandType: landQualifier } : null),
    } as LandfallTrigger);
  }

  const thisOrAnotherLandEnterMatch = oracleText.match(
    /whenever (?:this (?:land|permanent)|~) or another land you control enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherLandEnterMatch
    && !landfallMatch
    && !genericLandfallMatch
    && !triggers.some((t) => (t as any).triggerType === 'this_or_another_land_you_control_enters')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherLandEnterMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      triggerType: 'this_or_another_land_you_control_enters' as any,
    } as LandfallTrigger);
  }

  const anyLandEnterMatch = oracleText.match(
    /whenever a land enters(?: the battlefield)?(?: during your turn)?(?!\s+under),?\s*([^.]+)/i,
  );
  if (
    anyLandEnterMatch
    && !/you control enters/i.test(String(anyLandEnterMatch[0] || ''))
    && !/an opponent/i.test(String(anyLandEnterMatch[0] || ''))
    && !/enchanted player/i.test(String(anyLandEnterMatch[0] || ''))
    && !landfallMatch
    && !genericLandfallMatch
    && !triggers.some((t) => (t as any).triggerType === 'any_land_enter' || (t as any).triggerType === 'opponent_land_enter')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyLandEnterMatch);
    const duringYourTurn = /during your turn/i.test(String(anyLandEnterMatch[0] || ''));
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      triggerType: 'any_land_enter' as any,
      ...(duringYourTurn ? { duringSourceControllerTurn: true } : null),
    } as LandfallTrigger);
  }

  const playLandPatterns = [
    { pattern: /whenever an opponent plays a land,?\s*([^.]+)/gi, triggerType: 'opponent_plays_land' as const },
    { pattern: /whenever a player plays a land,?\s*([^.]+)/gi, triggerType: 'player_plays_land' as const },
    { pattern: /whenever you play a land,?\s*([^.]+)/gi, triggerType: 'you_play_land' as const },
  ];
  for (const { pattern, triggerType } of playLandPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((t) => (t as any).triggerType === triggerType && t.effect === effectText)) {
        continue;
      }
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresChoice: effectText.toLowerCase().includes('you may'),
        triggerType: triggerType as any,
      } as LandfallTrigger);
    }
  }

  if (genericLandfallMatch && !landfallMatch && !landEntersNotHandMatch) {
    const effectText = timingTriggerEffect(oracleText, genericLandfallMatch);
    
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
 * @param enteringLand Optional entering land permanent — used to filter typed subtype landfall
 */
function enteringLandMatchesOpponentQualifier(enteringLand: any, requiredLandType?: string): boolean {
  const required = String(requiredLandType || '').trim().toLowerCase();
  if (!required || required === 'land') return true;
  if (!enteringLand) return true;
  const typeLine = String(enteringLand?.card?.type_line || enteringLand?.type_line || '').toLowerCase();
  if (required === 'nonbasic') {
    return typeLine.includes('land') && !/\bbasic\b/.test(typeLine);
  }
  if (required === 'basic') {
    return /\bbasic\b/.test(typeLine);
  }
  if (required === 'snow') {
    return /\bsnow\b/.test(typeLine);
  }
  return enteringLandMatchesRequiredType(enteringLand, required);
}

function landfallIRVerdict(trigger: any, sourcePermanent: any, enteringLand: any, landController: string, ctx: GameContext): boolean | null {
  return triggerSubjectIRVerdict({
    oracleText: String(sourcePermanent?.card?.oracle_text || ''),
    events: ['enters', 'plays_land'],
    effectTexts: [trigger?.effect, trigger?.description],
    subjectPermanent: enteringLand,
    subjectControllerId: String(enteringLand?.controller || landController || ''),
    sourcePermanent,
    state: ctx.state,
  });
}

export function getLandfallTriggers(
  ctx: GameContext,
  landController: string,
  enteringLand?: any,
): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permTriggers = detectLandfallTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      const triggerType = String((trigger as any).triggerType || '');
      const isOpponentLandTrigger =
        triggerType === 'opponent_land_enter'
        || triggerType === 'exiled_name_opponent_land_enter';
      const isAnyControllerTyped = triggerType === 'any_typed_land_enter';
      const isAnyLandEnter = triggerType === 'any_land_enter';
      const isEnchantedPlayerLand = triggerType === 'enchanted_player_land_enter';

      if ((trigger as any).duringSourceControllerTurn) {
        const turnPlayer = String((ctx.state as any)?.turnPlayer || (ctx.state as any)?.activePlayer || '');
        if (turnPlayer && turnPlayer !== String(permanent.controller || '')) continue;
      }

      if (isOpponentLandTrigger) {
        // Watcher must be an opponent of the player whose land entered.
        if (String(permanent.controller || '') === String(landController || '')) continue;
        if (!enteringLandMatchesOpponentQualifier(enteringLand, (trigger as any).requiredLandType)) {
          continue;
        }
      } else if (isAnyControllerTyped) {
        if (!enteringLandMatchesRequiredType(enteringLand, (trigger as any).requiredLandType)) {
          continue;
        }
      } else if (isAnyLandEnter) {
        // Any land, any controller.
      } else if (isEnchantedPlayerLand) {
        const enchantedPlayer = String(
          permanent?.attachedTo || permanent?.enchanting || permanent?.enchantedPlayerId || '',
        ).trim();
        if (!enchantedPlayer || enchantedPlayer !== String(landController || '')) continue;
      } else {
        // Normal landfall: only when the land's controller owns the watcher.
        if (permanent.controller !== landController) continue;
        if (
          triggerType === 'typed_land_enter'
          && !enteringLandMatchesRequiredType(enteringLand, (trigger as any).requiredLandType)
        ) {
          continue;
        }
      }

      // The legacy triggerType drops subject qualifiers ("nontoken land", "a Forest or Island
      // you control", "land an opponent controls"); the printed sentence's IR keeps them.
      if (enteringLand && landfallIRVerdict(trigger, permanent, enteringLand, landController, ctx) === false) {
        continue;
      }

      triggers.push({
        ...trigger,
        sourceId: trigger.permanentId,
        sourceZone: 'battlefield' as const,
        sourceCard: permanent.card,
      });
    }
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
      if (
        (trigger as any).triggerType === 'typed_land_enter'
        && !enteringLandMatchesRequiredType(enteringLand, (trigger as any).requiredLandType)
      ) {
        continue;
      }
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

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'plays_land',
      subjectPermanent: enteringLand || { id: '', controller: landController, card: { type_line: 'Land' } },
      subjectControllerId: landController,
      sourcePermanent: permanent,
    })) {
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates(existing.effect || '', line)
      ))) continue;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        effect: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
        triggerType: 'plays_land',
      });
    }
  }

  return triggers;
}
