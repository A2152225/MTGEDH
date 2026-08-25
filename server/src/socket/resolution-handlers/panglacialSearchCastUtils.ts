/**
 * socket/resolution-handlers/panglacialSearchCastUtils.ts
 *
 * Origin parent: server/src/socket/resolution.ts (library-search Panglacial Wurm cast).
 * Cluster moved: buildKnownCardRefForSearch, getPanglacialCastCardId,
 * getPanglacialCastableCards, restoreLibrarySearchStep.
 * Public entry symbols: getPanglacialCastableCards, getPanglacialCastCardId,
 * restoreLibrarySearchStep, PANGLACIAL_WURM_NAME.
 *
 * Must not import resolution.ts.
 */

import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
} from "../../state/resolution/index.js";
import { isTrueLibrarySearchStep } from "../resolutionLibrarySearchHandlers.js";
import { ensureGame } from "../util.js";

const PANGLACIAL_WURM_NAME = 'panglacial wurm';
export { PANGLACIAL_WURM_NAME };

function buildKnownCardRefForSearch(card: any): any {
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    imageUrl: card.image_uris?.normal,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  };
}

export function getPanglacialCastCardId(selections: unknown): string | undefined {
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) return undefined;
  const raw = selections as Record<string, any>;
  if (String(raw.action || '').trim().toLowerCase() !== 'cast_panglacial_wurm') return undefined;
  const cardId = String(raw.cardId || '').trim();
  return cardId || undefined;
}

export function getPanglacialCastableCards(gameId: string, step: ResolutionStep): any[] {
  if (step.type !== ResolutionStepType.LIBRARY_SEARCH) return [];
  if (!isTrueLibrarySearchStep(step as any)) return [];

  const game = ensureGame(gameId);
  if (!game) return [];

  const playerId = String(step.playerId || '').trim();
  if (!playerId) return [];

  const library = Array.isArray((game as any).libraries?.get(playerId))
    ? ((game as any).libraries.get(playerId) as any[])
    : (Array.isArray((game as any)?.state?.zones?.[playerId]?.library)
      ? ((game as any).state.zones[playerId].library as any[])
      : []);

  return library
    .filter((card: any) => String(card?.name || '').trim().toLowerCase() === PANGLACIAL_WURM_NAME)
    .map(buildKnownCardRefForSearch);
}

export function restoreLibrarySearchStep(gameId: string, step: any): void {
  if (!step?.id) return;
  const queue = ResolutionQueueManager.getQueue(gameId);
  const exists = queue.steps.some((entry: any) => String(entry?.id || '') === String(step.id));
  if (exists) return;
  queue.steps.unshift(step);
  if ((queue as any).activeStep && String((queue as any).activeStep.id || '') === String(step.id)) {
    (queue as any).activeStep = undefined;
  }
}
