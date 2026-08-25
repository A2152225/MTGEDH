/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Shared mutation bag + extras for generic non-mana / mana / persist peels
 * of activateBattlefieldAbility.
 *
 * Public entry symbols: ActivateGenericAbilityMutationState,
 * ActivateGenericAbilityExtras.
 */

import type { SacrificeType } from "../../../../shared/src/textUtils";

export type ActivateGenericAbilityMutationState = {
  pendingLifePaymentForCost: number;
  pendingManaLifeLossAmount: number;
  pendingManaLifeLossIsDamage: boolean;
  manaGrantsCreatureSpellHasteUntilEndOfTurn: boolean;
  persistedStackItemId: string | undefined;
  tappedPermanentsForCost: string[];
  sacrificedPermanentsForCost: string[];
  recordedAddedMana: Record<string, number>;
  removedCountersForCost: Array<{ permanentId: string; counterType: string; count: number }>;
  pendingCounterRemovals: Array<{ counterType: string; count: number }>;
};

export type ActivateGenericAbilityExtras = {
  abilityText: string;
  requiresTap: boolean;
  requiresUntap: boolean;
  manaCost: string;
  requiresSelfExert: boolean;
  sacrificeType: SacrificeType | null;
  sacrificeSubtype: string | undefined;
  isPowerUpActivation: boolean;
  powerUpAbilityIndex: number;
  selectedAbilityIndex: number;
  selectedAbilityFullText: string;
  selectedAbilityOracleLine: string;
  isExhaustActivation: boolean;
  isBoastAbility: boolean;
  oncePerTurnActivatedEffect: string;
  resolvedAbilityText: string;
  resolvedActivatedAbilityText: string;
};
