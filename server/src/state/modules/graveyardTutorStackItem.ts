/**
 * state/modules/graveyardTutorStackItem.ts
 *
 * CR 602.2 / 608.2: a tutor ability activated from a graveyard goes on the stack and searches when it
 * resolves. The live handler (interactionGraveyardAbilitySocketHandlers) and the replay of its
 * activateGraveyardAbility event (searchOnResolution: true, stackId) build the same stack item here;
 * stackResolveDeferredTutorSearch queues the LIBRARY_SEARCH from its searchParams. Older events
 * without the flag keep the search queued at activation.
 *
 * Public entry symbols: GraveyardTutorStackParams, buildGraveyardTutorStackItem,
 * pushGraveyardTutorStackItem, graveyardTutorStackParamsFromEvent.
 */

export type GraveyardTutorStackParams = {
  stackId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  card?: any;
  abilityId?: string;
  searchCriteria: string;
  destination: string;
  maxSelections: number | 'rest';
  splitDestination: boolean;
  toBattlefield: number | 'rest';
  toHand: number | 'rest';
  entersTapped: boolean;
  filter: any;
};

export function buildGraveyardTutorStackItem(p: GraveyardTutorStackParams): any {
  const card = p.card || {};
  const oracleText = String(card.oracle_text || '');
  return {
    id: p.stackId,
    type: 'ability',
    controller: p.playerId,
    source: p.cardId,
    sourceName: p.cardName,
    sourceZone: 'graveyard',
    description: oracleText || `${p.cardName} ability`,
    activatedAbilityText: oracleText || undefined,
    abilityType: 'tutor',
    abilityId: p.abilityId || undefined,
    searchOnResolution: true,
    card: {
      id: p.cardId,
      name: `${p.cardName} (ability)`,
      type_line: 'Activated Ability',
      oracle_text: oracleText,
      image_uris: card.image_uris,
    },
    targets: [],
    searchParams: {
      filter: p.filter && typeof p.filter === 'object' ? { ...p.filter } : {},
      searchCriteria: p.searchCriteria,
      maxSelections: p.maxSelections,
      destination: p.destination,
      entersTapped: p.entersTapped,
      splitDestination: p.splitDestination,
      toBattlefield: p.toBattlefield,
      toHand: p.toHand,
    },
  };
}

export function pushGraveyardTutorStackItem(state: any, p: GraveyardTutorStackParams): any {
  const item = buildGraveyardTutorStackItem(p);
  state.stack = Array.isArray(state.stack) ? state.stack : [];
  state.stack.push(item);
  return item;
}

/** Rebuild the params from a persisted activateGraveyardAbility event (replay). */
export function graveyardTutorStackParamsFromEvent(e: any, playerId: string, cardId: string, card: any): GraveyardTutorStackParams {
  const maxSelections = e?.maxSelections === 'rest' ? 'rest' as const : Number(e?.maxSelections);
  return {
    stackId: String(e?.stackId || `ability_gy_tutor_${String(cardId)}`),
    playerId: String(playerId),
    cardId: String(cardId),
    cardName: String(card?.name || e?.cardName || 'Card'),
    card,
    abilityId: String(e?.abilityId || ''),
    searchCriteria: String(e?.searchCriteria || 'any card'),
    destination: String(e?.destination || 'hand'),
    maxSelections: maxSelections === 'rest' || Number.isFinite(maxSelections) ? maxSelections : 1,
    splitDestination: e?.splitDestination === true,
    toBattlefield: e?.toBattlefield === 'rest' ? 'rest' : Number(e?.toBattlefield || 1),
    toHand: e?.toHand === 'rest' ? 'rest' : Number(e?.toHand || 1),
    entersTapped: e?.entersTapped === true,
    filter: e?.filter && typeof e.filter === 'object' ? { ...e.filter } : {},
  };
}
