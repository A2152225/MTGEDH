/**
 * pillowfortEffects.ts
 * 
 * Implements "pillowfort" effects - card effects that impose additional costs
 * or restrictions on attacking. These are commonly used in defensive strategies
 * to discourage or prevent attacks.
 * 
 * Common pillowfort cards:
 * - Propaganda: Creatures can't attack you unless their controller pays {2} for each creature
 * - Ghostly Prison: Same as Propaganda
 * - Norn's Annex: Creatures can't attack you or planeswalkers you control unless 
 *                 their controller pays {W/P} for each creature
 * - Sphere of Safety: Can't attack unless controller pays {1} for each enchantment you control
 * - Windborn Muse: Propaganda on a creature
 * - Collective Restraint (domain): Pay {1} for each basic land type you control
 * - Baird, Steward of Argive: Pay {1} for each creature attacking you
 * - Archangel of Tithes: Pay {1} for each creature attacking you or planeswalkers you control
 * - War Tax: Pay {X} for each creature, where X is chosen by defender
 * 
 * Reference: These effects are triggered abilities that create attack restrictions
 * Rule 508.1d: Declare attackers step checks for attack restrictions and costs
 */

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { ManaCost } from './types/mana';

/**
 * Types of attack cost effects
 */
export enum AttackCostType {
  MANA_PER_CREATURE = 'mana_per_creature',      // Propaganda, Ghostly Prison
  MANA_PER_ENCHANTMENT = 'mana_per_enchantment', // Sphere of Safety
  PHYREXIAN_MANA = 'phyrexian_mana',            // Norn's Annex (pay mana or life)
  DOMAIN_MANA = 'domain_mana',                   // Collective Restraint
  VARIABLE_MANA = 'variable_mana',               // War Tax
  LIFE_PAYMENT = 'life_payment',                 // Effects that require life payment
  SACRIFICE = 'sacrifice',                       // Effects requiring sacrifice to attack
  CUSTOM = 'custom',                             // Other unique effects
}

/**
 * Represents an attack cost requirement from a pillowfort effect
 */
export interface AttackCostRequirement {
  readonly sourceId: string;          // ID of the permanent creating this effect
  readonly sourceName: string;        // Name of the source (for logging)
  readonly sourceControllerId: string; // Who controls the pillowfort permanent
  readonly type: AttackCostType;
  readonly manaCost?: ManaCost;       // Mana cost per creature (e.g., {2} for Propaganda)
  readonly lifeCost?: number;          // Life that can be paid instead of mana (Norn's Annex)
  readonly perCreatureAttacking?: boolean; // Is the cost per creature? (most are)
  readonly affectsCreatureController?: string; // Only affects specific controller (usually opponents)
  readonly targetType?: 'player' | 'planeswalker' | 'battle' | 'any'; // What's being defended
  readonly multiplierSourceType?: string; // For Sphere of Safety: enchantment count multiplier
  readonly customCondition?: string;   // For complex requirements
  readonly canPayWithLife?: boolean;   // For Phyrexian mana costs
}

/**
 * Result of checking attack costs for a player
 */
export interface AttackCostCheckResult {
  readonly canAffordAll: boolean;
  readonly requirements: AttackCostRequirement[];
  readonly totalManaCost: ManaCost;
  readonly totalLifeCost: number;
  readonly missingMana?: ManaCost;
  readonly insufficientResources?: string;
}

/**
 * Known pillowfort patterns to detect from oracle text
 */
const PILLOWFORT_PATTERNS: {
  pattern: RegExp;
  type: AttackCostType;
  extractor: (match: RegExpMatchArray, oracleText: string) => Partial<AttackCostRequirement>;
}[] = [
  // Propaganda / Ghostly Prison pattern
  // "Creatures can't attack you unless their controller pays {2} for each creature"
  {
    pattern: /creatures?\s+can't\s+attack\s+you\s+unless\s+.*pays?\s+\{(\d+)\}\s+(for\s+each\s+creature)?/i,
    type: AttackCostType.MANA_PER_CREATURE,
    extractor: (match, _text) => ({
      manaCost: { generic: parseInt(match[1], 10) },
      perCreatureAttacking: match[2] !== undefined,
      targetType: 'player',
    }),
  },
  
  // Norn's Annex pattern - Phyrexian mana
  // "{W/P} for each creature attacking you or a planeswalker you control"
  {
    pattern: /creatures?\s+can't\s+attack\s+you\s+.*unless\s+.*pays?\s+\{([WUBRG])\/P\}\s+(for\s+each\s+creature)?/i,
    type: AttackCostType.PHYREXIAN_MANA,
    extractor: (match, _text) => {
      const colorMap: Record<string, keyof ManaCost> = { 
        'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green' 
      };
      const color = colorMap[match[1].toUpperCase()] || 'white';
      return {
        manaCost: { [color]: 1 } as ManaCost,
        lifeCost: 2, // Phyrexian mana = 2 life
        canPayWithLife: true,
        perCreatureAttacking: match[2] !== undefined,
        targetType: 'any', // You or planeswalkers
      };
    },
  },
  
  // Sphere of Safety pattern
  // "Creatures can't attack you unless their controller pays {X} for each creature, where X is the number of enchantments you control"
  {
    pattern: /creatures?\s+can't\s+attack\s+you\s+unless\s+.*pays?\s+\{1\}\s+for\s+each\s+enchantment\s+you\s+control\s+for\s+each/i,
    type: AttackCostType.MANA_PER_ENCHANTMENT,
    extractor: (_match, _text) => ({
      manaCost: { generic: 1 }, // Base cost, multiplied by enchantment count
      perCreatureAttacking: true,
      multiplierSourceType: 'enchantment',
      targetType: 'player',
    }),
  },
  
  // Generic {X} for each creature pattern
  {
    pattern: /creatures?\s+can't\s+attack\s+you\s+unless\s+.*pays?\s+\{(\d+)\}/i,
    type: AttackCostType.MANA_PER_CREATURE,
    extractor: (match, _text) => ({
      manaCost: { generic: parseInt(match[1], 10) },
      perCreatureAttacking: true,
      targetType: 'player',
    }),
  },
  
  // Collective Restraint (domain) pattern
  // "Domain — Creatures can't attack you unless their controller pays {1} for each basic land type among lands you control"
  {
    pattern: /domain.*creatures?\s+can't\s+attack.*pays?\s+\{(\d+)\}\s+for\s+each\s+basic\s+land\s+type/i,
    type: AttackCostType.DOMAIN_MANA,
    extractor: (match, _text) => ({
      manaCost: { generic: parseInt(match[1], 10) },
      perCreatureAttacking: true,
      multiplierSourceType: 'basic_land_type',
      targetType: 'player',
    }),
  },
];

/**
 * Detect pillowfort effects from a permanent's oracle text
 * 
 * @param permanent - The permanent to check
 * @param controllerId - The controller of the permanent
 * @returns AttackCostRequirement if a pillowfort effect is found, null otherwise
 */
export function detectPillowfortEffect(
  permanent: BattlefieldPermanent | any,
  controllerId: string
): AttackCostRequirement | null {
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  const cardName = permanent.card?.name || permanent.name || 'Unknown';
  
  // Check for known pillowfort patterns
  for (const { pattern, type, extractor } of PILLOWFORT_PATTERNS) {
    const match = oracleText.match(pattern);
    if (match) {
      const extracted = extractor(match, oracleText);
      return {
        sourceId: permanent.id,
        sourceName: cardName,
        sourceControllerId: controllerId,
        type,
        perCreatureAttacking: true,
        ...extracted,
      };
    }
  }
  
  // Check modifiers for pillowfort effects applied by other cards
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'pillowfort' || mod.type === 'attackCost') {
        return {
          sourceId: permanent.id,
          sourceName: cardName,
          sourceControllerId: controllerId,
          type: mod.attackCostType || AttackCostType.MANA_PER_CREATURE,
          manaCost: mod.manaCost,
          lifeCost: mod.lifeCost,
          perCreatureAttacking: mod.perCreature !== false,
          targetType: mod.targetType || 'player',
          canPayWithLife: mod.canPayWithLife,
        };
      }
    }
  }
  
  return null;
}

/**
 * Collect all pillowfort effects that affect a specific defending player
 * 
 * @param state - The game state
 * @param defendingPlayerId - The player being attacked
 * @returns Array of all attack cost requirements
 */
export function collectPillowfortEffects(
  state: GameState,
  defendingPlayerId: string
): AttackCostRequirement[] {
  const requirements: AttackCostRequirement[] = [];
  
  // Check the defending player's centralized battlefield for pillowfort permanents
  const defender = state.players.find(p => p.id === defendingPlayerId);
  if (!defender) return requirements;
  
  // Check defender's permanents on centralized battlefield
  if (state.battlefield) {
    for (const permanent of state.battlefield as any[]) {
      if (permanent.controller === defendingPlayerId || permanent.controllerId === defendingPlayerId) {
        const effect = detectPillowfortEffect(permanent, defendingPlayerId);
        if (effect) {
          requirements.push(effect);
        }
      }
    }
  }
  
  return requirements;
}

/**
 * Calculate the total attack cost for a number of creatures attacking a player
 * 
 * @param requirements - All pillowfort requirements affecting this attack
 * @param attackingCreatureCount - Number of creatures attacking
 * @param state - Game state (for counting enchantments, etc.)
 * @param defendingPlayerId - The player being attacked
 * @returns The total mana cost required
 */
export function calculateTotalAttackCost(
  requirements: AttackCostRequirement[],
  attackingCreatureCount: number,
  state: GameState,
  defendingPlayerId: string
): { manaCost: ManaCost; lifeCostOption: number } {
  // Use a plain object for accumulation, then cast to ManaCost at the end
  const totalManaCost: Record<string, number> = {};
  let totalLifeCost = 0;
  
  const defender = state.players.find(p => p.id === defendingPlayerId);
  
  for (const req of requirements) {
    let multiplier = 1;
    
    // Calculate multiplier based on effect type
    if (req.perCreatureAttacking) {
      multiplier = attackingCreatureCount;
    }
    
    // Additional multiplier for enchantment-count effects (Sphere of Safety)
    if (req.multiplierSourceType === 'enchantment' && defender) {
      const enchantmentCount = (state.battlefield || []).filter((p: any) =>
        p.controller === defendingPlayerId &&
        (p.card?.type_line || '').toLowerCase().includes('enchantment')
      ).length;
      multiplier *= enchantmentCount;
    }
    
    // Domain multiplier (Collective Restraint)
    if (req.multiplierSourceType === 'basic_land_type' && defender) {
      const basicLandTypes = new Set<string>();
      // Count basic land types on centralized battlefield controlled by defender
      for (const perm of state.battlefield || [] as any[]) {
        if (perm.controller !== defender.id) continue;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        if (typeLine.includes('plains')) basicLandTypes.add('plains');
        if (typeLine.includes('island')) basicLandTypes.add('island');
        if (typeLine.includes('swamp')) basicLandTypes.add('swamp');
        if (typeLine.includes('mountain')) basicLandTypes.add('mountain');
        if (typeLine.includes('forest')) basicLandTypes.add('forest');
      }
      multiplier *= basicLandTypes.size;
    }
    
    // Add to total mana cost
    if (req.manaCost) {
      for (const [color, amount] of Object.entries(req.manaCost)) {
        if (typeof amount === 'number') {
          totalManaCost[color] = (totalManaCost[color] || 0) + (amount * multiplier);
        }
      }
    }
    
    // Track life payment option
    if (req.canPayWithLife && req.lifeCost) {
      totalLifeCost += req.lifeCost * multiplier;
    }
  }
  
  return {
    manaCost: totalManaCost as ManaCost,
    lifeCostOption: totalLifeCost,
  };
}

/**
 * Check if an attacker can pay the pillowfort costs to attack a player
 * 
 * @param state - Game state
 * @param attackingPlayerId - The player attacking
 * @param defendingPlayerId - The player being attacked
 * @param attackingCreatureCount - Number of creatures attacking this defender
 * @returns Result with cost breakdown and whether it can be afforded
 */
export function checkAttackCosts(
  state: GameState,
  attackingPlayerId: string,
  defendingPlayerId: string,
  attackingCreatureCount: number
): AttackCostCheckResult {
  const requirements = collectPillowfortEffects(state, defendingPlayerId);
  
  if (requirements.length === 0) {
    return {
      canAffordAll: true,
      requirements: [],
      totalManaCost: {},
      totalLifeCost: 0,
    };
  }
  
  const { manaCost, lifeCostOption } = calculateTotalAttackCost(
    requirements,
    attackingCreatureCount,
    state,
    defendingPlayerId
  );
  
  // Check if attacker can afford the mana cost
  const attacker = state.players.find(p => p.id === attackingPlayerId);
  if (!attacker) {
    return {
      canAffordAll: false,
      requirements,
      totalManaCost: manaCost,
      totalLifeCost: lifeCostOption,
      insufficientResources: 'Attacking player not found',
    };
  }
  
  const manaPool = attacker.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  
  // Calculate if mana can cover the cost
  let canPayWithMana = true;
  let genericNeeded = manaCost.generic || 0;
  // Use a plain Record for accumulation
  const missingManaMut: Record<string, number> = {};
  
  // Check colored mana requirements
  for (const color of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
    const needed = manaCost[color] || 0;
    const available = manaPool[color] || 0;
    if (needed > available) {
      missingManaMut[color] = needed - available;
      canPayWithMana = false;
    }
  }
  
  // Check if remaining mana can cover generic
  const totalAvailable = 
    (manaPool.white || 0) + (manaPool.blue || 0) + (manaPool.black || 0) +
    (manaPool.red || 0) + (manaPool.green || 0) + (manaPool.colorless || 0);
  const coloredSpent = 
    (manaCost.white || 0) + (manaCost.blue || 0) + (manaCost.black || 0) +
    (manaCost.red || 0) + (manaCost.green || 0) + (manaCost.colorless || 0);
  const remainingAfterColored = totalAvailable - coloredSpent;
  
  if (genericNeeded > remainingAfterColored) {
    missingManaMut['generic'] = genericNeeded - remainingAfterColored;
    canPayWithMana = false;
  }
  
  // Cast to readonly ManaCost for return
  const missingMana = missingManaMut as ManaCost;
  
  // Check if player can pay with life instead (for Phyrexian mana effects)
  // Players can pay life even if it would reduce them to 0 or below (they'd just lose the game after)
  const canPayWithLife = lifeCostOption > 0 && (attacker.life || 0) >= lifeCostOption;
  
  return {
    canAffordAll: canPayWithMana || canPayWithLife,
    requirements,
    totalManaCost: manaCost,
    totalLifeCost: lifeCostOption,
    missingMana: Object.keys(missingMana).length > 0 ? missingMana : undefined,
    insufficientResources: !canPayWithMana && !canPayWithLife 
      ? 'Cannot afford attack costs' 
      : undefined,
  };
}

/**
 * Get a human-readable description of the attack cost
 */
export function getAttackCostDescription(
  requirements: AttackCostRequirement[],
  attackingCreatureCount: number,
  totalManaCost: ManaCost,
  totalLifeCost: number
): string {
  if (requirements.length === 0) {
    return 'No attack costs';
  }
  
  const parts: string[] = [];
  
  // Format mana cost
  const manaParts: string[] = [];
  if (totalManaCost.generic) manaParts.push(`{${totalManaCost.generic}}`);
  if (totalManaCost.white) manaParts.push(`{W}`.repeat(totalManaCost.white));
  if (totalManaCost.blue) manaParts.push(`{U}`.repeat(totalManaCost.blue));
  if (totalManaCost.black) manaParts.push(`{B}`.repeat(totalManaCost.black));
  if (totalManaCost.red) manaParts.push(`{R}`.repeat(totalManaCost.red));
  if (totalManaCost.green) manaParts.push(`{G}`.repeat(totalManaCost.green));
  
  if (manaParts.length > 0) {
    parts.push(`Pay ${manaParts.join('')}`);
  }
  
  if (totalLifeCost > 0) {
    parts.push(`or ${totalLifeCost} life`);
  }
  
  parts.push(`to attack with ${attackingCreatureCount} creature${attackingCreatureCount !== 1 ? 's' : ''}`);
  
  // Add source info
  const sources = requirements.map(r => r.sourceName).join(', ');
  parts.push(`(from ${sources})`);
  
  return parts.join(' ');
}

/**
 * Check if a permanent creates a pillowfort effect
 * Used for AI evaluation of card value
 * 
 * @param permanent - The permanent to check for pillowfort effects
 * @returns true if the permanent has a pillowfort effect
 */
export function isPillowfortCard(permanent: BattlefieldPermanent | any): boolean {
  // Use the permanent's controller if available, otherwise use a placeholder
  // The detection doesn't actually depend on controllerId for pattern matching
  const controllerId = permanent.controller || permanent.controllerId || '';
  return detectPillowfortEffect(permanent, controllerId) !== null;
}

/**
 * Common pillowfort card names for reference
 */
export const COMMON_PILLOWFORT_CARDS = [
  'Propaganda',
  'Ghostly Prison',
  "Norn's Annex",
  'Sphere of Safety',
  'Windborn Muse',
  'Collective Restraint',
  'Baird, Steward of Argive',
  'Archangel of Tithes',
  'War Tax',
  'Elephant Grass',
  'Ensnaring Bridge', // Different mechanic but similar effect
  'Crawlspace',        // Limits number of attackers
  'Silent Arbiter',    // Limits to one attacker
  'Magus of the Moat', // Flying creatures only
  'Moat',              // Flying creatures only
] as const;

export type PillowfortCardName = typeof COMMON_PILLOWFORT_CARDS[number];
