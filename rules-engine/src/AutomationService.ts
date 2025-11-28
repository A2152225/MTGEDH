/**
 * AutomationService.ts
 * 
 * Core automation service for MTG Online-like gameplay automation.
 * 
 * This service handles:
 * 1. Automatic resolution of effects that don't require player decisions
 * 2. Detection of when player decisions are needed (targets, modes, X values)
 * 3. Auto-calculation of combat damage
 * 4. Auto-tapping of mana sources for spell costs
 * 5. Trigger ordering when multiple triggers happen simultaneously
 * 
 * Design Philosophy:
 * - The game engine handles ALL mechanical aspects automatically
 * - Players only make meaningful decisions (targets, modes, X values, etc.)
 * - Priority passes automatically when no actions are available
 * - Combat damage is calculated and applied automatically
 */

import type { GameState, BattlefieldPermanent, StackItem, PlayerRef, ManaPool } from '../../shared/src';

/**
 * Types of decisions that require player input
 */
export enum DecisionType {
  // Targeting
  SELECT_TARGETS = 'select_targets',
  SELECT_ADDITIONAL_TARGETS = 'select_additional_targets',
  
  // Modal spells
  SELECT_MODE = 'select_mode',
  SELECT_MODES = 'select_modes',  // For "choose two" etc.
  
  // X spells
  SELECT_X_VALUE = 'select_x_value',
  
  // Mana payment
  SELECT_MANA_PAYMENT = 'select_mana_payment', // For hybrid/phyrexian mana
  
  // Triggers
  ORDER_TRIGGERS = 'order_triggers',
  
  // Combat
  SELECT_ATTACKERS = 'select_attackers',
  SELECT_BLOCKERS = 'select_blockers',
  ORDER_BLOCKERS = 'order_blockers',       // Attacker blocked by multiple creatures
  ASSIGN_COMBAT_DAMAGE = 'assign_combat_damage', // When damage must be assigned to multiple
  
  // Other choices
  SELECT_OPTION = 'select_option',         // Generic choice from options
  SELECT_CARDS = 'select_cards',           // Choose cards (from hand, library, etc.)
  SELECT_PLAYER = 'select_player',
  SELECT_PERMANENT = 'select_permanent',
  SELECT_CREATURE_TYPE = 'select_creature_type',
  SELECT_COLOR = 'select_color',
  
  // May abilities
  MAY_ABILITY = 'may_ability',             // Optional "may" trigger
  
  // Replacement effects
  CHOOSE_REPLACEMENT = 'choose_replacement', // Multiple replacement effects apply
  
  // Mulligan
  MULLIGAN_DECISION = 'mulligan_decision',
  MULLIGAN_BOTTOM = 'mulligan_bottom',     // Choose cards to put on bottom
}

/**
 * Pending decision that requires player input
 */
export interface PendingDecision {
  id: string;
  type: DecisionType;
  playerId: string;
  sourceId?: string;           // Card/ability that caused this decision
  sourceName?: string;
  description: string;         // Human-readable description
  
  // Context for the decision
  options?: DecisionOption[];  // Available choices
  minSelections?: number;      // Minimum selections required
  maxSelections?: number;      // Maximum selections allowed
  filters?: SelectionFilter[]; // Filters for valid selections
  
  // For targeting
  targetTypes?: string[];      // Types of valid targets
  
  // For X values
  minX?: number;
  maxX?: number;
  
  // For mana payment
  manaCost?: string;           // The cost to pay
  
  // Timeout (optional)
  timeoutMs?: number;
  createdAt: number;
  
  // Is this decision mandatory?
  mandatory: boolean;
  
  // Default choice if timeout or auto-pass
  defaultChoice?: any;
}

/**
 * Option for player to choose from
 */
export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  imageUrl?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Filter for valid selections
 */
export interface SelectionFilter {
  type: 'card_type' | 'color' | 'controller' | 'zone' | 'name' | 'custom';
  value: string | string[];
}

/**
 * Result of processing a decision
 */
export interface DecisionResult {
  success: boolean;
  error?: string;
  continueAutomation: boolean; // Should automation continue after this decision?
}

/**
 * Automation context passed to automation functions
 */
export interface AutomationContext {
  gameId: string;
  state: GameState;
  emit: (event: any) => void;
}

/**
 * Result of automation step
 */
export interface AutomationResult {
  state: GameState;
  pendingDecisions: PendingDecision[];
  log: string[];
  shouldContinue: boolean;      // Should automation continue?
  stateChanged: boolean;        // Did the state change?
}

/**
 * Check if a stack item requires player decisions to resolve
 */
export function requiresDecisionToResolve(item: StackItem, state: GameState): {
  requires: boolean;
  decisions: PendingDecision[];
} {
  const decisions: PendingDecision[] = [];
  const card = item.card as any;
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const typeLine = (card?.type_line || '').toLowerCase();
  
  // Check if spell has targets but none selected
  if (requiresTargets(oracleText) && (!item.targets || item.targets.length === 0)) {
    decisions.push({
      id: `decision_${Date.now()}_target`,
      type: DecisionType.SELECT_TARGETS,
      playerId: item.controller,
      sourceId: item.id,
      sourceName: card?.name,
      description: `Choose targets for ${card?.name}`,
      targetTypes: parseTargetTypes(oracleText),
      minSelections: countMinTargets(oracleText),
      maxSelections: countMaxTargets(oracleText),
      mandatory: !oracleText.includes('up to'),
      createdAt: Date.now(),
    });
  }
  
  // Check for modal spells
  if (isModalSpell(oracleText)) {
    const modes = parseModes(oracleText);
    if (modes.length > 0) {
      const { min, max } = countModeSelection(oracleText);
      decisions.push({
        id: `decision_${Date.now()}_mode`,
        type: min > 1 ? DecisionType.SELECT_MODES : DecisionType.SELECT_MODE,
        playerId: item.controller,
        sourceId: item.id,
        sourceName: card?.name,
        description: `Choose ${min === max ? min : `${min}-${max}`} mode(s) for ${card?.name}`,
        options: modes.map((m, i) => ({ id: `mode_${i}`, label: m })),
        minSelections: min,
        maxSelections: max,
        mandatory: true,
        createdAt: Date.now(),
      });
    }
  }
  
  // Check for X spells
  if (hasXInCost(card?.mana_cost) || hasXInText(oracleText)) {
    decisions.push({
      id: `decision_${Date.now()}_x`,
      type: DecisionType.SELECT_X_VALUE,
      playerId: item.controller,
      sourceId: item.id,
      sourceName: card?.name,
      description: `Choose value of X for ${card?.name}`,
      minX: 0,
      mandatory: true,
      createdAt: Date.now(),
    });
  }
  
  return {
    requires: decisions.length > 0,
    decisions,
  };
}

/**
 * Check if oracle text indicates the spell targets
 */
function requiresTargets(oracleText: string): boolean {
  return /\btarget\b/.test(oracleText);
}

/**
 * Parse target types from oracle text
 */
function parseTargetTypes(oracleText: string): string[] {
  const types: string[] = [];
  
  // Common target patterns
  if (/target creature/.test(oracleText)) types.push('creature');
  if (/target player/.test(oracleText)) types.push('player');
  if (/target opponent/.test(oracleText)) types.push('opponent');
  if (/target permanent/.test(oracleText)) types.push('permanent');
  if (/target artifact/.test(oracleText)) types.push('artifact');
  if (/target enchantment/.test(oracleText)) types.push('enchantment');
  if (/target planeswalker/.test(oracleText)) types.push('planeswalker');
  if (/target land/.test(oracleText)) types.push('land');
  if (/target spell/.test(oracleText)) types.push('spell');
  if (/target creature or player/.test(oracleText)) types.push('creature', 'player');
  if (/any target/.test(oracleText)) types.push('creature', 'player', 'planeswalker', 'battle');
  
  return types.length > 0 ? types : ['permanent']; // Default to permanent if unclear
}

/**
 * Count minimum targets required
 */
function countMinTargets(oracleText: string): number {
  if (/up to (\w+) target/i.test(oracleText)) return 0;
  
  const match = oracleText.match(/target (\w+) (creature|permanent|player|artifact|enchantment)s?/i);
  if (match) {
    const word = match[1].toLowerCase();
    const numbers: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      a: 1, an: 1,
    };
    return numbers[word] || 1;
  }
  
  return 1;
}

/**
 * Count maximum targets
 */
function countMaxTargets(oracleText: string): number {
  const upToMatch = oracleText.match(/up to (\w+) target/i);
  if (upToMatch) {
    const word = upToMatch[1].toLowerCase();
    const numbers: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
    };
    return numbers[word] || 1;
  }
  
  return countMinTargets(oracleText);
}

/**
 * Check if spell is modal (choose one, choose two, etc.)
 */
function isModalSpell(oracleText: string): boolean {
  return /choose (one|two|three|four|any number)/i.test(oracleText) ||
         /\n•/.test(oracleText); // Bullet points indicate modes
}

/**
 * Parse modes from oracle text
 */
function parseModes(oracleText: string): string[] {
  // Look for bullet point modes
  const bulletModes = oracleText.match(/• .+?(?=\n•|\n\n|$)/g);
  if (bulletModes) {
    return bulletModes.map(m => m.replace('• ', '').trim());
  }
  
  // Look for em-dash modes
  const dashModes = oracleText.match(/— .+?(?=\n—|\n\n|$)/g);
  if (dashModes) {
    return dashModes.map(m => m.replace('— ', '').trim());
  }
  
  return [];
}

/**
 * Count how many modes to select
 */
function countModeSelection(oracleText: string): { min: number; max: number } {
  if (/choose two/i.test(oracleText)) return { min: 2, max: 2 };
  if (/choose three/i.test(oracleText)) return { min: 3, max: 3 };
  if (/choose one or more/i.test(oracleText)) return { min: 1, max: 10 };
  if (/choose any number/i.test(oracleText)) return { min: 0, max: 10 };
  if (/choose up to two/i.test(oracleText)) return { min: 0, max: 2 };
  return { min: 1, max: 1 };
}

/**
 * Check if mana cost contains X
 */
function hasXInCost(manaCost?: string): boolean {
  return !!manaCost && /\{X\}/i.test(manaCost);
}

/**
 * Check if oracle text uses X
 */
function hasXInText(oracleText: string): boolean {
  return /\bX\b/.test(oracleText) && !/\bexile\b/i.test(oracleText.split(/\bX\b/)[0] || '');
}

/**
 * Auto-calculate and apply combat damage
 */
export function calculateCombatDamage(state: GameState): {
  damageAssignments: CombatDamageAssignment[];
  requiresPlayerInput: boolean;
  pendingDecisions: PendingDecision[];
} {
  const assignments: CombatDamageAssignment[] = [];
  const pendingDecisions: PendingDecision[] = [];
  let requiresPlayerInput = false;
  
  const battlefield = state.battlefield || [];
  const attackers = battlefield.filter((p: BattlefieldPermanent) => p.attacking);
  
  for (const attacker of attackers) {
    const card = attacker.card as any;
    const power = parseInt(card?.power || '0', 10);
    const blockers = attacker.blockedBy || [];
    
    if (blockers.length === 0) {
      // Unblocked - damage goes to defending player
      const defendingPlayer = attacker.attacking as string;
      assignments.push({
        sourceId: attacker.id,
        sourceName: card?.name,
        targetId: defendingPlayer,
        targetType: 'player',
        damage: power,
        isLethal: false,
      });
    } else if (blockers.length === 1) {
      // Single blocker - damage goes to it
      const blocker = battlefield.find((p: BattlefieldPermanent) => p.id === blockers[0]);
      if (blocker) {
        assignments.push({
          sourceId: attacker.id,
          sourceName: card?.name,
          targetId: blockers[0],
          targetType: 'creature',
          damage: power,
          isLethal: power >= parseInt((blocker.card as any)?.toughness || '1', 10),
        });
      }
    } else {
      // Multiple blockers - attacker's controller must order them and assign damage
      requiresPlayerInput = true;
      pendingDecisions.push({
        id: `decision_${Date.now()}_damage_${attacker.id}`,
        type: DecisionType.ORDER_BLOCKERS,
        playerId: attacker.controller,
        sourceId: attacker.id,
        sourceName: card?.name,
        description: `Order blockers for ${card?.name} and assign ${power} damage`,
        options: blockers.map(id => {
          const b = battlefield.find((p: BattlefieldPermanent) => p.id === id);
          return {
            id,
            label: (b?.card as any)?.name || 'Blocker',
          };
        }),
        mandatory: true,
        createdAt: Date.now(),
      });
    }
  }
  
  // Process blockers dealing damage to attackers
  const blockers = battlefield.filter((p: BattlefieldPermanent) => 
    p.blocking && p.blocking.length > 0
  );
  
  for (const blocker of blockers) {
    const card = blocker.card as any;
    const power = parseInt(card?.power || '0', 10);
    
    // Blockers can only deal damage to one attacker they're blocking
    // (unless first strike/double strike is involved)
    if (blocker.blocking && blocker.blocking.length > 0) {
      const attackerId = blocker.blocking[0];
      assignments.push({
        sourceId: blocker.id,
        sourceName: card?.name,
        targetId: attackerId,
        targetType: 'creature',
        damage: power,
        isLethal: false, // Will be calculated when applied
      });
    }
  }
  
  return {
    damageAssignments: assignments,
    requiresPlayerInput,
    pendingDecisions,
  };
}

/**
 * Combat damage assignment
 */
export interface CombatDamageAssignment {
  sourceId: string;
  sourceName?: string;
  targetId: string;
  targetType: 'creature' | 'player' | 'planeswalker';
  damage: number;
  isLethal: boolean;
  isFirstStrike?: boolean;
  hasLifelink?: boolean;
  hasTrample?: boolean;
  hasDeathtouch?: boolean;
}

/**
 * Apply combat damage assignments to game state
 */
export function applyCombatDamage(
  state: GameState,
  assignments: CombatDamageAssignment[]
): { state: GameState; log: string[] } {
  let updatedState = { ...state };
  const log: string[] = [];
  
  for (const assignment of assignments) {
    if (assignment.targetType === 'player') {
      // Damage to player
      const updatedPlayers = updatedState.players.map(p => {
        if (p.id === assignment.targetId) {
          const newLife = (p.life || 0) - assignment.damage;
          log.push(`${assignment.sourceName} deals ${assignment.damage} damage to ${p.name} (${newLife} life)`);
          return { ...p, life: newLife };
        }
        return p;
      });
      updatedState = { ...updatedState, players: updatedPlayers };
    } else if (assignment.targetType === 'creature') {
      // Damage to creature - mark damage
      const updatedBattlefield = (updatedState.battlefield || []).map((p: BattlefieldPermanent) => {
        if (p.id === assignment.targetId) {
          const currentDamage = (p as any).damage || 0;
          const newDamage = currentDamage + assignment.damage;
          log.push(`${assignment.sourceName} deals ${assignment.damage} damage to ${(p.card as any)?.name}`);
          return { ...p, damage: newDamage } as any;
        }
        return p;
      });
      updatedState = { ...updatedState, battlefield: updatedBattlefield };
    } else if (assignment.targetType === 'planeswalker') {
      // Damage to planeswalker - remove loyalty
      const updatedBattlefield = (updatedState.battlefield || []).map((p: BattlefieldPermanent) => {
        if (p.id === assignment.targetId) {
          const currentLoyalty = p.loyalty || 0;
          const newLoyalty = Math.max(0, currentLoyalty - assignment.damage);
          log.push(`${assignment.sourceName} deals ${assignment.damage} damage to ${(p.card as any)?.name} (${newLoyalty} loyalty)`);
          return { ...p, loyalty: newLoyalty };
        }
        return p;
      });
      updatedState = { ...updatedState, battlefield: updatedBattlefield };
    }
    
    // Apply lifelink
    if (assignment.hasLifelink && assignment.damage > 0) {
      const source = (updatedState.battlefield || []).find(
        (p: BattlefieldPermanent) => p.id === assignment.sourceId
      );
      if (source) {
        const updatedPlayers = updatedState.players.map(p => {
          if (p.id === source.controller) {
            const newLife = (p.life || 0) + assignment.damage;
            log.push(`${p.name} gains ${assignment.damage} life from lifelink`);
            return { ...p, life: newLife };
          }
          return p;
        });
        updatedState = { ...updatedState, players: updatedPlayers };
      }
    }
  }
  
  return { state: updatedState, log };
}

/**
 * Auto-tap mana sources to pay for a spell cost
 */
export function autoTapForMana(
  state: GameState,
  playerId: string,
  manaCost: string
): {
  success: boolean;
  tappedPermanents: string[];
  manaProduced: ManaPool;
  remainingCost?: string;
  error?: string;
} {
  const cost = parseManaCost(manaCost);
  const battlefield = state.battlefield || [];
  const playerLands = battlefield.filter((p: BattlefieldPermanent) => 
    p.controller === playerId && 
    !p.tapped &&
    isManSource(p)
  );
  
  const tappedPermanents: string[] = [];
  const manaProduced: ManaPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  
  // First, pay colored costs with matching sources
  for (const [color, amount] of Object.entries(cost.colored)) {
    let remaining = amount;
    
    for (const land of playerLands) {
      if (remaining <= 0) break;
      if (tappedPermanents.includes(land.id)) continue;
      
      const producedColor = getManaColor(land);
      if (producedColor.includes(color as any)) {
        tappedPermanents.push(land.id);
        manaProduced[color as keyof ManaPool] = (manaProduced[color as keyof ManaPool] || 0) + 1;
        remaining--;
      }
    }
    
    if (remaining > 0) {
      return {
        success: false,
        tappedPermanents: [],
        manaProduced: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        error: `Not enough ${color} mana sources`,
      };
    }
  }
  
  // Then, pay generic cost with remaining sources
  let genericRemaining = cost.generic;
  for (const land of playerLands) {
    if (genericRemaining <= 0) break;
    if (tappedPermanents.includes(land.id)) continue;
    
    tappedPermanents.push(land.id);
    const producedColor = getManaColor(land)[0] || 'colorless';
    manaProduced[producedColor as keyof ManaPool] = (manaProduced[producedColor as keyof ManaPool] || 0) + 1;
    genericRemaining--;
  }
  
  if (genericRemaining > 0) {
    return {
      success: false,
      tappedPermanents: [],
      manaProduced: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      error: `Not enough mana sources for generic cost`,
    };
  }
  
  return {
    success: true,
    tappedPermanents,
    manaProduced,
  };
}

/**
 * Parse mana cost string into structured format
 */
function parseManaCost(cost: string): { generic: number; colored: Record<string, number> } {
  const tokens = cost.match(/\{[^}]+\}/g) || [];
  let generic = 0;
  const colored: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0 };
  
  for (const token of tokens) {
    const symbol = token.replace(/[{}]/g, '').toUpperCase();
    if (/^\d+$/.test(symbol)) {
      generic += parseInt(symbol, 10);
    } else if (symbol === 'W') {
      colored.white++;
    } else if (symbol === 'U') {
      colored.blue++;
    } else if (symbol === 'B') {
      colored.black++;
    } else if (symbol === 'R') {
      colored.red++;
    } else if (symbol === 'G') {
      colored.green++;
    }
  }
  
  return { generic, colored };
}

/**
 * Check if a permanent is a mana source
 */
function isManSource(perm: BattlefieldPermanent): boolean {
  const card = perm.card as any;
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  
  // Basic lands and lands that produce mana
  if (typeLine.includes('land')) {
    // Check it actually produces mana (not a fetch land)
    if (oracleText.includes('add') && !oracleText.includes('search')) {
      return true;
    }
    // Basic lands always produce mana
    if (typeLine.includes('basic')) {
      return true;
    }
    // Check for basic land types
    if (/plains|island|swamp|mountain|forest/.test(typeLine)) {
      return true;
    }
  }
  
  // Mana rocks
  if (typeLine.includes('artifact') && oracleText.includes('add')) {
    return true;
  }
  
  // Mana creatures (like Birds of Paradise, Llanowar Elves)
  if (typeLine.includes('creature') && oracleText.includes('add') && oracleText.includes('{t}')) {
    return !perm.summoningSickness;
  }
  
  return false;
}

/**
 * Get mana colors a permanent can produce
 */
function getManaColor(perm: BattlefieldPermanent): string[] {
  const card = perm.card as any;
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const colors: string[] = [];
  
  // Check basic land types
  if (typeLine.includes('plains') || oracleText.includes('add {w}')) colors.push('white');
  if (typeLine.includes('island') || oracleText.includes('add {u}')) colors.push('blue');
  if (typeLine.includes('swamp') || oracleText.includes('add {b}')) colors.push('black');
  if (typeLine.includes('mountain') || oracleText.includes('add {r}')) colors.push('red');
  if (typeLine.includes('forest') || oracleText.includes('add {g}')) colors.push('green');
  
  // Check for colorless
  if (oracleText.includes('add {c}') || oracleText.includes('add {1}')) colors.push('colorless');
  
  // If any color mentioned
  if (oracleText.includes('any color')) {
    return ['white', 'blue', 'black', 'red', 'green'];
  }
  
  return colors.length > 0 ? colors : ['colorless'];
}

/**
 * Check if player has any actions available
 * Used to determine if we should auto-pass priority
 */
export function hasAvailableActions(state: GameState, playerId: string): boolean {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  
  const isActivePlayer = state.players[state.activePlayerIndex || 0]?.id === playerId;
  const phaseStr = String(state.phase || '').toLowerCase();
  const isMainPhase = phaseStr.includes('main') || phaseStr === 'precombatmain' || phaseStr === 'postcombatmain';
  const stackEmpty = !state.stack || state.stack.length === 0;
  
  // Check for playable lands
  if (isActivePlayer && isMainPhase && stackEmpty) {
    const landsPlayed = (state as any).landsPlayedThisTurn?.[playerId] || 0;
    const hand = (player as any).hand || [];
    const hasPlayableLand = hand.some((c: any) => 
      (c?.type_line || '').toLowerCase().includes('land') && landsPlayed < 1
    );
    if (hasPlayableLand) return true;
  }
  
  // Check for castable spells
  const hand = (player as any).hand || [];
  for (const card of hand) {
    if (!card) continue;
    const typeLine = (card.type_line || '').toLowerCase();
    
    // Skip lands
    if (typeLine.includes('land')) continue;
    
    // Check if spell can be cast at this time
    const isInstant = typeLine.includes('instant') || 
                     (card.oracle_text || '').toLowerCase().includes('flash');
    
    if (isInstant) {
      // Can always cast instants with priority
      return true;
    } else if (isActivePlayer && isMainPhase && stackEmpty) {
      // Can cast sorcery-speed spells during main phase
      return true;
    }
  }
  
  // Check for activatable abilities on battlefield
  const battlefield = state.battlefield || [];
  for (const perm of battlefield) {
    if ((perm as BattlefieldPermanent).controller !== playerId) continue;
    
    const card = (perm as BattlefieldPermanent).card as any;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Check for activated abilities (look for colon)
    if (oracleText.includes(':')) {
      // Check if it's a tap ability and the permanent isn't tapped
      if (oracleText.includes('{t}:') && (perm as BattlefieldPermanent).tapped) {
        continue;
      }
      return true;
    }
  }
  
  return false;
}

/**
 * Process triggered abilities and put them on the stack
 */
export function processTriggeredAbilities(
  state: GameState,
  event: { type: string; data: any }
): {
  state: GameState;
  pendingDecisions: PendingDecision[];
  triggersProcessed: number;
} {
  const pendingDecisions: PendingDecision[] = [];
  const battlefield = state.battlefield || [];
  const triggersToAdd: StackItem[] = [];
  
  // Find all triggered abilities that trigger from this event
  for (const perm of battlefield) {
    const card = (perm as BattlefieldPermanent).card as any;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Check for matching trigger
    const triggerMatch = matchTrigger(oracleText, event.type);
    if (triggerMatch.triggers) {
      // Create stack item for the trigger
      const triggerId = `trigger_${Date.now()}_${perm.id}`;
      
      // Check if trigger requires decisions (targets, modes, etc.)
      if (triggerMatch.requiresTarget) {
        pendingDecisions.push({
          id: `decision_${triggerId}`,
          type: DecisionType.SELECT_TARGETS,
          playerId: (perm as BattlefieldPermanent).controller,
          sourceId: perm.id,
          sourceName: card?.name,
          description: `Choose target for ${card?.name}'s triggered ability`,
          targetTypes: triggerMatch.targetTypes,
          minSelections: 1,
          maxSelections: 1,
          mandatory: !oracleText.includes('you may'),
          createdAt: Date.now(),
        });
      }
      
      // Check for "may" triggers
      if (oracleText.includes('you may') && !triggerMatch.requiresTarget) {
        pendingDecisions.push({
          id: `decision_${triggerId}`,
          type: DecisionType.MAY_ABILITY,
          playerId: (perm as BattlefieldPermanent).controller,
          sourceId: perm.id,
          sourceName: card?.name,
          description: `${card?.name}: ${triggerMatch.effectText}`,
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
          mandatory: false,
          defaultChoice: 'no',
          createdAt: Date.now(),
        });
      }
      
      triggersToAdd.push({
        id: triggerId,
        type: 'ability',
        controller: (perm as BattlefieldPermanent).controller,
        card: card,
        targets: [],
      });
    }
  }
  
  // If multiple triggers for same controller, may need to order them
  const triggersByController = new Map<string, StackItem[]>();
  for (const trigger of triggersToAdd) {
    const existing = triggersByController.get(trigger.controller) || [];
    existing.push(trigger);
    triggersByController.set(trigger.controller, existing);
  }
  
  // Add ordering decision if multiple triggers for one player
  for (const entry of Array.from(triggersByController.entries())) {
    const [controller, triggers] = entry;
    if (triggers.length > 1) {
      pendingDecisions.push({
        id: `decision_${Date.now()}_order`,
        type: DecisionType.ORDER_TRIGGERS,
        playerId: controller,
        description: 'Order your triggered abilities on the stack',
        options: triggers.map(t => ({
          id: t.id,
          label: (t.card as any)?.name || 'Triggered Ability',
        })),
        minSelections: triggers.length,
        maxSelections: triggers.length,
        mandatory: true,
        createdAt: Date.now(),
      });
    }
  }
  
  // Add triggers to stack (APNAP order if no player ordering needed)
  const newStack = [...(state.stack || []), ...triggersToAdd];
  
  return {
    state: { ...state, stack: newStack },
    pendingDecisions,
    triggersProcessed: triggersToAdd.length,
  };
}

/**
 * Match a trigger event to oracle text patterns
 */
function matchTrigger(oracleText: string, eventType: string): {
  triggers: boolean;
  requiresTarget: boolean;
  targetTypes?: string[];
  effectText?: string;
} {
  // Map event types to trigger patterns
  const patterns: Record<string, RegExp[]> = {
    'enters_battlefield': [
      /when .* enters( the battlefield)?/i,
      /whenever .* enters( the battlefield)?/i,
    ],
    'dies': [
      /when .* dies/i,
      /whenever .* dies/i,
    ],
    'attacks': [
      /when .* attacks/i,
      /whenever .* attacks/i,
    ],
    'deals_damage': [
      /when .* deals damage/i,
      /whenever .* deals damage/i,
    ],
    'cast_spell': [
      /when you cast/i,
      /whenever you cast/i,
      /whenever a player casts/i,
    ],
  };
  
  const eventPatterns = patterns[eventType];
  if (!eventPatterns) {
    return { triggers: false, requiresTarget: false };
  }
  
  for (const pattern of eventPatterns) {
    if (pattern.test(oracleText)) {
      // Extract effect text
      const effectMatch = oracleText.match(/(?:when|whenever)[^,]+,\s*(.+)/i);
      const effectText = effectMatch ? effectMatch[1] : '';
      
      // Check if requires target
      const requiresTarget = /target/.test(effectText);
      const targetTypes = requiresTarget ? parseTargetTypes(effectText) : undefined;
      
      return {
        triggers: true,
        requiresTarget,
        targetTypes,
        effectText,
      };
    }
  }
  
  return { triggers: false, requiresTarget: false };
}

/**
 * Main automation loop - processes automatic game actions
 */
export function runAutomation(context: AutomationContext): AutomationResult {
  let state = context.state;
  const pendingDecisions: PendingDecision[] = [];
  const log: string[] = [];
  let stateChanged = false;
  
  // Check for pending decisions first
  const existingDecisions = (state as any).pendingDecisions || [];
  if (existingDecisions.length > 0) {
    return {
      state,
      pendingDecisions: existingDecisions,
      log: ['Waiting for player decisions'],
      shouldContinue: false,
      stateChanged: false,
    };
  }
  
  // Check state-based actions
  const sbaResult = checkStateBasedActions(state);
  if (sbaResult.actionsPerformed > 0) {
    state = sbaResult.state;
    log.push(...sbaResult.log);
    stateChanged = true;
  }
  
  // Check for triggers to process
  // (This would be called after specific events)
  
  // Check if stack needs to resolve
  if (state.stack && state.stack.length > 0) {
    const topItem = state.stack[state.stack.length - 1];
    const decisionCheck = requiresDecisionToResolve(topItem, state);
    
    if (decisionCheck.requires) {
      return {
        state,
        pendingDecisions: decisionCheck.decisions,
        log: [`${(topItem.card as any)?.name} requires player decisions`],
        shouldContinue: false,
        stateChanged,
      };
    }
    
    // All players must pass priority before resolving
    // This is handled elsewhere (priority system)
  }
  
  // Check for automatic phase transitions
  const step = String(state.step || '').toLowerCase();
  
  // Untap step - automatic untap
  if (step === 'untap') {
    const untapResult = autoUntap(state);
    state = untapResult.state;
    log.push(...untapResult.log);
    stateChanged = true;
  }
  
  // Draw step - automatic draw (for active player)
  if (step === 'draw') {
    const drawResult = autoDraw(state);
    state = drawResult.state;
    log.push(...drawResult.log);
    stateChanged = true;
  }
  
  // Combat damage step - automatic damage
  if (step === 'combatdamage' || step === 'damage') {
    const damageCalc = calculateCombatDamage(state);
    if (damageCalc.requiresPlayerInput) {
      return {
        state,
        pendingDecisions: damageCalc.pendingDecisions,
        log: ['Combat damage requires player decisions'],
        shouldContinue: false,
        stateChanged,
      };
    }
    
    if (damageCalc.damageAssignments.length > 0) {
      const damageResult = applyCombatDamage(state, damageCalc.damageAssignments);
      state = damageResult.state;
      log.push(...damageResult.log);
      stateChanged = true;
    }
  }
  
  // Cleanup step - automatic discard and cleanup
  if (step === 'cleanup') {
    const cleanupResult = autoCleanup(state);
    if (cleanupResult.requiresDiscard) {
      return {
        state,
        pendingDecisions: cleanupResult.pendingDecisions,
        log: ['Cleanup requires discard decision'],
        shouldContinue: false,
        stateChanged,
      };
    }
    state = cleanupResult.state;
    log.push(...cleanupResult.log);
    stateChanged = true;
  }
  
  return {
    state,
    pendingDecisions,
    log,
    shouldContinue: stateChanged, // Continue if state changed (may need more SBAs)
    stateChanged,
  };
}

/**
 * Check state-based actions
 */
function checkStateBasedActions(state: GameState): {
  state: GameState;
  log: string[];
  actionsPerformed: number;
} {
  let updatedState = state;
  const log: string[] = [];
  let actionsPerformed = 0;
  
  // Check for creatures with lethal damage
  const battlefield = updatedState.battlefield || [];
  for (const perm of battlefield) {
    const card = (perm as BattlefieldPermanent).card as any;
    const typeLine = (card?.type_line || '').toLowerCase();
    
    if (typeLine.includes('creature')) {
      const toughness = parseInt(card?.toughness || '1', 10);
      const damage = (perm as any).damage || 0;
      
      if (damage >= toughness) {
        // Creature dies
        updatedState = moveCreatureToGraveyard(updatedState, (perm as BattlefieldPermanent));
        log.push(`${card?.name} dies from lethal damage`);
        actionsPerformed++;
      }
    }
    
    // Check planeswalkers with 0 loyalty
    if (typeLine.includes('planeswalker')) {
      const loyalty = (perm as BattlefieldPermanent).loyalty || 0;
      if (loyalty <= 0) {
        updatedState = moveCreatureToGraveyard(updatedState, (perm as BattlefieldPermanent));
        log.push(`${card?.name} dies from 0 loyalty`);
        actionsPerformed++;
      }
    }
  }
  
  // Check for players at 0 or less life
  for (const player of updatedState.players) {
    if ((player.life || 0) <= 0 && !player.hasLost) {
      updatedState = {
        ...updatedState,
        players: updatedState.players.map(p => 
          p.id === player.id ? { ...p, hasLost: true } : p
        ),
      };
      log.push(`${player.name} loses the game (0 or less life)`);
      actionsPerformed++;
    }
  }
  
  return { state: updatedState, log, actionsPerformed };
}

/**
 * Move a creature to its owner's graveyard
 */
function moveCreatureToGraveyard(state: GameState, perm: BattlefieldPermanent): GameState {
  const ownerId = perm.owner || perm.controller;
  
  return {
    ...state,
    battlefield: (state.battlefield || []).filter(p => p.id !== perm.id),
    players: state.players.map(p => {
      if (p.id === ownerId) {
        return {
          ...p,
          graveyard: [...(p.graveyard || []), perm.card],
        };
      }
      return p;
    }),
  };
}

/**
 * Auto-untap all permanents for active player
 */
function autoUntap(state: GameState): { state: GameState; log: string[] } {
  const activePlayerId = state.players[state.activePlayerIndex || 0]?.id;
  const log: string[] = [];
  
  const updatedBattlefield = (state.battlefield || []).map((perm: BattlefieldPermanent) => {
    if (perm.controller === activePlayerId && perm.tapped) {
      // Check for "doesn't untap" effects (simplified)
      const card = perm.card as any;
      const oracleText = (card?.oracle_text || '').toLowerCase();
      if (oracleText.includes("doesn't untap during")) {
        return perm;
      }
      
      log.push(`Untapped ${card?.name}`);
      return { ...perm, tapped: false };
    }
    return perm;
  });
  
  // Remove summoning sickness
  const withoutSickness = updatedBattlefield.map((perm: BattlefieldPermanent) => {
    if (perm.controller === activePlayerId && perm.summoningSickness) {
      return { ...perm, summoningSickness: false };
    }
    return perm;
  });
  
  return {
    state: { ...state, battlefield: withoutSickness },
    log: log.length > 0 ? log : ['Untap step completed'],
  };
}

/**
 * Auto-draw card for active player
 */
function autoDraw(state: GameState): { state: GameState; log: string[] } {
  const activePlayer = state.players[state.activePlayerIndex || 0];
  if (!activePlayer) {
    return { state, log: [] };
  }
  
  // Don't draw on first turn for first player in multiplayer
  if ((state.turn || 1) === 1 && state.players.length > 1) {
    return { state, log: ['First player skips first draw'] };
  }
  
  const library = (activePlayer as any).library || [];
  if (library.length === 0) {
    // Player loses for drawing from empty library (handled in SBA)
    return { state, log: [`${activePlayer.name} tries to draw from empty library`] };
  }
  
  const [drawnCard, ...remainingLibrary] = library;
  const hand = [...((activePlayer as any).hand || []), drawnCard];
  
  const updatedPlayers = state.players.map(p => {
    if (p.id === activePlayer.id) {
      return { ...p, library: remainingLibrary, hand };
    }
    return p;
  });
  
  return {
    state: { ...state, players: updatedPlayers },
    log: [`${activePlayer.name} draws a card`],
  };
}

/**
 * Auto-cleanup for end of turn
 */
function autoCleanup(state: GameState): {
  state: GameState;
  log: string[];
  requiresDiscard: boolean;
  pendingDecisions: PendingDecision[];
} {
  const activePlayer = state.players[state.activePlayerIndex || 0];
  const log: string[] = [];
  const pendingDecisions: PendingDecision[] = [];
  
  // Check for discard requirement
  const hand = (activePlayer as any).hand || [];
  const maxHandSize = 7; // Standard max hand size
  
  if (hand.length > maxHandSize) {
    const discardCount = hand.length - maxHandSize;
    pendingDecisions.push({
      id: `decision_${Date.now()}_discard`,
      type: DecisionType.SELECT_CARDS,
      playerId: activePlayer.id,
      description: `Discard ${discardCount} card(s) to hand size`,
      minSelections: discardCount,
      maxSelections: discardCount,
      mandatory: true,
      createdAt: Date.now(),
    });
    
    return {
      state,
      log: [`${activePlayer.name} must discard to hand size`],
      requiresDiscard: true,
      pendingDecisions,
    };
  }
  
  // Clear damage from creatures
  const updatedBattlefield = (state.battlefield || []).map((perm: BattlefieldPermanent) => {
    if ((perm as any).damage) {
      return { ...perm, damage: 0 };
    }
    return perm;
  });
  
  // Clear combat states
  const clearedCombat = updatedBattlefield.map((perm: BattlefieldPermanent) => ({
    ...perm,
    attacking: undefined,
    blocking: undefined,
    blockedBy: undefined,
  }));
  
  log.push('Cleanup step completed');
  
  return {
    state: { ...state, battlefield: clearedCombat },
    log,
    requiresDiscard: false,
    pendingDecisions: [],
  };
}

export default {
  runAutomation,
  calculateCombatDamage,
  applyCombatDamage,
  autoTapForMana,
  hasAvailableActions,
  requiresDecisionToResolve,
  processTriggeredAbilities,
};
