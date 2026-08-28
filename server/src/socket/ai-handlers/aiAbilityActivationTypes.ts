/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: AI activated-ability snapshot/resolver type aliases used by
 * snapshotAIAbilityActivationState and payment/activation callers.
 *
 * Public entry symbols: AIResolvedActivatedAbilityAction,
 * AIActivatedAbilityResolverCandidate, AIAbilityActivationSnapshot.
 */

export type AIResolvedActivatedAbilityAction = {
  permanentId: string;
  cardName: string;
  abilityText: string;
  abilityId?: string;
};

export type AIActivatedAbilityResolverCandidate = {
  id: string;
  text: string;
  effect?: string;
};

export type AIAbilityActivationSnapshot = {
  stackLength: number;
  pendingSteps: number;
  manaPoolKey: string;
  lifeTotal: number;
  battlefieldCount: number;
  graveyardCount: number;
  handCount: number;
  exileCount: number;
  permanentExists: boolean;
  permanentTapped: boolean;
  /** Tap/untap of *other* permanents (tap-a-Merfolk costs) is progress even if the source stays untapped. */
  battlefieldTappedKey: string;
};
