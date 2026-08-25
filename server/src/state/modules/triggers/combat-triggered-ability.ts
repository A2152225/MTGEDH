/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: CombatTriggeredAbility
 * Public: CombatTriggeredAbility
 */

// ============================================================================
// Local Type Definitions (compatible with types.ts but with additional fields)
// ============================================================================

/**
 * Combat trigger with additional fields for combat-specific processing
 */
export interface CombatTriggeredAbility {
  permanentId: string;
  cardName: string;
  controllerId?: string;
  triggerType?: string;
  description: string;
  effect?: string;
  value?: any;
  mandatory?: boolean;
  requiresTarget?: boolean;
  manaCost?: string;
  energyCost?: number;
  batched?: boolean;
  /** Creature type / color phrase for typed attack watchers (e.g. "Dragon", "white", "Samurai or Warrior"). */
  requiredTypePhrase?: string;
  /** Power threshold for "power N or less" attack watchers. */
  maxPower?: number;
}
