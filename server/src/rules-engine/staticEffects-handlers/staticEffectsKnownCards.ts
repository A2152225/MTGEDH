// server/src/rules-engine/staticEffects-handlers/staticEffectsKnownCards.ts
// Origin parent: server/src/rules-engine/staticEffects.ts
// Cluster moved: KNOWN_STATIC_EFFECT_CARDS and the known-static section comments.
// Public entry symbols: KNOWN_STATIC_EFFECT_CARDS.

// ============================================================================
// Known static effect cards for special handling
// ============================================================================

/**
 * Known cards with static effects that need special handling
 * These are cards that grant abilities but have complex patterns
 */
export const KNOWN_STATIC_EFFECT_CARDS: Record<string, {
  grantsToCreatures?: string[];
  grantsToPlayer?: string[];
  affectsOtherCreatures?: boolean;
  affectsAllCreatures?: boolean;
  affectsOpponentCreatures?: boolean;
  powerToughnessBonus?: { power: number; toughness: number };
  requiresCondition?: string;
}> = {
  // Ability granters
  "anger": { grantsToCreatures: ['haste'], requiresCondition: 'graveyard_and_mountain' },
  "brawn": { grantsToCreatures: ['trample'], requiresCondition: 'graveyard_and_forest' },
  "wonder": { grantsToCreatures: ['flying'], requiresCondition: 'graveyard_and_island' },
  "filth": { grantsToCreatures: ['swampwalk'], requiresCondition: 'graveyard_and_swamp' },
  "glory": { grantsToCreatures: ['protection'], requiresCondition: 'graveyard_and_plains' },
  
  // Buff granters
  "craterhoof behemoth": { powerToughnessBonus: { power: 0, toughness: 0 }, grantsToCreatures: ['trample'] }, // +X/+X where X = creatures you control
  "overwhelming stampede": { powerToughnessBonus: { power: 0, toughness: 0 }, grantsToCreatures: ['trample'] }, // +X/+X where X = greatest power
  
  // Hexproof granters
  "shalai, voice of plenty": { grantsToPlayer: ['hexproof'], grantsToCreatures: ['hexproof'], affectsOtherCreatures: true },
  "leyline of sanctity": { grantsToPlayer: ['hexproof'] },
  "aegis of the gods": { grantsToPlayer: ['hexproof'] },
  "orbs of warding": { grantsToPlayer: ['hexproof'] },
  "witchbane orb": { grantsToPlayer: ['hexproof'] },
  "sigarda, heron's grace": { grantsToPlayer: ['hexproof'], grantsToCreatures: ['hexproof'] },
  
  // Protection granters
  "kira, great glass-spinner": { grantsToCreatures: ['ward'], affectsOtherCreatures: false }, // Creatures you control have ward (counter first spell)
  "saryth, the viper's fang": { grantsToCreatures: ['deathtouch', 'hexproof'] }, // Tapped have deathtouch, untapped have hexproof
  
  // Lure effects
  "lure": { }, // Enchanted creature must be blocked if able
  "shinen of life's roar": { }, // Must be blocked if able
  "engulfing slagwurm": { }, // Destroys creature before damage
  
  // All creatures effects
  "elesh norn, grand cenobite": { powerToughnessBonus: { power: 2, toughness: 2 }, affectsOpponentCreatures: true },
  "glaring spotlight": { }, // Creatures your opponents control lose hexproof
  
  // Mana ability granters
  "cryptolith rite": { grantsToCreatures: ['tap_for_any_color'] },
  "citanul hierophants": { grantsToCreatures: ['tap_for_green'] },
  "chromatic lantern": { }, // Lands have "tap: add one mana of any color"
  "elven chorus": { grantsToCreatures: ['tap_for_any_color'] }, // Creatures have "{T}: Add one mana of any color."
};

