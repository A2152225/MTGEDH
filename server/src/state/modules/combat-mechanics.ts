/**
 * combat-mechanics.ts
 * 
 * Comprehensive combat system for Magic: The Gathering
 * 
 * COMBAT PHASES:
 * 1. Beginning of Combat
 * 2. Declare Attackers
 * 3. Declare Blockers
 * 4. First Strike Damage (if applicable)
 * 5. Combat Damage
 * 6. End of Combat
 * 
 * EVASION ABILITIES:
 * - Flying: Can only be blocked by creatures with flying or reach
 * - Shadow: Can only be blocked by creatures with shadow
 * - Horsemanship: Can only be blocked by creatures with horsemanship
 * - Fear: Can only be blocked by artifact or black creatures
 * - Intimidate: Can only be blocked by artifact or same color creatures
 * - Menace: Must be blocked by 2+ creatures
 * - Skulk: Can't be blocked by creatures with greater power
 * - Unblockable: Can't be blocked
 * 
 * COMBAT KEYWORDS:
 * - First Strike: Deals damage before regular combat damage
 * - Double Strike: Deals both first strike and regular damage
 * - Lifelink: Controller gains life equal to damage dealt
 * - Deathtouch: Any damage is lethal
 * - Trample: Excess damage goes to defending player/planeswalker
 * - Vigilance: Doesn't tap when attacking
 * - Indestructible: Can't be destroyed by damage
 * 
 * PROTECTION:
 * - Protection from X: Can't be blocked, targeted, dealt damage, or enchanted by X
 * - Teferi's Protection: Phase out, life total can't change, protection from everything
 * - Hexproof: Can't be targeted by opponents
 * - Shroud: Can't be targeted by anyone
 * 
 * PHASING:
 * - Phased out permanents are treated as though they don't exist
 * - Phase in at beginning of owner's untap step
 */

import type { GameContext } from "../context.js";

export interface CombatCreature {
  permanentId: string;
  cardName: string;
  controller: string;
  power: number;
  toughness: number;
  damage: number;
  keywords: CreatureKeywords;
  protections: string[];
  colors: string[];
  types: string[];
  isToken: boolean;
  phasedOut: boolean;
}

export interface CreatureKeywords {
  flying: boolean;
  reach: boolean;
  shadow: boolean;
  horsemanship: boolean;
  fear: boolean;
  intimidate: boolean;
  menace: boolean;
  skulk: boolean;
  unblockable: boolean;
  firstStrike: boolean;
  doubleStrike: boolean;
  lifelink: boolean;
  deathtouch: boolean;
  trample: boolean;
  vigilance: boolean;
  indestructible: boolean;
  hexproof: boolean;
  shroud: boolean;
  haste: boolean;
  defender: boolean;
  cantAttack: boolean;
  cantBlock: boolean;
}

export interface BlockAssignment {
  attackerId: string;
  blockerIds: string[];
  damageAssignment: Record<string, number>; // blockerId -> damage assigned
}

export interface CombatState {
  attackers: string[]; // permanent IDs
  attackerTargets: Record<string, string>; // attackerId -> defender (player ID or planeswalker ID)
  blockers: Record<string, string[]>; // attackerId -> blockerIds
  damageAssignments: Record<string, Record<string, number>>; // attackerId -> { blockerId: damage }
  firstStrikeDamageDealt: boolean;
  combatDamageDealt: boolean;
}

/**
 * Parse creature keywords from card data
 */
export function parseCreatureKeywords(card: any, permanent?: any): CreatureKeywords {
  try {
    const oracleText = (card?.oracle_text || "").toLowerCase();
    // Defensive handling: ensure keywords is an array of strings
    const rawKeywords = card?.keywords;
    
    // Debug logging for troubleshooting multi-keyword crashes
    // Log the raw value to help diagnose issues
    console.log(`[parseCreatureKeywords] ${card?.name}: rawKeywords type=${typeof rawKeywords}, isArray=${Array.isArray(rawKeywords)}, value=`, 
      rawKeywords ? JSON.stringify(rawKeywords) : 'undefined');
    
    if (rawKeywords && !Array.isArray(rawKeywords)) {
      console.warn(`[parseCreatureKeywords] keywords is not an array for ${card?.name}: type=${typeof rawKeywords}, value=`, rawKeywords);
    }
    
    const keywords = Array.isArray(rawKeywords) 
      ? rawKeywords.filter((k: any) => typeof k === 'string').map((k: string) => k.toLowerCase())
      : [];
    
    // Debug: log when there are 2+ keywords (to trace the crash issue)
    if (keywords.length >= 2) {
      console.log(`[parseCreatureKeywords] Card ${card?.name} has ${keywords.length} keywords: [${keywords.join(', ')}]`);
    }
    
    const hasKeyword = (kw: string) => 
      keywords.includes(kw.toLowerCase()) || oracleText.includes(kw.toLowerCase());
    
    const result = {
      flying: hasKeyword("flying"),
      reach: hasKeyword("reach"),
      shadow: hasKeyword("shadow"),
      horsemanship: hasKeyword("horsemanship"),
      fear: hasKeyword("fear"),
      intimidate: hasKeyword("intimidate"),
      menace: hasKeyword("menace"),
      skulk: hasKeyword("skulk"),
      unblockable: oracleText.includes("can't be blocked") || 
                    oracleText.includes("is unblockable"),
      firstStrike: hasKeyword("first strike") && !hasKeyword("double strike"),
      doubleStrike: hasKeyword("double strike"),
      lifelink: hasKeyword("lifelink"),
      deathtouch: hasKeyword("deathtouch"),
      trample: hasKeyword("trample"),
      vigilance: hasKeyword("vigilance"),
      indestructible: hasKeyword("indestructible"),
      hexproof: hasKeyword("hexproof"),
      shroud: hasKeyword("shroud"),
      haste: hasKeyword("haste"),
      defender: hasKeyword("defender"),
      cantAttack: oracleText.includes("can't attack") || hasKeyword("defender"),
      cantBlock: oracleText.includes("can't block"),
    };
    
    // Log the parsed result for multi-keyword cards
    if (keywords.length >= 2) {
      const activeKeywords = Object.entries(result).filter(([_, v]) => v === true).map(([k]) => k);
      console.log(`[parseCreatureKeywords] ${card?.name} parsed result: [${activeKeywords.join(', ')}]`);
    }
    
    return result;
  } catch (err) {
    console.error(`[parseCreatureKeywords] CRASH parsing ${card?.name}:`, err);
    console.error(`[parseCreatureKeywords] rawKeywords was:`, card?.keywords);
    console.error(`[parseCreatureKeywords] Card data:`, JSON.stringify(card, null, 2).slice(0, 1000));
    console.error(`[parseCreatureKeywords] Permanent data:`, permanent ? JSON.stringify(permanent, null, 2).slice(0, 500) : 'undefined');
    throw err; // Re-throw to let caller handle
  }
}

/**
 * Parse protection abilities from card
 */
export function parseProtections(card: any): string[] {
  const protections: string[] = [];
  const oracleText = (card?.oracle_text || "");
  
  // Protection from [color]
  const colorProtections = oracleText.match(/protection from (white|blue|black|red|green)/gi);
  if (colorProtections) {
    for (const match of colorProtections) {
      protections.push(match.toLowerCase().replace("protection from ", ""));
    }
  }
  
  // Protection from [type]
  const typeProtections = oracleText.match(/protection from (creatures|artifacts|enchantments|instants|sorceries|planeswalkers)/gi);
  if (typeProtections) {
    for (const match of typeProtections) {
      protections.push(match.toLowerCase().replace("protection from ", ""));
    }
  }
  
  // Protection from everything (Teferi's Protection, Progenitus)
  if (oracleText.toLowerCase().includes("protection from everything") ||
      oracleText.toLowerCase().includes("protection from all")) {
    protections.push("everything");
  }
  
  // Protection from colored spells
  if (oracleText.toLowerCase().includes("protection from colored")) {
    protections.push("colored");
  }
  
  // Protection from monocolored
  if (oracleText.toLowerCase().includes("protection from monocolored")) {
    protections.push("monocolored");
  }
  
  // Protection from multicolored
  if (oracleText.toLowerCase().includes("protection from multicolored")) {
    protections.push("multicolored");
  }
  
  return protections;
}

/**
 * Check if a blocker can legally block an attacker
 */
export function canBlock(
  attacker: CombatCreature,
  blocker: CombatCreature,
  existingBlockers: CombatCreature[] = []
): { legal: boolean; reason?: string } {
  // Phased out creatures can't block
  if (blocker.phasedOut) {
    return { legal: false, reason: "Phased out creatures can't block" };
  }
  
  // Can't block if has defender or "can't block"
  if (blocker.keywords.cantBlock) {
    return { legal: false, reason: "This creature can't block" };
  }
  
  // Unblockable creatures can't be blocked
  if (attacker.keywords.unblockable) {
    return { legal: false, reason: "This creature can't be blocked" };
  }
  
  // Flying - must have flying or reach
  if (attacker.keywords.flying && !blocker.keywords.flying && !blocker.keywords.reach) {
    return { legal: false, reason: "Can only block with flying or reach" };
  }
  
  // Shadow - can only be blocked by shadow
  if (attacker.keywords.shadow && !blocker.keywords.shadow) {
    return { legal: false, reason: "Can only be blocked by creatures with shadow" };
  }
  // Non-shadow can't be blocked by shadow
  if (!attacker.keywords.shadow && blocker.keywords.shadow) {
    return { legal: false, reason: "Shadow creatures can only block shadow creatures" };
  }
  
  // Horsemanship - can only be blocked by horsemanship
  if (attacker.keywords.horsemanship && !blocker.keywords.horsemanship) {
    return { legal: false, reason: "Can only be blocked by creatures with horsemanship" };
  }
  
  // Fear - can only be blocked by artifact or black creatures
  if (attacker.keywords.fear) {
    const isArtifact = blocker.types.includes("artifact");
    const isBlack = blocker.colors.includes("B") || blocker.colors.includes("black");
    if (!isArtifact && !isBlack) {
      return { legal: false, reason: "Can only be blocked by artifact or black creatures" };
    }
  }
  
  // Intimidate - can only be blocked by artifact or same color
  if (attacker.keywords.intimidate) {
    const isArtifact = blocker.types.includes("artifact");
    const sharesColor = attacker.colors.some(c => blocker.colors.includes(c));
    if (!isArtifact && !sharesColor) {
      return { legal: false, reason: "Can only be blocked by artifact or same color creatures" };
    }
  }
  
  // Skulk - can't be blocked by greater power
  if (attacker.keywords.skulk && blocker.power > attacker.power) {
    return { legal: false, reason: "Skulk: Can't be blocked by creatures with greater power" };
  }
  
  // Protection from [quality]
  for (const protection of attacker.protections) {
    if (protection === "everything") {
      return { legal: false, reason: "Protection from everything" };
    }
    if (protection === "creatures") {
      return { legal: false, reason: "Protection from creatures" };
    }
    // Color protection
    const colorMap: Record<string, string> = {
      white: "W", blue: "U", black: "B", red: "R", green: "G"
    };
    if (colorMap[protection] && blocker.colors.includes(colorMap[protection])) {
      return { legal: false, reason: `Protection from ${protection}` };
    }
  }
  
  // Menace - must be blocked by 2+ creatures
  if (attacker.keywords.menace) {
    const totalBlockers = existingBlockers.length + 1;
    if (totalBlockers < 2) {
      return { legal: true, reason: "Menace: Need 2+ blockers (current: " + totalBlockers + ")" };
    }
  }
  
  return { legal: true };
}

/**
 * Check if a creature can attack
 */
export function canAttack(
  creature: CombatCreature,
  hasHaste: boolean = false,
  summoned: boolean = false
): { legal: boolean; reason?: string } {
  // Phased out creatures can't attack
  if (creature.phasedOut) {
    return { legal: false, reason: "Phased out creatures can't attack" };
  }
  
  // Defender can't attack
  if (creature.keywords.defender || creature.keywords.cantAttack) {
    return { legal: false, reason: "This creature can't attack" };
  }
  
  // Summoning sickness (unless haste)
  if (summoned && !creature.keywords.haste && !hasHaste) {
    return { legal: false, reason: "Summoning sickness" };
  }
  
  return { legal: true };
}

/**
 * Calculate combat damage for first strike / double strike phase
 */
export function calculateFirstStrikeDamage(
  attackers: CombatCreature[],
  blockers: Record<string, CombatCreature[]>,
  damageAssignments: Record<string, Record<string, number>>
): { 
  damageToDefender: Record<string, number>;
  damageToCreatures: Record<string, number>;
  lifeGain: Record<string, number>;
  deaths: string[];
} {
  const result = {
    damageToDefender: {} as Record<string, number>,
    damageToCreatures: {} as Record<string, number>,
    lifeGain: {} as Record<string, number>,
    deaths: [] as string[],
  };
  
  for (const attacker of attackers) {
    // Only first strike and double strike creatures deal damage in this phase
    if (!attacker.keywords.firstStrike && !attacker.keywords.doubleStrike) continue;
    
    const attackerBlockers = blockers[attacker.permanentId] || [];
    
    if (attackerBlockers.length === 0) {
      // Unblocked - damage goes to defender
      // (handled separately based on attack target)
    } else {
      // Blocked - assign damage to blockers
      const assignments = damageAssignments[attacker.permanentId] || {};
      let remainingPower = attacker.power;
      
      for (const blocker of attackerBlockers) {
        const assigned = assignments[blocker.permanentId] || 0;
        result.damageToCreatures[blocker.permanentId] = 
          (result.damageToCreatures[blocker.permanentId] || 0) + assigned;
        remainingPower -= assigned;
        
        // Deathtouch kills with any damage (unless blocker is indestructible)
        if (attacker.keywords.deathtouch && assigned > 0) {
          if (!blocker.keywords.indestructible) {
            result.deaths.push(blocker.permanentId);
          }
        }
        // Normal lethal damage
        else if (assigned >= blocker.toughness - blocker.damage) {
          if (!blocker.keywords.indestructible) {
            result.deaths.push(blocker.permanentId);
          }
        }
        
        // Lifelink
        if (attacker.keywords.lifelink) {
          result.lifeGain[attacker.controller] = 
            (result.lifeGain[attacker.controller] || 0) + assigned;
        }
      }
      
      // Trample - excess goes to defender
      if (attacker.keywords.trample && remainingPower > 0) {
        result.damageToDefender[attacker.controller] = 
          (result.damageToDefender[attacker.controller] || 0) + remainingPower;
      }
    }
    
    // Blockers deal damage back to attacker (if they have first/double strike)
    for (const blocker of attackerBlockers) {
      if (blocker.keywords.firstStrike || blocker.keywords.doubleStrike) {
        result.damageToCreatures[attacker.permanentId] = 
          (result.damageToCreatures[attacker.permanentId] || 0) + blocker.power;
        
        if (blocker.keywords.deathtouch) {
          if (!attacker.keywords.indestructible) {
            result.deaths.push(attacker.permanentId);
          }
        }
        
        if (blocker.keywords.lifelink) {
          result.lifeGain[blocker.controller] = 
            (result.lifeGain[blocker.controller] || 0) + blocker.power;
        }
      }
    }
  }
  
  return result;
}

/**
 * Phase out a permanent
 */
export function phaseOut(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && !permanent.phasedOut) {
    permanent.phasedOut = true;
    permanent.phaseOutController = permanent.controller;
    ctx.bumpSeq();
    return true;
  }
  return false;
}

/**
 * Phase in a permanent
 */
export function phaseIn(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && permanent.phasedOut) {
    permanent.phasedOut = false;
    delete permanent.phaseOutController;
    ctx.bumpSeq();
    return true;
  }
  return false;
}

/**
 * Phase in all permanents for a player (at beginning of untap step)
 */
export function phaseInAllForPlayer(ctx: GameContext, playerId: string): string[] {
  const battlefield = ctx.state?.battlefield || [];
  const phasedIn: string[] = [];
  
  for (const permanent of battlefield) {
    if (permanent?.phasedOut && permanent?.phaseOutController === playerId) {
      permanent.phasedOut = false;
      delete permanent.phaseOutController;
      phasedIn.push(permanent.card?.name || permanent.id);
    }
  }
  
  if (phasedIn.length > 0) {
    ctx.bumpSeq();
  }
  
  return phasedIn;
}

/**
 * Apply Teferi's Protection effect
 * - Your life total can't change
 * - You have protection from everything
 * - All permanents you control phase out
 */
export function applyTeferisProtection(ctx: GameContext, playerId: string): {
  phasedOut: string[];
  protectionApplied: boolean;
} {
  const battlefield = ctx.state?.battlefield || [];
  const phasedOut: string[] = [];
  
  // Phase out all permanents controlled by player
  for (const permanent of battlefield) {
    if (permanent?.controller === playerId && !permanent.phasedOut) {
      permanent.phasedOut = true;
      permanent.phaseOutController = playerId;
      permanent.teferisProtection = true; // Mark for special handling
      phasedOut.push(permanent.card?.name || permanent.id);
    }
  }
  
  // Set player protection flag (life can't change, protection from everything)
  ctx.state.playerProtection = ctx.state.playerProtection || {};
  ctx.state.playerProtection[playerId] = {
    teferisProtection: true,
    lifeCannotChange: true,
    protectionFromEverything: true,
    expiresAtCleanup: true, // Expires at next cleanup step
  };
  
  if (phasedOut.length > 0) {
    ctx.bumpSeq();
  }
  
  return { phasedOut, protectionApplied: true };
}

/**
 * Check if player has protection from life changes
 */
export function playerLifeCanChange(ctx: GameContext, playerId: string): boolean {
  const protection = ctx.state?.playerProtection?.[playerId];
  return !protection?.lifeCannotChange;
}

/**
 * Check if player has protection from everything
 */
export function playerHasProtectionFromEverything(ctx: GameContext, playerId: string): boolean {
  const protection = ctx.state?.playerProtection?.[playerId];
  return !!protection?.protectionFromEverything;
}

/**
 * Clear expired protections (at cleanup step)
 */
export function clearExpiredProtections(ctx: GameContext): void {
  if (!ctx.state.playerProtection) return;
  
  for (const playerId of Object.keys(ctx.state.playerProtection)) {
    const protection = ctx.state.playerProtection[playerId];
    if (protection?.expiresAtCleanup) {
      delete ctx.state.playerProtection[playerId];
      
      // Phase in permanents that were phased out by Teferi's Protection
      const battlefield = ctx.state?.battlefield || [];
      for (const permanent of battlefield) {
        if (permanent?.phaseOutController === playerId && permanent?.teferisProtection) {
          permanent.phasedOut = false;
          delete permanent.phaseOutController;
          delete permanent.teferisProtection;
        }
      }
    }
  }
  
  ctx.bumpSeq();
}

/**
 * Check if damage would be prevented by protection
 */
export function wouldDamageBePreventedByProtection(
  source: { colors: string[]; types: string[]; isSpell?: boolean },
  target: { protections: string[] }
): boolean {
  for (const protection of target.protections) {
    if (protection === "everything") return true;
    
    // Color protection
    const colorMap: Record<string, string> = {
      white: "W", blue: "U", black: "B", red: "R", green: "G"
    };
    if (colorMap[protection] && source.colors.includes(colorMap[protection])) {
      return true;
    }
    
    // Type protection
    if (source.types.some(t => t.toLowerCase() === protection)) {
      return true;
    }
    
    // Colored spells
    if (protection === "colored" && source.colors.length > 0) {
      return true;
    }
  }
  
  return false;
}
