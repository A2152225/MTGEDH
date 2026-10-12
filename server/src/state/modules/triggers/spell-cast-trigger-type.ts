/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover SpellCastTrigger (evolved leftover copy; leftover re-exports)
 * Public: SpellCastTrigger
 */
// ============================================================================
// General Spell-Cast Triggered Abilities
// (Merrow Reejerey, Deeproot Waters, Beast Whisperer, etc.)
// ============================================================================

export interface SpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  spellCondition: 'any' | 'creature' | 'noncreature' | 'instant_sorcery' | 'colorless' | 'historic' | 'tribal_type' | 'color' | 'chosen_color' | 'artifact_or_creature';
  tribalType?: string; // For tribal triggers like "Merfolk spell" or color like "green"
  /** When set, the cast must have used mana produced by this permanent (Barracks-style). */
  requiresManaFromPermanentId?: string;
  copiesSpell?: boolean;
  firstSpellThisTurn?: boolean;
  firstSpellDuringOpponentTurn?: boolean;
  sourceZoneRequirement?: 'hand' | 'library' | 'exile' | 'graveyard' | 'not_hand';
  /** Folk Hero: spell must share a creature type with the source permanent. */
  requiresSharedCreatureTypeWithSource?: boolean;
  requiresTarget?: boolean;
  targetType?: string; // e.g., "permanent" for tap/untap effects
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
    colors?: string[];
    abilities?: string[];
  };
  oncePerTurn?: boolean;
  replacementEffect?: {
    kind: 'bottom_spell_reveal_until_nonland';
    revealFromLibraryOf: 'controller';
    castWithoutPayingManaCost: boolean;
    randomizeBottomRemainder: boolean;
  };
  addsLoyaltyCounters?: number; // Number of loyalty counters to add (for planeswalkers like Ral, Crackling Wit)
  optionalPaymentCost?: string; // Optional mana payment before effect (Emperor Mihail II)
  /** Minimum printed power of the cast creature spell (Gwenna, Eyes of Gaea). */
  minSpellPower?: number;
  /**
   * Game event that fires this trigger. Omitted means casting a spell. Cycle triggers
   * ("whenever you cycle a card", "when you cycle this card") are recognized by the detector
   * but must never be put on the stack by a spell cast.
   */
  triggerEvent?: 'cycle';
  /** Full parsed condition when the entry came from the trigger IR; matchers use it over spellCondition. */
  triggerCondition?: import('../../../../../rules-engine/src/triggerCondition/index.js').TriggerConditionIR;
  mandatory: boolean;
}
