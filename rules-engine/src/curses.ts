/**
 * curses.ts
 * 
 * Implements curse enchantment effects - Auras that attach to players
 * and typically have negative effects on the enchanted player.
 * 
 * Common curse cards:
 * - Curse of Misfortunes: Search for and attach other curses
 * - Curse of Exhaustion: Enchanted player can't cast more than one spell per turn
 * - Curse of the Pierced Heart: Deal 1 damage at upkeep
 * - Curse of Thirst: Deal damage equal to curses attached
 * - Curse of Opulence: Create Gold tokens when enchanted player is attacked
 * - Curse of Verbosity: Draw cards when enchanted player is attacked
 * - Curse of Disturbance: Create Zombie tokens when enchanted player is attacked
 * - Curse of Bounty: Untap permanents when enchanted player is attacked
 * - Curse of Bloodletting: Double damage to enchanted player
 * - Curse of Shaken Faith: Deal 2 damage when casting second spell each turn
 * - Overwhelming Splendor: Creatures lose abilities, can't have counters
 * - Cruel Reality: Sacrifice creature or planeswalker each upkeep
 * 
 * Rule 303.4: An Aura that can enchant a player can be attached to a player.
 * These are often referred to as "Curses" due to the Curse subtype.
 */

import type { GameState, BattlefieldPermanent } from '../../shared/src';

/**
 * Types of curse effects
 */
export enum CurseEffectType {
  // Triggered at upkeep
  UPKEEP_DAMAGE = 'upkeep_damage',         // Curse of the Pierced Heart
  UPKEEP_SACRIFICE = 'upkeep_sacrifice',   // Cruel Reality
  UPKEEP_DISCARD = 'upkeep_discard',       // Curse of the Cabal
  UPKEEP_LIFE_LOSS = 'upkeep_life_loss',   // Various curses
  
  // Triggered when attacked
  ATTACK_TRIGGER = 'attack_trigger',       // Curse of Opulence, Verbosity, etc.
  
  // Continuous effects
  SPELL_RESTRICTION = 'spell_restriction', // Curse of Exhaustion
  DAMAGE_MULTIPLIER = 'damage_multiplier', // Curse of Bloodletting
  CREATURE_DEBUFF = 'creature_debuff',     // Overwhelming Splendor
  MANA_RESTRICTION = 'mana_restriction',   // Curse of Inertia
  
  // Spell cast triggers
  SPELL_CAST_TRIGGER = 'spell_cast_trigger', // Curse of Shaken Faith
  
  // Other effects
  SEARCH_CURSE = 'search_curse',           // Curse of Misfortunes
  CURSE_COUNT_MATTERS = 'curse_count',     // Curse of Thirst
  CUSTOM = 'custom',
}

/**
 * Represents a curse effect on a player
 */
export interface CurseEffect {
  readonly sourceId: string;           // ID of the curse enchantment
  readonly sourceName: string;         // Name of the curse
  readonly sourceControllerId: string; // Who controls the curse
  readonly enchantedPlayerId: string;  // Who is cursed
  readonly effectType: CurseEffectType;
  readonly damageAmount?: number;      // For damage effects
  readonly multiplier?: number;        // For damage multipliers
  readonly spellLimit?: number;        // For spell restrictions
  readonly triggerCondition?: string;  // Description of when it triggers
  readonly effectDescription: string;  // Human-readable effect
}

/**
 * Result of checking curses on a player
 */
export interface CurseCheckResult {
  readonly curseCount: number;
  readonly curses: CurseEffect[];
  readonly hasDamageMultiplier: boolean;
  readonly hasSpellRestriction: boolean;
  readonly damageMultiplier: number;
  readonly spellsPerTurn: number;
}

/**
 * Known curse patterns to detect from oracle text
 */
const CURSE_PATTERNS: {
  pattern: RegExp;
  effectType: CurseEffectType;
  extractor?: (match: RegExpMatchArray, oracleText: string) => Partial<CurseEffect>;
}[] = [
  // "At the beginning of enchanted player's upkeep, [curse] deals X damage"
  {
    pattern: /at\s+the\s+beginning\s+of\s+enchanted\s+player's\s+upkeep.*deals?\s+(\d+)\s+damage/i,
    effectType: CurseEffectType.UPKEEP_DAMAGE,
    extractor: (match) => ({
      damageAmount: parseInt(match[1], 10),
      triggerCondition: 'At beginning of enchanted player\'s upkeep',
    }),
  },
  
  // "Enchanted player can't cast more than one spell each turn"
  {
    pattern: /enchanted\s+player\s+can't\s+cast\s+more\s+than\s+(\w+)\s+spell/i,
    effectType: CurseEffectType.SPELL_RESTRICTION,
    extractor: (match) => ({
      spellLimit: match[1] === 'one' ? 1 : parseInt(match[1], 10) || 1,
    }),
  },
  
  // "Damage dealt to enchanted player is doubled"
  {
    pattern: /damage\s+(?:dealt\s+)?to\s+enchanted\s+player\s+is\s+doubled/i,
    effectType: CurseEffectType.DAMAGE_MULTIPLIER,
    extractor: () => ({ multiplier: 2 }),
  },
  
  // "If a source would deal damage to enchanted player, it deals double"
  {
    pattern: /source\s+would\s+deal\s+damage\s+to\s+enchanted\s+player.*double/i,
    effectType: CurseEffectType.DAMAGE_MULTIPLIER,
    extractor: () => ({ multiplier: 2 }),
  },
  
  // "Whenever a player attacks enchanted player" (attack triggers)
  {
    pattern: /whenever\s+(?:a\s+)?(?:player|creature)\s+attacks?\s+enchanted\s+player/i,
    effectType: CurseEffectType.ATTACK_TRIGGER,
  },
  
  // "At the beginning of enchanted player's upkeep, that player sacrifices"
  {
    pattern: /enchanted\s+player's\s+upkeep.*sacrifices?\s+/i,
    effectType: CurseEffectType.UPKEEP_SACRIFICE,
    extractor: () => ({
      triggerCondition: 'At beginning of enchanted player\'s upkeep',
    }),
  },
  
  // "At the beginning of enchanted player's upkeep, that player discards"
  {
    pattern: /enchanted\s+player's\s+upkeep.*discards?\s+/i,
    effectType: CurseEffectType.UPKEEP_DISCARD,
    extractor: () => ({
      triggerCondition: 'At beginning of enchanted player\'s upkeep',
    }),
  },
  
  // Curse count matters (Curse of Thirst)
  {
    pattern: /deals?\s+damage.*equal\s+to.*curses?\s+attached/i,
    effectType: CurseEffectType.CURSE_COUNT_MATTERS,
  },
  
  // Search for curses (Curse of Misfortunes)
  {
    pattern: /search.*library.*curse.*card/i,
    effectType: CurseEffectType.SEARCH_CURSE,
  },
  
  // Spell cast damage trigger (Curse of Shaken Faith)
  {
    pattern: /whenever\s+enchanted\s+player\s+casts.*spell.*deals?\s+(\d+)\s+damage/i,
    effectType: CurseEffectType.SPELL_CAST_TRIGGER,
    extractor: (match) => ({
      damageAmount: parseInt(match[1], 10),
      triggerCondition: 'When enchanted player casts a spell',
    }),
  },
  
  // Creature debuff (Overwhelming Splendor)
  {
    pattern: /creatures?\s+enchanted\s+player\s+controls\s+lose\s+all\s+abilities/i,
    effectType: CurseEffectType.CREATURE_DEBUFF,
  },
];

/**
 * Check if a permanent is a curse (has Curse subtype or enchants a player)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent is a curse
 */
export function isCurse(permanent: BattlefieldPermanent | any): boolean {
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  const oracleText = permanent.card?.oracle_text?.toLowerCase() ||
                     permanent.oracle_text?.toLowerCase() || '';
  
  // Check for Curse subtype
  if (typeLine.includes('curse')) {
    return true;
  }
  
  // Check if it's an enchantment that enchants a player
  if (typeLine.includes('enchantment') && typeLine.includes('aura')) {
    if (oracleText.includes('enchant player') || oracleText.includes('enchanted player')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect curse effects from a permanent
 * 
 * @param permanent - The curse permanent
 * @param enchantedPlayerId - The player the curse is attached to
 * @returns CurseEffect if detected, null otherwise
 */
export function detectCurseEffect(
  permanent: BattlefieldPermanent | any,
  enchantedPlayerId: string
): CurseEffect | null {
  if (!isCurse(permanent)) {
    return null;
  }
  
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  const cardName = permanent.card?.name || permanent.name || 'Unknown Curse';
  const controllerId = permanent.controller || permanent.controllerId || '';
  
  // Check for known patterns
  for (const { pattern, effectType, extractor } of CURSE_PATTERNS) {
    const match = oracleText.match(pattern);
    if (match) {
      const extracted = extractor ? extractor(match, oracleText) : {};
      return {
        sourceId: permanent.id,
        sourceName: cardName,
        sourceControllerId: controllerId,
        enchantedPlayerId,
        effectType,
        effectDescription: oracleText.slice(0, 100) + (oracleText.length > 100 ? '...' : ''),
        ...extracted,
      };
    }
  }
  
  // Default curse effect if no specific pattern matched
  return {
    sourceId: permanent.id,
    sourceName: cardName,
    sourceControllerId: controllerId,
    enchantedPlayerId,
    effectType: CurseEffectType.CUSTOM,
    effectDescription: oracleText.slice(0, 100) + (oracleText.length > 100 ? '...' : ''),
  };
}

/**
 * Collect all curses attached to a specific player
 * 
 * @param state - The game state
 * @param playerId - The player to check for curses
 * @returns Array of all curse effects affecting that player
 */
export function collectPlayerCurses(
  state: GameState,
  playerId: string
): CurseEffect[] {
  const curses: CurseEffect[] = [];
  
  // Check all players' battlefields for curses attached to this player
  for (const player of state.players) {
    const battlefield = player.battlefield || [];
    for (const permanent of battlefield as any[]) {
      // Check if this permanent is a curse attached to the target player
      if (isCurse(permanent)) {
        const attachedTo = permanent.attachedTo || permanent.enchanting;
        if (attachedTo === playerId) {
          const effect = detectCurseEffect(permanent, playerId);
          if (effect) {
            curses.push(effect);
          }
        }
      }
    }
  }
  
  // Also check global battlefield
  if (state.battlefield) {
    for (const permanent of state.battlefield as any[]) {
      if (isCurse(permanent)) {
        const attachedTo = permanent.attachedTo || permanent.enchanting;
        if (attachedTo === playerId) {
          const effect = detectCurseEffect(permanent, playerId);
          if (effect && !curses.some(c => c.sourceId === effect.sourceId)) {
            curses.push(effect);
          }
        }
      }
    }
  }
  
  return curses;
}

/**
 * Check all curse effects on a player and summarize them
 * 
 * @param state - The game state
 * @param playerId - The player to check
 * @returns Summary of all curse effects
 */
export function checkCurses(
  state: GameState,
  playerId: string
): CurseCheckResult {
  const curses = collectPlayerCurses(state, playerId);
  
  // Calculate aggregated effects
  let damageMultiplier = 1;
  let spellsPerTurn = Infinity; // No restriction by default
  let hasDamageMultiplier = false;
  let hasSpellRestriction = false;
  
  for (const curse of curses) {
    if (curse.effectType === CurseEffectType.DAMAGE_MULTIPLIER && curse.multiplier) {
      damageMultiplier *= curse.multiplier;
      hasDamageMultiplier = true;
    }
    
    if (curse.effectType === CurseEffectType.SPELL_RESTRICTION && curse.spellLimit !== undefined) {
      spellsPerTurn = Math.min(spellsPerTurn, curse.spellLimit);
      hasSpellRestriction = true;
    }
  }
  
  return {
    curseCount: curses.length,
    curses,
    hasDamageMultiplier,
    hasSpellRestriction,
    damageMultiplier,
    spellsPerTurn: spellsPerTurn === Infinity ? -1 : spellsPerTurn, // -1 = no limit
  };
}

/**
 * Apply damage multiplication from curses
 * (e.g., Curse of Bloodletting doubles damage)
 * 
 * @param state - The game state
 * @param targetPlayerId - The player receiving damage
 * @param baseDamage - The base damage amount
 * @returns The modified damage amount
 */
export function applyDamageMultipliers(
  state: GameState,
  targetPlayerId: string,
  baseDamage: number
): { finalDamage: number; multipliers: CurseEffect[] } {
  const curseCheck = checkCurses(state, targetPlayerId);
  
  const multipliers = curseCheck.curses.filter(
    c => c.effectType === CurseEffectType.DAMAGE_MULTIPLIER
  );
  
  return {
    finalDamage: Math.floor(baseDamage * curseCheck.damageMultiplier),
    multipliers,
  };
}

/**
 * Check if a player can cast a spell based on curse restrictions
 * (e.g., Curse of Exhaustion limits to one spell per turn)
 * 
 * @param state - The game state
 * @param playerId - The player trying to cast
 * @param spellsCastThisTurn - Number of spells already cast this turn
 * @returns Whether the player can cast another spell
 */
export function canCastSpellWithCurses(
  state: GameState,
  playerId: string,
  spellsCastThisTurn: number
): { canCast: boolean; reason?: string; limitingCurse?: CurseEffect } {
  const curseCheck = checkCurses(state, playerId);
  
  if (!curseCheck.hasSpellRestriction) {
    return { canCast: true };
  }
  
  if (spellsCastThisTurn >= curseCheck.spellsPerTurn) {
    const limitingCurse = curseCheck.curses.find(
      c => c.effectType === CurseEffectType.SPELL_RESTRICTION
    );
    return {
      canCast: false,
      reason: `${limitingCurse?.sourceName || 'A curse'} limits you to ${curseCheck.spellsPerTurn} spell(s) per turn`,
      limitingCurse,
    };
  }
  
  return { canCast: true };
}

/**
 * Get upkeep triggers from curses
 * 
 * @param state - The game state
 * @param playerId - The player whose upkeep it is
 * @returns Array of curse effects that trigger at upkeep
 */
export function getCurseUpkeepTriggers(
  state: GameState,
  playerId: string
): CurseEffect[] {
  const curses = collectPlayerCurses(state, playerId);
  
  return curses.filter(c => 
    c.effectType === CurseEffectType.UPKEEP_DAMAGE ||
    c.effectType === CurseEffectType.UPKEEP_SACRIFICE ||
    c.effectType === CurseEffectType.UPKEEP_DISCARD ||
    c.effectType === CurseEffectType.UPKEEP_LIFE_LOSS ||
    c.effectType === CurseEffectType.CURSE_COUNT_MATTERS
  );
}

/**
 * Get attack triggers from curses
 * 
 * @param state - The game state
 * @param attackedPlayerId - The player being attacked
 * @returns Array of curse effects that trigger when attacked
 */
export function getCurseAttackTriggers(
  state: GameState,
  attackedPlayerId: string
): CurseEffect[] {
  const curses = collectPlayerCurses(state, attackedPlayerId);
  
  return curses.filter(c => c.effectType === CurseEffectType.ATTACK_TRIGGER);
}

/**
 * Count curses on a player (for Curse of Thirst, etc.)
 * 
 * @param state - The game state
 * @param playerId - The player to count curses on
 * @returns The number of curses attached to that player
 */
export function countCursesOnPlayer(
  state: GameState,
  playerId: string
): number {
  return collectPlayerCurses(state, playerId).length;
}

/**
 * Common curse card names for reference
 */
export const COMMON_CURSE_CARDS = [
  'Curse of Misfortunes',
  'Curse of Exhaustion',
  'Curse of the Pierced Heart',
  'Curse of Thirst',
  'Curse of Opulence',
  'Curse of Verbosity',
  'Curse of Disturbance',
  'Curse of Bounty',
  'Curse of Bloodletting',
  'Curse of Shaken Faith',
  'Curse of the Cabal',
  'Overwhelming Splendor',
  'Cruel Reality',
  'Curse of Oblivion',
  'Curse of Stalked Prey',
  'Curse of Clinging Webs',
  'Curse of Leeches',
] as const;

export type CurseCardName = typeof COMMON_CURSE_CARDS[number];
