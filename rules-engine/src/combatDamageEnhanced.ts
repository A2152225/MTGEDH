/**
 * combatDamageEnhanced.ts
 * 
 * Enhanced combat damage automation that handles:
 * - Combat damage assignment with multiple blockers
 * - First strike / double strike timing
 * - Lifelink life gain
 * - Deathtouch lethal damage optimization
 * - Trample excess damage calculation
 * - Combat damage triggers
 * - Creature death from combat
 * 
 * Rules Reference:
 * - Rule 510: Combat Damage Step
 * - Rule 510.1: Assignment of combat damage
 * - Rule 510.1c: Lethal damage ordering
 * - Rule 702.2: Deathtouch
 * - Rule 702.4: Double strike
 * - Rule 702.7: First strike
 * - Rule 702.15: Lifelink
 * - Rule 702.19: Trample
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import { 
  extractCombatKeywords, 
  getCreaturePower, 
  getCreatureToughness,
  type CombatCreature,
  type CombatKeywords,
} from './combatAutomation';
import { TriggerEvent, type TriggerInstance, createTriggerInstance, type TriggeredAbility } from './triggeredAbilities';

/**
 * Combat damage phase (first strike or regular)
 */
export enum CombatDamagePhase {
  FIRST_STRIKE = 'first_strike',
  REGULAR = 'regular',
}

/**
 * Damage assignment to a specific target
 */
export interface DetailedDamageAssignment {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceController: PlayerID;
  readonly targetId: string;
  readonly targetType: 'creature' | 'player' | 'planeswalker' | 'battle';
  readonly targetName?: string;
  readonly amount: number;
  readonly phase: CombatDamagePhase;
  readonly properties: {
    readonly deathtouch: boolean;
    readonly lifelink: boolean;
    readonly trample: boolean;
    readonly infect: boolean;
    readonly wither: boolean;
  };
}

/**
 * Result of combat damage calculation
 */
export interface CombatDamageCalculation {
  readonly assignments: readonly DetailedDamageAssignment[];
  readonly firstStrikeAssignments: readonly DetailedDamageAssignment[];
  readonly regularAssignments: readonly DetailedDamageAssignment[];
  readonly lifeChanges: Record<PlayerID, number>;
  readonly poisonChanges: Record<PlayerID, number>;
  readonly creaturesKilled: readonly string[];
  readonly planeswalkersDamaged: readonly { id: string; damage: number }[];
  readonly triggers: readonly TriggerInstance[];
  readonly log: readonly string[];
}

/**
 * Blocker order for damage assignment
 */
export interface BlockerOrder {
  readonly attackerId: string;
  readonly blockerIds: readonly string[];
  /** Order in which damage is assigned (first blocker gets damage first) */
}

/**
 * Check if a creature has first strike or double strike
 */
export function hasFirstStrikeDamage(keywords: CombatKeywords): boolean {
  return keywords.firstStrike || keywords.doubleStrike;
}

/**
 * Check if a creature has regular damage (not just first strike)
 */
export function hasRegularDamage(keywords: CombatKeywords): boolean {
  return !keywords.firstStrike || keywords.doubleStrike;
}

/**
 * Calculate lethal damage amount for a blocker
 * Takes into account deathtouch (1 damage is lethal) and existing damage
 */
export function calculateLethalDamageForBlocker(
  attacker: BattlefieldPermanent,
  blocker: BattlefieldPermanent,
  existingDamageOnBlocker: number = 0
): number {
  const attackerKeywords = extractCombatKeywords(attacker);
  const blockerToughness = getCreatureToughness(blocker);
  const remainingToughness = blockerToughness - existingDamageOnBlocker;
  
  // Deathtouch: 1 damage is lethal
  if (attackerKeywords.deathtouch && remainingToughness > 0) {
    return 1;
  }
  
  return Math.max(0, remainingToughness);
}

/**
 * Auto-assign damage from attacker to ordered blockers
 * Uses optimal damage assignment (lethal to each blocker, excess tramples through)
 */
export function assignDamageToBlockers(
  attacker: BattlefieldPermanent,
  orderedBlockers: readonly BattlefieldPermanent[],
  damageToAssign: number,
  existingDamageOnBlockers: Record<string, number> = {},
  phase: CombatDamagePhase = CombatDamagePhase.REGULAR
): {
  assignments: DetailedDamageAssignment[];
  remainingDamage: number;
  blockersDying: string[];
} {
  const assignments: DetailedDamageAssignment[] = [];
  const blockersDying: string[] = [];
  const attackerCard = attacker.card as KnownCardRef;
  const attackerKeywords = extractCombatKeywords(attacker);
  let remaining = damageToAssign;
  
  for (const blocker of orderedBlockers) {
    if (remaining <= 0) break;
    
    const blockerCard = blocker.card as KnownCardRef;
    const existingDamage = existingDamageOnBlockers[blocker.id] || 0;
    const lethalDamage = calculateLethalDamageForBlocker(attacker, blocker, existingDamage);
    
    // Must assign at least lethal damage before moving on (or all remaining if not enough)
    const damageToBlocker = Math.min(lethalDamage, remaining);
    
    if (damageToBlocker > 0) {
      assignments.push({
        sourceId: attacker.id,
        sourceName: attackerCard?.name || 'Creature',
        sourceController: attacker.controller,
        targetId: blocker.id,
        targetType: 'creature',
        targetName: blockerCard?.name,
        amount: damageToBlocker,
        phase,
        properties: {
          deathtouch: attackerKeywords.deathtouch,
          lifelink: attackerKeywords.lifelink,
          trample: attackerKeywords.trample,
          infect: false, // TODO: Add infect detection
          wither: false, // TODO: Add wither detection
        },
      });
      
      remaining -= damageToBlocker;
      
      // Check if this kills the blocker
      const totalDamage = existingDamage + damageToBlocker;
      const blockerToughness = getCreatureToughness(blocker);
      if (totalDamage >= blockerToughness || (attackerKeywords.deathtouch && damageToBlocker > 0)) {
        blockersDying.push(blocker.id);
      }
    }
  }
  
  return { assignments, remainingDamage: remaining, blockersDying };
}

/**
 * Calculate trample damage to defending player
 */
export function calculateTrampleToPlayer(
  attacker: BattlefieldPermanent,
  blockers: readonly BattlefieldPermanent[],
  damageAssignedToBlockers: number,
  defendingPlayerId: PlayerID,
  phase: CombatDamagePhase = CombatDamagePhase.REGULAR
): DetailedDamageAssignment | null {
  const attackerKeywords = extractCombatKeywords(attacker);
  
  if (!attackerKeywords.trample) {
    return null;
  }
  
  const attackerPower = getCreaturePower(attacker);
  const excessDamage = attackerPower - damageAssignedToBlockers;
  
  if (excessDamage <= 0) {
    return null;
  }
  
  const attackerCard = attacker.card as KnownCardRef;
  
  return {
    sourceId: attacker.id,
    sourceName: attackerCard?.name || 'Creature',
    sourceController: attacker.controller,
    targetId: defendingPlayerId,
    targetType: 'player',
    amount: excessDamage,
    phase,
    properties: {
      deathtouch: attackerKeywords.deathtouch,
      lifelink: attackerKeywords.lifelink,
      trample: true,
      infect: false,
      wither: false,
    },
  };
}

/**
 * Process an unblocked attacker's damage
 */
export function processUnblockedAttacker(
  attacker: BattlefieldPermanent,
  defendingPlayerId: PlayerID,
  phase: CombatDamagePhase = CombatDamagePhase.REGULAR
): DetailedDamageAssignment | null {
  const attackerKeywords = extractCombatKeywords(attacker);
  const attackerPower = getCreaturePower(attacker);
  const attackerCard = attacker.card as KnownCardRef;
  
  // Check if this creature deals damage in this phase
  if (phase === CombatDamagePhase.FIRST_STRIKE && !hasFirstStrikeDamage(attackerKeywords)) {
    return null;
  }
  if (phase === CombatDamagePhase.REGULAR && !hasRegularDamage(attackerKeywords)) {
    return null;
  }
  
  if (attackerPower <= 0) {
    return null;
  }
  
  return {
    sourceId: attacker.id,
    sourceName: attackerCard?.name || 'Creature',
    sourceController: attacker.controller,
    targetId: defendingPlayerId,
    targetType: 'player',
    amount: attackerPower,
    phase,
    properties: {
      deathtouch: attackerKeywords.deathtouch,
      lifelink: attackerKeywords.lifelink,
      trample: attackerKeywords.trample,
      infect: false,
      wither: false,
    },
  };
}

/**
 * Process damage from blockers to attacker
 */
export function processBlockerDamageToAttacker(
  blocker: BattlefieldPermanent,
  attacker: BattlefieldPermanent,
  phase: CombatDamagePhase = CombatDamagePhase.REGULAR
): DetailedDamageAssignment | null {
  const blockerKeywords = extractCombatKeywords(blocker);
  const blockerPower = getCreaturePower(blocker);
  const blockerCard = blocker.card as KnownCardRef;
  const attackerCard = attacker.card as KnownCardRef;
  
  // Check if this creature deals damage in this phase
  if (phase === CombatDamagePhase.FIRST_STRIKE && !hasFirstStrikeDamage(blockerKeywords)) {
    return null;
  }
  if (phase === CombatDamagePhase.REGULAR && !hasRegularDamage(blockerKeywords)) {
    return null;
  }
  
  if (blockerPower <= 0) {
    return null;
  }
  
  return {
    sourceId: blocker.id,
    sourceName: blockerCard?.name || 'Creature',
    sourceController: blocker.controller,
    targetId: attacker.id,
    targetType: 'creature',
    targetName: attackerCard?.name,
    amount: blockerPower,
    phase,
    properties: {
      deathtouch: blockerKeywords.deathtouch,
      lifelink: blockerKeywords.lifelink,
      trample: false, // Blockers don't trample to players
      infect: false,
      wither: false,
    },
  };
}

/**
 * Calculate lifelink gains from damage assignments
 */
export function calculateLifelinkGains(
  assignments: readonly DetailedDamageAssignment[]
): Record<PlayerID, number> {
  const gains: Record<PlayerID, number> = {};
  
  for (const assignment of assignments) {
    if (assignment.properties.lifelink && assignment.amount > 0) {
      const controller = assignment.sourceController;
      gains[controller] = (gains[controller] || 0) + assignment.amount;
    }
  }
  
  return gains;
}

/**
 * Determine which creatures die from damage
 */
export function determineCreatureDeaths(
  assignments: readonly DetailedDamageAssignment[],
  creatureState: Record<string, { toughness: number; existingDamage: number; indestructible: boolean }>
): string[] {
  const dying: string[] = [];
  const damageByCreature: Record<string, { total: number; hasDeathtouch: boolean }> = {};
  
  // Accumulate damage to each creature
  for (const assignment of assignments) {
    if (assignment.targetType === 'creature') {
      if (!damageByCreature[assignment.targetId]) {
        damageByCreature[assignment.targetId] = { total: 0, hasDeathtouch: false };
      }
      damageByCreature[assignment.targetId].total += assignment.amount;
      if (assignment.properties.deathtouch) {
        damageByCreature[assignment.targetId].hasDeathtouch = true;
      }
    }
  }
  
  // Check for lethal damage
  for (const [creatureId, damage] of Object.entries(damageByCreature)) {
    const state = creatureState[creatureId];
    if (!state || state.indestructible) continue;
    
    const totalDamage = state.existingDamage + damage.total;
    const isLethal = totalDamage >= state.toughness || (damage.hasDeathtouch && damage.total > 0);
    
    if (isLethal) {
      dying.push(creatureId);
    }
  }
  
  return dying;
}

/**
 * Create combat damage triggers
 */
export function createCombatDamageTriggers(
  assignments: readonly DetailedDamageAssignment[],
  permanents: readonly BattlefieldPermanent[],
  timestamp: number
): TriggerInstance[] {
  const triggers: TriggerInstance[] = [];
  
  for (const assignment of assignments) {
    // Find the source permanent
    const source = permanents.find(p => p.id === assignment.sourceId);
    if (!source) continue;
    
    const card = source.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Check for damage dealt triggers
    if (assignment.targetType === 'player') {
      // "Whenever this creature deals combat damage to a player"
      if (oracleText.includes('deals combat damage to a player') || 
          oracleText.includes('deals combat damage to an opponent')) {
        const ability: TriggeredAbility = {
          id: `${source.id}-combat-damage-player`,
          sourceId: source.id,
          sourceName: card?.name || 'Creature',
          controllerId: source.controller,
          keyword: 'whenever' as any,
          event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
          effect: 'Combat damage to player trigger',
        };
        triggers.push(createTriggerInstance(ability, timestamp));
      }
    }
    
    // "Whenever this creature deals combat damage"
    if (oracleText.includes('deals combat damage') && !oracleText.includes('to a player')) {
      const ability: TriggeredAbility = {
        id: `${source.id}-combat-damage`,
        sourceId: source.id,
        sourceName: card?.name || 'Creature',
        controllerId: source.controller,
        keyword: 'whenever' as any,
        event: TriggerEvent.DEALS_COMBAT_DAMAGE,
        effect: 'Combat damage trigger',
      };
      triggers.push(createTriggerInstance(ability, timestamp));
    }
    
    // "Whenever this creature deals damage"
    if (oracleText.includes('deals damage') && !oracleText.includes('combat damage')) {
      const ability: TriggeredAbility = {
        id: `${source.id}-damage`,
        sourceId: source.id,
        sourceName: card?.name || 'Creature',
        controllerId: source.controller,
        keyword: 'whenever' as any,
        event: TriggerEvent.DEALS_DAMAGE,
        effect: 'Damage trigger',
      };
      triggers.push(createTriggerInstance(ability, timestamp));
    }
  }
  
  return triggers;
}

/**
 * Check if there are any first strikers in combat
 */
export function hasFirstStrikersInCombat(
  attackers: readonly BattlefieldPermanent[],
  blockers: readonly BattlefieldPermanent[]
): boolean {
  for (const attacker of attackers) {
    const keywords = extractCombatKeywords(attacker);
    if (hasFirstStrikeDamage(keywords)) {
      return true;
    }
  }
  
  for (const blocker of blockers) {
    const keywords = extractCombatKeywords(blocker);
    if (hasFirstStrikeDamage(keywords)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Comprehensive combat damage calculation
 */
export function calculateCombatDamage(
  attackerData: readonly { 
    attacker: BattlefieldPermanent; 
    defendingPlayerId: PlayerID; 
    orderedBlockers: readonly BattlefieldPermanent[];
  }[],
  currentLifeTotals: Record<PlayerID, number>,
  creatureState: Record<string, { toughness: number; existingDamage: number; indestructible: boolean }>,
  timestamp: number
): CombatDamageCalculation {
  const allAssignments: DetailedDamageAssignment[] = [];
  const firstStrikeAssignments: DetailedDamageAssignment[] = [];
  const regularAssignments: DetailedDamageAssignment[] = [];
  const log: string[] = [];
  
  // Collect all permanents for trigger checking
  const allPermanents: BattlefieldPermanent[] = [];
  for (const data of attackerData) {
    allPermanents.push(data.attacker);
    allPermanents.push(...data.orderedBlockers);
  }
  
  // Process each attacker
  for (const { attacker, defendingPlayerId, orderedBlockers } of attackerData) {
    const attackerCard = attacker.card as KnownCardRef;
    const attackerKeywords = extractCombatKeywords(attacker);
    
    if (orderedBlockers.length === 0) {
      // Unblocked - deal damage to player
      for (const phase of [CombatDamagePhase.FIRST_STRIKE, CombatDamagePhase.REGULAR]) {
        const assignment = processUnblockedAttacker(attacker, defendingPlayerId, phase);
        if (assignment) {
          allAssignments.push(assignment);
          if (phase === CombatDamagePhase.FIRST_STRIKE) {
            firstStrikeAssignments.push(assignment);
          } else {
            regularAssignments.push(assignment);
          }
          log.push(`${attackerCard?.name || 'Creature'} deals ${assignment.amount} damage to player (${phase})`);
        }
      }
    } else {
      // Blocked - assign damage to blockers
      for (const phase of [CombatDamagePhase.FIRST_STRIKE, CombatDamagePhase.REGULAR]) {
        // Check if attacker deals damage in this phase
        if (phase === CombatDamagePhase.FIRST_STRIKE && !hasFirstStrikeDamage(attackerKeywords)) {
          continue;
        }
        if (phase === CombatDamagePhase.REGULAR && !hasRegularDamage(attackerKeywords)) {
          continue;
        }
        
        const power = getCreaturePower(attacker);
        const { assignments, remainingDamage } = assignDamageToBlockers(
          attacker, orderedBlockers, power, {}, phase
        );
        
        allAssignments.push(...assignments);
        if (phase === CombatDamagePhase.FIRST_STRIKE) {
          firstStrikeAssignments.push(...assignments);
        } else {
          regularAssignments.push(...assignments);
        }
        
        for (const assign of assignments) {
          log.push(`${attackerCard?.name || 'Creature'} deals ${assign.amount} damage to ${assign.targetName || 'blocker'} (${phase})`);
        }
        
        // Trample damage
        if (attackerKeywords.trample && remainingDamage > 0) {
          const trampleAssign = calculateTrampleToPlayer(
            attacker, orderedBlockers, power - remainingDamage, defendingPlayerId, phase
          );
          if (trampleAssign) {
            allAssignments.push(trampleAssign);
            if (phase === CombatDamagePhase.FIRST_STRIKE) {
              firstStrikeAssignments.push(trampleAssign);
            } else {
              regularAssignments.push(trampleAssign);
            }
            log.push(`${attackerCard?.name || 'Creature'} tramples for ${trampleAssign.amount} damage to player (${phase})`);
          }
        }
      }
      
      // Blockers deal damage back
      for (const blocker of orderedBlockers) {
        for (const phase of [CombatDamagePhase.FIRST_STRIKE, CombatDamagePhase.REGULAR]) {
          const blockerAssign = processBlockerDamageToAttacker(blocker, attacker, phase);
          if (blockerAssign) {
            allAssignments.push(blockerAssign);
            if (phase === CombatDamagePhase.FIRST_STRIKE) {
              firstStrikeAssignments.push(blockerAssign);
            } else {
              regularAssignments.push(blockerAssign);
            }
            const blockerCard = blocker.card as KnownCardRef;
            log.push(`${blockerCard?.name || 'Blocker'} deals ${blockerAssign.amount} damage to ${attackerCard?.name || 'attacker'} (${phase})`);
          }
        }
      }
    }
  }
  
  // Calculate lifelink gains
  const lifelinkGains = calculateLifelinkGains(allAssignments);
  
  // Calculate life changes (damage minus lifelink)
  const lifeChanges: Record<PlayerID, number> = { ...lifelinkGains };
  for (const assignment of allAssignments) {
    if (assignment.targetType === 'player') {
      lifeChanges[assignment.targetId] = (lifeChanges[assignment.targetId] || 0) - assignment.amount;
    }
  }
  
  // Determine creature deaths
  const creaturesKilled = determineCreatureDeaths(allAssignments, creatureState);
  
  // Create triggers
  const triggers = createCombatDamageTriggers(allAssignments, allPermanents, timestamp);
  
  // Planeswalker damage
  const planeswalkersDamaged: { id: string; damage: number }[] = [];
  for (const assignment of allAssignments) {
    if (assignment.targetType === 'planeswalker') {
      const existing = planeswalkersDamaged.find(p => p.id === assignment.targetId);
      if (existing) {
        existing.damage += assignment.amount;
      } else {
        planeswalkersDamaged.push({ id: assignment.targetId, damage: assignment.amount });
      }
    }
  }
  
  return {
    assignments: allAssignments,
    firstStrikeAssignments,
    regularAssignments,
    lifeChanges,
    poisonChanges: {}, // TODO: Handle infect
    creaturesKilled,
    planeswalkersDamaged,
    triggers,
    log,
  };
}

export default {
  hasFirstStrikeDamage,
  hasRegularDamage,
  calculateLethalDamageForBlocker,
  assignDamageToBlockers,
  calculateTrampleToPlayer,
  processUnblockedAttacker,
  processBlockerDamageToAttacker,
  calculateLifelinkGains,
  determineCreatureDeaths,
  createCombatDamageTriggers,
  hasFirstStrikersInCombat,
  calculateCombatDamage,
};
