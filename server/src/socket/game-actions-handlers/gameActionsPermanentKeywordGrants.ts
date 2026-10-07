/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: "does this permanent have keyword X right now" resolution across
 * every grant source - own oracle text, granted/temporary abilities, attached
 * equipment and auras, and battlefield-wide (global or tribal) grants - plus the
 * haste-aware summoning sickness check built on top of it.
 *
 * Public entry symbols:
 *   - permanentHasSummoningSickness
 *   - creatureHasHaste
 *   - permanentHasKeyword
 */
import { attachmentOracleGrantsKeyword } from "../../../../shared/src/attachmentKeywordGrants.js";
import {
  grantedAbilityIsOwnKeyword,
  oracleTextGrantsKeywordOnlyToOthers,
  oracleTextHasOwnKeyword,
} from "../../../../rules-engine/src/oracleOwnKeywordText.js";
import { debugWarn } from "../../utils/debug.js";
import { getContinuousGrantedAbilitiesForPermanent } from "../../state/modules/staticEffectSpec.js";
import { extractCreatureTypes } from "./gameActionsCastCostReduction.js";

function cardListsKeyword(card: any, keyword: string): boolean {
  const keywords = Array.isArray(card?.keywords) ? card.keywords : [];
  const lower = keyword.toLowerCase();
  return keywords.some((entry: unknown) => String(entry || '').toLowerCase() === lower);
}

function grantorGivesKeywordToOtherCreaturesYouControl(oracle: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`\bother creatures you control have ${escaped}\b`, 'i').test(oracle);
}

function grantorGivesKeywordToCreaturesYouControlIncludingSelf(oracle: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (grantorGivesKeywordToOtherCreaturesYouControl(oracle, keyword)) return false;
  return new RegExp(String.raw`\bcreatures you control have ${escaped}\b`, 'i').test(oracle);
}

/**
 * Check if a creature has haste (either inherently or from effects)
 * Rule 702.10: Haste allows a creature to attack and use tap abilities immediately
 * 
 * Sources of haste:
 * - Creature's own oracle text containing "haste"
 * - Granted abilities on the permanent (from other effects)
 * - Battlefield permanents that grant haste to creatures (e.g., "creatures you control have haste")
 * - Specific creature type grants (e.g., "Goblin creatures you control have haste")
 * - Equipment attached to the creature (e.g., "Equipped creature has haste")
 * 
 * @param permanent - The creature permanent to check
 * @param battlefield - Array of all battlefield permanents
 * @param controller - The controller of the creature
 * @returns true if the creature has haste
 */
export function permanentHasSummoningSickness(
  permanent: any,
  battlefield: any[],
  controller: string,
): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) {
    return false;
  }
  if (creatureHasHaste(permanent, battlefield, controller)) {
    return false;
  }
  return permanent?.summoningSickness === true || permanent?.enteredThisTurn === true;
}

export function creatureHasHaste(permanent: any, battlefield: any[], controller: string): boolean {
  try {
    const permCard = permanent?.card || {};
    const permTypeLine = (permCard.type_line || "").toLowerCase();
    const permOracleText = (permCard.oracle_text || "").toLowerCase();
    
    const otherHasteLord = oracleTextGrantsKeywordOnlyToOthers(permOracleText, 'haste');

    // 1. Printed haste on this creature — not lord text like
    // "Other Dinosaurs you control have haste."
    if (oracleTextHasOwnKeyword(permOracleText, 'haste')) {
      return true;
    }
    // Scryfall/keyword lists can be filled by a naive full-oracle scan of a lord grant.
    if (cardListsKeyword(permCard, 'haste') && !otherHasteLord) {
      return true;
    }
    
    // 2. Check granted abilities on the permanent. Exact keyword only — lord wording
    // containing "haste" is not self-haste. Other-only lords may also be stamped with
    // a 'haste' badge from their own grant; ignore that and look at other sources.
    const grantedAbilities = permanent?.grantedAbilities || [];
    if (
      !otherHasteLord &&
      Array.isArray(grantedAbilities) &&
      grantedAbilities.some((a: string) => grantedAbilityIsOwnKeyword(a, 'haste'))
    ) {
      return true;
    }

    // 2b. Check temporary haste granted until end of turn.
    const tempAbilities = [
      ...(Array.isArray(permanent?.tempAbilities) ? permanent.tempAbilities : []),
      ...(Array.isArray(permanent?.temporaryAbilities) ? permanent.temporaryAbilities : []),
    ];
    if (tempAbilities.some((entry: any) => {
      if (typeof entry === 'string') {
        return grantedAbilityIsOwnKeyword(entry, 'haste');
      }
      return grantedAbilityIsOwnKeyword(entry?.ability || entry?.keyword || entry?.name, 'haste');
    })) {
      return true;
    }
    
    // 3. Check attached equipment for haste grants (e.g., Lightning Greaves, Swiftfoot Boots)
    // Pattern: "Equipped creature has haste" or "Equipped creature has shroud and haste"
    
    // Helper function to detect if equipment/aura grants haste
    const equipmentGrantsHaste = (equipOracle: string): boolean => {
      if (!equipOracle.includes('equipped creature') && !equipOracle.includes('enchanted creature')) {
        return false;
      }
      return equipOracle.includes('has haste') || 
             equipOracle.includes('have haste') ||
             equipOracle.includes('gains haste') ||
             /(?:equipped|enchanted) creature has (?:[\w\s,]+\s+and\s+)?haste/i.test(equipOracle);
    };
    
    const attachedEquipment = permanent?.attachedEquipment || [];
    for (const equipId of attachedEquipment) {
      const equipment = battlefield.find((p: any) => p.id === equipId);
      if (equipment && equipment.card) {
        const equipOracle = (equipment.card.oracle_text || "").toLowerCase();
        if (equipmentGrantsHaste(equipOracle)) {
          return true;
        }
      }
    }
    
    // Also check by attachedTo relationship (in case attachedEquipment isn't set)
    if (permanent.id) {
      for (const equip of battlefield) {
        if (!equip || !equip.card) continue;
        const equipTypeLine = (equip.card.type_line || "").toLowerCase();
        if (!equipTypeLine.includes('equipment') && !equipTypeLine.includes('aura')) continue;
        if (equip.attachedTo !== permanent.id) continue;
        
        const equipOracle = (equip.card.oracle_text || "").toLowerCase();
        if (equipmentGrantsHaste(equipOracle)) {
          return true;
        }
      }
    }
    
    // 4. Check battlefield for permanents that grant haste
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Only check permanents that could grant haste to this creature
      // Common patterns: "creatures you control have haste", "Goblin creatures you control have haste"
      
      // Check for global "creatures you control have haste" effects
      if (grantorController === controller) {
        const grantorId = String(perm.id || '');
        const recipientId = String(permanent.id || '');
        if (grantorGivesKeywordToCreaturesYouControlIncludingSelf(grantorOracle, 'haste')) {
          return true;
        }
        if (
          grantorGivesKeywordToOtherCreaturesYouControl(grantorOracle, 'haste') &&
          grantorId !== recipientId
        ) {
          return true;
        }
        
        // Check for "activate abilities... as though... had haste" effects
        // This covers Thousand-Year Elixir: "You may activate abilities of creatures 
        // you control as though those creatures had haste."
        if (grantorOracle.includes('as though') && 
            grantorOracle.includes('had haste') &&
            (grantorOracle.includes('creatures you control') || 
             grantorOracle.includes('activate abilities'))) {
          return true;
        }
        
        // Check for tribal haste grants (e.g., "Goblin creatures you control have haste")
        // Optimization: Use indexOf instead of creating RegExp for each creature type
        const creatureTypes = extractCreatureTypes(permTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const hasteIndex = grantorOracle.indexOf('have haste');
          // Check if creature type appears before "have haste" with no period between them
          if (typeIndex !== -1 && hasteIndex !== -1 && typeIndex < hasteIndex) {
            const textBetween = grantorOracle.slice(typeIndex, hasteIndex);
            if (textBetween.includes('.')) continue;
            const prefix = grantorOracle.slice(Math.max(0, typeIndex - 10), typeIndex);
            const isOtherGrant = /\bother\s+$/i.test(prefix);
            if (isOtherGrant && String(perm.id || '') === String(permanent.id || '')) {
              continue;
            }
            return true;
          }
        }
        
        // Check for "all creatures have haste" (rare but exists)
        if (grantorOracle.includes('all creatures have haste')) {
          return true;
        }
        
        // Check for token-specific haste grants with turn restrictions
        // Pattern: "During your turn, creature tokens you control ... have haste"
        const isToken = permanent?.isToken === true;
        if (isToken && grantorOracle.includes('creature tokens you control') && 
            grantorOracle.includes('have haste')) {
          // Check if there's a turn restriction
          if (grantorOracle.includes('during your turn')) {
            // We don't have access to turn player in this function, so we can't reliably
            // determine if it's the controller's turn. This function is typically called
            // during combat declaration which only happens on your own turn anyway.
            // The caller should handle turn restrictions if needed.
            // For attacking/tapping purposes, this is typically called during your turn.
            // Return true here - the combat system will validate turn timing separately.
            return true;
          } else {
            // No turn restriction, always grants haste
            return true;
          }
        }
      }
      
      // Check for effects that grant haste to all creatures (both players)
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, '[creatureHasHaste] Error checking haste:', err);
    return false;
  }
}

/**
 * Check if a permanent has a given keyword ability from any source
 * This includes:
 * - The permanent's own oracle text
 * - Granted abilities array
 * - Equipment attached to the permanent
 * - Auras attached to the permanent
 * - Global effects from other permanents on the battlefield
 * 
 * @param permanent - The permanent to check
 * @param battlefield - Array of all battlefield permanents
 * @param controller - The controller of the permanent
 * @param keyword - The keyword to check for (e.g., 'haste', 'vigilance', 'shroud', 'hexproof')
 * @returns true if the permanent has the keyword ability
 */
export function permanentHasKeyword(
  permanent: any,
  battlefield: any[],
  controller: string,
  keyword: string,
  /** Optional game state: when given, derived continuous static grants (anthems like
   *  "Nontoken creatures you control get +1/+1 and have vigilance") are honored too. */
  state?: unknown,
): boolean {
  try {
    const lowerKeyword = keyword.toLowerCase();
    const permCard = permanent?.card || {};
    const permTypeLine = (permCard.type_line || "").toLowerCase();
    const permOracleText = (permCard.oracle_text || "").toLowerCase();
    
    const otherOnlyGrant = oracleTextGrantsKeywordOnlyToOthers(permOracleText, lowerKeyword);

    // 1. Printed keyword on this permanent — not lord text that grants it to others.
    if (oracleTextHasOwnKeyword(permOracleText, lowerKeyword)) {
      return true;
    }
    if (cardListsKeyword(permCard, lowerKeyword) && !otherOnlyGrant) {
      return true;
    }
    
    // 2. Check granted abilities on the permanent
    const grantedAbilities = permanent?.grantedAbilities || [];
    if (
      !otherOnlyGrant &&
      Array.isArray(grantedAbilities) &&
      grantedAbilities.some((a: string) => grantedAbilityIsOwnKeyword(a, lowerKeyword))
    ) {
      return true;
    }
    
    // 3. Check attached equipment and auras for keyword grants
    // Pattern: "Equipped/Enchanted creature has [keyword]" or "Equipped/Enchanted creature has [ability] and [keyword]"
    // Pre-compile regex for efficiency
    const equipmentKeywordRegex = new RegExp(
      `(?:equipped|enchanted) creature (?:has|gains?) (?:[\\w\\s,]+\\s+and\\s+)?${lowerKeyword}`,
      'i'
    );
    
    const attachmentGrantsKeyword = (attachmentOracle: string): boolean => {
      if (!attachmentOracle.includes('equipped creature') && !attachmentOracle.includes('enchanted creature')) {
        return false;
      }
      if (attachmentOracleGrantsKeyword(attachmentOracle, lowerKeyword)) {
        return true;
      }
      // Fallback for uncommon grant phrasing the shared parser may miss.
      return equipmentKeywordRegex.test(attachmentOracle);
    };
    
    // Check attachedEquipment array
    const attachedEquipment = permanent?.attachedEquipment || [];
    for (const equipId of attachedEquipment) {
      const equipment = battlefield.find((p: any) => p.id === equipId);
      if (equipment && equipment.card) {
        const equipOracle = (equipment.card.oracle_text || "").toLowerCase();
        if (attachmentGrantsKeyword(equipOracle)) {
          return true;
        }
      }
    }
    
    // Also check by attachedTo relationship (in case attachedEquipment isn't set)
    if (permanent.id) {
      for (const attachment of battlefield) {
        if (!attachment || !attachment.card) continue;
        const attachTypeLine = (attachment.card.type_line || "").toLowerCase();
        if (!attachTypeLine.includes('equipment') && !attachTypeLine.includes('aura')) continue;
        if (attachment.attachedTo !== permanent.id) continue;
        
        const attachOracle = (attachment.card.oracle_text || "").toLowerCase();
        if (attachmentGrantsKeyword(attachOracle)) {
          return true;
        }
      }
    }
    
    // 4. Check battlefield for permanents that grant the keyword globally
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      const chosenAbilities = Array.isArray((perm as any)?.chosenOptions)
        ? (perm as any).chosenOptions
        : [((perm as any)?.chosenOption ?? '')];
      const chosenKeywordSet = new Set(
        chosenAbilities
          .map((value: any) => String(value || '').trim().toLowerCase())
          .filter((value: string) => value.length > 0)
      );
      
      // Only check permanents controlled by the same player
      if (grantorController === controller) {
        if (perm.id !== permanent.id && chosenKeywordSet.has(lowerKeyword) && grantorOracle.includes('abilities of your choice among')) {
          const creatureTypes = extractCreatureTypes(permTypeLine);
          for (const creatureType of creatureTypes) {
            const chosenGrantPattern = new RegExp(
              `other\\s+${creatureType}s?\\s+(?:creatures?\\s+)?you\\s+control\\s+(?:get\\s+[^.]*\\s+and\\s+have|have)\\s+all\\s+abilities\\s+of\\s+your\\s+choice\\s+among`,
              'i'
            );
            if (chosenGrantPattern.test(grantorOracle)) {
              return true;
            }
          }
        }

        // Global grants: "creatures you control have [keyword]"
        // Do not treat "other creatures you control have X" as granting X to the source.
        if (grantorGivesKeywordToCreaturesYouControlIncludingSelf(grantorOracle, lowerKeyword)) {
          return true;
        }
        if (
          grantorGivesKeywordToOtherCreaturesYouControl(grantorOracle, lowerKeyword) &&
          String(perm.id || '') !== String(permanent.id || '')
        ) {
          return true;
        }
        
        // Check for tribal grants (e.g., "Goblin creatures you control have haste")
        const creatureTypes = extractCreatureTypes(permTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const keywordIndex = grantorOracle.indexOf(`have ${lowerKeyword}`);
          if (typeIndex !== -1 && keywordIndex !== -1 && typeIndex < keywordIndex) {
            const textBetween = grantorOracle.slice(typeIndex, keywordIndex);
            if (textBetween.includes('.')) continue;
            const prefix = grantorOracle.slice(Math.max(0, typeIndex - 10), typeIndex);
            const isOtherGrant = /\bother\s+$/i.test(prefix);
            if (isOtherGrant && String(perm.id || '') === String(permanent.id || '')) {
              continue;
            }
            return true;
          }
        }
        
        // Check for "all creatures have [keyword]" (rare but exists)
        if (grantorOracle.includes(`all creatures have ${lowerKeyword}`)) {
          return true;
        }
        
        // Check for token-specific keyword grants with turn restrictions
        // Pattern: "During your turn, creature tokens you control ... have [keyword]"
        // Examples: Mite Overseer ("During your turn, creature tokens you control get +1/+0 and have first strike.")
        const isToken = permanent?.isToken === true;
        if (isToken) {
          // Pattern with turn restriction
          const tokenTurnKeywordPattern = new RegExp(
            `during your turn,?\\s*creature tokens you control.*?have.*?\\b${lowerKeyword}\\b`,
            'i'
          );
          if (tokenTurnKeywordPattern.test(grantorOracle)) {
            // This function doesn't have direct access to game state, so we check if
            // it's the controller's turn by looking at the permanent's controller.
            // Since keyword checks are typically done during combat or ability resolution,
            // and the turn restriction only matters during the controller's turn,
            // this is a reasonable approximation. The caller (combat resolution, etc.)
            // can further validate turn timing if needed.
            // For now, we return true for the controller's tokens during their effects.
            return true;
          }
          
          // Pattern without turn restriction: "creature tokens you control have [keyword]"
          if (grantorOracle.includes(`creature tokens you control`) && 
              grantorOracle.includes(`have ${lowerKeyword}`) &&
              !grantorOracle.includes('during your turn')) {
            return true;
          }
        }
      }
      
      // Check for effects that grant to all creatures (both players)
      if (grantorOracle.includes(`all creatures have ${lowerKeyword}`) ||
          grantorOracle.includes(`each creature has ${lowerKeyword}`)) {
        return true;
      }
    }

    // 5. Derived continuous static grants (StaticEffectSpec + regex statics).
    if (state && typeof state === 'object') {
      const continuous = getContinuousGrantedAbilitiesForPermanent(permanent, state);
      if (continuous.some((a: string) => grantedAbilityIsOwnKeyword(a, lowerKeyword))) {
        return true;
      }
    }

    return false;
  } catch (err) {
    debugWarn(1, `[permanentHasKeyword] Error checking ${keyword}:`, err);
    return false;
  }
}
