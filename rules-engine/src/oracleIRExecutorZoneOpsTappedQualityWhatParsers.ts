/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: tapped/quality battlefield what-parsers and random-from-hand helpers
 * from parseMoveZoneAllOtherTappedCreatures through
 * selectBattlefieldPermanentsWithTotalManaValueLte.
 * Public entry symbols: parseMoveZoneAllOtherTappedCreatures,
 * selectRandomCardIdFromHand, exileRandomCardFromHand,
 * selectBattlefieldPermanentsWithTotalManaValueLte.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import {
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import {
  normalizeBoundPlayerZoneSelectorText,
  stripMoveZoneSelectorPrefix,
} from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import type { MoveZoneUpToTargetCountSpec } from './oracleIRExecutorZoneOpsHandSimpleWhatParsers';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';

export function parseMoveZoneAllOtherTappedCreatures(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all other tapped creatures';
}

export function parseMoveZoneAllTappedCreatures(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all tapped creatures';
}

export function parseMoveZoneHalfCreaturesTheyControlRoundedUp(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'half the creatures they control';
}

export function parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
  ].filter(Boolean);

  for (let raw of candidates) {
    raw = stripMoveZoneSelectorPrefix(raw);
    const embedded = raw.match(
      /(?:you\s+may\s+)?return\s+(target instant or sorcery card from your graveyard or (?:an )?exiled card with flashback you own)(?:\s+to\s+.+)?$/i
    );
    if (embedded) {
      raw = String(embedded[1] || '').trim();
    }
    const lower = raw.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/g, '');
    if (
      lower === 'target instant or sorcery card from your graveyard or exiled card with flashback you own' ||
      lower === 'target instant or sorcery card from your graveyard or an exiled card with flashback you own'
    ) {
      return { cardType: 'instant_or_sorcery' };
    }
  }
  return null;
}

export function parseMoveZoneCompoundOpponentLibraryTopRandomGyHandExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .replace(/[.\s]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return (
    raw ===
      "the top card of target opponent's library, a card at random from target opponent's graveyard, and a card at random from target opponent's hand" ||
    raw ===
      "the top card of target player's library, a card at random from target player's graveyard, and a card at random from target player's hand"
  );
}

export function selectRandomCardIdFromHand(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';
  const hand = Array.isArray(player.hand) ? player.hand : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  if (preferred.length > 0) {
    const match = hand.find((card: any) => preferred.includes(String(card?.id || '').trim()));
    if (match) return String(match.id || '').trim();
  }
  const card = hand[0];
  return card ? String((card as any)?.id || '').trim() : '';
}

export function exileRandomCardFromHand(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): { state: GameState; log: string[]; movedCards: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  let pickedIndex = 0;
  if (preferred.length > 0) {
    const idx = hand.findIndex((card: any) => preferred.includes(String(card?.id || '').trim()));
    if (idx >= 0) pickedIndex = idx;
  }
  const picked = hand[pickedIndex];
  if (!picked) return { state, log: [], movedCards: [] };
  const nextHand = hand.filter((_, index) => index !== pickedIndex);
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: nextHand, exile: [...exile, picked] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles a random card from hand`],
    movedCards: [picked],
  };
}

export function parseMoveZoneUpToCountOfThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^up to ([a-z0-9]+) of them$/);
  if (!match) return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;
  return { maxCount };
}

export function parseMoveZoneUpToThatManyInstantOrSorceryFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^up to that many target (instant and\/or sorcery|instant or sorcery) cards?(?: with mana value (\d+) or less)? from your graveyard(?: and copy them)?$/i
  );
  if (!match) return null;
  const mv = Number.parseInt(String(match[2] || ''), 10);
  return {
    maxCount: 0,
    useReferenceAmount: true,
    criteria: {
      cardType: 'any',
      typeLineTermsAnyOf: ['instant', 'sorcery'],
      ...(Number.isFinite(mv) ? { manaValueLte: mv } : {}),
    },
  };
}

export function parseMoveZoneAnyNumberArtifactCreatureTotalMvFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalManaValueLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^any number of artifact creature cards with total mana value (\d+) or less from your graveyard$/
  );
  if (!match) return null;
  const total = Number.parseInt(String(match[1] || ''), 10);
  if (!Number.isFinite(total)) return null;
  return { totalManaValueLte: total };
}

export function parseMoveZoneUpToCountTotalMvFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number; readonly totalManaValueLte: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^up to (\w+) (\w+(?:\s+\w+)*) cards with total mana value (\d+) or less from your graveyard$/
  );
  if (!match) return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  const total = Number.parseInt(String(match[3] || ''), 10);
  const cardType = parseSimpleCardTypeFromText(String(match[2] || '').trim());
  if (!maxCount || maxCount < 1 || !Number.isFinite(total) || !cardType) return null;
  return { maxCount, totalManaValueLte: total, cardType };
}

export function parseMoveZoneAnyNumberTargetNonlandTotalMv(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalManaValueLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of target nonland permanents with total mana value (\d+) or less$/);
  if (!match) return null;
  const total = Number.parseInt(String(match[1] || ''), 10);
  if (!Number.isFinite(total)) return null;
  return { totalManaValueLte: total };
}

export function parseMoveZoneCreatureYouControl(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature you control';
}

export function parseMoveZoneLesserMvThanDiedCreatureFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (
    raw !==
    'a creature card with lesser mana value than the creature that died from your graveyard'
  ) {
    return null;
  }
  return { cardType: 'creature' };
}

export function parseMoveZoneRandomCardFromTargetPlayerHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return (
    raw === "a card at random from target player's hand" ||
    raw === "a card at random from that player's hand"
  );
}

export function parseMoveZoneCompoundExileItAndEachPlayerReturnAllGyCreaturesToHand(
  rawStep: string
): boolean {
  return /^exile it and each player returns all creature cards from their graveyard to their hand$/i.test(
    String(rawStep || '').trim()
  );
}

export function selectBattlefieldPermanentsWithTotalManaValueLte(
  state: GameState,
  boundPermanentIds: readonly string[],
  totalManaValueLte: number
): string[] {
  const battlefield = [...((state.battlefield || []) as any[])];
  const bound = new Set(boundPermanentIds.map(id => String(id || '').trim()).filter(Boolean));

  let candidates = battlefield.filter(perm => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!permanentId || hasExecutorClass(perm as any, 'land')) return false;
    if (bound.size > 0 && !bound.has(permanentId)) return false;
    return getCardManaValue((perm as any)?.card || perm) !== null;
  });

  if (candidates.length === 0) {
    candidates = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || hasExecutorClass(perm as any, 'land')) return false;
      return getCardManaValue((perm as any)?.card || perm) !== null;
    });
  }

  candidates.sort(
    (left, right) =>
      (getCardManaValue((left as any)?.card || left) ?? 0) -
      (getCardManaValue((right as any)?.card || right) ?? 0)
  );

  const selected: string[] = [];
  let total = 0;
  for (const perm of candidates) {
    const permanentId = String((perm as any)?.id || '').trim();
    const manaValue = getCardManaValue((perm as any)?.card || perm) ?? 0;
    if (total + manaValue > totalManaValueLte) continue;
    selected.push(permanentId);
    total += manaValue;
  }
  return selected;
}

