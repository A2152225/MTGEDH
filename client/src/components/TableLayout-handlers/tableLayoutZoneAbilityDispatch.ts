// client/src/components/TableLayout-handlers/tableLayoutZoneAbilityDispatch.ts
// Routes a click on a zone-specific ability in the table's card right-click menu (ZoneCardContextMenu)
// to the right socket event / App handler. Previously only hand abilities (cycling, foretell) were wired,
// so Flashback, Unearth, Escape, Embalm, ... in the graveyard and Foretell/Plot/adventure casts in exile
// did nothing when clicked.

import type { KnownCardRef } from '../../../../shared/src';

export type ZoneAbilityDispatchZone = 'hand' | 'graveyard' | 'exile' | 'library' | 'commander' | 'battlefield';

/** Abilities that are status lines in the menu, not actions. */
const NON_ACTION_ABILITY_IDS = new Set(['suspend-status']);

/** Hand abilities that are really "open the normal cast flow" (the cast modal offers kicker / buyback). */
const HAND_CAST_FLOW_ABILITY_IDS = new Set(['cast-kicked', 'cast-buyback']);

export interface ZoneAbilityDispatchArgs {
  zone: ZoneAbilityDispatchZone;
  gameId?: string | null;
  cardId: string;
  abilityId: string;
  card: KnownCardRef;
  emit: (event: string, payload: Record<string, unknown>) => void;
  onCastFromHand?: (cardId: string) => void;
  /** App-level handler shared with the Graveyard view modal (casts, land plays, activateGraveyardAbility). */
  onGraveyardAbility?: (cardId: string, abilityId: string, card: KnownCardRef) => void;
  /** App-level handler shared with the Exile view modal. */
  onExileAbility?: (cardId: string, abilityId: string, card: KnownCardRef) => void;
}

/** Returns true when the click was routed somewhere. */
export function dispatchZoneCardAbility(args: ZoneAbilityDispatchArgs): boolean {
  const { zone, gameId, cardId, abilityId, card, emit } = args;
  if (!gameId || !cardId || !abilityId) return false;
  if (NON_ACTION_ABILITY_IDS.has(abilityId)) return false;

  if (zone === 'hand') {
    if (abilityId === 'cycling' || /-cycling-\d+$/i.test(abilityId)) {
      emit('activateCycling', { gameId, cardId, abilityId });
      return true;
    }
    if (abilityId === 'foretell') {
      emit('foretellCard', { gameId, cardId });
      return true;
    }
    if (HAND_CAST_FLOW_ABILITY_IDS.has(abilityId) && args.onCastFromHand) {
      args.onCastFromHand(cardId);
      return true;
    }
    return false;
  }

  if (zone === 'graveyard') {
    if (args.onGraveyardAbility) {
      args.onGraveyardAbility(cardId, abilityId, card);
    } else {
      emit('activateGraveyardAbility', { gameId, cardId, abilityId });
    }
    return true;
  }

  if (zone === 'exile') {
    if (args.onExileAbility) {
      args.onExileAbility(cardId, abilityId, card);
      return true;
    }
    if (abilityId === 'foretell-cast') {
      emit('castForetold', { gameId, cardId });
      return true;
    }
    return false;
  }

  return false;
}