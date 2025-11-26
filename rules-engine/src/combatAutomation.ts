/**
 * combatAutomation.ts
 * 
 * Comprehensive combat automation system handling:
 * - First strike / Double strike damage ordering
 * - Deathtouch lethal damage calculation
 * - Trample excess damage
 * - Menace blocking requirements
 * - Lifelink life gain
 * - Combat triggers (attack/block/damage)
 * 
 * Rules Reference:
 * - Rule 508: Declare Attackers Step
 * - Rule 509: Declare Blockers Step
 * - Rule 510: Combat Damage Step
 * - Rule 702: Keyword Abilities
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Combat keyword abilities
 */
export interface CombatKeywords {
  readonly flying: boolean;
  readonly reach: boolean;
  readonly firstStrike: boolean;
  readonly doubleStrike: boolean;
  readonly deathtouch: boolean;
  readonly trample: boolean;
  readonly lifelink: boolean;
  readonly menace: boolean;
  readonly vigilance: boolean;
  readonly haste: boolean;
  readonly indestructible: boolean;
  readonly defender: boolean;
  readonly shadow: boolean;
  readonly horsemanship: boolean;
  readonly skulk: boolean;
  readonly fear: boolean;
  readonly intimidate: boolean;
  readonly protectionColors: readonly string[];
}

/**
 * Combat participant with computed stats
 */
export interface CombatCreature {
  readonly id: string;
  readonly name: string;
  readonly controllerId: PlayerID;
  readonly power: number;
  readonly toughness: number;
  readonly damage: number;
  readonly keywords: CombatKeywords;
  readonly permanent: BattlefieldPermanent;
}

/**
 * Attack declaration
 */
export interface AttackDeclaration {
  readonly attackerId: string;
  readonly defendingPlayerId: PlayerID;
  readonly attackingPlaneswalker?: string; // ID of planeswalker being attacked
}

/**
 * Block declaration
 */
export interface BlockDeclaration {
  readonly blockerId: string;
  readonly attackerId: string;
  readonly damageOrder: number; // Order for damage assignment
}

/**
 * Combat damage assignment
 */
export interface DamageAssignment {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId: string;
  readonly targetType: 'creature' | 'player' | 'planeswalker';
  readonly amount: number;
  readonly isFirstStrike: boolean;
  readonly hasDeathtouch: boolean;
  readonly hasLifelink: boolean;
  readonly isTrampleDamage: boolean;
}

/**
 * Combat result
 */
export interface CombatResult {
  readonly damageAssignments: readonly DamageAssignment[];
  readonly creaturesKilled: readonly string[];
  readonly lifeGained: Record<PlayerID, number>;
  readonly lifeTotal: Record<PlayerID, number>;
  readonly triggers: readonly CombatTrigger[];
  readonly log: readonly string[];
}

/**
 * Combat-related triggers
 */
export interface CombatTrigger {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly triggerType: 'attack' | 'block' | 'damage_dealt' | 'damage_received' | 'dies';
  readonly effect: string;
  readonly requiresChoice: boolean;
  readonly targetInfo?: { id: string; type: string }[];
}

/**
 * Blocking validation result
 */
export interface BlockValidation {
  readonly legal: boolean;
  readonly reason?: string;
  readonly requiredBlockers?: number; // For menace
}

/**
 * Extract combat keywords from a permanent
 */
export function extractCombatKeywords(perm: BattlefieldPermanent): CombatKeywords {
  const card = perm.card as KnownCardRef;
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const typeLine = (card?.type_line || '').toLowerCase();
  
  // Check oracle text and granted abilities
  const grantedAbilities = (perm.grantedAbilities || [])
    .map(a => (typeof a === 'string' ? a : (a as any).name || '')).join(' ').toLowerCase();
  const allText = oracleText + ' ' + grantedAbilities;
  
  // Check for protection
  const protectionColors: string[] = [];
  if (allText.includes('protection from white')) protectionColors.push('W');
  if (allText.includes('protection from blue')) protectionColors.push('U');
  if (allText.includes('protection from black')) protectionColors.push('B');
  if (allText.includes('protection from red')) protectionColors.push('R');
  if (allText.includes('protection from green')) protectionColors.push('G');
  
  return {
    flying: allText.includes('flying'),
    reach: allText.includes('reach'),
    firstStrike: allText.includes('first strike') && !allText.includes('double strike'),
    doubleStrike: allText.includes('double strike'),
    deathtouch: allText.includes('deathtouch'),
    trample: allText.includes('trample'),
    lifelink: allText.includes('lifelink'),
    menace: allText.includes('menace'),
    vigilance: allText.includes('vigilance'),
    haste: allText.includes('haste'),
    indestructible: allText.includes('indestructible'),
    defender: allText.includes('defender'),
    shadow: allText.includes('shadow'),
    horsemanship: allText.includes('horsemanship'),
    skulk: allText.includes('skulk'),
    fear: allText.includes('fear'),
    intimidate: allText.includes('intimidate'),
    protectionColors,
  };
}

/**
 * Get creature's current power (with counters and modifiers)
 */
export function getCreaturePower(perm: BattlefieldPermanent): number {
  const card = perm.card as KnownCardRef;
  let power = perm.basePower ?? (parseInt(card?.power || '0', 10) || 0);
  
  // Add +1/+1 counters
  power += (perm.counters?.['+1/+1'] || 0);
  // Subtract -1/-1 counters
  power -= (perm.counters?.['-1/-1'] || 0);
  
  // Apply modifiers
  if (perm.modifiers) {
    for (const mod of perm.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        power += (mod as any).power || 0;
      }
    }
  }
  
  return Math.max(0, power);
}

/**
 * Get creature's current toughness (with counters and modifiers)
 */
export function getCreatureToughness(perm: BattlefieldPermanent): number {
  const card = perm.card as KnownCardRef;
  let toughness = perm.baseToughness ?? (parseInt(card?.toughness || '0', 10) || 0);
  
  // Add +1/+1 counters
  toughness += (perm.counters?.['+1/+1'] || 0);
  // Subtract -1/-1 counters
  toughness -= (perm.counters?.['-1/-1'] || 0);
  
  // Apply modifiers
  if (perm.modifiers) {
    for (const mod of perm.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        toughness += (mod as any).toughness || 0;
      }
    }
  }
  
  return Math.max(0, toughness);
}

/**
 * Create a CombatCreature from a permanent
 */
export function createCombatCreature(perm: BattlefieldPermanent): CombatCreature {
  const card = perm.card as KnownCardRef;
  return {
    id: perm.id,
    name: card?.name || 'Creature',
    controllerId: perm.controller,
    power: getCreaturePower(perm),
    toughness: getCreatureToughness(perm),
    damage: perm.counters?.damage || 0,
    keywords: extractCombatKeywords(perm),
    permanent: perm,
  };
}

/**
 * Check if a creature can attack
 */
export function canCreatureAttack(
  creature: CombatCreature,
  isControllersTurn: boolean,
  hasControlledSinceTurnStart: boolean
): { canAttack: boolean; reason?: string } {
  // Defender can't attack
  if (creature.keywords.defender) {
    return { canAttack: false, reason: `${creature.name} has defender and can't attack` };
  }
  
  // Tapped creatures can't attack
  if (creature.permanent.tapped) {
    return { canAttack: false, reason: `${creature.name} is tapped` };
  }
  
  // Summoning sickness (unless has haste)
  if (creature.permanent.summoningSickness && !creature.keywords.haste && !hasControlledSinceTurnStart) {
    return { canAttack: false, reason: `${creature.name} has summoning sickness` };
  }
  
  return { canAttack: true };
}

/**
 * Check if a blocker can legally block an attacker
 * Handles flying, shadow, horsemanship, menace, etc.
 */
export function canCreatureBlock(
  blocker: CombatCreature,
  attacker: CombatCreature,
  existingBlockersOnAttacker: readonly CombatCreature[]
): BlockValidation {
  // Tapped creatures can't block
  if (blocker.permanent.tapped) {
    return { legal: false, reason: `${blocker.name} is tapped` };
  }
  
  // Flying: can only be blocked by flying or reach
  if (attacker.keywords.flying) {
    if (!blocker.keywords.flying && !blocker.keywords.reach) {
      return { legal: false, reason: `${blocker.name} can't block ${attacker.name} (flying)` };
    }
  }
  
  // Shadow: can only be blocked by shadow
  if (attacker.keywords.shadow) {
    if (!blocker.keywords.shadow) {
      return { legal: false, reason: `${blocker.name} can't block ${attacker.name} (shadow)` };
    }
  }
  
  // Horsemanship: can only be blocked by horsemanship
  if (attacker.keywords.horsemanship) {
    if (!blocker.keywords.horsemanship) {
      return { legal: false, reason: `${blocker.name} can't block ${attacker.name} (horsemanship)` };
    }
  }
  
  // Fear: can only be blocked by artifact creatures or black creatures
  if (attacker.keywords.fear) {
    const card = blocker.permanent.card as KnownCardRef;
    const isArtifact = card?.type_line?.toLowerCase().includes('artifact');
    const isBlack = card?.colors?.includes('B');
    if (!isArtifact && !isBlack) {
      return { legal: false, reason: `${blocker.name} can't block ${attacker.name} (fear)` };
    }
  }
  
  // Intimidate: can only be blocked by artifact creatures or creatures that share a color
  if (attacker.keywords.intimidate) {
    const blockerCard = blocker.permanent.card as KnownCardRef;
    const attackerCard = attacker.permanent.card as KnownCardRef;
    const isArtifact = blockerCard?.type_line?.toLowerCase().includes('artifact');
    const sharesColor = (attackerCard?.colors || []).some(c => 
      (blockerCard?.colors || []).includes(c)
    );
    if (!isArtifact && !sharesColor) {
      return { legal: false, reason: `${blocker.name} can't block ${attacker.name} (intimidate)` };
    }
  }
  
  // Skulk: can't be blocked by creatures with greater power
  if (attacker.keywords.skulk) {
    if (blocker.power > attacker.power) {
      return { legal: false, reason: `${blocker.name} can't block ${attacker.name} (skulk)` };
    }
  }
  
  // Protection from colors
  if (attacker.keywords.protectionColors.length > 0) {
    const blockerCard = blocker.permanent.card as KnownCardRef;
    const blockerColors = blockerCard?.colors || [];
    if (blockerColors.some(c => attacker.keywords.protectionColors.includes(c))) {
      const protectedFrom = attacker.keywords.protectionColors.filter(c => blockerColors.includes(c));
      return { legal: false, reason: `${attacker.name} has protection from ${protectedFrom.join(', ')}` };
    }
  }
  
  // Menace: requires at least 2 blockers
  if (attacker.keywords.menace) {
    const totalBlockers = existingBlockersOnAttacker.length + 1;
    if (totalBlockers < 2 && existingBlockersOnAttacker.length === 0) {
      // First blocker being assigned - need UI to require a second
      return { 
        legal: true, 
        requiredBlockers: 2,
        reason: `${attacker.name} has menace (must be blocked by 2+ creatures)`
      };
    }
  }
  
  return { legal: true };
}

/**
 * Calculate lethal damage amount
 * With deathtouch, any amount > 0 is lethal
 */
export function calculateLethalDamage(
  attacker: CombatCreature,
  defender: CombatCreature
): number {
  const remainingToughness = defender.toughness - defender.damage;
  
  // Deathtouch: 1 damage is lethal
  if (attacker.keywords.deathtouch) {
    return Math.min(1, remainingToughness);
  }
  
  return remainingToughness;
}

/**
 * Calculate trample damage to player
 * After assigning lethal damage to blockers, excess goes to player
 */
export function calculateTrampleDamage(
  attacker: CombatCreature,
  blockers: readonly CombatCreature[],
  damageToBlockers: readonly { blockerId: string; damage: number }[]
): number {
  if (!attacker.keywords.trample) return 0;
  
  let totalDamageAssigned = 0;
  for (const assignment of damageToBlockers) {
    totalDamageAssigned += assignment.damage;
  }
  
  const excessDamage = attacker.power - totalDamageAssigned;
  return Math.max(0, excessDamage);
}

/**
 * Auto-assign combat damage for an attacker
 * Returns damage assignments (may require UI confirmation for blockers)
 */
export function autoAssignCombatDamage(
  attacker: CombatCreature,
  blockers: readonly CombatCreature[],
  defendingPlayerId: PlayerID
): {
  assignments: DamageAssignment[];
  needsPlayerChoice: boolean;
  choiceInfo?: {
    type: 'blocker_order' | 'damage_split';
    blockers: readonly CombatCreature[];
  };
} {
  const assignments: DamageAssignment[] = [];
  
  // Unblocked: all damage to defending player
  if (blockers.length === 0) {
    if (attacker.power > 0) {
      assignments.push({
        sourceId: attacker.id,
        sourceName: attacker.name,
        targetId: defendingPlayerId,
        targetType: 'player',
        amount: attacker.power,
        isFirstStrike: attacker.keywords.firstStrike || attacker.keywords.doubleStrike,
        hasDeathtouch: attacker.keywords.deathtouch,
        hasLifelink: attacker.keywords.lifelink,
        isTrampleDamage: false,
      });
    }
    return { assignments, needsPlayerChoice: false };
  }
  
  // Multiple blockers: may need player to choose order
  if (blockers.length > 1) {
    return {
      assignments: [],
      needsPlayerChoice: true,
      choiceInfo: {
        type: 'blocker_order',
        blockers,
      },
    };
  }
  
  // Single blocker: assign damage automatically
  const blocker = blockers[0];
  const lethalDamage = calculateLethalDamage(attacker, blocker);
  const damageToBlocker = Math.min(attacker.power, lethalDamage);
  
  if (damageToBlocker > 0) {
    assignments.push({
      sourceId: attacker.id,
      sourceName: attacker.name,
      targetId: blocker.id,
      targetType: 'creature',
      amount: damageToBlocker,
      isFirstStrike: attacker.keywords.firstStrike || attacker.keywords.doubleStrike,
      hasDeathtouch: attacker.keywords.deathtouch,
      hasLifelink: attacker.keywords.lifelink,
      isTrampleDamage: false,
    });
  }
  
  // Trample: excess damage to player
  if (attacker.keywords.trample && attacker.power > damageToBlocker) {
    const trampleDamage = attacker.power - damageToBlocker;
    assignments.push({
      sourceId: attacker.id,
      sourceName: attacker.name,
      targetId: defendingPlayerId,
      targetType: 'player',
      amount: trampleDamage,
      isFirstStrike: attacker.keywords.firstStrike || attacker.keywords.doubleStrike,
      hasDeathtouch: attacker.keywords.deathtouch,
      hasLifelink: attacker.keywords.lifelink,
      isTrampleDamage: true,
    });
  }
  
  // Blocker damage back to attacker
  if (blocker.power > 0) {
    assignments.push({
      sourceId: blocker.id,
      sourceName: blocker.name,
      targetId: attacker.id,
      targetType: 'creature',
      amount: blocker.power,
      isFirstStrike: blocker.keywords.firstStrike || blocker.keywords.doubleStrike,
      hasDeathtouch: blocker.keywords.deathtouch,
      hasLifelink: blocker.keywords.lifelink,
      isTrampleDamage: false,
    });
  }
  
  return { assignments, needsPlayerChoice: false };
}

/**
 * Process first strike damage step
 */
export function processFirstStrikeDamage(
  allAssignments: readonly DamageAssignment[]
): DamageAssignment[] {
  return allAssignments.filter(a => a.isFirstStrike);
}

/**
 * Process regular damage step (includes double strike second hit)
 */
export function processRegularDamage(
  allAssignments: readonly DamageAssignment[]
): DamageAssignment[] {
  // Include non-first strike damage
  const regular = allAssignments.filter(a => !a.isFirstStrike);
  
  // Include double strike creatures again (they deal damage in both steps)
  // This is handled by checking the permanent's keywords in the actual combat processing
  
  return regular;
}

/**
 * Check if creature is killed by damage
 * Handles deathtouch and indestructible
 */
export function isCreatureKilled(
  creature: CombatCreature,
  newDamage: number,
  wasDealtDeathtouch: boolean
): boolean {
  // Indestructible creatures can't be destroyed by damage
  if (creature.keywords.indestructible) {
    return false;
  }
  
  const totalDamage = creature.damage + newDamage;
  
  // Deathtouch: any damage is lethal
  if (wasDealtDeathtouch && newDamage > 0) {
    return true;
  }
  
  // Lethal damage: damage >= toughness
  return totalDamage >= creature.toughness;
}

/**
 * Detect combat triggers from a permanent
 */
export function detectCombatTriggers(
  perm: BattlefieldPermanent,
  triggerType: 'attack' | 'block' | 'damage_dealt' | 'damage_received'
): CombatTrigger[] {
  const triggers: CombatTrigger[] = [];
  const card = perm.card as KnownCardRef;
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const permName = card?.name || 'Creature';
  
  // Attack triggers
  if (triggerType === 'attack') {
    // "Whenever ~ attacks"
    if (oracleText.includes('whenever') && oracleText.includes('attacks')) {
      const match = oracleText.match(/whenever .* attacks,?\s*([^.]+)/i);
      if (match) {
        triggers.push({
          sourceId: perm.id,
          sourceName: permName,
          controllerId: perm.controller,
          triggerType: 'attack',
          effect: match[1].trim(),
          requiresChoice: match[1].includes('may') || match[1].includes('target'),
        });
      }
    }
  }
  
  // Block triggers
  if (triggerType === 'block') {
    // "Whenever ~ blocks"
    if (oracleText.includes('whenever') && oracleText.includes('blocks')) {
      const match = oracleText.match(/whenever .* blocks,?\s*([^.]+)/i);
      if (match) {
        triggers.push({
          sourceId: perm.id,
          sourceName: permName,
          controllerId: perm.controller,
          triggerType: 'block',
          effect: match[1].trim(),
          requiresChoice: match[1].includes('may') || match[1].includes('target'),
        });
      }
    }
  }
  
  // Damage dealt triggers
  if (triggerType === 'damage_dealt') {
    // "Whenever ~ deals combat damage"
    if (oracleText.includes('whenever') && oracleText.includes('deals') && oracleText.includes('damage')) {
      const match = oracleText.match(/whenever .* deals (?:combat )?damage[^,]*,?\s*([^.]+)/i);
      if (match) {
        triggers.push({
          sourceId: perm.id,
          sourceName: permName,
          controllerId: perm.controller,
          triggerType: 'damage_dealt',
          effect: match[1].trim(),
          requiresChoice: match[1].includes('may') || match[1].includes('target'),
        });
      }
    }
  }
  
  return triggers;
}

/**
 * Full combat resolution
 */
export function resolveCombat(
  attackers: readonly { attacker: CombatCreature; defendingPlayerId: PlayerID }[],
  blockers: readonly { blocker: CombatCreature; attackerId: string }[],
  playerLifeTotals: Record<PlayerID, number>
): CombatResult {
  const damageAssignments: DamageAssignment[] = [];
  const creaturesKilled: string[] = [];
  const lifeGained: Record<PlayerID, number> = {};
  const triggers: CombatTrigger[] = [];
  const log: string[] = [];
  
  // Group blockers by attacker
  const blockersByAttacker: Record<string, CombatCreature[]> = {};
  for (const { blocker, attackerId } of blockers) {
    if (!blockersByAttacker[attackerId]) {
      blockersByAttacker[attackerId] = [];
    }
    blockersByAttacker[attackerId].push(blocker);
  }
  
  // Process each attacker
  for (const { attacker, defendingPlayerId } of attackers) {
    const attackerBlockers = blockersByAttacker[attacker.id] || [];
    
    // Detect attack triggers
    const attackTriggers = detectCombatTriggers(attacker.permanent, 'attack');
    triggers.push(...attackTriggers);
    
    // Auto-assign damage
    const damageResult = autoAssignCombatDamage(attacker, attackerBlockers, defendingPlayerId);
    damageAssignments.push(...damageResult.assignments);
    
    // Process lifelink
    for (const assignment of damageResult.assignments) {
      if (assignment.hasLifelink) {
        const controllerId = attacker.controllerId;
        lifeGained[controllerId] = (lifeGained[controllerId] || 0) + assignment.amount;
        log.push(`${attacker.name} gains ${assignment.amount} life (lifelink)`);
      }
    }
    
    // Check for creature deaths
    for (const assignment of damageResult.assignments) {
      if (assignment.targetType === 'creature') {
        const targetCreature = attackerBlockers.find(b => b.id === assignment.targetId) || 
          (attacker.id === assignment.targetId ? attacker : null);
        
        if (targetCreature && isCreatureKilled(targetCreature, assignment.amount, assignment.hasDeathtouch)) {
          creaturesKilled.push(targetCreature.id);
          log.push(`${targetCreature.name} dies in combat`);
          
          if (assignment.hasDeathtouch) {
            log.push(`  (deathtouch)`);
          }
        }
      }
    }
    
    // Log damage to player
    for (const assignment of damageResult.assignments) {
      if (assignment.targetType === 'player') {
        log.push(`${attacker.name} deals ${assignment.amount} damage to player`);
        if (assignment.isTrampleDamage) {
          log.push(`  (trample)`);
        }
      }
    }
  }
  
  // Calculate final life totals
  const lifeTotal: Record<PlayerID, number> = { ...playerLifeTotals };
  
  for (const assignment of damageAssignments) {
    if (assignment.targetType === 'player') {
      lifeTotal[assignment.targetId] = (lifeTotal[assignment.targetId] || 0) - assignment.amount;
    }
  }
  
  for (const [playerId, gained] of Object.entries(lifeGained)) {
    lifeTotal[playerId] = (lifeTotal[playerId] || 0) + gained;
  }
  
  return {
    damageAssignments,
    creaturesKilled,
    lifeGained,
    lifeTotal,
    triggers,
    log,
  };
}

export default {
  extractCombatKeywords,
  getCreaturePower,
  getCreatureToughness,
  createCombatCreature,
  canCreatureAttack,
  canCreatureBlock,
  calculateLethalDamage,
  calculateTrampleDamage,
  autoAssignCombatDamage,
  processFirstStrikeDamage,
  processRegularDamage,
  isCreatureKilled,
  detectCombatTriggers,
  resolveCombat,
};
