/**
 * combatControl.ts
 * 
 * Handles combat control effects that allow a player to choose
 * which creatures attack and/or block during combat.
 * 
 * Cards that use this mechanic:
 * - Master Warcraft: "You choose which creatures attack this turn. 
 *   You choose which creatures block this turn and how those creatures block."
 * - Odric, Master Tactician: "Whenever Odric, Master Tactician and at least 
 *   three other creatures attack, you choose which creatures block this combat 
 *   and how those creatures block."
 * - Brutal Hordechief: "You choose how creatures block this combat."
 * - Avatar of Slaughter: "All creatures attack each combat if able."
 * - War's Toll: "Whenever an opponent attacks, if they attacked you, all their 
 *   untapped creatures attack you if able."
 * 
 * Rules Reference:
 * - Rule 508.1d: Restrictions and requirements on attacking
 * - Rule 509.1c: Restrictions and requirements on blocking
 * - Rule 508: Declare Attackers Step
 * - Rule 509: Declare Blockers Step
 */

import type { 
  PlayerID, 
  BattlefieldPermanent, 
  GameState, 
  CombatControlEffect 
} from '../../shared/src';
import { canPermanentAttack, canPermanentBlock } from './actions/combat';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';

function getProcessedBattlefield(gameState: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield((gameState.battlefield || []) as BattlefieldPermanent[]);
}

function getKeywordList(permanent: BattlefieldPermanent): string[] {
  const oracleText = (((permanent.card as any)?.oracle_text) || '').toLowerCase();
  const grantedAbilities = Array.isArray((permanent as any).grantedAbilities)
    ? ((permanent as any).grantedAbilities as unknown[])
        .filter((ability): ability is string => typeof ability === 'string')
        .map(ability => ability.toLowerCase())
    : [];
  const combinedText = `${oracleText} ${grantedAbilities.join(' ')}`;
  const keywords = ['flying', 'first strike', 'double strike', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'defender', 'reach', 'shadow', 'horsemanship'];
  return keywords.filter(keyword => combinedText.includes(keyword));
}

/**
 * Result of validating a combat control action
 */
export interface CombatControlValidation {
  readonly valid: boolean;
  readonly reason?: string;
  readonly invalidCreatures?: readonly string[];
}

/**
 * Combat control declaration request
 */
export interface CombatControlDeclaration {
  /** Creatures that will attack, with their targets */
  readonly attackers: ReadonlyArray<{
    readonly creatureId: string;
    readonly targetPlayerId?: PlayerID;
    readonly targetPermanentId?: string;
  }>;
  /** Creatures that will block, with what they block */
  readonly blockers: ReadonlyArray<{
    readonly blockerId: string;
    readonly attackerId: string;
  }>;
}

/**
 * Information about a creature that can be controlled in combat
 */
export interface CombatCreatureInfo {
  readonly id: string;
  readonly name: string;
  readonly controller: PlayerID;
  readonly owner: PlayerID;
  readonly power: number;
  readonly toughness: number;
  readonly tapped: boolean;
  readonly canAttack: boolean;
  readonly canBlock: boolean;
  readonly mustAttack: boolean;
  readonly mustBlock: boolean;
  readonly cantAttack: boolean;
  readonly cantBlock: boolean;
  readonly keywords: readonly string[];
}

/**
 * Detect combat control effects from oracle text
 * Parses cards for abilities that grant combat control
 */
export function detectCombatControlEffect(
  permanent: BattlefieldPermanent,
  gameState: GameState,
  triggerContext?: { attackerCount?: number; defendingPlayerId?: PlayerID }
): CombatControlEffect | null {
  const card = permanent.card as { 
    name?: string; 
    oracle_text?: string;
    type_line?: string;
  } | undefined;
  
  if (!card) return null;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = card.name || 'Unknown';
  
  // Master Warcraft - Full combat control (both attackers and blockers)
  // "You choose which creatures attack this turn. You choose which creatures block this turn"
  if (oracleText.includes('you choose which creatures attack') && 
      oracleText.includes('you choose which creatures block')) {
    return {
      controllerId: permanent.controller,
      sourceId: permanent.id,
      sourceName: cardName,
      controlsAttackers: true,
      controlsBlockers: true,
    };
  }
  
  // Odric, Master Tactician - Blocker control when attacking with 4+ creatures
  // "Whenever Odric, Master Tactician and at least three other creatures attack"
  if (cardName.toLowerCase().includes('odric') && 
      oracleText.includes('at least three other creatures attack')) {
    // Only triggers when attacking with Odric + 3 others (4 total)
    if (triggerContext?.attackerCount !== undefined && triggerContext.attackerCount >= 4) {
      return {
        controllerId: permanent.controller,
        sourceId: permanent.id,
        sourceName: cardName,
        controlsAttackers: false,
        controlsBlockers: true,
      };
    }
    return null;
  }
  
  // Brutal Hordechief - Blocker control
  // "You choose how creatures block this combat."
  if (oracleText.includes('you choose how creatures block')) {
    return {
      controllerId: permanent.controller,
      sourceId: permanent.id,
      sourceName: cardName,
      controlsAttackers: false,
      controlsBlockers: true,
    };
  }
  
  // Avatar of Slaughter - All creatures must attack
  // "All creatures attack each combat if able."
  if (oracleText.includes('all creatures attack') && oracleText.includes('if able')) {
    // This forces mandatory attacks but doesn't change the controller
    // Return null since this is handled as a requirement, not control transfer
    return null;
  }
  
  return null;
}

/**
 * Check if a creature can legally be declared as an attacker
 * considering combat control effects
 */
export function canCreatureBeControlledToAttack(
  creature: BattlefieldPermanent,
  controller: PlayerID,
  combatControl?: CombatControlEffect,
  battlefield?: BattlefieldPermanent[]
): { canAttack: boolean; reason?: string } {
  const validation = canPermanentAttack(creature, controller, battlefield);
  if (!validation.canParticipate) {
    return { canAttack: false, reason: validation.reason };
  }
  
  // Check if creature is prevented from attacking by combat control
  if (combatControl?.preventedAttackers?.includes(creature.id)) {
    const creatureName = ((creature.card as any)?.name) || 'creature';
    return { canAttack: false, reason: `${creatureName} is prevented from attacking` };
  }
  
  return { canAttack: true };
}

/**
 * Check if a creature can legally be declared as a blocker
 * considering combat control effects
 */
export function canCreatureBeControlledToBlock(
  creature: BattlefieldPermanent,
  attacker: BattlefieldPermanent,
  combatControl?: CombatControlEffect,
  battlefield?: BattlefieldPermanent[]
): { canBlock: boolean; reason?: string } {
  const validation = canPermanentBlock(creature, attacker, battlefield);
  if (!validation.canParticipate) {
    return { canBlock: false, reason: validation.reason };
  }
  
  // Check if creature is prevented from blocking by combat control
  if (combatControl?.preventedBlockers?.includes(creature.id)) {
    const creatureName = ((creature.card as any)?.name) || 'creature';
    return { canBlock: false, reason: `${creatureName} is prevented from blocking` };
  }
  
  return { canBlock: true };
}

/**
 * Get all creatures that can be legally declared as attackers
 * for combat control purposes
 */
export function getControllableAttackers(
  gameState: GameState,
  combatControl: CombatControlEffect
): CombatCreatureInfo[] {
  const creatures: CombatCreatureInfo[] = [];
  const battlefield = getProcessedBattlefield(gameState);
  for (const perm of battlefield) {
    const card = perm.card as { 
      type_line?: string; 
      oracle_text?: string;
      name?: string;
      power?: string | number;
      toughness?: string | number;
    } | undefined;
    
    const typeLine = (card?.type_line || '').toLowerCase();
    
    // Only include creatures
    if (!typeLine.includes('creature')) continue;
    
    const oracleText = `${(card?.oracle_text || '').toLowerCase()} ${(((perm as any).grantedAbilities) || []).join(' ').toLowerCase()}`;
    const { canAttack } = canCreatureBeControlledToAttack(perm, perm.controller, combatControl, battlefield);
    
    // Parse power/toughness
    const power = typeof (perm as any).effectivePower === 'number'
      ? (perm as any).effectivePower
      : (typeof card?.power === 'number' ? card.power : parseInt(String(card?.power || '0'), 10) || 0);
    const toughness = typeof (perm as any).effectiveToughness === 'number'
      ? (perm as any).effectiveToughness
      : (typeof card?.toughness === 'number' ? card.toughness : parseInt(String(card?.toughness || '0'), 10) || 0);
    
    // Check for attack requirements ("must attack")
    const mustAttack = oracleText.includes('must attack') || 
      oracleText.includes('attacks each combat if able');
    
    // Check for "can't attack" restrictions
    const cantAttack = !canAttack;
    
    // Extract keywords for display
    const keywords = getKeywordList(perm);
    
    creatures.push({
      id: perm.id,
      name: card?.name || 'Creature',
      controller: perm.controller,
      owner: perm.owner,
      power,
      toughness,
      tapped: perm.tapped || false,
      canAttack,
      canBlock: true, // Will be evaluated separately
      mustAttack,
      mustBlock: false,
      cantAttack,
      cantBlock: false,
      keywords,
    });
  }
  
  return creatures;
}

/**
 * Get all creatures that can be legally declared as blockers
 * for combat control purposes
 */
export function getControllableBlockers(
  gameState: GameState,
  attackers: readonly { creatureId: string; targetPlayerId?: PlayerID }[],
  combatControl: CombatControlEffect
): CombatCreatureInfo[] {
  const creatures: CombatCreatureInfo[] = [];
  const battlefield = getProcessedBattlefield(gameState);
  
  // Get defending players (those being attacked)
  const defendingPlayerIds = new Set(
    attackers.map(a => a.targetPlayerId).filter((id): id is PlayerID => !!id)
  );
  
  for (const perm of battlefield) {
    // Only include creatures controlled by defending players
    if (!defendingPlayerIds.has(perm.controller)) continue;
    
    const card = perm.card as { 
      type_line?: string; 
      oracle_text?: string;
      name?: string;
      power?: string | number;
      toughness?: string | number;
    } | undefined;
    
    const typeLine = (card?.type_line || '').toLowerCase();
    
    // Only include creatures
    if (!typeLine.includes('creature')) continue;
    
    const oracleText = `${(card?.oracle_text || '').toLowerCase()} ${(((perm as any).grantedAbilities) || []).join(' ').toLowerCase()}`;
    
    // Parse power/toughness
    const power = typeof (perm as any).effectivePower === 'number'
      ? (perm as any).effectivePower
      : (typeof card?.power === 'number' ? card.power : parseInt(String(card?.power || '0'), 10) || 0);
    const toughness = typeof (perm as any).effectiveToughness === 'number'
      ? (perm as any).effectiveToughness
      : (typeof card?.toughness === 'number' ? card.toughness : parseInt(String(card?.toughness || '0'), 10) || 0);
    
    // General blocking ability (will be refined per-attacker)
    const canBlock = !perm.tapped && !oracleText.includes("can't block");
    
    // Check for block requirements ("must block")
    const mustBlock = oracleText.includes('must block') || 
      oracleText.includes('blocks each combat if able');
    
    // Check for "can't block" restrictions
    const cantBlock = oracleText.includes("can't block") && !oracleText.includes("can't be blocked");
    
    // Extract keywords for display
    const keywords = getKeywordList(perm);
    
    creatures.push({
      id: perm.id,
      name: card?.name || 'Creature',
      controller: perm.controller,
      owner: perm.owner,
      power,
      toughness,
      tapped: perm.tapped || false,
      canAttack: false, // Not relevant for blockers
      canBlock,
      mustAttack: false,
      mustBlock,
      cantAttack: false,
      cantBlock,
      keywords,
    });
  }
  
  return creatures;
}

/**
 * Validate a combat control declaration for attackers
 */
export function validateCombatControlAttackers(
  gameState: GameState,
  combatControl: CombatControlEffect,
  attackerDeclarations: ReadonlyArray<{
    creatureId: string;
    targetPlayerId?: PlayerID;
    targetPermanentId?: string;
  }>
): CombatControlValidation {
  const battlefield = getProcessedBattlefield(gameState);
  const invalidCreatures: string[] = [];
  const reasons: string[] = [];
  
  for (const decl of attackerDeclarations) {
    const creature = battlefield.find(p => p.id === decl.creatureId);
    if (!creature) {
      invalidCreatures.push(decl.creatureId);
      reasons.push(`Creature ${decl.creatureId} not found`);
      continue;
    }
    
    const { canAttack, reason } = canCreatureBeControlledToAttack(
      creature, 
      creature.controller, 
      combatControl,
      battlefield
    );
    
    if (!canAttack) {
      invalidCreatures.push(decl.creatureId);
      reasons.push(reason || `Creature ${decl.creatureId} cannot attack`);
    }
    
    // Validate target player/permanent exists
    if (decl.targetPlayerId) {
      const targetPlayer = gameState.players.find(p => p.id === decl.targetPlayerId);
      if (!targetPlayer) {
        invalidCreatures.push(decl.creatureId);
        reasons.push(`Target player ${decl.targetPlayerId} not found`);
      }
    }
  }
  
  // Check mandatory attackers
  if (combatControl.mandatoryAttackers && combatControl.mandatoryAttackers.length > 0) {
    for (const mandatoryId of combatControl.mandatoryAttackers) {
      const isAttacking = attackerDeclarations.some(d => d.creatureId === mandatoryId);
      if (!isAttacking) {
        const creature = battlefield.find(p => p.id === mandatoryId);
        const card = creature?.card as { name?: string } | undefined;
        reasons.push(`${card?.name || mandatoryId} must attack`);
      }
    }
  }
  
  if (invalidCreatures.length > 0 || reasons.length > 0) {
    return {
      valid: false,
      reason: reasons.join('; '),
      invalidCreatures,
    };
  }
  
  return { valid: true };
}

/**
 * Validate a combat control declaration for blockers
 */
export function validateCombatControlBlockers(
  gameState: GameState,
  combatControl: CombatControlEffect,
  attackers: readonly BattlefieldPermanent[],
  blockerDeclarations: ReadonlyArray<{
    blockerId: string;
    attackerId: string;
  }>
): CombatControlValidation {
  const battlefield = getProcessedBattlefield(gameState);
  const invalidCreatures: string[] = [];
  const reasons: string[] = [];
  
  for (const decl of blockerDeclarations) {
    const blocker = battlefield.find(p => p.id === decl.blockerId);
    const attacker = attackers.find(a => a.id === decl.attackerId);
    
    if (!blocker) {
      invalidCreatures.push(decl.blockerId);
      reasons.push(`Blocker ${decl.blockerId} not found`);
      continue;
    }
    
    if (!attacker) {
      invalidCreatures.push(decl.blockerId);
      reasons.push(`Attacker ${decl.attackerId} not found`);
      continue;
    }
    
    const { canBlock, reason } = canCreatureBeControlledToBlock(
      blocker,
      attacker,
      combatControl,
      battlefield
    );
    
    if (!canBlock) {
      invalidCreatures.push(decl.blockerId);
      reasons.push(reason || `${decl.blockerId} cannot block ${decl.attackerId}`);
    }
  }
  
  // Check mandatory blockers
  if (combatControl.mandatoryBlockers) {
    for (const [attackerId, blockerIds] of Object.entries(combatControl.mandatoryBlockers)) {
      for (const blockerId of blockerIds) {
        const isBlocking = blockerDeclarations.some(
          d => d.blockerId === blockerId && d.attackerId === attackerId
        );
        if (!isBlocking) {
          const blocker = battlefield.find(p => p.id === blockerId);
          const card = blocker?.card as { name?: string } | undefined;
          reasons.push(`${card?.name || blockerId} must block`);
        }
      }
    }
  }
  
  if (invalidCreatures.length > 0 || reasons.length > 0) {
    return {
      valid: false,
      reason: reasons.join('; '),
      invalidCreatures,
    };
  }
  
  return { valid: true };
}

/**
 * Apply combat control effect to game state
 */
export function applyCombatControlEffect(
  gameState: GameState,
  combatControl: CombatControlEffect
): GameState {
  // Update combat info with the control effect
  const combat = gameState.combat || {
    phase: 'declareAttackers',
    attackers: [],
    blockers: [],
  };
  
  return {
    ...gameState,
    combat: {
      ...combat,
      combatControl,
    },
  };
}

/**
 * Clear combat control effect from game state
 */
export function clearCombatControlEffect(gameState: GameState): GameState {
  if (!gameState.combat) return gameState;
  
  const { combatControl, ...combatWithoutControl } = gameState.combat;
  
  return {
    ...gameState,
    combat: combatWithoutControl,
  };
}

export default {
  detectCombatControlEffect,
  canCreatureBeControlledToAttack,
  canCreatureBeControlledToBlock,
  getControllableAttackers,
  getControllableBlockers,
  validateCombatControlAttackers,
  validateCombatControlBlockers,
  applyCombatControlEffect,
  clearCombatControlEffect,
};
