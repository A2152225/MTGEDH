/**
 * triggers/combat.ts
 * 
 * Combat-related trigger detection and processing.
 * Includes beginning of combat, attack, end of combat, and combat damage triggers.
 * 
 * Combat phases:
 * - Beginning of Combat: detectBeginningOfCombatTriggers, getBeginningOfCombatTriggers
 * - Declare Attackers: detectAttackTriggers, getAttackTriggersForCreatures
 * - Combat Damage: detectCombatDamageTriggers, getCombatDamageTriggersForCreature
 * - End of Combat: detectEndOfCombatTriggers, getEndOfCombatTriggers
 */

import type { GameContext } from "../../context.js";
import {
  KNOWN_COMBAT_DAMAGE_TRIGGERS,
  KNOWN_ATTACK_TRIGGERS,
  KNOWN_BEGINNING_COMBAT_TRIGGERS,
} from "./card-data-tables.js";
import type { BeginningOfCombatTrigger, EndOfCombatTrigger } from "./types.js";
import { escapeCardNameForRegex } from "./types.js";
import { debug, debugWarn, debugError } from "../../../utils/debug.js";
import { permanentHasCreatureType } from "../../../../../shared/src/creatureTypes.js";
import { isInterveningIfSatisfied } from "./intervening-if.js";

// ============================================================================
// Trigger Doubling (Roaming Throne, Isshin, Teysa Karlov, etc.)
// ============================================================================

/**
 * Interface for trigger doubler permanents
 */
interface TriggerDoubler {
  permanentId: string;
  cardName: string;
  controller: string;
  creatureTypeFilter?: string;  // For Roaming Throne - chosen creature type
  triggerTypeFilter?: 'attack' | 'etb' | 'death' | 'any';  // What kinds of triggers are doubled
  affectsOthersOnly?: boolean;  // Roaming Throne: "another creature you control"
}

/**
 * Detect trigger doublers on the battlefield
 * Uses regex-based oracle text parsing for scalability
 * 
 * Handles cards like:
 * - Roaming Throne: "If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time"
 * - Isshin, Two Heavens as One: "If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time"
 * - Teysa Karlov: "If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time"
 * - Panharmonicon: "If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time"
 */
export function detectTriggerDoublers(
  battlefield: any[],
  controllerId: string
): TriggerDoubler[] {
  const doublers: TriggerDoubler[] = [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controllerId) continue;
    
    const oracleText = (perm.card?.oracle_text || '').toLowerCase();
    const cardName = perm.card?.name || 'Unknown';
    
    // Skip if doesn't have trigger doubling text
    if (!oracleText.includes('triggers an additional time') && 
        !oracleText.includes('trigger an additional time')) {
      continue;
    }
    
    // Roaming Throne pattern: "If a triggered ability of another creature you control of the chosen type triggers"
    // Oracle: "If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time."
    const roamingThronePattern = /if a triggered ability of another creature you control of the chosen type triggers/i;
    if (roamingThronePattern.test(oracleText)) {
      const chosenType = (perm as any).chosenCreatureType;
      if (chosenType) {
        doublers.push({
          permanentId: perm.id,
          cardName,
          controller: perm.controller,
          creatureTypeFilter: chosenType,
          triggerTypeFilter: 'any',
          affectsOthersOnly: true,  // "another creature"
        });
        debug(2, `[detectTriggerDoublers] Found Roaming Throne effect for type '${chosenType}' from ${cardName}`);
      }
      continue;
    }
    
    // Isshin pattern: "If a creature attacking causes a triggered ability"
    const isshinPattern = /if a creature attacking causes a triggered ability .* to trigger.*triggers? an additional time/i;
    if (isshinPattern.test(oracleText)) {
      doublers.push({
        permanentId: perm.id,
        cardName,
        controller: perm.controller,
        triggerTypeFilter: 'attack',
      });
      debug(2, `[detectTriggerDoublers] Found Isshin-style attack trigger doubler from ${cardName}`);
      continue;
    }
    
    // Teysa pattern: "If a creature dying causes a triggered ability"
    const teysaPattern = /if a creature dying causes a triggered ability .* to trigger.*triggers? an additional time/i;
    if (teysaPattern.test(oracleText)) {
      doublers.push({
        permanentId: perm.id,
        cardName,
        controller: perm.controller,
        triggerTypeFilter: 'death',
      });
      debug(2, `[detectTriggerDoublers] Found Teysa-style death trigger doubler from ${cardName}`);
      continue;
    }
    
    // Panharmonicon pattern: "If an artifact or creature entering the battlefield causes"
    const panharmoniconPattern = /if (?:an? )?(?:artifact|creature|permanent)(?: or (?:artifact|creature))? entering (?:the battlefield )?causes a triggered ability .* to trigger.*triggers? an additional time/i;
    if (panharmoniconPattern.test(oracleText)) {
      doublers.push({
        permanentId: perm.id,
        cardName,
        controller: perm.controller,
        triggerTypeFilter: 'etb',
      });
      debug(2, `[detectTriggerDoublers] Found Panharmonicon-style ETB trigger doubler from ${cardName}`);
      continue;
    }
    
    // Generic pattern - any trigger doubling we haven't categorized
    debug(2, `[detectTriggerDoublers] Found generic trigger doubler from ${cardName}, not yet categorized`);
  }
  
  return doublers;
}

/**
 * Apply trigger doublers to a list of triggers
 * Returns the modified trigger list with doubled triggers added
 * 
 * @param triggers - Original triggers list
 * @param doublers - Active trigger doublers
 * @param triggerType - The type of trigger event ('attack', 'etb', 'death', etc.)
 * @param sourcePermanent - The permanent whose trigger is firing (for creature type checks)
 */
export function applyTriggerDoublers(
  triggers: CombatTriggeredAbility[],
  doublers: TriggerDoubler[],
  triggerType: 'attack' | 'etb' | 'death' | 'any',
  sourcePermanent?: any
): CombatTriggeredAbility[] {
  if (doublers.length === 0 || triggers.length === 0) {
    return triggers;
  }
  
  const result: CombatTriggeredAbility[] = [];
  
  for (const trigger of triggers) {
    // Always add the original trigger
    result.push(trigger);
    
    // Check each doubler to see if it applies
    for (const doubler of doublers) {
      // Check trigger type filter
      if (doubler.triggerTypeFilter && 
          doubler.triggerTypeFilter !== 'any' && 
          doubler.triggerTypeFilter !== triggerType) {
        continue;
      }
      
      // Check if this doubler affects "another creature" (not itself)
      if (doubler.affectsOthersOnly && trigger.permanentId === doubler.permanentId) {
        continue;
      }
      
      // Check creature type filter
      if (doubler.creatureTypeFilter && sourcePermanent) {
        if (!permanentHasCreatureType(sourcePermanent, doubler.creatureTypeFilter)) {
          continue;
        }
      }
      
      // This doubler applies - add a copy of the trigger
      const copiedTrigger: CombatTriggeredAbility = {
        ...trigger,
        description: `${trigger.description} (doubled by ${doubler.cardName})`,
      };
      result.push(copiedTrigger);
      debug(2, `[applyTriggerDoublers] Doubled trigger '${trigger.description}' from ${trigger.cardName} due to ${doubler.cardName}`);
    }
  }
  
  return result;
}

// ============================================================================
// Local Type Definitions (compatible with types.ts but with additional fields)
// ============================================================================

/**
 * Combat trigger with additional fields for combat-specific processing
 */
export interface CombatTriggeredAbility {
  permanentId: string;
  cardName: string;
  controllerId?: string;
  triggerType?: string;
  description: string;
  effect?: string;
  value?: any;
  mandatory?: boolean;
  requiresTarget?: boolean;
  manaCost?: string;
  batched?: boolean;
}

export interface AttachmentAttackTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  attachedToId: string;
  effect: string;
  mandatory: boolean;
  searchesLibrary?: boolean;
  searchType?: string;
  createsToken?: boolean;
}

// Re-export types from types.ts for consumers
export type { BeginningOfCombatTrigger, EndOfCombatTrigger };

// ============================================================================
// Combat Damage Triggers
// ============================================================================

/**
 * Detect combat damage triggers from a permanent's abilities.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_COMBAT_DAMAGE_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * Patterns detected:
 * - "Whenever ~ deals combat damage to a player, [effect]"
 * - "Whenever one or more creatures you control deal combat damage to a player, [effect]"
 * - "Whenever ~ deals damage to a player, [effect]" (includes non-combat)
 */
export function detectCombatDamageTriggers(card: any, permanent: any): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // Use shared utility function for regex escaping
  const cardNameEscaped = escapeCardNameForRegex(cardName);
  
  // "Whenever ~ deals combat damage to a player" detection
  const combatDamagePattern = new RegExp(`whenever\\s+(?:~|this creature|${cardNameEscaped})\\s+deals\\s+combat\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i');
  const combatDamagePlayerMatch = oracleText.match(combatDamagePattern);
  if (combatDamagePlayerMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage',
      description: combatDamagePlayerMatch[1].trim(),
      effect: combatDamagePlayerMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever one or more creatures you control deal combat damage to a player" (batched trigger)
  const batchedCombatDamageMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (batchedCombatDamageMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_batched',
      description: batchedCombatDamageMatch[1].trim(),
      effect: batchedCombatDamageMatch[1].trim(),
      mandatory: true,
      batched: true,
    });
  }
  
  // "Whenever ~ deals damage to a player" (includes combat and non-combat)
  const damagePlayerPattern = new RegExp(`whenever\\s+(?:~|this creature|${cardNameEscaped})\\s+deals\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i');
  const damagePlayerMatch = oracleText.match(damagePlayerPattern);
  if (damagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: damagePlayerMatch[1].trim(),
      effect: damagePlayerMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases and provide enhanced metadata
  // Only add if not already detected dynamically
  for (const [knownName, info] of Object.entries(KNOWN_COMBAT_DAMAGE_TRIGGERS)) {
    if (lowerName.includes(knownName) && !triggers.some(t => t.triggerType === 'deals_combat_damage')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'deals_combat_damage',
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get combat damage triggers for creatures that dealt damage
 */
export function getCombatDamageTriggersForCreature(
  ctx: GameContext,
  attackingPermanent: any,
  damageDealt: number,
  damagedPlayerId: string
): CombatTriggeredAbility[] {
  if (damageDealt <= 0) return [];
  
  return detectCombatDamageTriggers(attackingPermanent.card, attackingPermanent);
}

// ============================================================================
// Attack Triggers
// ============================================================================

/**
 * Detect attack triggers from a permanent's abilities.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_ATTACK_TRIGGERS table serves as an optimization
 * fallback for special handling and enhanced metadata (token creation, etc.).
 * 
 * Patterns detected:
 * - "Whenever ~ attacks, [effect]" (self attack trigger)
 * - "Whenever a creature you control attacks, [effect]"
 * - Keyword abilities: Annihilator N, Melee, Myriad, Exalted, Battle Cry, Firebending N
 * - Token creation patterns with count-based values
 * - Optional mana payment triggers
 */
export function detectAttackTriggers(card: any, permanent: any): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";

  const optionalManaPaymentPattern = /you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*if you do,?\s*(.+)/i;
  
  // Also check grantedAbilities on the permanent for temporary abilities
  // These are abilities granted by other cards (e.g., "gains firebending 4 until end of turn")
  const grantedAbilities = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  const grantedText = grantedAbilities.join('\n').toLowerCase();
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // Annihilator N (keyword ability)
  const annihilatorMatch = oracleText.match(/annihilator\s+(\d+)/i);
  if (annihilatorMatch) {
    const n = parseInt(annihilatorMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'annihilator',
      description: `Defending player sacrifices ${n} permanent${n > 1 ? 's' : ''}`,
      value: n,
      mandatory: true,
      requiresTarget: false,
    });
  }
  
  // Firebending N - Avatar set mechanic
  // Check both oracle text AND granted abilities (for creatures that "gain firebending N")
  const firebendingMatch = oracleText.match(/firebending\s+(\d+)/i) || grantedText.match(/firebending\s+(\d+)/i);
  if (firebendingMatch) {
    const n = parseInt(firebendingMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'firebending',
      description: `Add ${'{R}'.repeat(n)} (until end of combat)`,
      effect: `add_red_mana`,
      value: n,
      mandatory: true,
      requiresTarget: false,
    });
  }
  
  // Melee keyword ability
  if (lowerOracle.includes("melee")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'melee',
      description: "+1/+1 for each opponent you attacked this combat",
      mandatory: true,
    });
  }
  
  // Myriad keyword ability
  if (lowerOracle.includes("myriad")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'myriad',
      description: "Create token copies attacking each other opponent",
      mandatory: true,
    });
  }
  
  // Exalted keyword ability
  if (lowerOracle.includes("exalted")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exalted',
      description: "+1/+1 to attacking creature (when attacking alone)",
      mandatory: true,
    });
  }
  
  // Battle Cry keyword ability
  if (lowerOracle.includes("battle cry")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'battle_cry',
      description: "Each other attacking creature gets +1/+0 until end of turn",
      effect: 'battle_cry_buff',
      mandatory: true,
    });
  }
  
  // Generic "whenever ~ attacks" - match ~, this creature, or the actual card name
  // Use consistent regex escaping approach
  const cardNamePatternEscaped = escapeCardNameForRegex(cardName);
  // Capture the full ability line (including periods) so patterns like
  // "you may pay {1}{G}. If you do, ..." can be recognized.
  const attacksPattern = new RegExp(`whenever\\s+(?:~|this creature|${cardNamePatternEscaped})\\s+attacks,?\\s*([^\\n]+)`, 'i');
  const attacksMatch = oracleText.match(attacksPattern);
  if (attacksMatch && !triggers.some(t => t.triggerType === 'attacks')) {
    const effectText = attacksMatch[1].trim();
    
    // Check for optional mana payment trigger
    const mayPayMatch = effectText.match(optionalManaPaymentPattern);
    
    if (mayPayMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: mayPayMatch[2].trim(),
        manaCost: mayPayMatch[1],
        mandatory: false,
      });
    } else {
      // Check for count-based token creation (Myrel, etc.)
      // Pattern: "create X [P/T] [type] tokens, where X is the number of [countType] you control"
      const countTokenMatch = effectText.match(/create\s+X\s+(\d+)\/(\d+)\s+([^,]+?)\s+(?:creature\s+)?tokens?,?\s+where\s+X\s+is\s+the\s+number\s+of\s+(\w+)(?:s)?\s+you\s+control/i);
      
      if (countTokenMatch) {
        const power = parseInt(countTokenMatch[1], 10);
        const toughness = parseInt(countTokenMatch[2], 10);
        const tokenDesc = countTokenMatch[3].trim();
        const countType = countTokenMatch[4].trim();
        
        // Parse token description for color and type
        const parts = tokenDesc.split(/\s+/);
        let color = 'colorless';
        let type = 'Token';
        let isArtifact = false;
        
        const colorMap: Record<string, string> = {
          'white': 'white', 'blue': 'blue', 'black': 'black', 'red': 'red', 'green': 'green', 'colorless': 'colorless'
        };
        
        for (const part of parts) {
          const lowerPart = part.toLowerCase();
          if (colorMap[lowerPart]) {
            color = lowerPart;
          } else if (lowerPart === 'artifact') {
            isArtifact = true;
          } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'tokens') {
            type = part.charAt(0).toUpperCase() + part.slice(1);
          }
        }
        
        triggers.push({
          permanentId,
          cardName,
          triggerType: 'attacks',
          description: effectText,
          effect: effectText,
          mandatory: true,
          value: {
            countType: countType.toLowerCase(),
            power,
            toughness,
            type,
            color,
            isArtifact,
          },
        });
      } else {
        // Check for fixed-count token creation
        // Pattern: "create a X/Y [color] [type] creature token tapped and attacking"
        const fixedTokenMatch = effectText.match(/create\s+(?:a\s+)?(\d+)\/(\d+)\s+(\w+)\s+([\w\s]+?)\s+(?:creature\s+)?token/i);
        
        if (fixedTokenMatch) {
          const power = parseInt(fixedTokenMatch[1], 10);
          const toughness = parseInt(fixedTokenMatch[2], 10);
          const color = fixedTokenMatch[3].toLowerCase();
          const type = fixedTokenMatch[4].trim();
          
          triggers.push({
            permanentId,
            cardName,
            triggerType: 'attacks',
            description: effectText,
            effect: effectText,
            mandatory: true,
            value: {
              createTokens: {
                count: 1,
                power,
                toughness,
                type,
                color,
              }
            },
          });
        } else {
          // Regular attack trigger without special parsing
          triggers.push({
            permanentId,
            cardName,
            triggerType: 'attacks',
            description: effectText,
            effect: effectText,
            mandatory: true,
          });
        }
      }
    }
  }
  
  // "Whenever a creature you control attacks"
  const creatureAttacksMatch = oracleText.match(/whenever a creature you control attacks,?\s*([^.]+)/i);
  if (creatureAttacksMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_attacks',
      description: creatureAttacksMatch[1].trim(),
      effect: creatureAttacksMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Join Forces attack trigger
  if (lowerOracle.includes('join forces') && 
      lowerOracle.includes('whenever') && 
      lowerOracle.includes('attacks')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'join_forces_attack',
      description: 'Join forces - each player may pay any amount of mana',
      effect: oracleText,
      mandatory: true,
      value: { isJoinForces: true },
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases and provide enhanced metadata
  // Only add if not already detected dynamically
  for (const [knownName, info] of Object.entries(KNOWN_ATTACK_TRIGGERS)) {
    if (lowerName.includes(knownName) && !triggers.some(t => t.triggerType === 'attacks')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: info.effect,
        effect: info.effect,
        value: info.value || info.createTokensBasedOnCount || info.createTokens,
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Process attack triggers when creatures attack
 */
export function getAttackTriggersForCreatures(
  ctx: GameContext,
  attackingCreatures: any[],
  attackingPlayer: string,
  defendingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check each attacking creature for attack triggers
  for (const attacker of attackingCreatures) {
    const attackerTriggers = detectAttackTriggers(attacker.card, attacker);
    triggers.push(...attackerTriggers);
  }
  
  // Check all permanents for "whenever a creature you control attacks" triggers
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingPlayer) continue;
    
    const permTriggers = detectAttackTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      if (trigger.triggerType === 'creature_attacks') {
        for (const _ of attackingCreatures) {
          triggers.push({ ...trigger });
        }
      }
      if (trigger.triggerType === 'exalted' && attackingCreatures.length === 1) {
        triggers.push(trigger);
      }
    }
  }
  
  // Check for equipment/aura attack triggers on each attacking creature
  for (const attacker of attackingCreatures) {
    const attachmentTriggers = getAttachmentAttackTriggers(ctx, attacker, attackingPlayer);
    for (const attachTrigger of attachmentTriggers) {
      triggers.push({
        permanentId: attachTrigger.permanentId,
        cardName: attachTrigger.cardName,
        description: attachTrigger.effect,
        triggerType: 'equipment_attack',
        mandatory: attachTrigger.mandatory,
        value: {
          attachedToId: attachTrigger.attachedToId,
          searchesLibrary: attachTrigger.searchesLibrary,
          searchType: attachTrigger.searchType,
          createsToken: attachTrigger.createsToken,
        },
      });
    }
  }
  
  // Check for Background enchantments that grant abilities to commanders
  // Example: Agent of the Shadow Thieves - grants attack trigger to commanders
  const commandZone = (ctx.state as any).commandZone?.[attackingPlayer];
  const commanderIds = commandZone?.commanderIds || [];
  
  for (const attacker of attackingCreatures) {
    // Check if this attacking creature is a commander owned by the attacking player
    const isCommander = commanderIds.includes(attacker.card?.id) || 
                       (attacker.card?.name && commandZone?.commanderNames?.includes(attacker.card.name));
    
    if (isCommander) {
      // Check all permanents for backgrounds that grant abilities to commanders
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== attackingPlayer) continue;
        
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        const cardName = (permanent.card?.name || "").toLowerCase();
        const typeLine = (permanent.card?.type_line || "").toLowerCase();
        
        // Check if this is a Background enchantment
        if (!typeLine.includes('background')) continue;
        
        // Agent of the Shadow Thieves: "Commander creatures you own have 'Whenever this creature attacks a player...'"
        if (cardName.includes('agent of the shadow thieves') ||
            (oracleText.includes('commander creatures you own') && 
             oracleText.includes('whenever this creature attacks'))) {
          // Extract the granted ability
          const grantedAbilityMatch = oracleText.match(/commander creatures you own have "([^"]+)"/i);
          if (grantedAbilityMatch) {
            const grantedAbility = grantedAbilityMatch[1];
            triggers.push({
              permanentId: attacker.id,
              cardName: attacker.card?.name || 'Commander',
              description: grantedAbility,
              triggerType: 'attacks',
              mandatory: true,
              value: {
                grantedBy: permanent.id,
                grantedByName: permanent.card?.name,
                defendingPlayer: defendingPlayer, // Pass defending player for conditional check
              },
            });
            debug(2, `[getAttackTriggersForCreatures] Background ${permanent.card?.name} granted attack trigger to commander ${attacker.card?.name} (defending ${defendingPlayer})`);
          }
        }
      }
    }
  }
  
  // ===== Apply trigger doublers (Roaming Throne, Isshin, etc.) =====
  // Check for trigger doublers controlled by the attacking player
  const doublers = detectTriggerDoublers(battlefield, attackingPlayer);
  
  if (doublers.length > 0) {
    debug(2, `[getAttackTriggersForCreatures] Found ${doublers.length} trigger doubler(s)`);
    
    // For each attacking creature, apply doublers to its triggers
    const doubledTriggers: CombatTriggeredAbility[] = [];
    
    for (const trigger of triggers) {
      // Find the source permanent for creature type checks
      const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
      
      // Apply doublers with attack trigger type
      const resultTriggers = applyTriggerDoublers([trigger], doublers, 'attack', sourcePerm);
      doubledTriggers.push(...resultTriggers);
    }
    
    return doubledTriggers;
  }
  
  return triggers;
}

/**
 * Detect attachment attack triggers
 */
export function detectAttachmentAttackTriggers(card: any, permanent: any): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedToId = permanent?.attachedTo || "";
  
  if (!attachedToId) return triggers;
  
  // Sword of X and Y style - "Whenever equipped creature deals combat damage to a player"
  if (oracleText.includes('whenever equipped creature deals combat damage to a player')) {
    const effectMatch = oracleText.match(/whenever equipped creature deals combat damage to a player,?\s*([^.]+)/i);
    if (effectMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        attachedToId,
        effect: effectMatch[1].trim(),
        mandatory: true,
        searchesLibrary: oracleText.includes('search'),
        searchType: oracleText.includes('basic land') ? 'basic land' : undefined,
      });
    }
  }
  
  // "Whenever enchanted creature attacks"
  if (oracleText.includes('whenever enchanted creature attacks')) {
    const effectMatch = oracleText.match(/whenever enchanted creature attacks,?\s*([^.]+)/i);
    if (effectMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        attachedToId,
        effect: effectMatch[1].trim(),
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get attachment attack triggers for an attacking creature
 */
export function getAttachmentAttackTriggers(
  ctx: GameContext,
  attacker: any,
  attackingPlayer: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all attachments on this creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.attachedTo !== attacker.id) continue;
    
    const attachTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    triggers.push(...attachTriggers);
  }
  
  return triggers;
}

/**
 * Get attachment combat damage triggers
 */
export function getAttachmentCombatDamageTriggers(
  ctx: GameContext,
  attacker: any,
  attackingPlayer: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.attachedTo !== attacker.id) continue;
    
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const cardName = permanent.card?.name || "Unknown";
    
    // "Whenever equipped creature deals combat damage to a player"
    if (oracleText.includes('whenever equipped creature deals combat damage to a player')) {
      const effectMatch = oracleText.match(/whenever equipped creature deals combat damage to a player,?\s*([^.]+)/i);
      if (effectMatch) {
        triggers.push({
          permanentId: permanent.id,
          cardName,
          controllerId: permanent.controller,
          attachedToId: attacker.id,
          effect: effectMatch[1].trim(),
          mandatory: true,
          searchesLibrary: oracleText.includes('search'),
        });
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Beginning of Combat Triggers
// ============================================================================

/**
 * Detect beginning of combat triggers.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_BEGINNING_COMBAT_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * Patterns detected:
 * - "At the beginning of combat on your turn, [effect]"
 * - "At the beginning of each combat, [effect]"
 */
export function detectBeginningOfCombatTriggers(card: any, permanent: any): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // "At the beginning of combat on your turn" pattern
  const beginCombatMatch = oracleText.match(/at the beginning of combat on your turn,?\s*([^.]+)/i);
  if (beginCombatMatch) {
    const effectText = beginCombatMatch[1].trim();
    const requiresChoice = /\bchoose\b/i.test(effectText) || /\byou may\b/i.test(effectText);
    const createsToken = /\bcreate\b.*\btoken\b/i.test(effectText);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
      requiresChoice,
      createsToken,
    });
  }
  
  // "At the beginning of each combat" - triggers on all players' combats
  const eachCombatMatch = oracleText.match(/at the beginning of each combat,?\s*([^.]+)/i);
  if (eachCombatMatch && !triggers.some(t => t.description.includes(eachCombatMatch[1].trim()))) {
    const effectText = eachCombatMatch[1].trim();
    const requiresChoice = /\bchoose\b/i.test(effectText) || /\byou may\b/i.test(effectText);
    const createsToken = /\bcreate\b.*\btoken\b/i.test(effectText);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
      requiresChoice,
      createsToken,
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases and provide enhanced metadata
  // Only add if not already detected dynamically (check by permanentId, not description)
  for (const [knownName, info] of Object.entries(KNOWN_BEGINNING_COMBAT_TRIGGERS)) {
    if (lowerName.includes(knownName) && !triggers.some(t => t.permanentId === permanentId)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: info.effect,
        effect: info.effect,
        mandatory: true,
        requiresChoice: info.requiresChoice,
        createsToken: info.createsToken,
      });
    }
  }
  
  return triggers;
}

/**
 * Get all beginning of combat triggers for the active player's combat step
 */
export function getBeginningOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const MAX_TRIGGERS_PER_STEP = 100;
  let triggerCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    if (triggerCount >= MAX_TRIGGERS_PER_STEP) {
      debugError(1, `[getBeginningOfCombatTriggers] SAFETY LIMIT: Stopped after ${MAX_TRIGGERS_PER_STEP} triggers`);
      break;
    }
    
    const permTriggers = detectBeginningOfCombatTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      const hasOnYourTurn = lowerOracle.includes('on your turn') || 
                           lowerOracle.includes('on his or her turn') ||
                           lowerOracle.includes('on their turn');
      
      const hasEachCombat = lowerOracle.includes('each combat') ||
                           lowerOracle.includes('each player\'s combat') ||
                           lowerOracle.includes('every combat');
      
      if (hasOnYourTurn) {
        if (permanent.controller === activePlayerId) {
          const raw = String(trigger.effect || trigger.description || '').trim();
          let interveningText = raw;
          if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
            interveningText = `At the beginning of combat, ${interveningText}`;
          }
          const ok = isInterveningIfSatisfied(ctx, trigger.controllerId || permanent.controller, interveningText, permanent);
          if (ok !== false) {
            triggers.push(trigger);
            triggerCount++;
          }
        }
      } else if (hasEachCombat) {
        const raw = String(trigger.effect || trigger.description || '').trim();
        let interveningText = raw;
        if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
          interveningText = `At the beginning of combat, ${interveningText}`;
        }
        const ok = isInterveningIfSatisfied(ctx, trigger.controllerId || permanent.controller, interveningText, permanent);
        if (ok !== false) {
          triggers.push(trigger);
          triggerCount++;
        }
      } else if (permanent.controller === activePlayerId) {
        const raw = String(trigger.effect || trigger.description || '').trim();
        let interveningText = raw;
        if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
          interveningText = `At the beginning of combat, ${interveningText}`;
        }
        const ok = isInterveningIfSatisfied(ctx, trigger.controllerId || permanent.controller, interveningText, permanent);
        if (ok !== false) {
          triggers.push(trigger);
          triggerCount++;
        }
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// End of Combat Triggers
// ============================================================================

/**
 * Detect end of combat triggers from a card's oracle text
 */
export function detectEndOfCombatTriggers(card: any, permanent: any): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "At end of combat" or "At the end of combat"
  const endCombatMatch = oracleText.match(/at (?:the )?end of combat,?\s*([^.]+)/i);
  if (endCombatMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: endCombatMatch[1].trim(),
      effect: endCombatMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all end of combat triggers
 */
export function getEndOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectEndOfCombatTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      const raw = String(trigger.effect || trigger.description || '').trim();
      let interveningText = raw;
      if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
        interveningText = `At end of combat, ${interveningText}`;
      }
      const ok = isInterveningIfSatisfied(ctx, (trigger as any).controllerId || permanent.controller, interveningText, permanent);
      if (ok === false) continue;
      triggers.push(trigger);
    }
  }
  
  return triggers;
}

// ============================================================================
// Damage Received Triggers
// ============================================================================

/**
 * Information about a damage received trigger that needs to be queued for resolution
 */
export interface DamageReceivedTriggerInfo {
  triggerId: string;
  sourceId: string;
  sourceName: string;
  controller: string;
  damageAmount: number;
  targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'each_opponent' | 'controller';
  targetRestriction?: string;
}

/**
 * Check if a permanent has a "whenever this creature is dealt damage" trigger
 * and return the trigger information if it does.
 * 
 * This supports cards like:
 * - Brash Taunter: "Whenever Brash Taunter is dealt damage, it deals that much damage to target opponent."
 * - Boros Reckoner: "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
 * - Stuffy Doll: "Whenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player."
 */
export function checkDamageReceivedTrigger(
  permanent: any,
  damageAmount: number
): DamageReceivedTriggerInfo | null {
  if (!permanent || damageAmount <= 0) return null;
  
  const card = permanent.card;
  if (!card) return null;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  const creatureName = card.name || "Unknown";
  const lowerName = creatureName.toLowerCase();
  
  // Check if this card has a damage received trigger
  // Pattern 1: "Whenever this creature is dealt damage"
  // Pattern 2: "Whenever [CardName] is dealt damage"
  const hasTrigger = 
    oracleText.includes("whenever this creature is dealt damage") ||
    oracleText.includes(`whenever ${lowerName} is dealt damage`);
  
  if (!hasTrigger) return null;
  
  // Determine target type from oracle text
  let targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'each_opponent' | 'controller' = 'any';
  let targetRestriction = '';
  
  if (oracleText.includes("target opponent")) {
    targetType = 'opponent';
    targetRestriction = 'opponent';
  } else if (oracleText.includes("any target that isn't a dragon")) {
    targetType = 'any_non_dragon';
    targetRestriction = "that isn't a Dragon";
  } else if (oracleText.includes("the chosen player")) {
    targetType = 'chosen_player';
    targetRestriction = 'chosen player';
  } else if (oracleText.includes("each opponent")) {
    targetType = 'each_opponent';
    targetRestriction = 'each opponent';
  } else if (oracleText.includes("any target")) {
    targetType = 'any';
  }
  
  const triggerId = `damage_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  return {
    triggerId,
    sourceId: permanent.id,
    sourceName: creatureName,
    controller: permanent.controller,
    damageAmount,
    targetType,
    targetRestriction,
  };
}

// ============================================================================
// Block Triggers
// ============================================================================

/**
 * Block trigger interface for "whenever ~ blocks" abilities
 */
export interface BlockTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  blockedCreatureId?: string;
  createTokens?: {
    count: number;
    power: number;
    toughness: number;
    type: string;
    color: string;
    abilities?: string[];
  };
}

/**
 * Detect block triggers from a permanent's abilities
 * Patterns:
 * - "Whenever ~ blocks a creature, create a 1/1 white Cat Soldier creature token..."
 * - "Whenever ~ blocks, ..."
 */
export function detectBlockTriggers(card: any, permanent: any): BlockTrigger[] {
  const triggers: BlockTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Brimaz, King of Oreskos: "Whenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature."
  if (lowerName.includes("brimaz")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      effect: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      mandatory: true,
      createTokens: {
        count: 1,
        power: 1,
        toughness: 1,
        type: "Cat Soldier",
        color: "white",
        abilities: ["vigilance"],
      },
    });
  }
  
  // Generic "whenever ~ blocks" detection
  // Use consistent regex escaping approach
  const blockCardNamePattern = escapeCardNameForRegex(cardName);
  const blocksPattern = new RegExp(`whenever\\s+(?:~|this creature|${blockCardNamePattern})\\s+blocks(?:\\s+a\\s+creature)?,?\\s*([^.]+)`, 'i');
  const blocksMatch = oracleText.match(blocksPattern);
  
  if (blocksMatch && !triggers.some(t => t.permanentId === permanentId)) {
    const effectText = blocksMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get block triggers for creatures that are blocking
 * @param ctx - Game context
 * @param blockingCreatures - Array of creatures that are blocking
 * @param blockingPlayer - Player who is declaring blockers
 * @returns Array of triggered abilities
 */
export function getBlockTriggersForCreatures(
  ctx: GameContext,
  blockingCreatures: any[],
  blockingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check each blocking creature for block triggers
  for (const blocker of blockingCreatures) {
    const blockerTriggers = detectBlockTriggers(blocker.card, blocker);
    
    for (const trigger of blockerTriggers) {
      triggers.push({
        permanentId: trigger.permanentId,
        cardName: trigger.cardName,
        triggerType: 'blocks',
        description: trigger.description,
        effect: trigger.effect,
        mandatory: trigger.mandatory,
        value: {
          blockedCreatureId: blocker.blocking?.[0], // The attacker being blocked
          createTokens: trigger.createTokens,
        },
      });
    }
  }
  
  return triggers;
}


