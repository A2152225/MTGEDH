/**
 * Origin parent: shared/src/types.ts
 *
 * Cluster moved: mana pool and restricted-mana entries.
 *
 * Public entry symbols: ManaRestrictionType, RestrictedManaEntry, ManaPool.
 */

/**
 * Mana restriction type - specifies how restricted mana can be spent
 * Rule 106.6: Some abilities produce mana that can be spent only on certain things
 */
export type ManaRestrictionType = 
  | 'creatures'           // Can only be spent on creatures (e.g., Beastcaller Savant)
  | 'abilities'           // Can only be spent on abilities (e.g., Metalworker with Training Grounds)
  | 'colorless_spells'    // Can only be spent on colorless spells (e.g., Eldrazi Temple)
  | 'artifacts'           // Can only be spent on artifacts
  | 'no_nonartifact_spells' // Powerstone/Vibranium: cannot cast nonartifact spells; OK for artifact spells, activated abilities, other costs
  | 'legendary'           // Can only be spent on legendary spells (e.g., Reki, History of Kamigawa)
  | 'multicolored'        // Can only be spent on multicolored spells
  | 'commander'           // Can only be spent on commander costs (e.g., Command Tower in some interpretations)
  | 'activated_abilities' // Can only be spent to activate abilities of a specific permanent type
  | 'instant_sorcery'     // Can only be spent on instants and sorceries
  | 'chosen_type_creature_spell' // Cavern of Souls, Unclaimed Territory, etc.
  | 'chosen_type_creature_source' // Secluded Courtyard — creature spells + creature-source abilities
  | 'chosen_type_spell'   // Echoing Cavern — any spell of the chosen type
  | 'creature_spells_mv_or_x' // Helga: creature spells with MV >= N (restrictedTo) or {X} in cost
  | 'specific_card';      // Can only be spent on a specific card or permanent (stored in restrictedTo)

/**
 * Represents a single unit of restricted mana in the mana pool
 * Rule 106.6: Some effects produce mana with restrictions on what it can be spent on
 */
export interface RestrictedManaEntry {
  /** The type of the mana (primary field for identifying the mana color) */
  type: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  /** Amount of mana with this restriction */
  amount: number;
  /** Type of restriction on this mana */
  restriction: ManaRestrictionType;
  /** Optional: specific card/permanent ID this mana can be spent on */
  restrictedTo?: string;
  /** Source permanent that produced this mana (for tracking) */
  sourceId?: string;
  /** Source permanent name (for display) */
  sourceName?: string;
}

/**
 * Enhanced mana pool for a player - supports both regular and restricted mana
 * 
 * Rule 106.4: A player's mana pool is where mana is stored.
 * Rule 106.6: Some mana can only be spent in specific ways.
 * Rule 106.4a: If unused mana remains in a player's mana pool after mana is spent to pay
 * a cost, that player announces what mana is left. If unused mana remains in a player's 
 * mana pool at the end of a step or phase, that mana empties (unless the player has an 
 * effect preventing it, like Horizon Stone or Omnath, Locus of Mana).
 */
export interface ManaPool {
  /** Regular unrestricted mana counts */
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
  generic?: number;
  
  /** 
   * Restricted mana entries - mana that can only be spent on specific things
   * Each entry represents mana with a specific restriction type
   * Readonly to match rules-engine types
   */
  readonly restricted?: readonly RestrictedManaEntry[];
  
  /**
   * Flag indicating this player's mana pool doesn't empty at end of phases/steps
   * Set by effects like Horizon Stone, Omnath Locus of Mana, Kruphix God of Horizons
   */
  readonly doesNotEmpty?: boolean;
  
  /**
   * If mana doesn't empty but converts to a specific color, specify that color
   * Examples:
   * - 'colorless' for Kruphix, God of Horizons and Horizon Stone
   * - 'black' for Omnath, Locus of All
   * - 'red' for Ozai, the Phoenix King
   * If undefined and doesNotEmpty is true, mana is preserved as-is
   */
  readonly convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  
  /**
   * @deprecated Use convertsTo instead. Kept for backwards compatibility.
   * If mana doesn't empty but converts to colorless, specify that transformation
   */
  readonly convertsToColorless?: boolean;
  
  /**
   * Source permanent(s) providing the "doesn't empty" effect
   * Used to track when the effect should be removed
   */
  readonly noEmptySourceIds?: readonly string[];
}
