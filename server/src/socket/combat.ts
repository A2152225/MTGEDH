/**
 * server/src/socket/combat.ts
 * 
 * Combat phase socket handlers for declaring attackers and blockers.
 * Handles the declare attackers and declare blockers steps of combat.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer, getEffectivePower, getEffectiveToughness } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { getAttackTriggersForCreatures, type TriggeredAbility } from "../state/modules/triggered-abilities.js";

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
 * 
 * Note: This does NOT handle "can't attack" effects like Defang or Pacifism,
 * which are checked separately in the attack validation.
 * 
 * NOTE: This function is intentionally duplicated from rules-engine/src/actions/combat.ts
 * to avoid circular dependencies. Keep both versions in sync when making changes.
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent is currently a creature
 */
function isCurrentlyCreature(permanent: any): boolean {
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
      
      // Calculate devotion from permanents in the same context
      // If we have access to battlefield through permanent.battlefield or similar
      const playerPerms = permanent.controllerBattlefield || [];
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
      const grantPattern = new RegExp(`creatures?\\s+(?:you\\s+control\\s+)?have\\s+${lowerAbility}`, 'i');
      if (grantPattern.test(permOracle) && permController === controllerId) {
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
        if (!isCurrentlyCreature(creature)) {
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
          const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
          const hasVigilance = oracleText.includes("vigilance");
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
          // More robust haste detection using keyword ability patterns
          const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
          const rawKeywords = (creature as any).card?.keywords;
          const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
          const rawGrantedAbilities = (creature as any).grantedAbilities;
          const grantedAbilities = Array.isArray(rawGrantedAbilities) ? rawGrantedAbilities : [];
          
          // Check for haste in multiple places:
          // 1. Keywords array from Scryfall data
          // 2. Granted abilities from effects
          // 3. Oracle text (with more specific matching to avoid false positives)
          const hasHaste = 
            keywords.some((k: string) => k.toLowerCase() === 'haste') ||
            grantedAbilities.some((a: string) => a.toLowerCase() === 'haste') ||
            // Match "haste" as a standalone word or at beginning of ability text
            /\bhaste\b/i.test(oracleText);
          
          if (!hasHaste) {
            socket.emit("error", {
              code: "SUMMONING_SICKNESS",
              message: `${(creature as any).card?.name || "Creature"} has summoning sickness and cannot attack`,
            });
            return;
          }
        }

        attackerIds.push(attacker.creatureId);
        
        // Mark creature as attacking
        (creature as any).attacking = attacker.targetPlayerId || attacker.targetPermanentId;
        
        // Tap the attacker (unless it has vigilance)
        const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
        const rawKeywords = (creature as any).card?.keywords;
        const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
        const hasVigilance = 
          keywords.some((k: string) => k.toLowerCase() === 'vigilance') ||
          /\bvigilance\b/i.test(oracleText);
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }

      // Use game's declareAttackers method if available
      if (typeof (game as any).declareAttackers === "function") {
        try {
          (game as any).declareAttackers(playerId, attackerIds);
        } catch (e) {
          console.warn("[combat] game.declareAttackers failed:", e);
        }
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareAttackers", {
          playerId,
          attackers,
        });
      } catch (e) {
        console.warn("[combat] Failed to persist declareAttackers event:", e);
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
            console.log(`[combat] Found ${triggers.length} attack trigger(s) for game ${gameId}`);
            
            for (const trigger of triggers) {
              // Push trigger onto the stack
              game.state.stack = game.state.stack || [];
              const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              game.state.stack.push({
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: trigger.permanentId,
                sourceName: trigger.cardName,
                description: trigger.description,
                triggerType: trigger.triggerType,
                value: trigger.value,
                mandatory: trigger.mandatory,
              });
              
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
      } catch (triggerErr) {
        console.warn("[combat] Error processing attack triggers:", triggerErr);
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

      console.log(`[combat] Player ${playerId} declared ${attackerCount} attackers in game ${gameId}`);

      // NOTE: Do NOT auto-advance the step here!
      // Per MTG rules, after attackers are declared, all players get priority
      // to cast instants and activate abilities before moving to declare blockers.
      // The step will advance when all players pass priority in succession.
      // The client should emit "passPriority" or "nextStep" when ready to proceed.
      
    } catch (err: any) {
      console.error(`[combat] declareAttackers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "DECLARE_ATTACKERS_ERROR",
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
        if (!isCurrentlyCreature(blockerCreature)) {
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
          console.warn("[combat] game.declareBlockers failed:", e);
        }
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareBlockers", {
          playerId,
          blockers,
        });
      } catch (e) {
        console.warn("[combat] Failed to persist declareBlockers event:", e);
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

      console.log(`[combat] Player ${playerId} declared ${blockerCount} blockers in game ${gameId}`);

      // NOTE: Do NOT auto-advance the step here!
      // Per MTG rules, after blockers are declared, all players get priority
      // to cast instants and activate abilities before combat damage.
      // The step will advance when all players pass priority in succession.
      // The client should emit "passPriority" or "nextStep" when ready to proceed.
      
    } catch (err: any) {
      console.error(`[combat] declareBlockers error for game ${gameId}:`, err);
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
      console.error(`[combat] skipDeclareAttackers error:`, err);
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

      // Advance to damage step
      if (typeof (game as any).nextStep === "function") {
        await (game as any).nextStep();
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
      
    } catch (err: any) {
      console.error(`[combat] skipDeclareBlockers error:`, err);
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

      console.log(`[combat] Player ${playerId} gained combat control via ${sourceName} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[combat] applyCombatControl error for game ${gameId}:`, err);
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

        // Check if permanent is a creature
        if (!isCurrentlyCreature(creature)) {
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
          const hasHaste = oracleText.includes("haste");
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
        const rawKeywords = (creature as any).card?.keywords;
        const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
        const hasVigilance = 
          keywords.some((k: string) => k.toLowerCase() === 'vigilance') ||
          /\bvigilance\b/i.test(oracleText);
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }

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
        console.warn("[combat] Failed to persist declareControlledAttackers event:", e);
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

      console.log(`[combat] Player ${playerId} declared ${attackers.length} controlled attackers in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[combat] declareControlledAttackers error for game ${gameId}:`, err);
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

        // Check if permanent is a creature
        if (!isCurrentlyCreature(blockerCreature)) {
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
        console.warn("[combat] Failed to persist declareControlledBlockers event:", e);
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

      console.log(`[combat] Player ${playerId} declared ${blockers.length} controlled blockers in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[combat] declareControlledBlockers error for game ${gameId}:`, err);
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
      console.error(`[combat] clearCombatControl error:`, err);
    }
  });
}
