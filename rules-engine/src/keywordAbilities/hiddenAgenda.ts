/**
 * Hidden Agenda keyword ability (Rule 702.106)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.106. Hidden Agenda
 * 702.106a Hidden agenda is a conspiracy ability. As you put a conspiracy card with hidden 
 * agenda into the command zone, you secretly name a card.
 * 702.106b Any time you have priority, you may reveal the chosen name.
 * 702.106c If a conspiracy card has multiple instances of hidden agenda, the named cards 
 * may be the same or different.
 */

export interface HiddenAgendaAbility {
  readonly type: 'hiddenAgenda';
  readonly source: string;
  readonly namedCard?: string;
  readonly revealed: boolean;
}

/**
 * Create a hidden agenda ability for a conspiracy card
 * Rule 702.106a
 */
export function hiddenAgenda(source: string, namedCard?: string): HiddenAgendaAbility {
  return {
    type: 'hiddenAgenda',
    source,
    namedCard,
    revealed: false,
  };
}

/**
 * Reveal the named card for a hidden agenda ability
 * Rule 702.106b
 */
export function revealAgenda(ability: HiddenAgendaAbility): HiddenAgendaAbility {
  if (ability.revealed) {
    return ability;
  }
  
  return {
    ...ability,
    revealed: true,
  };
}

/**
 * Check if a card name matches the hidden agenda
 */
export function matchesAgenda(ability: HiddenAgendaAbility, cardName: string): boolean {
  if (!ability.namedCard) {
    return false;
  }
  
  return ability.namedCard.toLowerCase() === cardName.toLowerCase();
}

/**
 * Check if the agenda has been revealed
 */
export function isAgendaRevealed(ability: HiddenAgendaAbility): boolean {
  return ability.revealed;
}

/**
 * Multiple hidden agenda instances can name different cards
 * Rule 702.106c
 */
export function hasRedundantHiddenAgenda(
  abilities: readonly HiddenAgendaAbility[]
): boolean {
  return abilities.length > 1;
}
