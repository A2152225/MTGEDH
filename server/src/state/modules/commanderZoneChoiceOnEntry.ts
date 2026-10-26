// Origin parent: server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.ts
// Cluster: CR 903.9a — a commander that just arrived in a graveyard or in exile
//   (a countered commander spell, including a Background) must offer the command zone.
// Public: offerCommanderZoneChoiceForArrivals

import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';

function trimId(value: unknown): string {
  return String(value || '').trim();
}

function idsMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}_`) || right.startsWith(`${left}_`);
}

export function isCommanderCardForOwner(state: any, ownerId: string, card: any): boolean {
  if (!card || typeof card !== 'object') return false;
  if (card.isCommander === true || card.commander === true) return true;

  const info = state?.commandZone?.[ownerId];
  if (!info) return false;

  const cardId = trimId(card.id);
  const commanderIds: string[] = Array.isArray(info.commanderIds)
    ? info.commanderIds.map(trimId).filter(Boolean)
    : [];
  if (cardId && commanderIds.some((id) => idsMatch(cardId, id))) return true;

  const name = trimId(card.name).toLowerCase();
  const commanderNames: string[] = Array.isArray(info.commanderNames)
    ? info.commanderNames.map((entry: unknown) => trimId(entry).toLowerCase()).filter(Boolean)
    : [];
  if (name && commanderNames.includes(name)) return true;

  const commanderCards = Array.isArray(info.commanderCards) ? info.commanderCards : [];
  return commanderCards.some((entry: any) => {
    const entryId = trimId(entry?.id);
    const entryName = trimId(entry?.name).toLowerCase();
    return (cardId && entryId && idsMatch(cardId, entryId)) || (name && entryName === name);
  });
}

/**
 * Queue the command-zone choice for commanders that just entered a graveyard or exile.
 * The card stays in that zone until the owner answers. Choosing the command zone
 * removes it; choosing to stay leaves it.
 */
export function offerCommanderZoneChoiceForArrivals(
  ctx: GameContext,
  ownerId: string,
  cards: readonly any[],
  destinationZone: 'graveyard' | 'exile',
): void {
  if ((ctx as any)?.isReplaying) return;
  const gameId = trimId((ctx as any)?.gameId);
  if (!gameId || gameId === 'unknown') return;
  const owner = trimId(ownerId);
  if (!owner || !Array.isArray(cards) || cards.length === 0) return;

  const queue = ResolutionQueueManager.getQueue(gameId);
  const pendingIds = new Set(
    (queue?.steps || [])
      .filter((step: any) =>
        step?.commanderZoneChoice === true
        && String(step?.status || '').toLowerCase() !== 'completed'
        && String(step?.status || '').toLowerCase() !== 'cancelled',
      )
      .map((step: any) => trimId(step?.commanderId || step?.card?.id))
      .filter(Boolean),
  );

  const zoneLabel = destinationZone === 'exile' ? 'exile' : 'your graveyard';
  const stayLabel = destinationZone === 'exile' ? 'Leave it in exile' : 'Let it go to graveyard';

  for (const card of cards) {
    if (!isCommanderCardForOwner((ctx as any).state, owner, card)) continue;
    const cardId = trimId(card?.id);
    if (!cardId || pendingIds.has(cardId)) continue;
    pendingIds.add(cardId);

    const name = trimId(card?.name) || 'Commander';
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: cardId,
      sourceName: name,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: `Your commander ${name} would be put into ${zoneLabel}. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: stayLabel },
      ],
      commanderId: cardId,
      commanderName: name,
      fromZone: destinationZone,
      destinationZone,
      card: { ...card, zone: destinationZone },
    } as any);
  }
}
