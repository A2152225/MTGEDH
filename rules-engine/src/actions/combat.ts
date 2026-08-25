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

import type { GameState, CombatInfo, CombatantInfo, BattlefieldPermanent } from '../../../shared/src';
import { GameStep as SharedGameStep } from '../../../shared/src';
import type { EngineResult, ActionContext } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import {
  createDamageSourceFromPermanent,
  DamageRecipientType,
  processDamageToCreature,
  processDamageToPlayer,
} from '../damageProcessing';
import { previewPreventedDamage } from '../oracleIRDamagePrevention';
import { getCombinedPermanentText, getPermanentTextFragments } from '../permanentText';
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';
import { getPermanentForGoadAnalysis } from './combat-handlers/combatGoadPermanentLookup.js';
import {
  canPermanentAttack,
  canPermanentBlock,
  getPermanentTypeLineLower,
  hasAbility,
} from './combat-handlers/combatLegalityHelpers.js';
export {
  isCurrentlyCreature,
  hasDefender,
  hasHaste,
  canPermanentAttack,
  canPermanentBlock,
  checkEvasionAbilities,
  type CombatValidationResult,
} from './combat-handlers/combatLegalityHelpers.js';
import { getPermanentPower } from './combat-handlers/combatPermanentPower.js';
import { buildProcessedBattlefieldForGoad } from './combat-handlers/combatGoadHelpers.js';
export {
  isGoaded,
  getGoadedBy,
  getGoadedAttackTargets,
  canGoadedCreatureAttack,
} from './combat-handlers/combatGoadHelpers.js';
export { getGoadedAttackers } from './combat-handlers/combatGoadedAttackers.js';
export { validateDeclareAttackers } from './combat-handlers/combatValidateDeclareAttackers.js';
import type {
  DeclareAttackersAction,
  DeclareBlockersAction,
  DealCombatDamageAction,
} from './combat-handlers/combatActionTypes.js';
export type {
  AttackerDeclaration,
  BlockerDeclaration,
  DeclareAttackersAction,
  DeclareBlockersAction,
  CombatDamageAssignment,
  DealCombatDamageAction,
} from './combat-handlers/combatActionTypes.js';



const BLOCKER_CAPACITY_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function parseBlockerCapacityValue(token?: string): number {
  if (!token) return 1;

  const normalized = token.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return Math.max(0, parseInt(normalized, 10));
  }

  if (BLOCKER_CAPACITY_WORDS[normalized] !== undefined) {
    return BLOCKER_CAPACITY_WORDS[normalized];
  }

  const parts = normalized.split(/[-\s]+/).filter(Boolean);
  if (parts.length > 1) {
    let total = 0;
    for (const part of parts) {
      const value = BLOCKER_CAPACITY_WORDS[part];
      if (value === undefined) {
        return 1;
      }
      total += value;
    }
    if (total > 0) {
      return total;
    }
  }

  return 1;
}

export function getBlockerCapacity(permanent: any): number {
  const combinedText = getCombinedPermanentText(permanent);

  if (!combinedText) {
    return 1;
  }

  if (/can block any number of creatures(?: this turn)?/.test(combinedText)) {
    return Number.POSITIVE_INFINITY;
  }

  let additionalCreatures = 0;
  const additionalCreaturePattern = /can block an additional(?: ((?:\d+|[a-z]+(?:[ -][a-z]+)*)))? creature(?:s)? (?:each combat|this turn)/g;

  for (const match of combinedText.matchAll(additionalCreaturePattern)) {
    additionalCreatures += parseBlockerCapacityValue(match[1] || '1');
  }

  return 1 + additionalCreatures;
}

function getAttackerBlockerLimit(attacker: any): number {
  const combinedText = getCombinedPermanentText(attacker);
  if (!combinedText) {
    return Number.POSITIVE_INFINITY;
  }

  if (combinedText.includes("can't be blocked by more than one creature")) {
    return 1;
  }

  return Number.POSITIVE_INFINITY;
}

type AllAbleBlockRequirement = {
  readonly requiredBlockerAbility?: string;
};

function normalizeCombatRequirementText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAllAbleBlockRequirementText(
  text: unknown,
  options: {
    readonly allowSelf: boolean;
    readonly allowEquipped: boolean;
    readonly allowEnchanted: boolean;
  }
): AllAbleBlockRequirement | null {
  const normalized = normalizeCombatRequirementText(text);
  if (!normalized) return null;

  const selfQualifiedMatch = normalized.match(
    /^all creatures with (.+?) able to block (?:this creature|this permanent|~) do so[.)]*$/i
  );
  if (selfQualifiedMatch && options.allowSelf) {
    return { requiredBlockerAbility: String(selfQualifiedMatch[1] || '').trim() };
  }

  if (
    options.allowSelf &&
    /^all creatures able to block (?:this creature|this permanent|~) do so[.)]*$/i.test(normalized)
  ) {
    return {};
  }

  if (
    /^all creatures able to block this creature or enchanted creature do so[.)]*$/i.test(normalized) &&
    (options.allowSelf || options.allowEnchanted)
  ) {
    return {};
  }

  const equippedMatch = normalized.match(/^all creatures(?: with (.+?))? able to block equipped creature do so[.)]*$/i);
  if (equippedMatch && options.allowEquipped) {
    const ability = String(equippedMatch[1] || '').trim();
    return ability ? { requiredBlockerAbility: ability } : {};
  }

  const enchantedMatch = normalized.match(/^all creatures(?: with (.+?))? able to block enchanted creature do so[.)]*$/i);
  if (enchantedMatch && options.allowEnchanted) {
    const ability = String(enchantedMatch[1] || '').trim();
    return ability ? { requiredBlockerAbility: ability } : {};
  }

  return null;
}

function collectAllAbleBlockRequirements(
  attacker: any,
  battlefield: readonly BattlefieldPermanent[]
): readonly AllAbleBlockRequirement[] {
  const requirements: AllAbleBlockRequirement[] = [];
  const seen = new Set<string>();

  const pushRequirement = (requirement: AllAbleBlockRequirement | null) => {
    if (!requirement) return;
    const key = String(requirement.requiredBlockerAbility || '*').trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    requirements.push(requirement);
  };

  for (const fragment of getPermanentTextFragments(attacker)) {
    pushRequirement(
      parseAllAbleBlockRequirementText(fragment, {
        allowSelf: true,
        allowEquipped: false,
        allowEnchanted: false,
      })
    );
  }

  const attackerId = String(attacker?.id || '').trim();
  if (!attackerId) return requirements;

  for (const attachment of battlefield) {
    if (String((attachment as any)?.attachedTo || '').trim() !== attackerId) continue;
    const typeLineLower = getPermanentTypeLineLower(attachment);
    const isEquipment = /\bequipment\b/i.test(typeLineLower);

    for (const fragment of getPermanentTextFragments(attachment)) {
      pushRequirement(
        parseAllAbleBlockRequirementText(fragment, {
          allowSelf: false,
          allowEquipped: isEquipment,
          allowEnchanted: !isEquipment,
        })
      );
    }
  }

  return requirements;
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
  const currentTurn = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0) || 0;
  const noCombatDamageUntilTurn = Number((permanent as any)?.assignsNoCombatDamageUntilTurn);
  if (Number.isFinite(noCombatDamageUntilTurn) && noCombatDamageUntilTurn === currentTurn) {
    return 0;
  }

  const processedBattlefield = state?.battlefield ? buildProcessedBattlefieldForGoad(state.battlefield as any[]) : undefined;
  const analyzedPermanent = processedBattlefield
    ? getPermanentForGoadAnalysis(permanent, processedBattlefield)
    : permanent;
  
  // Default to power
  let power = getPermanentPower(analyzedPermanent);
  let toughness = getPermanentToughness(analyzedPermanent);
  
  // Check for power/toughness damage swap effects
  // (e.g., Doran, the Siege Tower - "Each creature assigns combat damage equal to its toughness rather than its power")
  if (analyzedPermanent.modifiers && Array.isArray(analyzedPermanent.modifiers)) {
    for (const mod of analyzedPermanent.modifiers) {
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
  const battlefield = buildProcessedBattlefieldForGoad(state.battlefield as any[] | undefined);
  
  // Check global battlefield (single source of truth)
  for (const perm of battlefield) {
    if (perm.controller === playerId) {
      const result = canPermanentAttack(perm, playerId, battlefield);
      if (result.canParticipate) {
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
  const battlefield = buildProcessedBattlefieldForGoad(state.battlefield as any[] | undefined);
  
  // Find the attacker if specified
  if (attackerId) {
    attacker = battlefield.find((p: any) => p.id === attackerId);
  }
  
  // Check global battlefield (single source of truth)
  for (const perm of battlefield) {
    if (perm.controller === playerId) {
      const result = canPermanentBlock(perm, attacker, battlefield);
      if (result.canParticipate) {
        legalBlockers.push(perm.id);
      }
    }
  }
  
  return legalBlockers;
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
  const battlefield = buildProcessedBattlefieldForGoad(state.battlefield as any[] | undefined);
  const blockerAssignments = new Map<string, Set<string>>();
  const blockerPermanents = new Map<string, any>();
  const attackerAssignments = new Map<string, Set<string>>();
  const attackerPermanents = new Map<string, any>();
  // Check if it's the declare blockers step
  if (state.step !== SharedGameStep.DECLARE_BLOCKERS) {
    return { legal: false, reason: 'Not in declare blockers step' };
  }
  
  // Validate each blocker using comprehensive validation
  for (const blocker of action.blockers) {
    // Find the blocker permanent (using centralized battlefield)
    let permanent = battlefield.find(
      (p: any) => p.id === blocker.blockerId && p.controller === action.playerId
    );
    
    if (!permanent) {
      return { legal: false, reason: `Permanent ${blocker.blockerId} not found on battlefield` };
    }
    
    // Find the attacker being blocked (for evasion checks)
    let attacker = battlefield.find(
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
      // Attacker should already be in state.battlefield
      if (!attacker) {
        attacker = battlefield.find((p: any) => p.id === blocker.attackerId);
      }
    }
    
    // Use comprehensive block validation (includes evasion checks)
    const validationResult = canPermanentBlock(permanent, attacker, battlefield);
    if (!validationResult.canParticipate) {
      return { legal: false, reason: validationResult.reason || 'Cannot block with this permanent' };
    }

    blockerPermanents.set(blocker.blockerId, permanent);
    attackerPermanents.set(blocker.attackerId, attacker);
    const assignments = blockerAssignments.get(blocker.blockerId) || new Set<string>();
    if (assignments.has(blocker.attackerId)) {
      return { legal: false, reason: `Permanent ${blocker.blockerId} cannot block the same attacker multiple times` };
    }
    assignments.add(blocker.attackerId);
    blockerAssignments.set(blocker.blockerId, assignments);

    const attackerBlockers = attackerAssignments.get(blocker.attackerId) || new Set<string>();
    attackerBlockers.add(blocker.blockerId);
    attackerAssignments.set(blocker.attackerId, attackerBlockers);
  }

  for (const [blockerId, attackerIds] of blockerAssignments.entries()) {
    const permanent = blockerPermanents.get(blockerId);
    const blockerCapacity = getBlockerCapacity(permanent);

    if (attackerIds.size > blockerCapacity) {
      const blockerName = permanent?.card?.name || blockerId;
      if (blockerCapacity === 1) {
        return { legal: false, reason: `${blockerName} cannot block more than one creature` };
      }

      return {
        legal: false,
        reason: `${blockerName} can block at most ${blockerCapacity} creatures each combat`,
      };
    }
  }

  for (const [attackerId, blockerIds] of attackerAssignments.entries()) {
    const attacker = attackerPermanents.get(attackerId);
    const blockerLimit = getAttackerBlockerLimit(attacker);
    if (blockerIds.size > blockerLimit) {
      const attackerName = attacker?.card?.name || attackerId;
      if (blockerLimit === 1) {
        return { legal: false, reason: `${attackerName} can't be blocked by more than one creature` };
      }

      return {
        legal: false,
        reason: `${attackerName} can be blocked by at most ${blockerLimit} creatures`,
      };
    }
  }

  const attackingPermanents = battlefield.filter((attacker: any) => {
    const attackerId = String(attacker?.id || '').trim();
    if (!attackerId) return false;
    return (state.combat?.attackers || []).some((entry: any) => String(entry?.cardId || '').trim() === attackerId);
  });

  for (const attacker of attackingPermanents) {
    const requirements = collectAllAbleBlockRequirements(attacker, battlefield);
    if (requirements.length === 0) continue;

    const attackerId = String(attacker?.id || '').trim();
    const assignedBlockers = attackerAssignments.get(attackerId) || new Set<string>();
    for (const candidate of battlefield) {
      const candidateId = String((candidate as any)?.id || '').trim();
      if (!candidateId || String((candidate as any)?.controller || '').trim() !== action.playerId) continue;

      const validationResult = canPermanentBlock(candidate, attacker, battlefield);
      if (!validationResult.canParticipate) continue;

      const appliesToCandidate = requirements.some((requirement) => {
        const requiredAbility = String(requirement.requiredBlockerAbility || '').trim();
        return !requiredAbility || hasAbility(candidate, requiredAbility, battlefield);
      });
      if (!appliesToCandidate) continue;

      if (!assignedBlockers.has(candidateId)) {
        const attackerName = attacker?.card?.name || attackerId;
        const blockerName = (candidate as any)?.card?.name || candidateId;
        return { legal: false, reason: `${blockerName} must block ${attackerName} if able` };
      }
    }
  }

  const mustBlockEffects = battlefield.flatMap((candidate: any) => {
    const candidateId = String(candidate?.id || '').trim();
    if (!candidateId || String(candidate?.controller || '').trim() !== action.playerId) return [];
    const effects = Array.isArray(candidate?.temporaryEffects) ? candidate.temporaryEffects : [];
    return effects
      .map((effect: any) => String(effect?.mustBlockAttackerId || '').trim())
      .filter(Boolean)
      .map((attackerId: string) => ({ blocker: candidate, blockerId: candidateId, attackerId }));
  });

  for (const requirement of mustBlockEffects) {
    const attacker = battlefield.find((candidate: any) => String(candidate?.id || '').trim() === requirement.attackerId);
    if (!attacker) continue;
    const validationResult = canPermanentBlock(requirement.blocker, attacker, battlefield);
    if (!validationResult.canParticipate) continue;

    const assignedBlockers = attackerAssignments.get(requirement.attackerId) || new Set<string>();
    if (!assignedBlockers.has(requirement.blockerId)) {
      const attackerName = attacker?.card?.name || requirement.attackerId;
      const blockerName = requirement.blocker?.card?.name || requirement.blockerId;
      return { legal: false, reason: `${blockerName} must block ${attackerName} if able` };
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
      blockedBy: Array.from(new Set(blockersForAttacker.map(b => b.blockerId))),
    };
  });

  const blockerMap = new Map<string, CombatantInfo>();
  for (const blocker of action.blockers) {
    const existing = blockerMap.get(blocker.blockerId);
    if (existing) {
      blockerMap.set(blocker.blockerId, {
        ...existing,
        blocking: Array.from(new Set([...(existing.blocking || []), blocker.attackerId])),
      });
      continue;
    }

    blockerMap.set(blocker.blockerId, {
      permanentId: blocker.blockerId,
      blocking: [blocker.attackerId],
      damage: blocker.damageOrder,
    });
  }

  const combatBlockers: CombatantInfo[] = Array.from(blockerMap.values());
  
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
  const combinedText = getCombinedPermanentText(permanent);
  if (combinedText.includes('lifelink')) return true;
  
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
  const applyPoisonCountersToPlayer = (state: GameState, playerId: string, amount: number): GameState => {
    if (amount <= 0) return state;

    const nextPlayers = state.players.map((player: any) => {
      if (player.id !== playerId) return player;
      const currentPoison = Math.max(
        0,
        Number(player?.poisonCounters ?? player?.counters?.poison) || 0
      );
      const nextPoison = currentPoison + amount;
      return {
        ...player,
        poisonCounters: nextPoison,
        counters: {
          ...((player?.counters || {}) as Record<string, number>),
          poison: nextPoison,
        },
      };
    });

    return {
      ...state,
      players: nextPlayers as any,
      poisonCounters: {
        ...(((state as any).poisonCounters || {}) as Record<string, number>),
        [playerId]: Math.max(
          0,
          Number(
            ((nextPlayers.find((player: any) => player.id === playerId) as any)?.poisonCounters) || 0
          )
        ),
      },
    } as any;
  };
  const addCountersToPermanent = (state: GameState, permanentId: string, counterName: string, amount: number, sourceId?: string): GameState => {
    if (amount <= 0) return state;

    const nextBattlefield = (state.battlefield || []).map((permanent: any) => {
      if (permanent.id !== permanentId) return permanent;
      const nextPermanent = appendDamageSourceId(permanent, sourceId);
      const currentCounters = { ...((nextPermanent?.counters || {}) as Record<string, number>) };
      currentCounters[counterName] = (Number(currentCounters[counterName]) || 0) + amount;
      return {
        ...nextPermanent,
        counters: currentCounters,
      };
    });

    return { ...state, battlefield: nextBattlefield as any };
  };
  const appendDamageSourceId = (permanent: any, sourceId: string | undefined): any => {
    const normalizedSourceId = String(sourceId || '').trim();
    if (!normalizedSourceId) return permanent;

    const currentDamageSourceIds = Array.isArray((permanent as any)?.damageSourceIds)
      ? (permanent as any).damageSourceIds
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean)
      : [];
    if (currentDamageSourceIds.includes(normalizedSourceId)) {
      return permanent;
    }

    return {
      ...permanent,
      damageSourceIds: [...currentDamageSourceIds, normalizedSourceId],
    };
  };
  
  for (const attacker of action.attackers) {
    const creature = attacker.creature;
    const damage = attacker.damage || creature?.power || 0;
    const processedBattlefield = applyStaticAbilitiesToBattlefield((currentState.battlefield || []) as any[]);
    
    // Find the actual permanent on the battlefield for ability checks
    const permanentOnBattlefield = processedBattlefield.find((p: any) => p.id === attacker.attackerId);
    const creatureHasLifelink = hasLifelink(permanentOnBattlefield) || hasLifelink(creature);
    const controllerId = permanentOnBattlefield?.controller || creature?.controller;
    const directDamageCharacteristics = permanentOnBattlefield
      ? (() => {
          const source = createDamageSourceFromPermanent(permanentOnBattlefield);
          return {
            ...source,
            // Poisonous is already automated through the triggered-ability path.
            hasPoisonous: false,
            poisonousValue: 0,
          };
        })()
      : null;
    
    if (attacker.blockedBy && attacker.blockedBy.length > 0) {
      // Creature is blocked - deal damage to blockers
      let totalDamageDealt = 0;
      for (const block of attacker.blockedBy) {
        const damageToBlocker = block.damageAssigned || damage;
        const prevention = previewPreventedDamage(currentState, damageToBlocker, attacker.attackerId, {
          combatDamage: true,
          targetPermanentId: block.blockerId,
        });
        currentState = prevention.state ?? currentState;
        const finalDamageToBlocker = prevention.remainingDamage;
        logs.push(...prevention.log);
        if (finalDamageToBlocker <= 0) {
          logs.push(`${creature?.name || 'Creature'} has all combat damage prevented`);
          continue;
        }
        
        // Find blocker and assign damage
        const blocker = processedBattlefield.find((p: any) => p.id === block.blockerId);
        if (blocker) {
          if (directDamageCharacteristics) {
            const blockerToughness = typeof (blocker as any).effectiveToughness === 'number'
              ? (blocker as any).effectiveToughness
              : (parseInt(String(blocker?.card?.toughness || (blocker as any)?.toughness || '0'), 10) || 0);
            const processed = processDamageToCreature({
              sourceId: directDamageCharacteristics.sourceId,
              sourceName: directDamageCharacteristics.sourceName,
              sourceControllerId: directDamageCharacteristics.controllerId,
              recipientId: block.blockerId,
              recipientType: DamageRecipientType.CREATURE,
              amount: finalDamageToBlocker,
              isCombatDamage: true,
              characteristics: directDamageCharacteristics,
            }, blockerToughness);

            if (processed.markedDamage > 0) {
              currentState = addCountersToPermanent(
                currentState,
                block.blockerId,
                'damage',
                processed.markedDamage,
                attacker.attackerId
              );
            }

            if (processed.minusCounters > 0) {
              currentState = addCountersToPermanent(
                currentState,
                block.blockerId,
                '-1/-1',
                processed.minusCounters,
                attacker.attackerId
              );
            }

            logs.push(...processed.log);

            if (processed.lifelinkHealing > 0 && controllerId) {
              const currentGain = lifelinkGain.get(controllerId) || 0;
              lifelinkGain.set(controllerId, currentGain + processed.lifelinkHealing);
            }
          } else {
            currentState = addCountersToPermanent(currentState, block.blockerId, 'damage', finalDamageToBlocker, attacker.attackerId);
            logs.push(`${creature?.name || 'Creature'} deals ${finalDamageToBlocker} damage to ${blocker?.card?.name || 'blocker'}`);
          }
          totalDamageDealt += finalDamageToBlocker;
        }
      }
      
      // Apply lifelink for damage dealt to blockers (Rule 702.15b)
      if (creatureHasLifelink && totalDamageDealt > 0 && controllerId && !directDamageCharacteristics) {
        const currentGain = lifelinkGain.get(controllerId) || 0;
        lifelinkGain.set(controllerId, currentGain + totalDamageDealt);
      }
    } else if (attacker.defendingPlayerId) {
      // Unblocked - deal damage to defending player
      const defender = currentState.players.find(p => p.id === attacker.defendingPlayerId);
      
      if (defender && damage > 0) {
        const prevention = previewPreventedDamage(currentState, damage, attacker.attackerId, {
          combatDamage: true,
          targetPlayerId: attacker.defendingPlayerId,
        });
        currentState = prevention.state ?? currentState;
        const finalDamage = prevention.remainingDamage;
        logs.push(...prevention.log);
        if (finalDamage <= 0) {
          logs.push(`${creature?.name || 'Creature'} has all combat damage prevented`);
          continue;
        }
        if (directDamageCharacteristics) {
          const processed = processDamageToPlayer({
            sourceId: directDamageCharacteristics.sourceId,
            sourceName: directDamageCharacteristics.sourceName,
            sourceControllerId: directDamageCharacteristics.controllerId,
            recipientId: attacker.defendingPlayerId,
            recipientType: DamageRecipientType.PLAYER,
            amount: finalDamage,
            isCombatDamage: true,
            characteristics: directDamageCharacteristics,
          });

          currentState = {
            ...currentState,
            players: currentState.players.map(p =>
              p.id === attacker.defendingPlayerId
                ? { ...p, life: (p.life || 40) + processed.lifeChange }
                : p
            ),
          };
          currentState = applyPoisonCountersToPlayer(currentState, attacker.defendingPlayerId, processed.poisonCounters);
          logs.push(...processed.log);

          if (processed.lifelinkHealing > 0 && controllerId) {
            const currentGain = lifelinkGain.get(controllerId) || 0;
            lifelinkGain.set(controllerId, currentGain + processed.lifelinkHealing);
          }
        } else {
          const newLife = (defender.life || 40) - finalDamage;

          currentState = {
            ...currentState,
            players: currentState.players.map(p =>
              p.id === attacker.defendingPlayerId
                ? { ...p, life: newLife }
                : p
            ),
          };

          logs.push(`${creature?.name || 'Creature'} deals ${finalDamage} combat damage to ${attacker.defendingPlayerId}`);

          // Apply lifelink for damage dealt to player (Rule 702.15b)
          if (creatureHasLifelink && controllerId) {
            const currentGain = lifelinkGain.get(controllerId) || 0;
            lifelinkGain.set(controllerId, currentGain + finalDamage);
          }
        }
        
        // Handle commander damage
        if (creature?.isCommander) {
          const commanderDamage = defender.commanderDamage || {};
          const commanderId = creature.id;
          const totalCommanderDamage = (commanderDamage[commanderId] || 0) + finalDamage;
          
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
  const lifelinkEntries = Array.from(lifelinkGain.entries());
  for (const [playerId, lifeGained] of lifelinkEntries) {
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
