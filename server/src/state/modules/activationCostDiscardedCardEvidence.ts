// server/src/state/modules/activationCostDiscardedCardEvidence.ts
//
// Origin: new module (no parent). Keeps "the discarded card" known to an activated ability whose
// cost was a discard, so its effect can ask about that card when it resolves.
//
// Moria Scavenger (oracle-cards.jsonl): "{T}, Discard a card: Draw a card. If the discarded card
// was a creature card, amass Orcs 1."
//
// Public entry symbols:
//   snapshotActivationCostDiscardedCards
//   attachActivationCostDiscardedCards
//   readActivationCostDiscardedCards
//
// The snapshot lives on the ability's stack item (`discardedCardsForCost`). The stack item is
// rebuilt from the `activateBattlefieldAbility` event (`discardedCardIds`) on replay, so no new
// event type is needed.

const STACK_ITEM_FIELD = 'discardedCardsForCost';

function findCardById(state: any, playerId: string, cardId: string): any | null {
  const zones = state?.zones || {};
  const ownerFirst = [playerId, ...Object.keys(zones).filter((id) => id !== playerId)];
  for (const ownerId of ownerFirst) {
    const playerZones = zones[ownerId];
    if (!playerZones) continue;
    // A discarded card is normally in the graveyard; madness or a replacement can put it in exile.
    for (const zoneName of ['graveyard', 'exile', 'hand']) {
      const cards = Array.isArray(playerZones[zoneName]) ? playerZones[zoneName] : [];
      const found = cards.find((card: any) => card && String(card.id || '') === cardId);
      if (found) return found;
    }
  }
  return null;
}

/** Last-known information for cards discarded to pay an activation cost. */
export function snapshotActivationCostDiscardedCards(
  state: any,
  playerId: string,
  cardIds: readonly unknown[] | undefined,
): any[] {
  const snapshots: any[] = [];
  for (const rawId of Array.isArray(cardIds) ? cardIds : []) {
    const cardId = String(rawId || '').trim();
    if (!cardId) continue;
    const card = findCardById(state, String(playerId || ''), cardId);
    if (!card) continue;
    snapshots.push({
      id: cardId,
      name: card.name,
      type_line: card.type_line,
      mana_cost: card.mana_cost,
      cmc: card.cmc,
      colors: Array.isArray(card.colors) ? [...card.colors] : card.colors,
      power: card.power,
      toughness: card.toughness,
    });
  }
  return snapshots;
}

/** Record the discarded cost cards on the ability's stack item. No-op when nothing was discarded. */
export function attachActivationCostDiscardedCards(
  state: any,
  stackItem: any,
  playerId: string,
  cardIds: readonly unknown[] | undefined,
): void {
  if (!stackItem || typeof stackItem !== 'object') return;
  const snapshots = snapshotActivationCostDiscardedCards(state, playerId, cardIds);
  if (snapshots.length > 0) stackItem[STACK_ITEM_FIELD] = snapshots;
}

export function readActivationCostDiscardedCards(stackItem: any): any[] {
  const snapshots = stackItem?.[STACK_ITEM_FIELD];
  return Array.isArray(snapshots) ? snapshots.map((entry: any) => ({ ...entry })) : [];
}
