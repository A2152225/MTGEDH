/**
 * actions/combat.ts
 * 
 * Combat-related action handlers.
 * Handles declaring attackers, blockers, and dealing combat damage.
 * 
 * Rules references:
 * - Rule 508: Declare Attackers Step
 * - Rule 509: Declare Blockers Step
 * - Rule 510: Combat Damage Step
 */

import type { GameState, CombatInfo, CombatantInfo } from '../../../shared/src';
import { GameStep as SharedGameStep } from '../../../shared/src';
import type { EngineResult, ActionContext, BaseAction } from '../core/types';
import { RulesEngineEvent } from '../core/events';

export interface AttackerDeclaration {
  readonly creatureId: string;
  readonly defendingPlayerId: string;
}

export interface BlockerDeclaration {
  readonly blockerId: string;
  readonly attackerId: string;
  readonly damageOrder?: number;
}

export interface DeclareAttackersAction extends BaseAction {
  readonly type: 'declareAttackers';
  readonly attackers: AttackerDeclaration[];
}

export interface DeclareBlockersAction extends BaseAction {
  readonly type: 'declareBlockers';
  readonly blockers: BlockerDeclaration[];
}

export interface CombatDamageAssignment {
  readonly attackerId: string;
  readonly damage: number;
  readonly defendingPlayerId?: string;
  readonly blockedBy?: Array<{ blockerId: string; damageAssigned: number }>;
  readonly creature?: any;
}

export interface DealCombatDamageAction extends BaseAction {
  readonly type: 'dealCombatDamage';
  readonly attackers: CombatDamageAssignment[];
}

/**
 * Result of checking if a permanent can participate in combat
 */
export interface CombatValidationResult {
  readonly canParticipate: boolean;
  readonly reason?: string;
}

/**
 * Check if a permanent is currently a creature (Rule 302)
 * This considers:
 * - Base type line
 * - Type-changing effects (e.g., Imprisoned in the Moon removes creature type)
 * - Animation effects (e.g., Tezzeret making artifacts creatures)
 * - Granted types from effects
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent is currently a creature
 */
export function isCurrentlyCreature(permanent: any): boolean {
  if (!permanent) return false;
  
  // Check for explicit types array (from modifiers or card data)
  if (permanent.types && Array.isArray(permanent.types)) {
    if (permanent.types.includes('Creature')) return true;
  }
  
  // Check type_line from card data
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  
  // Check if type has been removed by effects (like Imprisoned in the Moon)
  // Type removal effects typically set a modifier that overrides the type line
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      // TYPE_CHANGE modifiers can add or remove types
      if (mod.type === 'typeChange' || mod.type === 'TYPE_CHANGE') {
        // If modifier explicitly removes creature type
        if (mod.removesTypes?.includes('Creature')) {
          return false;
        }
        // If modifier sets a new type line that replaces the original
        if (mod.newTypeLine && !mod.newTypeLine.toLowerCase().includes('creature')) {
          return false;
        }
        // If modifier adds creature type
        if (mod.addsTypes?.includes('Creature') || 
            (mod.newTypeLine && mod.newTypeLine.toLowerCase().includes('creature'))) {
          return true;
        }
      }
    }
  }
  
  // Check granted types from effects (e.g., "becomes a creature")
  if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
    if (permanent.grantedTypes.includes('Creature')) return true;
  }
  
  // Check if the base type line includes creature
  if (typeLine.includes('creature')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent has the defender keyword ability (Rule 702.3)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent has defender
 */
export function hasDefender(permanent: any): boolean {
  if (!permanent) return false;
  
  // Check oracle text for defender keyword
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  if (oracleText.includes('defender')) return true;
  
  // Check type line (some cards have it inline like "Creature — Wall")
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  // Walls historically had defender, but since 2004 it's explicit
  
  // Check granted abilities
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === 'defender')) {
      return true;
    }
  }
  
  // Check modifiers for granted defender
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'abilityGrant' || mod.type === 'ABILITY_GRANT') {
        if (mod.ability?.toLowerCase() === 'defender') return true;
      }
    }
  }
  
  // Check abilities array if present
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type === 'defender' || a.name?.toLowerCase() === 'defender'
    )) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a permanent has a "can't attack" restriction
 * This includes:
 * - Defender keyword (Rule 702.3)
 * - Effects that say "can't attack" (e.g., Pacifism, Arrest)
 * - Creature is tapped
 * - Summoning sickness (Rule 302.6)
 * 
 * @param permanent - The permanent to check
 * @param controllerId - The controller's player ID
 * @returns CombatValidationResult with canParticipate and reason
 */
export function canPermanentAttack(permanent: any, controllerId?: string): CombatValidationResult {
  if (!permanent) {
    return { canParticipate: false, reason: 'Permanent not found' };
  }
  
  // Must be a creature to attack (Rule 508.1a)
  if (!isCurrentlyCreature(permanent)) {
    return { canParticipate: false, reason: 'Only creatures can attack' };
  }
  
  // Cannot attack if tapped (Rule 508.1a)
  if (permanent.tapped) {
    return { canParticipate: false, reason: 'Cannot attack with tapped creature' };
  }
  
  // Cannot attack with defender (Rule 702.3b)
  if (hasDefender(permanent)) {
    return { canParticipate: false, reason: 'Creatures with defender cannot attack' };
  }
  
  // Check for summoning sickness (Rule 302.6)
  // A creature can't attack unless it has been under its controller's 
  // control continuously since the beginning of their most recent turn
  if (permanent.summoningSickness || permanent.summmoningSickness) {
    // Check for haste which bypasses summoning sickness
    if (!hasHaste(permanent)) {
      return { canParticipate: false, reason: 'Creature has summoning sickness' };
    }
  }
  
  // Check for "can't attack" modifiers (e.g., Pacifism, Arrest)
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'cantAttack' || mod.type === 'CANT_ATTACK') {
        return { canParticipate: false, reason: mod.reason || 'This creature cannot attack' };
      }
    }
  }
  
  // Check oracle text for "can't attack" effects on attached auras/equipment
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || '';
  if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
    // Self-restricting abilities like "can't attack alone" are handled differently
    // Full implementation would check specific conditions
  }
  
  return { canParticipate: true };
}

/**
 * Check if a permanent has the haste keyword ability (Rule 702.10)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent has haste
 */
export function hasHaste(permanent: any): boolean {
  if (!permanent) return false;
  
  // Check oracle text for haste keyword
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  if (oracleText.includes('haste')) return true;
  
  // Check granted abilities
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === 'haste')) {
      return true;
    }
  }
  
  // Check modifiers for granted haste
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'abilityGrant' || mod.type === 'ABILITY_GRANT') {
        if (mod.ability?.toLowerCase() === 'haste') return true;
      }
    }
  }
  
  // Check abilities array if present
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type === 'haste' || a.name?.toLowerCase() === 'haste'
    )) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a permanent has a "can't block" restriction
 * This includes:
 * - Effects that say "can't block" (e.g., Cobblebrute, Goblin Heelcutter)
 * - Creature is tapped
 * - Shadow/fear/menace/flying restrictions (vs specific attackers)
 * 
 * @param permanent - The permanent to check
 * @param attacker - The attacking creature (optional, for evasion checks)
 * @returns CombatValidationResult with canParticipate and reason
 */
export function canPermanentBlock(permanent: any, attacker?: any): CombatValidationResult {
  if (!permanent) {
    return { canParticipate: false, reason: 'Permanent not found' };
  }
  
  // Must be a creature to block (Rule 509.1a)
  if (!isCurrentlyCreature(permanent)) {
    return { canParticipate: false, reason: 'Only creatures can block' };
  }
  
  // Cannot block if tapped (Rule 509.1a)
  if (permanent.tapped) {
    return { canParticipate: false, reason: 'Cannot block with tapped creature' };
  }
  
  // Check for "can't block" modifiers
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'cantBlock' || mod.type === 'CANT_BLOCK') {
        return { canParticipate: false, reason: mod.reason || 'This creature cannot block' };
      }
    }
  }
  
  // Check oracle text for "can't block" self-restrictions
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || '';
  if (oracleText.includes("can't block") && !oracleText.includes("can't be blocked")) {
    // Check if it's a self-restriction (simple cases)
    // Full implementation would parse the oracle text more carefully
    if (!oracleText.includes("can't block creatures") && 
        !oracleText.includes("can't block except")) {
      return { canParticipate: false, reason: 'This creature cannot block' };
    }
  }
  
  // If an attacker is provided, check evasion abilities
  if (attacker) {
    const evasionResult = checkEvasionAbilities(permanent, attacker);
    if (!evasionResult.canParticipate) {
      return evasionResult;
    }
  }
  
  return { canParticipate: true };
}

/**
 * Check evasion abilities when blocking
 * Flying, shadow, horsemanship, menace, fear, intimidate, skulk, etc.
 * 
 * @param blocker - The potential blocking creature
 * @param attacker - The attacking creature
 * @returns CombatValidationResult
 */
export function checkEvasionAbilities(blocker: any, attacker: any): CombatValidationResult {
  const attackerText = attacker.card?.oracle_text?.toLowerCase() || 
                       attacker.oracle_text?.toLowerCase() || '';
  const blockerText = blocker.card?.oracle_text?.toLowerCase() || 
                      blocker.oracle_text?.toLowerCase() || '';
  
  // Flying (Rule 702.9) - can only be blocked by creatures with flying or reach
  if (attackerText.includes('flying') || hasAbility(attacker, 'flying')) {
    if (!attackerText.includes('reach') && !hasAbility(blocker, 'reach') &&
        !blockerText.includes('flying') && !hasAbility(blocker, 'flying')) {
      return { canParticipate: false, reason: 'Cannot block a creature with flying without flying or reach' };
    }
  }
  
  // Shadow (Rule 702.27) - can only be blocked by creatures with shadow
  if (attackerText.includes('shadow') || hasAbility(attacker, 'shadow')) {
    if (!blockerText.includes('shadow') && !hasAbility(blocker, 'shadow')) {
      return { canParticipate: false, reason: 'Only creatures with shadow can block creatures with shadow' };
    }
  }
  
  // Horsemanship (Rule 702.30) - can only be blocked by creatures with horsemanship
  if (attackerText.includes('horsemanship') || hasAbility(attacker, 'horsemanship')) {
    if (!blockerText.includes('horsemanship') && !hasAbility(blocker, 'horsemanship')) {
      return { canParticipate: false, reason: 'Only creatures with horsemanship can block creatures with horsemanship' };
    }
  }
  
  return { canParticipate: true };
}

/**
 * Helper to check if a permanent has a specific ability
 */
function hasAbility(permanent: any, abilityName: string): boolean {
  if (!permanent) return false;
  
  const lowerName = abilityName.toLowerCase();
  
  // Check granted abilities
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === lowerName)) {
      return true;
    }
  }
  
  // Check abilities array
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type?.toLowerCase() === lowerName || a.name?.toLowerCase() === lowerName
    )) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the combat damage value for a creature
 * Handles power/toughness swaps (e.g., Doran, the Siege Tower)
 * 
 * @param permanent - The creature dealing combat damage
 * @param state - The game state (to check for global effects)
 * @returns The damage value to use
 */
export function getCombatDamageValue(permanent: any, state?: GameState): number {
  if (!permanent) return 0;
  
  // Default to power
  let power = getPermanentPower(permanent);
  let toughness = getPermanentToughness(permanent);
  
  // Check for power/toughness damage swap effects
  // (e.g., Doran, the Siege Tower - "Each creature assigns combat damage equal to its toughness rather than its power")
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'combatDamageFromToughness' || mod.useToughnessForDamage) {
        return toughness;
      }
    }
  }
  
  // Check global state for effects like Doran
  if (state?.battlefield) {
    for (const perm of state.battlefield as any[]) {
      const text = perm.card?.oracle_text?.toLowerCase() || '';
      if (text.includes('assigns combat damage equal to its toughness')) {
        return toughness;
      }
    }
  }
  
  return Math.max(0, power);
}

/**
 * Get a permanent's current power value
 */
function getPermanentPower(permanent: any): number {
  // Use effective power if calculated
  if (typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }
  
  // Use base power plus counters
  let power = permanent.basePower ?? 0;
  
  // Parse from card if needed
  if (typeof power !== 'number') {
    const cardPower = permanent.card?.power || permanent.power;
    power = typeof cardPower === 'string' ? parseInt(cardPower, 10) || 0 : cardPower || 0;
  }
  
  // Add +1/+1 counters
  if (permanent.counters && typeof permanent.counters['+1/+1'] === 'number') {
    power += permanent.counters['+1/+1'];
  }
  
  // Subtract -1/-1 counters
  if (permanent.counters && typeof permanent.counters['-1/-1'] === 'number') {
    power -= permanent.counters['-1/-1'];
  }
  
  // Apply power modifiers
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        if (typeof mod.power === 'number') {
          power += mod.power;
        }
      }
    }
  }
  
  return power;
}

/**
 * Get a permanent's current toughness value
 */
function getPermanentToughness(permanent: any): number {
  // Use effective toughness if calculated
  if (typeof permanent.effectiveToughness === 'number') {
    return permanent.effectiveToughness;
  }
  
  // Use base toughness plus counters
  let toughness = permanent.baseToughness ?? 0;
  
  // Parse from card if needed
  if (typeof toughness !== 'number') {
    const cardToughness = permanent.card?.toughness || permanent.toughness;
    toughness = typeof cardToughness === 'string' ? parseInt(cardToughness, 10) || 0 : cardToughness || 0;
  }
  
  // Add +1/+1 counters
  if (permanent.counters && typeof permanent.counters['+1/+1'] === 'number') {
    toughness += permanent.counters['+1/+1'];
  }
  
  // Subtract -1/-1 counters
  if (permanent.counters && typeof permanent.counters['-1/-1'] === 'number') {
    toughness -= permanent.counters['-1/-1'];
  }
  
  // Apply toughness modifiers
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        if (typeof mod.toughness === 'number') {
          toughness += mod.toughness;
        }
      }
    }
  }
  
  return toughness;
}

/**
 * Get all legal attackers for a player
 * Filters battlefield to only creatures that can legally attack
 * 
 * @param state - The game state
 * @param playerId - The player declaring attackers
 * @returns Array of permanent IDs that can attack
 */
export function getLegalAttackers(state: GameState, playerId: string): string[] {
  const legalAttackers: string[] = [];
  
  // Check global battlefield
  if (state.battlefield) {
    for (const perm of state.battlefield as any[]) {
      if (perm.controller === playerId) {
        const result = canPermanentAttack(perm, playerId);
        if (result.canParticipate) {
          legalAttackers.push(perm.id);
        }
      }
    }
  }
  
  // Check player-specific battlefield
  const player = state.players?.find((p: any) => p.id === playerId);
  if (player?.battlefield) {
    for (const perm of player.battlefield as any[]) {
      const result = canPermanentAttack(perm, playerId);
      if (result.canParticipate && !legalAttackers.includes(perm.id)) {
        legalAttackers.push(perm.id);
      }
    }
  }
  
  return legalAttackers;
}

/**
 * Get all legal blockers for a player against a specific attacker
 * 
 * @param state - The game state
 * @param playerId - The player declaring blockers
 * @param attackerId - The attacking creature to block (optional)
 * @returns Array of permanent IDs that can block
 */
export function getLegalBlockers(state: GameState, playerId: string, attackerId?: string): string[] {
  const legalBlockers: string[] = [];
  let attacker: any = null;
  
  // Find the attacker if specified
  if (attackerId) {
    attacker = (state.battlefield as any[])?.find((p: any) => p.id === attackerId);
    if (!attacker) {
      const attackerPlayer = state.players?.find((p: any) => 
        p.battlefield?.some((c: any) => c.id === attackerId)
      );
      attacker = attackerPlayer?.battlefield?.find((c: any) => c.id === attackerId);
    }
  }
  
  // Check global battlefield
  if (state.battlefield) {
    for (const perm of state.battlefield as any[]) {
      if (perm.controller === playerId) {
        const result = canPermanentBlock(perm, attacker);
        if (result.canParticipate) {
          legalBlockers.push(perm.id);
        }
      }
    }
  }
  
  // Check player-specific battlefield
  const player = state.players?.find((p: any) => p.id === playerId);
  if (player?.battlefield) {
    for (const perm of player.battlefield as any[]) {
      const result = canPermanentBlock(perm, attacker);
      if (result.canParticipate && !legalBlockers.includes(perm.id)) {
        legalBlockers.push(perm.id);
      }
    }
  }
  
  return legalBlockers;
}

/**
 * Validate declare attackers action
 * Uses comprehensive combat validation to check:
 * - Permanent must be a creature (not enchantment, artifact, etc.)
 * - Must be untapped
 * - Must not have defender
 * - Must not have summoning sickness (unless has haste)
 * - Must not have "can't attack" effects
 */
export function validateDeclareAttackers(
  state: GameState,
  action: DeclareAttackersAction
): { legal: boolean; reason?: string } {
  // Check if it's the declare attackers step
  if (state.step !== SharedGameStep.DECLARE_ATTACKERS) {
    return { legal: false, reason: 'Not in declare attackers step' };
  }
  
  // Check if player is active player
  const activePlayer = state.players[state.activePlayerIndex || 0];
  if (activePlayer?.id !== action.playerId) {
    return { legal: false, reason: 'Only active player can declare attackers' };
  }
  
  // Validate each attacker using comprehensive validation
  for (const attacker of action.attackers) {
    // Check global battlefield and player-specific battlefield
    let permanent = state.battlefield?.find(
      (p: any) => p.id === attacker.creatureId && p.controller === action.playerId
    );
    
    // Also check player's own battlefield if not found globally
    if (!permanent) {
      const player = state.players.find(p => p.id === action.playerId);
      permanent = player?.battlefield?.find(
        (p: any) => p.id === attacker.creatureId
      );
    }
    
    if (!permanent) {
      return { legal: false, reason: `Permanent ${attacker.creatureId} not found on battlefield` };
    }
    
    // Use comprehensive attack validation
    const validationResult = canPermanentAttack(permanent, action.playerId);
    if (!validationResult.canParticipate) {
      return { legal: false, reason: validationResult.reason || 'Cannot attack with this permanent' };
    }
  }
  
  return { legal: true };
}

/**
 * Execute declare attackers action
 */
export function executeDeclareAttackers(
  gameId: string,
  action: DeclareAttackersAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    // Return a minimal valid state to avoid type errors, with error logged
    return { 
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState, 
      log: ['Game not found'] 
    };
  }
  
  // Tap all attacking creatures
  const updatedBattlefield = (state.battlefield || []).map((perm: any) => {
    const isAttacker = action.attackers.some(a => a.creatureId === perm.id);
    if (isAttacker) {
      return { ...perm, tapped: true };
    }
    return perm;
  });
  
  // Build combat state matching the CombatInfo interface from shared types
  const combatAttackers: CombatantInfo[] = action.attackers.map(a => ({
    permanentId: a.creatureId,
    defending: a.defendingPlayerId,
    blockedBy: [],
  }));
  
  const combat: CombatInfo = {
    phase: 'declareAttackers',
    attackers: combatAttackers,
    blockers: [],
  };
  
  const nextState: GameState = {
    ...state,
    battlefield: updatedBattlefield,
    combat,
  };
  
  context.emit({
    type: RulesEngineEvent.ATTACKERS_DECLARED,
    timestamp: Date.now(),
    gameId,
    data: { 
      attackers: action.attackers, 
      attackerCount: action.attackers.length 
    },
  });
  
  return {
    next: nextState,
    log: [`Declared ${action.attackers.length} attackers`],
  };
}

/**
 * Validate declare blockers action
 * Uses comprehensive combat validation to check:
 * - Permanent must be a creature (not enchantment, artifact, etc.)
 * - Must be untapped
 * - Must not have "can't block" effects
 * - Checks evasion abilities (flying, shadow, etc.)
 */
export function validateDeclareBlockers(
  state: GameState,
  action: DeclareBlockersAction
): { legal: boolean; reason?: string } {
  // Check if it's the declare blockers step
  if (state.step !== SharedGameStep.DECLARE_BLOCKERS) {
    return { legal: false, reason: 'Not in declare blockers step' };
  }
  
  // Validate each blocker using comprehensive validation
  for (const blocker of action.blockers) {
    // Find the blocker permanent
    let permanent = state.battlefield?.find(
      (p: any) => p.id === blocker.blockerId && p.controller === action.playerId
    );
    
    // Also check player's own battlefield if not found globally
    if (!permanent) {
      const player = state.players.find(p => p.id === action.playerId);
      permanent = player?.battlefield?.find(
        (p: any) => p.id === blocker.blockerId
      );
    }
    
    if (!permanent) {
      return { legal: false, reason: `Permanent ${blocker.blockerId} not found on battlefield` };
    }
    
    // Find the attacker being blocked (for evasion checks)
    let attacker = state.battlefield?.find(
      (p: any) => p.id === blocker.attackerId
    );
    if (!attacker) {
      // Check in combat state
      const attackerInfo = state.combat?.attackers?.find(
        (a: any) => a.cardId === blocker.attackerId
      );
      if (!attackerInfo) {
        return { legal: false, reason: `Attacker ${blocker.attackerId} not found` };
      }
      // Try to find the actual permanent
      for (const player of state.players) {
        const found = player.battlefield?.find((p: any) => p.id === blocker.attackerId);
        if (found) {
          attacker = found;
          break;
        }
      }
    }
    
    // Use comprehensive block validation (includes evasion checks)
    const validationResult = canPermanentBlock(permanent, attacker);
    if (!validationResult.canParticipate) {
      return { legal: false, reason: validationResult.reason || 'Cannot block with this permanent' };
    }
  }
  
  return { legal: true };
}

/**
 * Execute declare blockers action
 */
export function executeDeclareBlockers(
  gameId: string,
  action: DeclareBlockersAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    // Return a minimal valid state to avoid type errors, with error logged
    return { 
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState, 
      log: ['Game not found'] 
    };
  }
  
  // Update combat state with blockers matching CombatInfo interface
  const existingAttackers = state.combat?.attackers || [];
  const updatedAttackers: CombatantInfo[] = existingAttackers.map((a: CombatantInfo) => {
    const blockersForAttacker = action.blockers.filter(b => b.attackerId === a.permanentId);
    return {
      ...a,
      blockedBy: blockersForAttacker.map(b => b.blockerId),
    };
  });
  
  const combatBlockers: CombatantInfo[] = action.blockers.map(b => ({
    permanentId: b.blockerId,
    blocking: [b.attackerId],
    damage: b.damageOrder,
  }));
  
  const combat: CombatInfo = {
    phase: 'declareBlockers',
    attackers: updatedAttackers,
    blockers: combatBlockers,
  };
  
  const nextState: GameState = {
    ...state,
    combat,
  };
  
  context.emit({
    type: RulesEngineEvent.BLOCKERS_DECLARED,
    timestamp: Date.now(),
    gameId,
    data: { 
      blockers: action.blockers, 
      blockerCount: action.blockers.length 
    },
  });
  
  return {
    next: nextState,
    log: [`Declared ${action.blockers.length} blockers`],
  };
}

/**
 * Check if a permanent has the lifelink keyword ability (Rule 702.15)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent has lifelink
 */
export function hasLifelink(permanent: any): boolean {
  if (!permanent) return false;
  
  // Check oracle text for lifelink keyword
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  if (oracleText.includes('lifelink')) return true;
  
  // Check granted abilities
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === 'lifelink')) {
      return true;
    }
  }
  
  // Check modifiers for granted lifelink
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'abilityGrant' || mod.type === 'ABILITY_GRANT') {
        if (mod.ability?.toLowerCase() === 'lifelink') return true;
      }
    }
  }
  
  // Check abilities array if present
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type === 'lifelink' || a.name?.toLowerCase() === 'lifelink'
    )) {
      return true;
    }
  }
  
  return false;
}

/**
 * Execute combat damage
 * Handles lifelink (Rule 702.15) - damage dealt by source with lifelink
 * causes that source's controller to gain that much life
 */
export function executeCombatDamage(
  gameId: string,
  action: DealCombatDamageAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    // Return a minimal valid state to avoid type errors, with error logged
    return { 
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState, 
      log: ['Game not found'] 
    };
  }
  
  let currentState = { ...state };
  const logs: string[] = [];
  
  // Track life gained from lifelink by controller
  const lifelinkGain: Map<string, number> = new Map();
  
  for (const attacker of action.attackers) {
    const creature = attacker.creature;
    const damage = attacker.damage || creature?.power || 0;
    
    // Find the actual permanent on the battlefield for ability checks
    const permanentOnBattlefield = currentState.battlefield?.find((p: any) => p.id === attacker.attackerId);
    const creatureHasLifelink = hasLifelink(permanentOnBattlefield) || hasLifelink(creature);
    const controllerId = permanentOnBattlefield?.controller || creature?.controller;
    
    if (attacker.blockedBy && attacker.blockedBy.length > 0) {
      // Creature is blocked - deal damage to blockers
      let totalDamageDealt = 0;
      for (const block of attacker.blockedBy) {
        const damageToBlocker = block.damageAssigned || damage;
        
        // Find blocker and assign damage
        const blocker = currentState.battlefield?.find((p: any) => p.id === block.blockerId);
        if (blocker) {
          // Add damage counter (simplified - real implementation needs damage tracking)
          const updatedBattlefield = (currentState.battlefield || []).map((p: any) => {
            if (p.id === block.blockerId) {
              return {
                ...p,
                counters: {
                  ...p.counters,
                  damage: (p.counters?.damage || 0) + damageToBlocker,
                },
              };
            }
            return p;
          });
          
          currentState = { ...currentState, battlefield: updatedBattlefield };
          logs.push(`${creature?.name || 'Creature'} deals ${damageToBlocker} damage to ${blocker?.card?.name || 'blocker'}`);
          totalDamageDealt += damageToBlocker;
        }
      }
      
      // Apply lifelink for damage dealt to blockers (Rule 702.15b)
      if (creatureHasLifelink && totalDamageDealt > 0 && controllerId) {
        const currentGain = lifelinkGain.get(controllerId) || 0;
        lifelinkGain.set(controllerId, currentGain + totalDamageDealt);
      }
    } else if (attacker.defendingPlayerId) {
      // Unblocked - deal damage to defending player
      const defender = currentState.players.find(p => p.id === attacker.defendingPlayerId);
      
      if (defender && damage > 0) {
        const newLife = (defender.life || 40) - damage;
        
        currentState = {
          ...currentState,
          players: currentState.players.map(p =>
            p.id === attacker.defendingPlayerId
              ? { ...p, life: newLife }
              : p
          ),
        };
        
        logs.push(`${creature?.name || 'Creature'} deals ${damage} combat damage to ${attacker.defendingPlayerId}`);
        
        // Apply lifelink for damage dealt to player (Rule 702.15b)
        if (creatureHasLifelink && controllerId) {
          const currentGain = lifelinkGain.get(controllerId) || 0;
          lifelinkGain.set(controllerId, currentGain + damage);
        }
        
        // Handle commander damage
        if (creature?.isCommander) {
          const commanderDamage = defender.commanderDamage || {};
          const commanderId = creature.id;
          const totalCommanderDamage = (commanderDamage[commanderId] || 0) + damage;
          
          currentState = {
            ...currentState,
            players: currentState.players.map(p =>
              p.id === attacker.defendingPlayerId
                ? { 
                    ...p, 
                    commanderDamage: { 
                      ...commanderDamage, 
                      [commanderId]: totalCommanderDamage 
                    } 
                  }
                : p
            ),
          };
          
          logs.push(`Commander damage: ${totalCommanderDamage}/21 from ${creature.name}`);
        }
      }
    }
  }
  
  // Apply all lifelink gains (Rule 702.15b)
  for (const [playerId, lifeGained] of lifelinkGain) {
    if (lifeGained > 0) {
      const player = currentState.players.find(p => p.id === playerId);
      if (player) {
        const newLife = (player.life || 40) + lifeGained;
        currentState = {
          ...currentState,
          players: currentState.players.map(p =>
            p.id === playerId
              ? { ...p, life: newLife }
              : p
          ),
        };
        logs.push(`${playerId} gains ${lifeGained} life (lifelink)`);
        
        context.emit({
          type: RulesEngineEvent.LIFE_GAINED,
          timestamp: Date.now(),
          gameId,
          data: { playerId, amount: lifeGained, source: 'lifelink' },
        });
      }
    }
  }
  
  context.emit({
    type: RulesEngineEvent.DAMAGE_DEALT,
    timestamp: Date.now(),
    gameId,
    data: { attackers: action.attackers, logs },
  });
  
  return {
    next: currentState,
    log: logs,
  };
}
