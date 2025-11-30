/**
 * cards/triggeredAbilityCards.ts
 * 
 * Cards with special triggered abilities that need explicit handling.
 */

import { TriggerEvent } from '../triggeredAbilities';

export interface TriggeredAbilityConfig {
  readonly cardName: string;
  readonly triggerEvent: TriggerEvent;
  readonly triggerCondition?: string;
  readonly effect: string;
  readonly requiresChoice?: boolean;
  readonly choiceOptions?: string[];
  readonly creatureTypeFilter?: string;
}

export const TRIGGERED_ABILITY_CARDS: Record<string, TriggeredAbilityConfig> = {
  'tireless provisioner': {
    cardName: 'Tireless Provisioner',
    triggerEvent: TriggerEvent.LANDFALL,
    effect: 'Create a Food token or a Treasure token.',
    requiresChoice: true,
    choiceOptions: ['Food', 'Treasure'],
  },
  'deeproot waters': {
    cardName: 'Deeproot Waters',
    triggerEvent: TriggerEvent.CREATURE_SPELL_CAST,
    creatureTypeFilter: 'Merfolk',
    effect: 'Create a 1/1 blue Merfolk creature token with hexproof.',
  },
  'aetherflux reservoir': {
    cardName: 'Aetherflux Reservoir',
    triggerEvent: TriggerEvent.SPELL_CAST,
    triggerCondition: 'you',
    effect: 'Gain 1 life for each spell you\'ve cast this turn.',
  },
  'smothering tithe': {
    cardName: 'Smothering Tithe',
    triggerEvent: TriggerEvent.DRAWN,
    triggerCondition: 'opponent',
    effect: 'That player may pay {2}. If they don\'t, you create a Treasure token.',
    requiresChoice: true,
  },
};

export function hasSpecialTriggeredAbility(cardName: string): boolean {
  return cardName.toLowerCase() in TRIGGERED_ABILITY_CARDS;
}

export function getTriggeredAbilityConfig(cardName: string): TriggeredAbilityConfig | undefined {
  return TRIGGERED_ABILITY_CARDS[cardName.toLowerCase()];
}
