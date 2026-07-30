import type { KnownCardRef } from '../../../shared/src';
import type { OptionChoiceOption } from '../components/OptionChoiceModal';

/**
 * Generic resolution choice primitives (task D6).
 *
 * New server step kinds should map onto these shapes so the client reuses
 * existing modals instead of growing bespoke handlers per IR step.
 */

export const GENERIC_OPTION_CHOICE_STEP_TYPES = new Set([
  'option_choice',
  'modal_choice',
  'riot_choice',
  'unleash_choice',
  'fabricate_choice',
  'tribute_choice',
]);

/** Step types with dedicated UI — do not route via generic option fallback. */
const SPECIALIZED_STEP_TYPES = new Set([
  'discard_selection',
  'hand_to_bottom',
  'kynaios_choice',
  'mana_color_selection',
  'counter_distribution',
  'x_value_selection',
  'number_choice',
  'mana_payment_choice',
  'extort_payment',
  'mutate_target_selection',
  'graveyard_selection',
  'soulshift_target',
  'two_pile_split',
  'tap_untap_target',
  'fight_target',
  'counter_target',
  'counter_movement',
  'station_creature_selection',
  'life_payment',
  'return_controlled_permanent_choice',
  'hideaway_choice',
  'join_forces',
  'tempting_offer',
  'player_choice',
  'cascade',
  'scry',
  'surveil',
  'bottom_order',
  'proliferate',
  'life_redistribution',
  'fateseal',
  'clash',
  'vote',
  'ponder_effect',
  'lim_duls_vault',
  'dance_with_calamity',
  'dance_with_calamity_cast',
  'library_search',
  'opening_hand_actions',
  'color_choice',
  'card_name_choice',
  'creature_type_choice',
  'mode_selection',
  'additional_cost_payment',
  'squad_cost_payment',
  'explore_decision',
  'batch_explore_decision',
  'target_selection',
  'mentor_target',
  'modular_choice',
  'exploit_choice',
  'upkeep_sacrifice',
  'trigger_order',
]);

export function isGenericNumberChoiceStep(step: Record<string, unknown> | null | undefined): boolean {
  if (!step) return false;
  const type = String(step.type || '');
  return type === 'number_choice' || type === 'x_value_selection';
}

export function isNamedGenericOptionChoiceStep(step: Record<string, unknown> | null | undefined): boolean {
  if (!step) return false;
  return GENERIC_OPTION_CHOICE_STEP_TYPES.has(String(step.type || ''));
}

/**
 * Fallback for future IR steps: if the server sends a novel type but includes
 * a standard options payload, render the generic option modal.
 */
export function isGenericOptionChoiceFallbackStep(step: Record<string, unknown> | null | undefined): boolean {
  if (!step) return false;
  const type = String(step.type || '');
  if (!type || SPECIALIZED_STEP_TYPES.has(type) || GENERIC_OPTION_CHOICE_STEP_TYPES.has(type)) {
    return false;
  }
  if (step.importWipeConfirm === true || step.judgeConfirm === true) return false;
  if (step.opponentMayPayChoice === true) return false;
  if (step.mayAbilityPrompt === true || step.optionalTriggeredAbilityPrompt === true) return false;
  if (
    step.effectProgramPrompt === true &&
    (step.effectProgramFamily === 'optional_triggered_ability' ||
      step.effectProgramFamily === 'optional_payment')
  ) {
    return false;
  }
  return Array.isArray(step.options) && step.options.length > 0;
}

export interface PendingSpellXSelectionState {
  stepId: string;
  cardName: string;
  description: string;
  minValue: number;
  maxValue: number;
  xCount?: number;
  affordableXHint?: number;
}

export function buildPendingSpellXSelectionFromStep(
  step: Record<string, unknown>,
): PendingSpellXSelectionState {
  return {
    stepId: String(step.id || ''),
    cardName: String(step.sourceName || step.cardName || 'Spell'),
    description: String(step.description || ''),
    minValue: Math.max(0, Number(step.minValue ?? 0)),
    maxValue: Math.max(0, Number(step.maxValue ?? 20)),
    xCount: Number.isFinite(step.xCount) ? Math.max(1, Number(step.xCount)) : undefined,
    affordableXHint: Number.isFinite(step.affordableXHint)
      ? Math.max(0, Number(step.affordableXHint))
      : undefined,
  };
}

export interface GenericOptionChoiceRequestShape {
  gameId: string;
  stepId: string;
  sourceId?: string;
  sourceName: string;
  sourceImage?: string;
  description: string;
  options: OptionChoiceOption[];
  minSelections: number;
  maxSelections: number;
  mandatory: boolean;
}

export function buildGenericOptionChoiceRequestFromStep(
  step: Record<string, unknown>,
  gameId: string,
  mandatory: boolean,
): GenericOptionChoiceRequestShape {
  return {
    gameId,
    stepId: String(step.id || ''),
    sourceId: step.sourceId != null ? String(step.sourceId) : undefined,
    sourceName: String(step.sourceName || 'Make a Choice'),
    sourceImage: typeof step.sourceImage === 'string' ? step.sourceImage : undefined,
    description: String(step.description || ''),
    options: Array.isArray(step.options) ? step.options as OptionChoiceOption[] : [],
    minSelections: Number(step.minSelections ?? 0),
    maxSelections: Number(step.maxSelections ?? 1),
    mandatory,
  };
}

export type LibrarySearchMoveTo = 'hand' | 'battlefield' | 'top' | 'graveyard' | 'exile' | 'split';

const LIBRARY_SEARCH_DESTINATIONS = new Set<LibrarySearchMoveTo>([
  'hand',
  'battlefield',
  'top',
  'graveyard',
  'exile',
]);

export function resolveLibrarySearchMoveTo(step: Record<string, unknown>): LibrarySearchMoveTo {
  if (step.splitDestination === true) return 'split';
  const destination = String(step.destination || 'hand') as LibrarySearchMoveTo;
  return LIBRARY_SEARCH_DESTINATIONS.has(destination) ? destination : 'hand';
}

export function isGraveyardSourceLibrarySearchStep(step: Record<string, unknown>): boolean {
  const haystack = `${String(step.searchCriteria || '')} ${String(step.description || '')}`.toLowerCase();
  return haystack.includes('graveyard');
}

export interface LibrarySearchModalStateShape {
  cards: KnownCardRef[];
  nonSelectableCards: KnownCardRef[];
  revealedCards: KnownCardRef[];
  castableWhileSearchingCards: KnownCardRef[];
  title: string;
  description: string;
  filter: {
    supertypes?: string[];
    types?: string[];
    subtypes?: string[];
    maxCmc?: number;
    minCmc?: number;
    maxPower?: number;
    minPower?: number;
    maxToughness?: number;
    minToughness?: number;
    colors?: string[];
  };
  minSelections: number;
  maxSelections: number;
  maxTotalManaValue?: number;
  moveTo: LibrarySearchMoveTo;
  shuffleAfter: boolean;
  targetPlayerId?: string;
  splitDestination: boolean;
  toBattlefield: number;
  toHand: number;
  entersTapped: boolean;
  mandatory: boolean;
  stepId: string;
}

export function buildLibrarySearchModalStateFromStep(
  step: Record<string, unknown>,
): LibrarySearchModalStateShape {
  const sourceName = String(step.sourceName || '').trim();
  const searchCriteria = String(step.searchCriteria || '').trim();
  const stepDescription = String(step.description || '').trim();
  const fromGraveyard = isGraveyardSourceLibrarySearchStep(step);
  const defaultTitle = fromGraveyard
    ? (sourceName ? `${sourceName}: Choose from graveyard` : 'Choose from graveyard')
    : (sourceName || 'Search Library');
  const defaultDescription = fromGraveyard
    ? (searchCriteria || stepDescription || 'Choose a card from your graveyard')
    : (stepDescription || searchCriteria || 'Search your library');

  return {
    cards: Array.isArray(step.availableCards) ? step.availableCards as KnownCardRef[] : [],
    nonSelectableCards: Array.isArray(step.nonSelectableCards) ? step.nonSelectableCards as KnownCardRef[] : [],
    revealedCards: Array.isArray(step.revealedCards) ? step.revealedCards as KnownCardRef[] : [],
    castableWhileSearchingCards: Array.isArray(step.castableWhileSearchingCards)
      ? step.castableWhileSearchingCards as KnownCardRef[]
      : [],
    title: defaultTitle,
    description: defaultDescription,
    filter: (step.filter && typeof step.filter === 'object' ? step.filter : {}) as LibrarySearchModalStateShape['filter'],
    minSelections: Math.max(0, Number(step.minSelections ?? 0)),
    maxSelections: Math.max(0, Number(step.maxSelections ?? 1)),
    maxTotalManaValue: Number.isFinite(Number(step.maxTotalManaValue))
      ? Number(step.maxTotalManaValue)
      : undefined,
    moveTo: resolveLibrarySearchMoveTo(step),
    shuffleAfter: step.shuffleAfter !== false,
    targetPlayerId: step.targetPlayerId != null
      ? String(step.targetPlayerId)
      : step.playerId != null
        ? String(step.playerId)
        : undefined,
    splitDestination: step.splitDestination === true,
    toBattlefield: Math.max(0, Number(step.toBattlefield ?? 0)),
    toHand: Math.max(0, Number(step.toHand ?? 0)),
    entersTapped: step.entersTapped === true,
    mandatory: step.mandatory !== false,
    stepId: String(step.id || ''),
  };
}
