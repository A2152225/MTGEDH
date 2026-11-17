/**
 * oracleIRExecutorZoneOpsExiledTypedCardParsers.ts
 *
 * Origin parent: oracleIRExecutorZoneOpsUpToCountWhatParsers.ts (this-way / exiled-with `what` parsers).
 * Cluster: typed plurals of the "exiled this way" / "exiled with it" selectors:
 * - "all permanent cards exiled this way" (Deep Space 9)
 * - "each creature card you own exiled with it" (S.S. Botany Bay)
 *
 * Public entries: parseMoveZoneAllTypedCardsExiledThisWay, parseMoveZoneEachTypedCardYouOwnExiledWithIt.
 * Registered through parseMoveZoneWhatReferenceQueries, the same slots as
 * parseMoveZoneAllCardsTheyExiledThisWay / parseMoveZoneAllExiledWithThisPermanent.
 */

import type { AllExiledWithThisPermanentSpec } from './oracleIRExecutorZoneOpsUpToCountWhatParsers';
import type { GameState } from '../../shared/src';
import { cardMatchesType, parseSimpleCardTypeFromText } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';

type WhatLike = { readonly kind: string; readonly text?: string; readonly raw?: string };

function readWhatText(what: WhatLike): string | null {
  if (what.kind !== 'raw') return null;
  return String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
}

function parseTypeWord(word: string): SimpleCardType | null {
  const normalized = String(word || '').trim().toLowerCase();
  if (!normalized) return null;
  return parseSimpleCardTypeFromText(normalized);
}

/** True when the card with `cardId` sits in `playerId`'s exile zone and matches `cardType`. */
export function exiledCardMatchesType(
  state: GameState,
  playerId: string,
  cardId: string,
  cardType: SimpleCardType,
): boolean {
  const owner = (state.players || []).find((p: any) => String(p?.id || '') === String(playerId)) as any;
  const exile = Array.isArray(owner?.exile) ? owner.exile : [];
  const card = exile.find((entry: any) => String(entry?.id || '').trim() === String(cardId || '').trim());
  return Boolean(card) && cardMatchesType(card, cardType);
}

/** "all permanent cards exiled this way" / "each creature card they exiled this way". */
export function parseMoveZoneAllTypedCardsExiledThisWay(what: WhatLike): { readonly cardType: SimpleCardType } | null {
  const raw = readWhatText(what);
  if (!raw) return null;
  const match = raw.match(/^(?:all|each)\s+([a-z]+)\s+cards?\s+(?:they\s+)?exiled\s+this\s+way$/);
  if (!match) return null;
  const cardType = parseTypeWord(String(match[1] || ''));
  return cardType ? { cardType } : null;
}

/** "each creature card you own exiled with it" - cards in the controller's own exile zone only. */
export function parseMoveZoneEachTypedCardYouOwnExiledWithIt(what: WhatLike): AllExiledWithThisPermanentSpec | null {
  const raw = readWhatText(what);
  if (!raw) return null;
  const match = raw.match(
    /^(?:each|all)\s+([a-z]+)\s+cards?\s+you\s+own\s+exiled\s+with\s+(?:it|this\s+(?:enchantment|artifact|creature|permanent|card|land|vehicle|spacecraft))$/,
  );
  if (!match) return null;
  const cardType = parseTypeWord(String(match[1] || ''));
  return cardType ? { cardType, ownedByController: true } : null;
}
