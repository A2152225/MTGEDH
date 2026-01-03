/**
 * server/src/socket/combat.ts
 * 
 * Combat phase socket handlers for declaring attackers and blockers.
 * Handles the declare attackers and declare blockers steps of combat.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer, getEffectivePower, getEffectiveToughness, broadcastManaPoolUpdate, parseManaCost, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, consumeManaFromPool, millUntilLand } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { getAttackTriggersForCreatures, getTapTriggers, type TriggeredAbility } from "../state/modules/triggered-abilities.js";
import { creatureHasHaste, permanentHasKeyword } from "./game-actions.js";
import { getAvailableMana, getTotalManaFromPool } from "../state/modules/mana-check.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Get goad status for a creature.
 * A creature is goaded if:
 * 1. It has active goaders in its goadedBy array (from direct goad effects)
 * 2. It's enchanted by The Sound of Drums or similar auras that continuously goad
 * 
 * Returns { isGoaded: boolean, goaders: PlayerID[] }
 */
function getCreatureGoadStatus(
  creature: any,
  battlefield: any[],
  creatureController: PlayerID,
  currentTurn: number
): { isGoaded: boolean; goaders: PlayerID[] } {
  const goaders: PlayerID[] = [];
  
  // Check for goadedBy tracking (from normal goad effects)
  const goadedBy = creature.goadedBy;
  const goadedUntil = creature.goadedUntil || {};
  
  if (goadedBy && Array.isArray(goadedBy) && goadedBy.length > 0) {
    // Check if goad is still active
    const activeGoaders = goadedBy.filter((goaderId: string) => {
      const expiryTurn = goadedUntil[goaderId];
      return expiryTurn === undefined || expiryTurn > currentTurn;
    });
    goaders.push(...activeGoaders);
  }
  
  // Check for The Sound of Drums or similar auras that continuously goad
  // Oracle text: "Enchanted creature is goaded."
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.attachedTo !== creature.id) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // The Sound of Drums - enchanted creature is goaded
    if (cardName.includes('sound of drums') || oracleText.includes('enchanted creature is goaded')) {
      const auraController = perm.controller;
      if (!goaders.includes(auraController)) {
        goaders.push(auraController);
      }
    }
  }
  
  return {
    isGoaded: goaders.length > 0,
    goaders
  };
}

/**
 * Process tap triggers for attacking creatures
 * This handles cards like Magda, Brazen Outlaw: "Whenever a Dwarf you control becomes tapped, create a Treasure token."
 * 
 * @param io - Socket.IO server instance
 * @param game - Game state
 * @param gameId - Game ID
 * @param attackers - Array of attacker objects with creatureId
 * @param battlefield - Battlefield array
 * @param attackingPlayerId - Player who is declaring attackers (may differ from creature controllers in controlled combat)
 */
function processTapTriggersForAttackers(
  io: Server,
  game: any,
  gameId: string,
  attackers: any[],
  battlefield: any[],
  attackingPlayerId: PlayerID
): void {
  try {
    const ctx = {
      state: game.state,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
      }
    };
    
    // Check for tap triggers for each creature that was tapped
    const allTapTriggers: any[] = [];
    for (const attacker of attackers) {
      const creature = battlefield.find((p: any) => p?.id === attacker.creatureId);
      if (!creature) continue;
      
      // Only process tap triggers if the creature was actually tapped
      const hasVigilance = permanentHasKeyword(creature, battlefield, attackingPlayerId, 'vigilance');
      if (!hasVigilance && creature.tapped) {
        // Get the actual controller of the creature (may be different from attackingPlayerId in controlled combat)
        const creatureController = creature.controller || attackingPlayerId;
        const tapTriggers = getTapTriggers(ctx as any, creature, creatureController);
        allTapTriggers.push(...tapTriggers);
      }
    }
    
    // Push tap triggers to stack and notify clients
    if (allTapTriggers.length > 0) {
      debug(2, `[combat] Found ${allTapTriggers.length} tap trigger(s) for game ${gameId}`);
      
      for (const trigger of allTapTriggers) {
        // Push trigger onto stack
        game.state.stack = game.state.stack || [];
        const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const stackItem: any = {
          id: triggerId,
          type: 'triggered_ability',
          controller: trigger.controllerId,
          source: trigger.permanentId,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: 'tap',
          mandatory: trigger.mandatory,
        };
        
        // Add effect data if present
        if (trigger.createsToken) {
          stackItem.effectData = {
            createsToken: true,
            tokenDetails: trigger.tokenDetails,
          };
        }
        
        game.state.stack.push(stackItem);
        
        // Notify players about the trigger
        io.to(gameId).emit("triggeredAbility", {
          gameId,
          triggerId,
          playerId: trigger.controllerId,
          sourcePermanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          triggerType: 'tap',
          description: trigger.description,
          mandatory: trigger.mandatory,
        });
        
        debug(2, `[combat] Tap trigger: ${trigger.cardName} - ${trigger.description}`);
      }
      
      // Broadcast the updated game state after adding triggers
      broadcastGame(io, game, gameId);
    }
  } catch (e) {
    debugError(1, "[combat] Failed to process tap triggers:", e);
  }
}


/**
 * Check if a permanent is currently a creature (Rule 302)
 * This considers:
 * - Base type line
 * - Type-changing effects (Imprisoned in the Moon, Song of the Dryads, etc.)
 * - Animation effects (e.g., Tezzeret making artifacts creatures, Nissa animating lands)
 * - Granted types from effects
 * - Vehicles (only creatures when crewed this turn)
 * - Spacecraft with Station (creatures when charge counter threshold met)
 * - Bestow creatures (may be Auras when attached to another creature)
 * - Gods with devotion requirements
 * 
 * Note: This does NOT handle "can't attack" effects like Defang or Pacifism,
 * which are checked separately in the attack validation.
 * 
 * NOTE: This function is intentionally duplicated from rules-engine/src/actions/combat.ts
 * to avoid circular dependencies. Keep both versions in sync when making changes.
 * 
 * @param permanent - The permanent to check
 * @param battlefield - Optional battlefield array for devotion calculations
 * @param controllerId - Optional controller ID for filtering battlefield by controller
 * @returns true if the permanent is currently a creature
 */
function isCurrentlyCreature(permanent: any, battlefield?: any[], controllerId?: string): boolean {
  if (!permanent) return false;
  
  // Check type_line from card data
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  
  // FIRST: Check for the isCreature flag - this is set by animation effects
  // like Tezzeret, Karn, Nissa, March of the Machines, etc.
  // This takes highest priority as it represents the current game state
  if (permanent.isCreature === true) {
    return true;
  }
  
  // Check for animation modifiers (Tezzeret, Karn, Ensoul Artifact, etc.)
  // These effects turn non-creature permanents into creatures
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      // Animation effects that make something a creature
      if (mod.type === 'animation' || mod.type === 'ANIMATION' ||
          mod.type === 'becomesCreature' || mod.type === 'BECOMES_CREATURE' ||
          mod.type === 'tezzeret' || mod.type === 'ensoulArtifact' ||
          mod.type === 'marchOfTheMachines' || mod.type === 'nissaAnimation' ||
          mod.type === 'karnAnimation' || mod.type === 'manland') {
        // Check if the animation is still active
        if (mod.active !== false) {
          return true;
        }
      }
      
      // TYPE_CHANGE modifiers can add or remove types
      if (mod.type === 'typeChange' || mod.type === 'TYPE_CHANGE' || 
          mod.type === 'imprisonedInTheMoon' || mod.type === 'songOfTheDryads' ||
          mod.type === 'typeReplacement') {
        // If modifier explicitly removes creature type
        if (mod.removesTypes?.includes('Creature')) {
          return false;
        }
        // If modifier sets a new type line that replaces the original (e.g., "Land")
        // These effects turn the permanent into something else entirely
        if (mod.newTypeLine) {
          const newType = mod.newTypeLine.toLowerCase();
          // The new type line replaces all types - check if it includes creature
          return newType.includes('creature');
        }
        // If modifier adds creature type
        if (mod.addsTypes?.includes('Creature')) {
          return true;
        }
      }
    }
  }
  
  // Check if this permanent is marked as having its types replaced
  // (e.g., by Imprisoned in the Moon making it "just a land")
  if (permanent.typesReplaced === true) {
    // Check the current effective types
    if (permanent.effectiveTypes && Array.isArray(permanent.effectiveTypes)) {
      return permanent.effectiveTypes.includes('Creature');
    }
    // If types were replaced but no creature type, it's not a creature
    return false;
  }
  
  // Check for animated flag (used for lands that become creatures, artifacts animated by Tezzeret, etc.)
  if (permanent.animated === true) {
    return true;
  }
  
  // Handle Bestow creatures - they can be Auras when cast with bestow
  // A bestow creature on the battlefield is a creature UNLESS it's currently
  // attached to another permanent as an Aura
  if (oracleText.includes('bestow')) {
    // Check if this permanent is currently attached to something (acting as an Aura)
    if (permanent.attachedTo || permanent.enchanting) {
      // It's attached to something, so it's an Aura (Enchantment), not a Creature
      return false;
    }
    // If a bestow creature is on the battlefield unattached, it's a creature
    // (This happens when the enchanted creature dies)
    if (typeLine.includes('creature')) {
      return true;
    }
  }
  
  // Handle Vehicles - they are NOT creatures unless crewed this turn
  // Vehicles have "Artifact — Vehicle" type line and "Crew N" ability
  if (typeLine.includes('vehicle')) {
    // Check if the vehicle has been crewed this turn
    // The game should set a 'crewed' flag when crew is activated
    if (permanent.crewed === true) {
      return true;
    }
    // Also check for granted creature type from crew effect
    if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
      if (permanent.grantedTypes.includes('Creature')) return true;
    }
    // Vehicle not crewed - not a creature
    return false;
  }
  
  // Handle Spacecraft with Station mechanic
  // Spacecraft become creatures when they have enough charge counters
  if (typeLine.includes('spacecraft')) {
    // Check if the spacecraft has met its station threshold
    // This is tracked by the game when station ability resolves
    if (permanent.stationed === true) {
      return true;
    }
    // Also check for granted creature type from station effect
    if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
      if (permanent.grantedTypes.includes('Creature')) return true;
    }
    // Check if counters meet the threshold (simplified check)
    // The game should manage this, but we can check for charge counters
    const chargeCounters = permanent.counters?.charge || permanent.counters?.['charge'] || 0;
    const stationThreshold = permanent.stationThreshold || 0;
    if (stationThreshold > 0 && chargeCounters >= stationThreshold) {
      return true;
    }
    // Spacecraft not stationed - not a creature
    return false;
  }
  
  // Check for explicit types array (from modifiers or card data)
  if (permanent.types && Array.isArray(permanent.types)) {
    if (permanent.types.includes('Creature')) return true;
  }
  
  // Check granted types from effects (e.g., "becomes a creature")
  if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
    if (permanent.grantedTypes.includes('Creature')) return true;
  }
  
  // Handle Gods - they are only creatures if devotion threshold is met
  // Theros gods like Purphoros require devotion to their color(s) >= a threshold
  // Oracle text pattern: "As long as your devotion to [color] is less than [N], ~ isn't a creature"
  if (typeLine.includes('god') && typeLine.includes('creature')) {
    // Check if this is a Theros-style god with devotion requirement
    const devotionMatch = oracleText.match(/devotion to (\w+)(?:\s+and\s+(\w+))? is less than (\d+)/i);
    if (devotionMatch) {
      const color1 = devotionMatch[1].toLowerCase();
      const color2 = devotionMatch[2]?.toLowerCase();
      const threshold = parseInt(devotionMatch[3], 10);
      
      // Calculate devotion from permanents controlled by the same player
      // Use the passed battlefield parameter if available, otherwise use permanent.controllerBattlefield
      const controller = controllerId || permanent.controller;
      const playerPerms = battlefield 
        ? battlefield.filter((p: any) => p && p.controller === controller)
        : (permanent.controllerBattlefield || []);
      let devotion = 0;
      
      // Map color words to mana symbols
      const colorToSymbol: Record<string, string> = {
        'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G'
      };
      const symbol1 = colorToSymbol[color1] || color1.charAt(0).toUpperCase();
      const symbol2 = color2 ? (colorToSymbol[color2] || color2.charAt(0).toUpperCase()) : null;
      
      for (const perm of playerPerms) {
        const manaCost = perm.card?.mana_cost || '';
        // Count occurrences of the color symbol(s)
        const regex1 = new RegExp(`\\{${symbol1}\\}`, 'gi');
        const matches1 = manaCost.match(regex1);
        if (matches1) devotion += matches1.length;
        
        if (symbol2) {
          const regex2 = new RegExp(`\\{${symbol2}\\}`, 'gi');
          const matches2 = manaCost.match(regex2);
          if (matches2) devotion += matches2.length;
        }
        
        // Also check hybrid mana symbols
        const hybridRegex = /\{([WUBRG])\/([WUBRG])\}/gi;
        let hybridMatch;
        while ((hybridMatch = hybridRegex.exec(manaCost)) !== null) {
          if (hybridMatch[1] === symbol1 || hybridMatch[2] === symbol1) devotion++;
          if (symbol2 && (hybridMatch[1] === symbol2 || hybridMatch[2] === symbol2)) devotion++;
        }
      }
      
      // Check if there's a stored devotion value on the permanent (from game state)
      if (permanent.calculatedDevotion !== undefined) {
        devotion = permanent.calculatedDevotion;
      }
      
      // Check the notCreature flag set by game state
      if (permanent.notCreature === true) {
        return false;
      }
      
      // If devotion is less than threshold, it's not a creature
      if (devotion < threshold) {
        debug(2, `[isCurrentlyCreature] God ${permanent.card?.name} does not meet devotion threshold: ${devotion} < ${threshold}`);
        return false;
      }
      // Devotion met - it IS a creature
      return true;
    }
  }
  
  // Check if the base type line includes creature
  if (typeLine.includes('creature')) {
    return true;
  }
  
  return false;
}

/**
 * Combat control effect type for type-safe access
 */
interface CombatControlEffect {
  controllerId: PlayerID;
  sourceId: string;
  sourceName: string;
  controlsAttackers: boolean;
  controlsBlockers: boolean;
  mandatoryAttackers?: readonly string[];
  mandatoryBlockers?: Readonly<Record<string, readonly string[]>>;
  preventedAttackers?: readonly string[];
  preventedBlockers?: readonly string[];
}

/**
 * Helper to get combat control effect from game state (type-safe)
 */
function getCombatControl(game: any): CombatControlEffect | undefined {
  return game?.state?.combat?.combatControl as CombatControlEffect | undefined;
}

/**
 * Check if a permanent effectively has a specific ability.
 * This considers:
 * - Base oracle text keywords
 * - Keywords array from card data
 * - Granted abilities from effects (grantedAbilities array)
 * - Removed abilities from effects (removedAbilities array)
 * - "As though" effects from other permanents
 * 
 * @param permanent - The permanent to check
 * @param ability - The ability to check for (lowercase, e.g., 'flying', 'reach', 'defender')
 * @param battlefield - All permanents on the battlefield (for checking global effects)
 * @param controllerId - The controller's player ID (for checking "you control" effects)
 * @returns Object with hasAbility flag and whether it's granted/removed
 */
function hasEffectiveAbility(
  permanent: any,
  ability: string,
  battlefield: any[] = [],
  controllerId?: string
): { hasAbility: boolean; isGranted: boolean; isRemoved: boolean; asThough: boolean } {
  const lowerAbility = ability.toLowerCase();
  const oracleText = (permanent?.card?.oracle_text || '').toLowerCase();
  const rawKeywords = permanent?.card?.keywords;
  const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
  const grantedAbilities = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  const removedAbilities = Array.isArray(permanent?.removedAbilities) ? permanent.removedAbilities : [];
  
  // Check if ability is explicitly removed
  const isRemoved = removedAbilities.some((a: string) => a.toLowerCase() === lowerAbility);
  
  // Check if ability is in base keywords or oracle text
  const hasInKeywords = keywords.some((k: string) => k.toLowerCase() === lowerAbility);
  const hasInOracleText = oracleText.includes(lowerAbility);
  const hasBaseAbility = hasInKeywords || hasInOracleText;
  
  // Check if ability is granted by effects
  const isGranted = grantedAbilities.some((a: string) => a.toLowerCase() === lowerAbility);
  
  // Check for "as though it had [ability]" effects from other permanents
  let asThough = false;
  if (battlefield.length > 0) {
    for (const perm of battlefield) {
      if (!perm.card?.oracle_text) continue;
      const permOracle = perm.card.oracle_text.toLowerCase();
      const permController = perm.controller;
      
      // Pattern: "as though they had [ability]" or "as though it had [ability]"
      // Examples: 
      // - Bower Passage: "Creatures you control can't be blocked by creatures with flying."
      // - Archetype of Courage: "Creatures you control have first strike. Creatures your opponents control lose first strike and can't have or gain first strike."
      // - Behind the Scenes: "Creatures you control have skulk."
      
      // Check for "as though" granting this specific ability
      const asThoughPattern = new RegExp(`as though (?:it|they) had ${lowerAbility}`, 'i');
      if (asThoughPattern.test(permOracle)) {
        // Check if this effect applies to this permanent
        // Most "as though" effects are for "creatures you control"
        if (permOracle.includes('you control') && permController === controllerId) {
          asThough = true;
        } else if (!permOracle.includes('you control') && !permOracle.includes('opponents control')) {
          asThough = true; // Global effect
        }
      }
      
      // Also check for ability-granting effects: "[Type] creatures have [ability]"
      // This includes patterns like:
      // - "creatures you control have flying"
      // - "creatures you control get +1/+1 and have flying and indestructible" (Eldrazi Monument)
      const grantPattern = new RegExp(`creatures?\\s+(?:you\\s+control\\s+)?have\\s+${lowerAbility}`, 'i');
      const grantWithBuffPattern = new RegExp(`creatures?\\s+you\\s+control\\s+get\\s+[+\\-]\\d+/[+\\-]\\d+\\s+and\\s+have\\s+[^.]*\\b${lowerAbility}\\b`, 'i');
      if ((grantPattern.test(permOracle) || grantWithBuffPattern.test(permOracle)) && permController === controllerId) {
        // This permanent grants the ability
        // Check if our permanent matches the filter (simplified - assumes creature)
        const permTypeLine = (permanent?.card?.type_line || '').toLowerCase();
        if (permTypeLine.includes('creature')) {
          asThough = true;
        }
      }
    }
  }
  
  // Final determination
  if (isRemoved) {
    // If explicitly removed, check if there's an "as though" override
    return { hasAbility: asThough, isGranted: false, isRemoved: true, asThough };
  }
  
  const hasAbility = hasBaseAbility || isGranted || asThough;
  return { hasAbility, isGranted, isRemoved: false, asThough };
}

/**
 * Check if a permanent has counters that prevent it from attacking/blocking
 * Uses scalable pattern matching: "creatures with [X] counters on them can't attack/block"
 * 
 * @param permanent - The permanent to check
 * @param battlefield - All permanents on the battlefield
 * @param action - The action to check: 'attack' or 'block'
 * @returns Object with isPrevented flag, counterType, and source card name
 */
function hasCounterPreventingAction(
  permanent: any,
  battlefield: any[],
  action: 'attack' | 'block'
): { isPrevented: boolean; counterType?: string; sourceName?: string } {
  if (!permanent?.counters) {
    return { isPrevented: false };
  }
  
  // Get all counter types on this permanent
  const counterTypes = Object.keys(permanent.counters).filter(
    key => typeof permanent.counters[key] === 'number' && permanent.counters[key] > 0
  );
  
  if (counterTypes.length === 0) {
    return { isPrevented: false };
  }
  
  // Check battlefield for effects that prevent creatures with specific counters from attacking/blocking
  // Pattern: "Creatures with [X] counters on them can't [attack/block]"
  for (const perm of battlefield) {
    if (!perm?.card?.oracle_text) continue;
    
    const oracle = perm.card.oracle_text.toLowerCase();
    const cardName = perm.card.name || 'Unknown';
    
    // Check if this permanent has an effect preventing the action
    const preventsAction = action === 'attack'
      ? (oracle.includes("can't attack") || oracle.includes("cannot attack"))
      : (oracle.includes("can't") || oracle.includes("cannot")) && oracle.includes("block");
    
    if (!preventsAction) continue;
    
    // Check each counter type this creature has
    for (const counterType of counterTypes) {
      // Pattern matching: "creatures with [counterType] counters"
      // Examples: "bribery counters", "stun counters", "shield counters", etc.
      const counterPattern = new RegExp(`creatures? with ${counterType} counters? on them`, 'i');
      if (counterPattern.test(oracle)) {
        return { 
          isPrevented: true, 
          counterType, 
          sourceName: cardName 
        };
      }
    }
  }
  
  return { isPrevented: false };
}

/**
 * Check if a permanent can attack (checking for defender and "as though it didn't have defender" effects)
 * 
 * @param permanent - The permanent to check
 * @param battlefield - All permanents on the battlefield
 * @param controllerId - The controller's player ID
 * @returns Object with canAttack flag and reason if blocked
 */
function canPermanentAttack(
  permanent: any,
  battlefield: any[] = [],
  controllerId?: string
): { canAttack: boolean; reason?: string } {
  // Check for counters that prevent attacking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = hasCounterPreventingAction(permanent, battlefield, 'attack');
  if (counterCheck.isPrevented) {
    return { 
      canAttack: false, 
      reason: `Has ${counterCheck.counterType} counter (${counterCheck.sourceName} effect)` 
    };
  }
  
  // Check for defender
  const defenderCheck = hasEffectiveAbility(permanent, 'defender', battlefield, controllerId);
  
  if (defenderCheck.hasAbility) {
    // Check if there's an "as though it didn't have defender" effect
    let canAttackDespiteDefender = false;
    
    // Check grantedAbilities for "can attack as though it didn't have defender"
    const grantedAbilities = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
    if (grantedAbilities.some((a: string) => a.toLowerCase().includes('can attack'))) {
      canAttackDespiteDefender = true;
    }
    
    // Check for Assault Formation-style effects on battlefield
    for (const perm of battlefield) {
      if (!perm.card?.oracle_text) continue;
      const permOracle = perm.card.oracle_text.toLowerCase();
      const permController = perm.controller;
      
      // Pattern: "creatures you control can attack as though they didn't have defender"
      // Assault Formation: "Each creature you control assigns combat damage equal to its toughness rather than its power."
      // and has activated ability for "Creatures you control can attack as though they didn't have defender"
      if (permOracle.includes("as though they didn't have defender") ||
          permOracle.includes("as though it didn't have defender")) {
        if (permOracle.includes('you control') && permController === controllerId) {
          canAttackDespiteDefender = true;
          break;
        }
      }
    }
    
    if (!canAttackDespiteDefender) {
      return { canAttack: false, reason: 'Has defender' };
    }
  }
  
  return { canAttack: true };
}

/**
 * Check if a blocker can block a specific attacker considering evasion and "as though" effects
 * 
 * @param blocker - The potential blocking permanent
 * @param attacker - The attacking permanent
 * @param battlefield - All permanents on the battlefield
 * @returns Object with canBlock flag and reason if blocked
 */
function canBlockAttacker(
  blocker: any,
  attacker: any,
  battlefield: any[] = [],
  blockerControllerId?: string
): { canBlock: boolean; reason?: string } {
  // Check for counters that prevent blocking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = hasCounterPreventingAction(blocker, battlefield, 'block');
  if (counterCheck.isPrevented) {
    return { 
      canBlock: false, 
      reason: `Has ${counterCheck.counterType} counter (${counterCheck.sourceName} effect)` 
    };
  }
  
  // Check flying - can only be blocked by flying or reach
  const attackerFlying = hasEffectiveAbility(attacker, 'flying', battlefield, attacker.controller);
  if (attackerFlying.hasAbility) {
    const blockerFlying = hasEffectiveAbility(blocker, 'flying', battlefield, blockerControllerId);
    const blockerReach = hasEffectiveAbility(blocker, 'reach', battlefield, blockerControllerId);
    if (!blockerFlying.hasAbility && !blockerReach.hasAbility) {
      return { canBlock: false, reason: 'Attacker has flying' };
    }
  }
  
  // Check shadow - shadow can only be blocked by shadow
  const attackerShadow = hasEffectiveAbility(attacker, 'shadow', battlefield, attacker.controller);
  const blockerShadow = hasEffectiveAbility(blocker, 'shadow', battlefield, blockerControllerId);
  if (attackerShadow.hasAbility && !blockerShadow.hasAbility) {
    return { canBlock: false, reason: 'Attacker has shadow' };
  }
  if (blockerShadow.hasAbility && !attackerShadow.hasAbility) {
    return { canBlock: false, reason: 'Blocker has shadow and can only block shadow' };
  }
  
  // Check horsemanship
  const attackerHorsemanship = hasEffectiveAbility(attacker, 'horsemanship', battlefield, attacker.controller);
  if (attackerHorsemanship.hasAbility) {
    const blockerHorsemanship = hasEffectiveAbility(blocker, 'horsemanship', battlefield, blockerControllerId);
    if (!blockerHorsemanship.hasAbility) {
      return { canBlock: false, reason: 'Attacker has horsemanship' };
    }
  }
  
  return { canBlock: true };
}

/**
 * Helper to set combat control effect on game state
 */
function setCombatControl(game: any, combatControl: CombatControlEffect): void {
  if (!game.state.combat) {
    game.state.combat = {
      phase: 'declareAttackers',
      attackers: [],
      blockers: [],
    };
  }
  game.state.combat.combatControl = combatControl;
}

/**
 * Register combat phase socket handlers
 */
export function registerCombatHandlers(io: Server, socket: Socket): void {
  /**
   * Declare attackers - player selects which creatures to attack with
   * 
   * Payload:
   * - gameId: string
   * - attackers: Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>
   */
  socket.on("declareAttackers", async ({
    gameId,
    attackers,
  }: {
    gameId: string;
    attackers: Array<{
      creatureId: string;
      targetPlayerId?: string;
      targetPermanentId?: string;
    }>;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "DECLARE_ATTACKERS_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Verify it's the player's turn and correct step
      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "You can only declare attackers on your turn",
        });
        return;
      }

      const step = String((game.state as any).step || "").toLowerCase();
      if (step !== "declareattackers" && step !== "declare_attackers") {
        socket.emit("error", {
          code: "WRONG_STEP",
          message: "Can only declare attackers during the declare attackers step",
        });
        return;
      }

      // Validate attackers are valid creatures controlled by the player
      const battlefield = game.state?.battlefield || [];
      const attackerIds: string[] = [];
      const currentTurn = (game.state as any).turn || 0;
      
      // Check for Ghostly Prison, Windborn Muse, Propaganda, etc. effects
      // These require payment per attacking creature
      const attackCostPerDefender: Map<string, { cost: number; sources: string[] }> = new Map();
      
      for (const perm of battlefield) {
        const permController = (perm as any).controller;
        if (permController === playerId) continue; // Only opponents' effects matter
        
        const oracleText = ((perm as any).card?.oracle_text || "").toLowerCase();
        const cardName = ((perm as any).card?.name || "").toLowerCase();
        
        // Pattern: "Creatures can't attack you unless their controller pays {X} for each creature"
        // Ghostly Prison: "{2}"
        // Propaganda: "{2}"
        // Windborn Muse: "{2}"
        // Sphere of Safety: "{1} for each enchantment you control"
        // Norn's Annex: "{W/P}"
        // Baird, Steward of Argive: "{1}"
        
        let attackCost = 0;
        const costMatch = oracleText.match(/creatures can't attack you (?:or a planeswalker you control )?unless their controller pays \{(\d+)\}/i);
        
        if (costMatch) {
          attackCost = parseInt(costMatch[1], 10);
        } else if (cardName.includes('ghostly prison') || cardName.includes('propaganda')) {
          attackCost = 2; // Default for these known cards
        } else if (cardName.includes('windborn muse')) {
          attackCost = 2;
        } else if (cardName.includes('sphere of safety')) {
          // Count enchantments controlled by that player
          const enchantmentCount = battlefield.filter((p: any) => 
            p.controller === permController && 
            ((p.card?.type_line || '').toLowerCase().includes('enchantment'))
          ).length;
          attackCost = enchantmentCount;
        } else if (cardName.includes('baird, steward of argive')) {
          attackCost = 1;
        } else if (cardName.includes('norn\'s annex')) {
          attackCost = 2; // Or pay 2 life with Phyrexian mana
        } else if (cardName.includes('archangel of tithes')) {
          // {1} for each creature attacking you if Archangel is untapped
          if (!(perm as any).tapped) {
            attackCost = 1;
          }
        } else if (cardName.includes('war tax') || cardName.includes('pendrell mists') ||
                   (oracleText.includes("can't attack") && oracleText.includes("unless") && oracleText.includes("pays"))) {
          // Generic detection for other pillowfort effects
          const genericCostMatch = oracleText.match(/pays?\s*\{(\d+)\}/);
          if (genericCostMatch) {
            attackCost = parseInt(genericCostMatch[1], 10);
          }
        }
        
        if (attackCost > 0) {
          const existingCost = attackCostPerDefender.get(permController) || { cost: 0, sources: [] };
          existingCost.cost += attackCost;
          existingCost.sources.push((perm as any).card?.name || 'Unknown');
          attackCostPerDefender.set(permController, existingCost);
        }
      }
      
      // Calculate total attack cost based on which players are being attacked
      let totalAttackCostRequired = 0;
      const attackCostBreakdown: { playerId: string; cost: number; sources: string[] }[] = [];
      
      for (const attacker of attackers) {
        const targetPlayerId = attacker.targetPlayerId;
        if (targetPlayerId && attackCostPerDefender.has(targetPlayerId)) {
          const costInfo = attackCostPerDefender.get(targetPlayerId)!;
          totalAttackCostRequired += costInfo.cost;
          attackCostBreakdown.push({
            playerId: targetPlayerId,
            cost: costInfo.cost,
            sources: costInfo.sources,
          });
        }
      }
      
      // If there's an attack cost, check if player can pay and consume mana
      if (totalAttackCostRequired > 0) {
        // Get total available mana including untapped mana sources (bounce lands, Sol Ring, etc.)
        // This gives the player credit for mana they could produce by tapping their lands
        const availableMana = getAvailableMana(game.state, playerId);
        const totalAvailable = getTotalManaFromPool(availableMana);
        
        // Also get current mana pool for actual payment
        const manaPool = game.state.manaPool[playerId] || {
          white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
        };
        
        const totalFloating = manaPool.white + manaPool.blue + manaPool.black + 
                          manaPool.red + manaPool.green + manaPool.colorless;
        
        if (totalAvailable < totalAttackCostRequired) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA_FOR_ATTACK",
            message: `Cannot attack. Need to pay {${totalAttackCostRequired}} for ${attackCostBreakdown.map(b => b.sources.join(', ')).join('; ')}. You have {${totalAvailable}} available.`,
          });
          return;
        }
        
        // If player doesn't have enough floating mana, they need to tap lands first
        // For now, we'll auto-tap untapped mana sources to pay the cost
        if (totalFloating < totalAttackCostRequired) {
          // Auto-tap untapped mana sources to generate needed mana
          let manaNeeded = totalAttackCostRequired - totalFloating;
          const battlefield = game.state.battlefield || [];
          
          for (const perm of battlefield) {
            if (manaNeeded <= 0) break;
            if (perm.controller !== playerId) continue;
            if (perm.tapped) continue;
            if (!perm.card) continue;
            
            const oracleText = (perm.card.oracle_text || "").toLowerCase();
            const cardName = (perm.card.name || "").toLowerCase();
            
            // Check if this is a mana-producing permanent
            // Note: This is a simplified check for auto-paying attack costs.
            // The full mana availability check uses getAvailableMana() in mana-check.ts
            const isManaSource = /\{t\}(?:[^:]*)?:\s*add/i.test(oracleText) ||
                                /^(plains|island|swamp|mountain|forest)$/i.test(cardName);
            
            if (isManaSource) {
              // Calculate how much mana this source produces
              let manaProduced = 1; // Default for basic lands
              
              // Check for multi-mana production (Sol Ring, bounce lands, etc.)
              const manaTokens = oracleText.match(/\{[wubrgc]\}/gi) || [];
              if (manaTokens.length >= 2 && !oracleText.includes(' or ')) {
                // Produces multiple mana (e.g., Sol Ring {C}{C}, bounce lands {B}{R})
                manaProduced = manaTokens.length;
              }
              
              // Tap the permanent
              perm.tapped = true;
              
              // Add mana to pool (simplified: add as colorless for generic costs)
              game.state.manaPool[playerId] = game.state.manaPool[playerId] || {
                white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
              };
              game.state.manaPool[playerId].colorless += manaProduced;
              manaNeeded -= manaProduced;
              
              debug(2, `[combat] Auto-tapped ${perm.card.name} for ${manaProduced} mana to pay attack cost`);
            }
          }
        }
        
        // Now consume mana from pool
        const updatedManaPool = game.state.manaPool[playerId] || {
          white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
        };
        
        // Consume generic mana from pool (prioritize colorless, then colors)
        let remaining = totalAttackCostRequired;
        const poolCopy = { ...updatedManaPool };
        
        // First use colorless
        const colorlessUsed = Math.min(remaining, poolCopy.colorless);
        poolCopy.colorless -= colorlessUsed;
        remaining -= colorlessUsed;
        
        // Then use colors if needed
        if (remaining > 0) {
          const colors = ['white', 'blue', 'black', 'red', 'green'] as const;
          for (const color of colors) {
            if (remaining <= 0) break;
            const used = Math.min(remaining, poolCopy[color]);
            poolCopy[color] -= used;
            remaining -= used;
          }
        }
        
        // Update mana pool
        game.state.manaPool[playerId] = poolCopy;
        
        // Log the payment
        debug(1, `[combat] Player ${playerId} paid {${totalAttackCostRequired}} to attack (${attackCostBreakdown.map(b => b.sources.join(', ')).join('; ')})`);
        
        // Broadcast mana pool update
        broadcastManaPoolUpdate(io, gameId, playerId, game.state.manaPool[playerId] as any, `Paid attack cost`, game);
      }
      
      for (const attacker of attackers) {
        const creature = battlefield.find((perm: any) => 
          perm.id === attacker.creatureId && 
          perm.controller === playerId
        );
        
        if (!creature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Creature ${attacker.creatureId} not found or not controlled by you`,
          });
          return;
        }

        // Check if permanent is actually a creature (Rule 508.1a)
        // Enchantments, artifacts without animation, lands, etc. cannot attack
        // Pass battlefield and controller for proper devotion calculation (Gods)
        if (!isCurrentlyCreature(creature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(creature as any).card?.name || "This permanent"} is not a creature and cannot attack`,
          });
          return;
        }

        // Check for defender and "as though it didn't have defender" effects (Rule 508.1c)
        const canAttackCheck = canPermanentAttack(creature, battlefield, playerId);
        if (!canAttackCheck.canAttack) {
          socket.emit("error", {
            code: "CANT_ATTACK",
            message: `${(creature as any).card?.name || "Creature"} can't attack (${canAttackCheck.reason})`,
          });
          return;
        }

        // Check if creature is tapped (can't attack if tapped, unless vigilance)
        if ((creature as any).tapped) {
          const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
          if (!hasVigilance) {
            socket.emit("error", {
              code: "CREATURE_TAPPED",
              message: `${(creature as any).card?.name || "Creature"} is tapped and cannot attack`,
            });
            return;
          }
        }

        // Check for summoning sickness (can't attack unless haste)
        if ((creature as any).summoningSickness) {
          // Use comprehensive haste check that includes equipment (Lightning Greaves, etc.)
          const hasHaste = creatureHasHaste(creature, battlefield, playerId);
          
          if (!hasHaste) {
            socket.emit("error", {
              code: "SUMMONING_SICKNESS",
              message: `${(creature as any).card?.name || "Creature"} has summoning sickness and cannot attack`,
            });
            return;
          }
        }

        // ========================================================================
        // GOAD validation (Rule 701.15b)
        // Goaded creatures must attack a player other than the goader if able
        // ========================================================================
        // Check if creature is goaded (either via goadedBy tracking or The Sound of Drums aura)
        const goadInfo = getCreatureGoadStatus(creature, battlefield, playerId, currentTurn);
        
        if (goadInfo.isGoaded) {
          // Creature is currently goaded
          const targetPlayerId = attacker.targetPlayerId;
          
          if (targetPlayerId) {
            // Check if attacking a goader when other options exist
            const isAttackingGoader = goadInfo.goaders.includes(targetPlayerId);
            
            if (isAttackingGoader) {
              // Get all possible opponents (not the controller)
              const players = (game.state as any).players || [];
              const allOpponents = players
                .filter((p: any) => p?.id && p.id !== playerId && !p.hasLost)
                .map((p: any) => p.id);
              
              // Check if there are non-goader opponents available
              const nonGoaderOpponents = allOpponents.filter((oppId: string) => 
                !goadInfo.goaders.includes(oppId)
              );
              
              if (nonGoaderOpponents.length > 0) {
                // Rule violation: attacking a goader when other options exist
                const goaderNames = goadInfo.goaders
                  .map((gId: string) => getPlayerName(game, gId))
                  .join(', ');
                socket.emit("error", {
                  code: "GOAD_VIOLATION",
                  message: `${(creature as any).card?.name || "Creature"} is goaded by ${goaderNames} and cannot attack them (must attack another opponent if able).`,
                });
                return;
              }
              // Attacking goader is OK only when they're the only option
              debug(2, `[combat] ${(creature as any).card?.name} is attacking goader ${targetPlayerId} (only option available)`);
            }
          }
        }

        attackerIds.push(attacker.creatureId);
        
        // Mark creature as attacking
        (creature as any).attacking = attacker.targetPlayerId || attacker.targetPermanentId;
        
        // Track that this creature attacked this turn (for Minas Tirith, etc.)
        (creature as any).attackedThisTurn = true;
        
        // Tap the attacker (unless it has vigilance)
        const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }
      
      // Track total creatures attacked this turn for the attacking player (for Minas Tirith, Lightmine Field, etc.)
      (game.state as any).creaturesAttackedThisTurn = (game.state as any).creaturesAttackedThisTurn || {};
      (game.state as any).creaturesAttackedThisTurn[playerId] = ((game.state as any).creaturesAttackedThisTurn[playerId] || 0) + attackerIds.length;
      debug(2, `[combat] Player ${playerId} has now attacked with ${(game.state as any).creaturesAttackedThisTurn[playerId]} creature(s) this turn`);

      // Trepanation Blade - mill defending player until land and set temporary bonus
      for (const attacker of attackers) {
        const defendingPlayerId = attacker.targetPlayerId;
        if (!defendingPlayerId) continue;
        const creature = battlefield.find((perm: any) => perm.id === attacker.creatureId);
        if (!creature) continue;
        for (const attachment of battlefield) {
          const attachType = (attachment.card?.type_line || "").toLowerCase();
          if (!attachType.includes("equipment")) continue;
          if (attachment.attachedTo !== attacker.creatureId) continue;
          const attachName = (attachment.card?.name || "").toLowerCase();
          if (attachName.includes("trepanation blade")) {
            const millResult = millUntilLand(game, defendingPlayerId);
            const bonus = millResult.milled.length;
            attachment.trepanationBonus = bonus;
            attachment.lastTrepanationBonus = bonus;
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${attachment.card?.name}: ${getPlayerName(game, defendingPlayerId)} mills ${bonus} card(s)${millResult.landHit ? ` (stopped at ${millResult.landHit.name})` : ''}. Equipped creature gets +${bonus}/+0 until end of turn.`,
              ts: Date.now(),
            });
          }
        }
      }

      // ========================================================================
      // GOAD ENFORCEMENT (Rule 701.38b)
      // Goaded creatures attack each combat if able
      // ========================================================================
      // Check if there are any goaded creatures that should have attacked but didn't
      const goadedCreaturesNotAttacking: any[] = [];
      
      for (const perm of battlefield) {
        if (perm.controller !== playerId) continue;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        
        const goadInfo = getCreatureGoadStatus(perm, battlefield, playerId, currentTurn);
        
        if (goadInfo.isGoaded) {
          // This creature is goaded - check if it's attacking
          const isAttacking = attackerIds.includes(perm.id);
          
          if (!isAttacking) {
            // Check if the creature CAN attack (not tapped, doesn't have defender, etc.)
            const isTapped = (perm as any).tapped;
            const hasDefender = permanentHasKeyword(perm, battlefield, playerId, 'defender');
            const cantAttack = (perm.card?.oracle_text || '').toLowerCase().includes("can't attack");
            
            // Check if there's summoning sickness (creature entered this turn without haste)
            const hasSummoningSickness = (perm as any).enteredThisTurn && 
              !permanentHasKeyword(perm, battlefield, playerId, 'haste');
            
            if (!isTapped && !hasDefender && !cantAttack && !hasSummoningSickness) {
              // Check if there are any valid targets to attack
              const players = (game.state as any).players || [];
              const possibleTargets = players
                .filter((p: any) => p?.id && p.id !== playerId && !p.hasLost)
                .map((p: any) => p.id);
              
              if (possibleTargets.length > 0) {
                // This creature should have attacked but didn't
                goadedCreaturesNotAttacking.push({
                  id: perm.id,
                  name: perm.card?.name || 'Unknown',
                  goaders: goadInfo.goaders
                });
              }
            }
          }
        }
      }
      
      if (goadedCreaturesNotAttacking.length > 0) {
        const creatureList = goadedCreaturesNotAttacking
          .map(c => c.name)
          .join(', ');
        socket.emit("error", {
          code: "GOAD_MUST_ATTACK",
          message: `The following goaded creature(s) must attack if able: ${creatureList}`,
        });
        return;
      }

      // Process tap triggers for creatures that became tapped from attacking
      processTapTriggersForAttackers(io, game, gameId, attackers, battlefield, playerId);

      // Use game's declareAttackers method if available
      if (typeof (game as any).declareAttackers === "function") {
        try {
          (game as any).declareAttackers(playerId, attackerIds);
        } catch (e) {
          debugWarn(1, "[combat] game.declareAttackers failed:", e);
        }
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareAttackers", {
          playerId,
          attackers,
        });
      } catch (e) {
        debugWarn(1, "[combat] Failed to persist declareAttackers event:", e);
      }

      // Broadcast chat message
      const attackerCount = attackers.length;
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} declares ${attackerCount} attacker${attackerCount !== 1 ? "s" : ""}.`,
        ts: Date.now(),
      });

      // Process attack triggers
      try {
        const attackingCreatures = battlefield.filter((perm: any) => 
          attackerIds.includes(perm.id)
        );
        
        // Get the first defender as the default defending player
        const firstDefender = attackers[0]?.targetPlayerId;
        
        if (attackingCreatures.length > 0 && firstDefender) {
          // Create a minimal context for trigger detection
          const ctx = {
            state: game.state,
            bumpSeq: () => {
              if (typeof (game as any).bumpSeq === "function") {
                (game as any).bumpSeq();
              }
            }
          };
          
          const triggers = getAttackTriggersForCreatures(
            ctx as any,
            attackingCreatures,
            playerId,
            firstDefender
          );
          
          // Push triggers to stack and notify clients
          if (triggers.length > 0) {
            debug(2, `[combat] Found ${triggers.length} attack trigger(s) for game ${gameId}`);
            
            for (const trigger of triggers) {
              // Check if this is an optional mana payment trigger
              if (trigger.manaCost && !trigger.mandatory) {
                // Don't auto-push to stack - instead emit a payment prompt
                const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                
                // Store pending trigger for later resolution
                game.state.pendingAttackTriggers = game.state.pendingAttackTriggers || {};
                game.state.pendingAttackTriggers[triggerId] = {
                  permanentId: trigger.permanentId,
                  cardName: trigger.cardName,
                  effect: trigger.effect,
                  manaCost: trigger.manaCost,
                  controller: playerId,
                  description: trigger.description,
                };
                
                // Get card image for the modal
                const permanent = battlefield.find((p: any) => p?.id === trigger.permanentId);
                const cardImageUrl = permanent?.card?.image_uris?.small || 
                                    permanent?.card?.image_uris?.normal;
                
                // Emit payment prompt to the controlling player
                emitToPlayer(io, playerId, "attackTriggerManaPaymentPrompt", {
                  gameId,
                  triggerId,
                  permanentId: trigger.permanentId,
                  cardName: trigger.cardName,
                  cardImageUrl,
                  manaCost: trigger.manaCost,
                  effect: trigger.effect,
                  description: trigger.description,
                });
                
                debug(2, `[combat] Attack trigger with mana payment for ${trigger.cardName}: ${trigger.manaCost} to ${trigger.effect}`);
              } else if ((trigger.triggerType as string) === 'firebending') {
                // Firebending - add red mana immediately, lasts until end of combat
                const manaAmount = typeof trigger.value === 'number' ? trigger.value : 1;
                
                // Initialize mana pool if needed
                game.state.manaPool = game.state.manaPool || {};
                game.state.manaPool[playerId] = game.state.manaPool[playerId] || {
                  white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
                };
                
                // Add red mana
                game.state.manaPool[playerId].red = (game.state.manaPool[playerId].red || 0) + manaAmount;
                
                // Track firebending mana so it empties at end of combat
                game.state.firebendingMana = game.state.firebendingMana || {};
                game.state.firebendingMana[playerId] = (game.state.firebendingMana[playerId] || 0) + manaAmount;
                
                // Emit chat and mana pool update
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `🔥 ${trigger.cardName}'s firebending adds ${'{R}'.repeat(manaAmount)} (until end of combat)`,
                  ts: Date.now(),
                });
                
                broadcastManaPoolUpdate(io, gameId, playerId, game.state.manaPool[playerId] as any, `Firebending from ${trigger.cardName}`, game);
                
                debug(2, `[combat] Firebending trigger from ${trigger.cardName}: added ${manaAmount} red mana`);
              } else if ((trigger.triggerType as string) === 'battle_cry') {
                // Battle Cry - Each other attacking creature gets +1/+0 until end of turn
                // Rule 702.91a: Apply +1/+0 to all OTHER attacking creatures
                const attackerIds = attackers.map(a => a.creatureId);
                const otherAttackers = battlefield.filter((p: any) => 
                  p && attackerIds.includes(p.id) && p.id !== trigger.permanentId
                );
                
                for (const attacker of otherAttackers) {
                  // Add the battle cry bonus as a temporary modifier
                  (attacker as any).modifiers = (attacker as any).modifiers || [];
                  (attacker as any).modifiers.push({
                    type: 'battle_cry',
                    power: 1,
                    toughness: 0,
                    source: trigger.permanentId,
                    sourceName: trigger.cardName,
                    expiresAt: 'end_of_turn',
                  });
                  
                  // Also update the temporary power boost for immediate effect
                  (attacker as any).temporaryPowerBoost = ((attacker as any).temporaryPowerBoost || 0) + 1;
                }
                
                const buffedCount = otherAttackers.length;
                if (buffedCount > 0) {
                  io.to(gameId).emit("chat", {
                    id: `m_${Date.now()}`,
                    gameId,
                    from: "system",
                    message: `⚔️ ${trigger.cardName}'s battle cry gives ${buffedCount} other attacking creature${buffedCount !== 1 ? 's' : ''} +1/+0 until end of turn`,
                    ts: Date.now(),
                  });
                  
                  debug(2, `[combat] Battle cry from ${trigger.cardName}: buffed ${buffedCount} other attackers`);
                }
              } else {
                // Regular trigger - push onto stack immediately
                game.state.stack = game.state.stack || [];
                const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const stackItem: any = {
                  id: triggerId,
                  type: 'triggered_ability',
                  controller: playerId,
                  source: trigger.permanentId,
                  sourceName: trigger.cardName,
                  description: trigger.description,
                  triggerType: trigger.triggerType,
                  mandatory: trigger.mandatory,
                };
                
                // Add value or effectData based on type
                if (typeof trigger.value === 'number') {
                  stackItem.value = trigger.value;
                } else if (typeof trigger.value === 'object') {
                  stackItem.effectData = trigger.value;
                }
                
                game.state.stack.push(stackItem);
                
                // Notify players about the trigger
                io.to(gameId).emit("triggeredAbility", {
                  gameId,
                  triggerId,
                  playerId,
                  sourcePermanentId: trigger.permanentId,
                  sourceName: trigger.cardName,
                  triggerType: trigger.triggerType,
                  description: trigger.description,
                  mandatory: trigger.mandatory,
                });
                
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`,
                  ts: Date.now(),
                });
              }
            }
          }
        }
      } catch (triggerErr) {
        debugWarn(1, "[combat] Error processing attack triggers:", triggerErr);
      }

      // Check for Odric, Master Tactician style effects
      // "Whenever Odric, Master Tactician and at least three other creatures attack"
      try {
        if (attackerCount >= 4) {
          // Look for Odric or similar cards among the attacking creatures
          for (const attacker of attackers) {
            const permanent = battlefield.find((p: any) => p?.id === attacker.creatureId);
            if (!permanent || !permanent.card) continue;
            
            const cardName = (permanent.card.name || '').toLowerCase();
            const oracleText = (permanent.card.oracle_text || '').toLowerCase();
            
            // Check for Odric's specific trigger condition
            if ((cardName.includes('odric') && oracleText.includes('at least three other creatures attack')) ||
                (oracleText.includes('at least three other creatures attack') && oracleText.includes('you choose which creatures block'))) {
              
              debug(2, `[combat] Odric-style effect detected: ${permanent.card.name} - setting combat control for blockers`);
              
              // Set combat control for blockers
              setCombatControl(game, {
                controllerId: playerId,
                sourceId: permanent.id,
                sourceName: permanent.card.name,
                controlsAttackers: false,
                controlsBlockers: true,
              });
              
              // Broadcast chat message
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `🎯 ${permanent.card.name}: ${getPlayerName(game, playerId)} will choose which creatures block and how they block this combat!`,
                ts: Date.now(),
              });
              
              break; // Only apply once
            }
          }
        }
      } catch (odricErr) {
        debugWarn(1, "[combat] Error checking Odric-style effects:", odricErr);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Emit combat state update for UI
      io.to(gameId).emit("combatStateUpdated", {
        gameId,
        phase: "declareAttackers",
        attackers: attackers.map(a => ({
          permanentId: a.creatureId,
          defending: a.targetPlayerId || a.targetPermanentId,
        })),
      });

      debug(2, `[combat] Player ${playerId} declared ${attackerCount} attackers in game ${gameId}`);

      // NOTE: Do NOT auto-advance the step here!
      // Per MTG rules, after attackers are declared, all players get priority
      // to cast instants and activate abilities before moving to declare blockers.
      // The step will advance when all players pass priority in succession.
      // The client should emit "passPriority" or "nextStep" when ready to proceed.
      
    } catch (err: any) {
      debugError(1, `[combat] declareAttackers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "DECLARE_ATTACKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle attack trigger mana payment response
   * Player decides whether to pay mana for an optional attack trigger (e.g., Casal)
   */
  socket.on("respondAttackTriggerPayment", async ({
    gameId,
    triggerId,
    payMana,
  }: {
    gameId: string;
    triggerId: string;
    payMana: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "PAYMENT_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Retrieve the pending trigger
      const pendingTrigger = game.state.pendingAttackTriggers?.[triggerId];
      if (!pendingTrigger) {
        socket.emit("error", {
          code: "TRIGGER_NOT_FOUND",
          message: "Trigger not found or already resolved",
        });
        return;
      }

      // Verify the player controls this trigger
      if (pendingTrigger.controller !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_TRIGGER",
          message: "You don't control this trigger",
        });
        return;
      }

      const { permanentId, cardName, effect, manaCost, description } = pendingTrigger;
      
      // Remove from pending
      delete game.state.pendingAttackTriggers[triggerId];

      if (payMana) {
        // Player chose to pay - validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, playerId);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { 
            code: "INSUFFICIENT_MANA", 
            message: `Cannot pay ${manaCost}: ${validationError}` 
          });
          return;
        }
        
        // Consume mana
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[attackTriggerPayment:${cardName}]`);
        broadcastManaPoolUpdate(io, gameId, playerId, pool as any, `Paid ${manaCost} for ${cardName}`, game);
        
        // Execute the effect (e.g., transform Casal)
        const battlefield = game.state?.battlefield || [];
        const permanent = battlefield.find((p: any) => p?.id === permanentId);
        
        if (permanent && effect && effect.toLowerCase().includes('transform')) {
          // Handle transform
          const cardFaces = (permanent.card as any)?.card_faces;
          if (Array.isArray(cardFaces) && cardFaces.length >= 2) {
            const wasTransformed = (permanent as any).transformed;
            (permanent as any).transformed = !wasTransformed;
            
            // Get the new face
            const newFaceIndex = wasTransformed ? 0 : 1;
            const newFace = cardFaces[newFaceIndex];
            
            // Update permanent's visible card data
            permanent.card = {
              ...permanent.card,
              name: newFace.name,
              type_line: newFace.type_line,
              oracle_text: newFace.oracle_text,
              power: newFace.power,
              toughness: newFace.toughness,
              mana_cost: newFace.mana_cost,
              colors: newFace.colors,
            } as any;
            
            // Check if this is Casal transforming to Pathbreaker Owlbear
            const newName = newFace.name || '';
            if (newName.toLowerCase().includes('pathbreaker owlbear')) {
              // Apply the buff: other legendary creatures get +2/+2 and trample until end of turn
              const legendaryCreatures = battlefield.filter((p: any) => 
                p?.controller === playerId && 
                p?.id !== permanentId && // Exclude Casal herself
                (p?.card?.type_line || '').toLowerCase().includes('legendary') &&
                (p?.card?.type_line || '').toLowerCase().includes('creature')
              );
              
              for (const creature of legendaryCreatures) {
                // Add temporary buff modifier
                const existingModifiers = creature.modifiers || [];
                creature.modifiers = [
                  ...existingModifiers,
                  {
                    type: 'pt_buff',
                    sourceId: permanentId,
                    power: 2,
                    toughness: 2,
                    keywords: ['Trample'],
                    duration: 'end_of_turn',
                    appliedAt: Date.now(),
                  } as any
                ];
              }
              
              if (legendaryCreatures.length > 0) {
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `🐻 ${newName}: ${legendaryCreatures.length} legendary creature${legendaryCreatures.length > 1 ? 's' : ''} get +2/+2 and gain trample until end of turn!`,
                  ts: Date.now(),
                });
              }
            }
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `💰 ${getPlayerName(game, playerId)} paid ${manaCost}. ${cardName} transforms into ${newFace.name}!`,
              ts: Date.now(),
            });
          }
        }
        
        // Bump sequence and broadcast
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        broadcastGame(io, game, gameId);
        
        debug(2, `[combat] ${playerId} paid ${manaCost} for ${cardName}'s attack trigger`);
      } else {
        // Player chose not to pay
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} declined to pay ${manaCost} for ${cardName}'s trigger.`,
          ts: Date.now(),
        });
        
        debug(2, `[combat] ${playerId} declined to pay for ${cardName}'s attack trigger`);
      }
      
    } catch (err: any) {
      debugError(1, `[combat] respondAttackTriggerPayment error:`, err);
      socket.emit("error", {
        code: "PAYMENT_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Declare blockers - defending player selects which creatures block which attackers
   * 
   * Payload:
   * - gameId: string
   * - blockers: Array<{ blockerId: string; attackerId: string }>
   */
  socket.on("declareBlockers", async ({
    gameId,
    blockers,
  }: {
    gameId: string;
    blockers: Array<{
      blockerId: string;
      attackerId: string;
    }>;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "DECLARE_BLOCKERS_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      const step = String((game.state as any).step || "").toLowerCase();
      if (step !== "declareblockers" && step !== "declare_blockers") {
        socket.emit("error", {
          code: "WRONG_STEP",
          message: "Can only declare blockers during the declare blockers step",
        });
        return;
      }

      // Validate blockers
      const battlefield = game.state?.battlefield || [];
      
      for (const blocker of blockers) {
        // Find the blocker creature
        const blockerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.blockerId && 
          perm.controller === playerId
        );
        
        if (!blockerCreature) {
          socket.emit("error", {
            code: "INVALID_BLOCKER",
            message: `Creature ${blocker.blockerId} not found or not controlled by you`,
          });
          return;
        }

        // Check if permanent is actually a creature (Rule 509.1a)
        // Enchantments, artifacts without animation, lands, etc. cannot block
        // Pass battlefield and controller for proper devotion calculation (Gods)
        if (!isCurrentlyCreature(blockerCreature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(blockerCreature as any).card?.name || "This permanent"} is not a creature and cannot block`,
          });
          return;
        }

        // Check if blocker is tapped
        if ((blockerCreature as any).tapped) {
          socket.emit("error", {
            code: "BLOCKER_TAPPED",
            message: `${(blockerCreature as any).card?.name || "Creature"} is tapped and cannot block`,
          });
          return;
        }

        // Find the attacker being blocked
        const attackerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.attackerId && 
          (perm as any).attacking
        );
        
        if (!attackerCreature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Attacker ${blocker.attackerId} not found or is not attacking`,
          });
          return;
        }

        // Use the comprehensive evasion check that considers granted abilities and "as though" effects
        const blockCheck = canBlockAttacker(blockerCreature, attackerCreature, battlefield, playerId);
        if (!blockCheck.canBlock) {
          socket.emit("error", {
            code: "CANT_BLOCK",
            message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (${blockCheck.reason})`,
          });
          return;
        }

        // Additional evasion checks not covered by canBlockAttacker (fear, intimidate, skulk, menace)
        const attackerText = ((attackerCreature as any).card?.oracle_text || "").toLowerCase();
        const blockerText = ((blockerCreature as any).card?.oracle_text || "").toLowerCase();
        const attackerKeywords = (attackerCreature as any).card?.keywords || [];
        const blockerKeywords = (blockerCreature as any).card?.keywords || [];
        
        // Fear: can only be blocked by artifact creatures or black creatures
        const attackerHasFear = attackerText.includes("fear") || 
          attackerKeywords.some((k: string) => k.toLowerCase() === 'fear');
        if (attackerHasFear) {
          const blockerCard = (blockerCreature as any).card;
          const isArtifact = blockerCard?.type_line?.toLowerCase().includes('artifact');
          const isBlack = blockerCard?.colors?.includes('B');
          if (!isArtifact && !isBlack) {
            socket.emit("error", {
              code: "CANT_BLOCK_FEAR",
              message: `${blockerCard?.name} can't block ${(attackerCreature as any).card?.name} (fear)`,
            });
            return;
          }
        }
        
        // Intimidate: can only be blocked by artifact creatures or creatures that share a color
        const attackerHasIntimidate = attackerText.includes("intimidate") || 
          attackerKeywords.some((k: string) => k.toLowerCase() === 'intimidate');
        if (attackerHasIntimidate) {
          const blockerCard = (blockerCreature as any).card;
          const attackerCard = (attackerCreature as any).card;
          const isArtifact = blockerCard?.type_line?.toLowerCase().includes('artifact');
          const sharesColor = (attackerCard?.colors || []).some((c: string) => 
            (blockerCard?.colors || []).includes(c)
          );
          if (!isArtifact && !sharesColor) {
            socket.emit("error", {
              code: "CANT_BLOCK_INTIMIDATE",
              message: `${blockerCard?.name} can't block ${attackerCard?.name} (intimidate)`,
            });
            return;
          }
        }
        
        // Skulk: can't be blocked by creatures with greater power
        const attackerHasSkulk = attackerText.includes("skulk") || 
          attackerKeywords.some((k: string) => k.toLowerCase() === 'skulk');
        if (attackerHasSkulk) {
          const blockerPower = getEffectivePower(blockerCreature);
          const attackerPower = getEffectivePower(attackerCreature);
          if (blockerPower > attackerPower) {
            socket.emit("error", {
              code: "CANT_BLOCK_SKULK",
              message: `${(blockerCreature as any).card?.name} (power ${blockerPower}) can't block ${(attackerCreature as any).card?.name} (skulk, power ${attackerPower})`,
            });
            return;
          }
        }

        // Mark the blocker as blocking
        (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
        (blockerCreature as any).blocking.push(blocker.attackerId);

        // Mark the attacker as being blocked
        (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
        (attackerCreature as any).blockedBy.push(blocker.blockerId);
      }

      // Use game's declareBlockers method if available
      if (typeof (game as any).declareBlockers === "function") {
        try {
          (game as any).declareBlockers(playerId, blockers);
        } catch (e) {
          debugWarn(1, "[combat] game.declareBlockers failed:", e);
        }
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareBlockers", {
          playerId,
          blockers,
        });
      } catch (e) {
        debugWarn(1, "[combat] Failed to persist declareBlockers event:", e);
      }

      // Broadcast chat message
      const blockerCount = blockers.length;
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} declares ${blockerCount} blocker${blockerCount !== 1 ? "s" : ""}.`,
        ts: Date.now(),
      });

      // Process block triggers
      try {
        const blockingCreatures = blockers.map(b => 
          battlefield.find((perm: any) => perm.id === b.blockerId)
        ).filter(Boolean);
        
        if (blockingCreatures.length > 0) {
          // Create a minimal context for trigger detection
          const ctx = {
            state: game.state,
            bumpSeq: () => {
              if (typeof (game as any).bumpSeq === "function") {
                (game as any).bumpSeq();
              }
            }
          };
          
          // Import block trigger function dynamically to avoid circular dependencies
          const { getBlockTriggersForCreatures } = await import("../state/modules/triggers/index.js");
          
          const triggers = getBlockTriggersForCreatures(
            ctx as any,
            blockingCreatures,
            playerId
          );
          
          // Push triggers to stack and notify clients
          if (triggers.length > 0) {
            debug(2, `[combat] Found ${triggers.length} block trigger(s) for game ${gameId}`);
            
            for (const trigger of triggers) {
              // Push onto stack
              game.state.stack = game.state.stack || [];
              const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const stackItem: any = {
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: trigger.permanentId,
                sourceName: trigger.cardName,
                description: trigger.description,
                triggerType: 'blocks',
                mandatory: trigger.mandatory,
                value: trigger.value,
              };
              
              game.state.stack.push(stackItem);
              
              // Notify players about the trigger
              io.to(gameId).emit("triggeredAbility", {
                gameId,
                triggerId,
                playerId,
                sourcePermanentId: trigger.permanentId,
                sourceName: trigger.cardName,
                triggerType: 'blocks',
                description: trigger.description,
                mandatory: trigger.mandatory,
              });
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`,
                ts: Date.now(),
              });
            }
          }
        }
      } catch (triggerErr) {
        debugWarn(1, "[combat] Error processing block triggers:", triggerErr);
      }

      // Mark that blockers have been declared for this player
      // This allows step advancement to proceed past DECLARE_BLOCKERS
      const state = game.state as any;
      state.blockersDeclaredBy = state.blockersDeclaredBy || [];
      if (!state.blockersDeclaredBy.includes(playerId)) {
        state.blockersDeclaredBy.push(playerId);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Emit combat state update for UI
      io.to(gameId).emit("combatStateUpdated", {
        gameId,
        phase: "declareBlockers",
        blockers: blockers.map(b => ({
          blockerId: b.blockerId,
          attackerId: b.attackerId,
        })),
      });

      debug(2, `[combat] Player ${playerId} declared ${blockerCount} blockers in game ${gameId}`);

      // NOTE: Do NOT auto-advance the step here!
      // Per MTG rules, after blockers are declared, all players get priority
      // to cast instants and activate abilities before combat damage.
      // The step will advance when all players pass priority in succession.
      // The client should emit "passPriority" or "nextStep" when ready to proceed.
      
    } catch (err: any) {
      debugError(1, `[combat] declareBlockers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "DECLARE_BLOCKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Skip declaring attackers - pass without attacking
   */
  socket.on("skipDeclareAttackers", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "You can only skip declaring attackers on your turn",
        });
        return;
      }

      // Advance to next step
      if (typeof (game as any).nextStep === "function") {
        await (game as any).nextStep();
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} attacks with no creatures.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      debugError(1, `[combat] skipDeclareAttackers error:`, err);
    }
  });

  /**
   * Skip declaring blockers - pass without blocking
   */
  socket.on("skipDeclareBlockers", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      // Mark that blockers have been declared (skipped) for this player
      // This allows step advancement to proceed past DECLARE_BLOCKERS
      const state = game.state as any;
      state.blockersDeclaredBy = state.blockersDeclaredBy || [];
      if (!state.blockersDeclaredBy.includes(playerId)) {
        state.blockersDeclaredBy.push(playerId);
        debug(1, `[combat] ${playerId} skipped declaring blockers`);
      } else {
        debug(1, `[combat] ${playerId} already declared/skipped blockers, ignoring duplicate skip`);
        return; // Already declared, don't do anything
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} chooses not to block.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Note: Don't call nextStep() here - let the normal priority passing advance the step
      // when all players pass priority in succession
      
    } catch (err: any) {
      debugError(1, `[combat] skipDeclareBlockers error:`, err);
    }
  });

  /**
   * Apply combat control effect (Master Warcraft, Odric, Master Tactician)
   * Sets up the game state so that a player controls combat decisions
   * 
   * Payload:
   * - gameId: string
   * - sourceId: string - The permanent/spell that grants combat control
   * - sourceName: string - Name of the source for display
   * - controlsAttackers: boolean - Whether this effect controls attacker declarations
   * - controlsBlockers: boolean - Whether this effect controls blocker declarations
   */
  socket.on("applyCombatControl", async ({
    gameId,
    sourceId,
    sourceName,
    controlsAttackers,
    controlsBlockers,
  }: {
    gameId: string;
    sourceId: string;
    sourceName: string;
    controlsAttackers: boolean;
    controlsBlockers: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "COMBAT_CONTROL_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Set combat control effect using helper
      setCombatControl(game, {
        controllerId: playerId,
        sourceId,
        sourceName,
        controlsAttackers,
        controlsBlockers,
      });

      // Broadcast chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎯 ${sourceName}: ${getPlayerName(game, playerId)} controls ${
          controlsAttackers && controlsBlockers ? "attackers and blockers" :
          controlsAttackers ? "attackers" : "blockers"
        } this combat.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      // Notify the controlling player that they need to make combat decisions
      const combatControl = getCombatControl(game);
      emitToPlayer(io, playerId, "combatControlActive", {
        gameId,
        combatControl,
        mode: controlsAttackers ? 'attackers' : 'blockers',
      });

      debug(2, `[combat] Player ${playerId} gained combat control via ${sourceName} in game ${gameId}`);
      
    } catch (err: any) {
      debugError(1, `[combat] applyCombatControl error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "COMBAT_CONTROL_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Declare attackers under combat control
   * Used when a player controls combat via Master Warcraft or similar effects
   * 
   * Payload:
   * - gameId: string
   * - attackers: Array<{ creatureId: string; targetPlayerId: string }>
   */
  socket.on("declareControlledAttackers", async ({
    gameId,
    attackers,
  }: {
    gameId: string;
    attackers: Array<{
      creatureId: string;
      targetPlayerId: string;
    }>;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "CONTROLLED_ATTACKERS_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Verify player has combat control
      const combatControl = getCombatControl(game);
      if (!combatControl || combatControl.controllerId !== playerId) {
        socket.emit("error", {
          code: "NO_COMBAT_CONTROL",
          message: "You don't have combat control",
        });
        return;
      }

      if (!combatControl.controlsAttackers) {
        socket.emit("error", {
          code: "NO_ATTACKER_CONTROL",
          message: "You don't control attacker declarations",
        });
        return;
      }

      const battlefield = game.state?.battlefield || [];
      const attackerIds: string[] = [];
      
      // Validate and set up each attacker
      for (const attacker of attackers) {
        const creature = battlefield.find((perm: any) => 
          perm.id === attacker.creatureId
        );
        
        if (!creature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Creature ${attacker.creatureId} not found`,
          });
          return;
        }

        // Check if permanent is a creature (includes devotion check for Gods)
        if (!isCurrentlyCreature(creature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(creature as any).card?.name || "This permanent"} is not a creature`,
          });
          return;
        }

        // Check if creature can attack (not tapped, no summoning sickness unless haste)
        if ((creature as any).tapped) {
          socket.emit("error", {
            code: "CREATURE_TAPPED",
            message: `${(creature as any).card?.name || "Creature"} is tapped and cannot attack`,
          });
          return;
        }

        // Check defender keyword
        const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
        if (oracleText.includes("defender")) {
          socket.emit("error", {
            code: "HAS_DEFENDER",
            message: `${(creature as any).card?.name || "Creature"} has defender and cannot attack`,
          });
          return;
        }

        // Check summoning sickness
        if ((creature as any).summoningSickness) {
          // Use comprehensive haste check that includes equipment (Lightning Greaves, etc.)
          const hasHaste = creatureHasHaste(creature, battlefield, playerId);
          if (!hasHaste) {
            socket.emit("error", {
              code: "SUMMONING_SICKNESS",
              message: `${(creature as any).card?.name || "Creature"} has summoning sickness`,
            });
            return;
          }
        }

        attackerIds.push(attacker.creatureId);
        
        // Mark creature as attacking
        (creature as any).attacking = attacker.targetPlayerId;
        
        // Tap the attacker (unless it has vigilance)
        const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }

      // Process tap triggers for creatures that became tapped from attacking
      processTapTriggersForAttackers(io, game, gameId, attackers, battlefield, playerId);

      // Update combat state
      game.state.combat = {
        ...game.state.combat!,
        phase: 'declareAttackers',
        attackers: attackers.map(a => ({
          permanentId: a.creatureId,
          defending: a.targetPlayerId,
          blockedBy: [],
        })),
      };

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareControlledAttackers", {
          playerId,
          attackers,
          combatControl: combatControl.sourceName,
        });
      } catch (e) {
        debugWarn(1, "[combat] Failed to persist declareControlledAttackers event:", e);
      }

      // Broadcast chat message
      const creatureControllers = new Set(
        attackers.map(a => {
          const creature = battlefield.find((p: any) => p.id === a.creatureId);
          return (creature as any)?.controller;
        }).filter(Boolean)
      );
      
      const controllerNames = Array.from(creatureControllers).map(c => getPlayerName(game, c as string));
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎯 ${combatControl.sourceName}: ${getPlayerName(game, playerId)} declares ${attackers.length} attacker${attackers.length !== 1 ? "s" : ""} (controlled: ${controllerNames.join(", ")}).`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Emit combat state update
      io.to(gameId).emit("combatStateUpdated", {
        gameId,
        phase: "declareAttackers",
        attackers: attackers.map(a => ({
          permanentId: a.creatureId,
          defending: a.targetPlayerId,
        })),
        combatControl,
      });

      debug(2, `[combat] Player ${playerId} declared ${attackers.length} controlled attackers in game ${gameId}`);
      
    } catch (err: any) {
      debugError(1, `[combat] declareControlledAttackers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CONTROLLED_ATTACKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Declare blockers under combat control
   * Used when a player controls combat via Odric or similar effects
   * 
   * Payload:
   * - gameId: string
   * - blockers: Array<{ blockerId: string; attackerId: string }>
   */
  socket.on("declareControlledBlockers", async ({
    gameId,
    blockers,
  }: {
    gameId: string;
    blockers: Array<{
      blockerId: string;
      attackerId: string;
    }>;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "CONTROLLED_BLOCKERS_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Verify player has combat control
      const combatControl = getCombatControl(game);
      if (!combatControl || combatControl.controllerId !== playerId) {
        socket.emit("error", {
          code: "NO_COMBAT_CONTROL",
          message: "You don't have combat control",
        });
        return;
      }

      if (!combatControl.controlsBlockers) {
        socket.emit("error", {
          code: "NO_BLOCKER_CONTROL",
          message: "You don't control blocker declarations",
        });
        return;
      }

      const battlefield = game.state?.battlefield || [];
      
      // Validate each blocker
      for (const blocker of blockers) {
        const blockerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.blockerId
        );
        
        if (!blockerCreature) {
          socket.emit("error", {
            code: "INVALID_BLOCKER",
            message: `Creature ${blocker.blockerId} not found`,
          });
          return;
        }

        // Check if permanent is a creature (includes devotion check for Gods)
        if (!isCurrentlyCreature(blockerCreature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(blockerCreature as any).card?.name || "This permanent"} is not a creature`,
          });
          return;
        }

        // Check if blocker is tapped
        if ((blockerCreature as any).tapped) {
          socket.emit("error", {
            code: "BLOCKER_TAPPED",
            message: `${(blockerCreature as any).card?.name || "Creature"} is tapped and cannot block`,
          });
          return;
        }

        // Find the attacker being blocked
        const attackerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.attackerId && 
          (perm as any).attacking
        );
        
        if (!attackerCreature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Attacker ${blocker.attackerId} not found or is not attacking`,
          });
          return;
        }

        // Check evasion abilities (flying, shadow, horsemanship)
        const attackerText = ((attackerCreature as any).card?.oracle_text || "").toLowerCase();
        const blockerText = ((blockerCreature as any).card?.oracle_text || "").toLowerCase();
        
        // Flying
        if (attackerText.includes("flying") || 
            ((attackerCreature as any).card?.keywords || []).some((k: string) => k.toLowerCase() === 'flying')) {
          const hasFlying = blockerText.includes("flying") || 
            ((blockerCreature as any).card?.keywords || []).some((k: string) => k.toLowerCase() === 'flying');
          const hasReach = blockerText.includes("reach") ||
            ((blockerCreature as any).card?.keywords || []).some((k: string) => k.toLowerCase() === 'reach');
          if (!hasFlying && !hasReach) {
            socket.emit("error", {
              code: "CANT_BLOCK_FLYING",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (flying)`,
            });
            return;
          }
        }
        
        // Shadow
        if (attackerText.includes("shadow")) {
          if (!blockerText.includes("shadow")) {
            socket.emit("error", {
              code: "CANT_BLOCK_SHADOW",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (shadow)`,
            });
            return;
          }
        }
        
        // Horsemanship
        if (attackerText.includes("horsemanship")) {
          if (!blockerText.includes("horsemanship")) {
            socket.emit("error", {
              code: "CANT_BLOCK_HORSEMANSHIP",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (horsemanship)`,
            });
            return;
          }
        }

        // Mark the blocker as blocking
        (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
        (blockerCreature as any).blocking.push(blocker.attackerId);

        // Mark the attacker as being blocked
        (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
        (attackerCreature as any).blockedBy.push(blocker.blockerId);
      }

      // Update combat state
      const existingAttackers = game.state.combat?.attackers || [];
      const updatedAttackers = existingAttackers.map((a: any) => {
        const blockersForAttacker = blockers.filter(b => b.attackerId === a.permanentId);
        return {
          ...a,
          blockedBy: blockersForAttacker.map(b => b.blockerId),
        };
      });

      game.state.combat = {
        ...game.state.combat!,
        phase: 'declareBlockers',
        attackers: updatedAttackers,
        blockers: blockers.map(b => ({
          permanentId: b.blockerId,
          blocking: [b.attackerId],
        })),
      };

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareControlledBlockers", {
          playerId,
          blockers,
          combatControl: combatControl.sourceName,
        });
      } catch (e) {
        debugWarn(1, "[combat] Failed to persist declareControlledBlockers event:", e);
      }

      // Broadcast chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎯 ${combatControl.sourceName}: ${getPlayerName(game, playerId)} declares ${blockers.length} blocker${blockers.length !== 1 ? "s" : ""}.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Emit combat state update
      io.to(gameId).emit("combatStateUpdated", {
        gameId,
        phase: "declareBlockers",
        blockers: blockers.map(b => ({
          blockerId: b.blockerId,
          attackerId: b.attackerId,
        })),
        combatControl,
      });

      debug(2, `[combat] Player ${playerId} declared ${blockers.length} controlled blockers in game ${gameId}`);
      
    } catch (err: any) {
      debugError(1, `[combat] declareControlledBlockers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CONTROLLED_BLOCKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Clear combat control effect
   * Called when combat ends or the control effect expires
   */
  socket.on("clearCombatControl", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      
      if (!game) {
        return;
      }

      if (game.state.combat && getCombatControl(game)) {
        delete (game.state.combat as any).combatControl;
      }

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      debugError(1, `[combat] clearCombatControl error:`, err);
    }
  });
}

