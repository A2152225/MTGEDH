/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detector TriggeredAbility wire type
 * Public: TriggeredAbility
 *
 * Distinct from triggers/types.ts TriggeredAbility (stale/skinny folder copy).
 * Detector functions use this shape. Leftover re-exports it so existing
 * `from "./triggered-abilities.js"` type imports keep working.
 */

export interface TriggeredAbility {
  permanentId: string;
  cardName: string;
  // Trigger detectors are extensible and already emit hundreds of generic
  // runtime identifiers. Keep this aligned with the shared wire type instead
  // of maintaining a second, permanently stale literal union here.
  triggerType: string;
  description: string;
  effect?: string;
  value?: number | Record<string, any>; // For Annihilator N, or complex effect data
  millAmount?: number; // For mill triggers like Altar of the Brood
  manaCost?: string; // For "sacrifice unless you pay" triggers
  mandatory: boolean;
  oncePerTurn?: boolean;
  /** "for the first time during each of your turns" (Tale of Katara and Toph). */
  onlyOnControllerTurn?: boolean;
  requiresTarget?: boolean;
  targetType?: string;
  targetConstraint?: 'opponent' | 'you' | undefined; // For targeting restrictions (e.g., "opponent controls" or "you control")
  requiresChoice?: boolean; // For triggers where player must choose
  creatureType?: string; // For "whenever you cast a [type] spell" triggers
  nontokenOnly?: boolean; // For triggers that only fire for nontoken creatures (Guardian Project)
  controlledOnly?: boolean; // For triggers that only fire when creature you control enters (Aura Shards)
  batched?: boolean; // For triggers that should only fire once per event even if multiple conditions met (Professional Face-Breaker)
  controllerId?: string; // Controller of the permanent with this trigger
  
  // Token creation options
  createTokensBasedOnCount?: {  // For Myrel, creates tokens based on count of permanents
    countType: string;  // e.g., "soldier" - counts permanents with this type
    power: number;
    toughness: number;
    type: string;
    color: string;
    isArtifact?: boolean;
    abilities?: string[];
  };
  createTokens?: { 
    count: number; 
    power: number; 
    toughness: number; 
    type: string; 
    color: string; 
    abilities?: string[] 
  };
  
  // Put card from hand options (Preeminent Captain)
  putFromHand?: boolean;
  tappedAndAttacking?: boolean;
  putCreatureType?: string;
}

