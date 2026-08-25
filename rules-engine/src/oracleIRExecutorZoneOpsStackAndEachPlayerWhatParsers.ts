/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: stack-exile / each-player all-from-zone what-parsers from
 * parseMoveZoneAllSpellsAndAbilitiesFromStackIncludingThis through
 * parseMoveZoneAllFromEachOpponentsExile.
 * Public entry symbols: exileAllSpellsAndAbilitiesFromStack,
 * exileAllSameNamedCardsFromAllGraveyards.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import {
  cardMatchesType,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { normalizeCardNameForCriteria } from './oracleIRExecutorZoneOpsSingleTargetMatchers';

export function parseMoveZoneAllSpellsAndAbilitiesFromStackIncludingThis(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[)\s.]+$/g, '');
  return raw === 'all spells and abilities from the stack, including this spell';
}

export function parseMoveZoneAnyNumberDistinctManaValuesFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[.\s]+$/g, '');
  return raw === 'any number of cards with different mana values from your graveyard';
}

export function selectGraveyardCardIdsWithDistinctManaValues(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): readonly string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  const preferredSet = new Set(preferred);
  const orderedCards = [
    ...graveyard.filter((card: any) => preferredSet.has(String(card?.id || '').trim())),
    ...graveyard.filter((card: any) => !preferredSet.has(String(card?.id || '').trim())),
  ];
  const selected: string[] = [];
  const usedManaValues = new Set<number>();
  for (const card of orderedCards) {
    const cardId = String((card as any)?.id || '').trim();
    if (!cardId) continue;
    if (preferred.length > 0 && !preferredSet.has(cardId)) continue;
    const manaValue = getCardManaValue(card);
    if (manaValue === null || usedManaValues.has(manaValue)) continue;
    selected.push(cardId);
    usedManaValues.add(manaValue);
  }
  return selected;
}

export function exileAllSpellsAndAbilitiesFromStack(
  state: GameState,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[]; readonly exiledCount: number } {
  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  if (stack.length === 0) {
    return { state, log: [], exiledCount: 0 };
  }

  let workingState = state;
  const combinedLog: string[] = [];
  let exiledCount = 0;
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(ctx.sourceName || '').trim();

  for (const stackObject of stack) {
    const targetSpellId = String((stackObject as any)?.id || '').trim();
    if (!targetSpellId) continue;
    const ownerId = String(
      (stackObject as any)?.owner ||
        (stackObject as any)?.ownerId ||
        (stackObject as any)?.controller ||
        (stackObject as any)?.controllerId ||
        ctx.controllerId ||
        ''
    ).trim() as PlayerID;
    if (!ownerId) continue;

    const baseCard =
      (stackObject as any)?.card && typeof (stackObject as any).card === 'object'
        ? { ...(stackObject as any).card }
        : { ...(stackObject as any) };
    const exiledSpellCard = {
      ...baseCard,
      id: String((baseCard as any)?.id || targetSpellId).trim() || targetSpellId,
      name:
        String((baseCard as any)?.name || (stackObject as any)?.name || targetSpellId).trim() ||
        targetSpellId,
      zone: 'exile',
      owner: ownerId,
      ownerId,
      ...(sourceRef ? { exiledBy: sourceRef } : {}),
      ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
    };

    const currentStack = Array.isArray((workingState as any).stack)
      ? [...((workingState as any).stack as any[])]
      : [];
    const nextStack = currentStack.filter(
      entry => String((entry as any)?.id || '').trim() !== targetSpellId
    );
    const updatedPlayers = (workingState.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== ownerId) return player;
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      return { ...player, exile: [...exile, exiledSpellCard] };
    });
    workingState = {
      ...(workingState as any),
      stack: nextStack as any,
      players: updatedPlayers as any,
    } as GameState;
    combinedLog.push(`${ownerId} exiles ${exiledSpellCard.name} from the stack`);
    exiledCount += 1;
  }

  return { state: workingState, log: combinedLog, exiledCount };
}

export function exileAllSameNamedCardsFromAllGraveyards(
  state: GameState,
  targetName: string
): {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCount: number;
  readonly normalizedTargetName: string;
} {
  const normalizedTargetName = normalizeCardNameForCriteria(targetName);
  if (!normalizedTargetName) return { state, log: [], movedCount: 0, normalizedTargetName: '' };

  let workingState = state;
  const combinedLog: string[] = [];
  let movedCount = 0;

  for (const player of (workingState.players || []) as any[]) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const kept: any[] = [];
    const moved: any[] = [];
    for (const card of graveyard) {
      const cardName = normalizeCardNameForCriteria(String((card as any)?.name || ''));
      if (cardName === normalizedTargetName) moved.push(card);
      else kept.push(card);
    }
    if (moved.length === 0) continue;
    movedCount += moved.length;
    const updatedPlayers = workingState.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...moved] } as any) : p
    );
    workingState = { ...workingState, players: updatedPlayers as any } as GameState;
    combinedLog.push(`${playerId} exiles ${moved.length} same-named card(s) from graveyard`);
  }

  return { state: workingState, log: combinedLog, movedCount, normalizedTargetName };
}

export function parseMoveZoneAnyNumberTargetCreaturesTotalMvFromGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly fromTargetPlayerOnly: boolean } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'any number of target creature cards with total mana value x or less from graveyards') {
    return { fromTargetPlayerOnly: false };
  }
  if (
    raw ===
    "any number of target creature cards with total mana value x or less from that player's graveyard"
  ) {
    return { fromTargetPlayerOnly: true };
  }
  return null;
}

export function parseMoveZoneCraftExiledCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw !== 'an exiled creature card used to craft this permanent') return null;
  return { cardType: 'creature' };
}

export function parseMoveZoneUpToReferenceCountTargetPermanents(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return raw === 'up to that many target permanents that player controls';
}

export function parseMoveZoneTopCardsFromTargetPlayerLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const match = raw.match(/^the top (two|[a-z0-9]+) cards of (?:target|that) player's library$/);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count };
}

export function parseMoveZoneCommandZonePermanent(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  stepRaw?: string
): boolean {
  if (what.kind !== 'raw') return false;
  const text = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const raw = String(stepRaw || '').toLowerCase();
  if (text === 'this permanent' && /\bfrom the command zone\b/.test(raw)) return true;
  if (text === 'a commander you own from the command zone') return true;
  if (text === 'your commander') return true;
  return false;
}

export function parseMoveZoneAllCommandersYouOwnFromCommandZoneAndGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const text = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return text === 'all commanders you own from the command zone and from your graveyard';
}

export function parseMoveZoneAllCommandersFromCommandZone(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const text = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return text === 'all commanders from the command zone';
}

export function parseMoveZoneMyraExileInstantSorcery(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (
    !/^target instant or sorcery card with mana value x from your graveyard and choose an attraction you control that doesn't have a midway counter on it$/.test(
      raw
    )
  ) {
    return null;
  }
  return { cardType: 'instant_or_sorcery', manaValueLte: -1 };
}

export function parseMoveZoneSharesTypeFromAmongThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'a card that shares a creature type with it from among them' ||
    raw === 'a card that shares a creature type with enchanted creature from among them' ||
    raw === 'a creature card that shares a creature type with enchanted creature from among them'
  );
}

export function selectGraveyardCreaturesWithTotalManaValueLteFromPlayers(
  state: GameState,
  playerIds: readonly PlayerID[],
  totalManaValueLte: number,
  preferredIds: readonly string[] = []
): readonly { readonly playerId: PlayerID; readonly cardId: string }[] {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const selected: { playerId: PlayerID; cardId: string }[] = [];
  let total = 0;

  const candidates: { playerId: PlayerID; cardId: string; manaValue: number }[] = [];
  for (const playerId of playerIds) {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) continue;
    const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
    for (const card of graveyard) {
      if (!cardMatchesType(card, 'creature')) continue;
      const cardId = String((card as any)?.id || '').trim();
      const manaValue = getCardManaValue(card);
      if (!cardId || manaValue === null) continue;
      candidates.push({ playerId, cardId, manaValue });
    }
  }

  candidates.sort((left, right) => left.manaValue - right.manaValue);
  const preferredCandidates = candidates.filter(entry => preferred.has(entry.cardId));
  const pool = preferredCandidates.length > 0 ? preferredCandidates : candidates;

  for (const entry of pool) {
    if (total + entry.manaValue > totalManaValueLte) continue;
    selected.push({ playerId: entry.playerId, cardId: entry.cardId });
    total += entry.manaValue;
  }
  return selected;
}

export function parseMoveZoneAllFromEachPlayersHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (!/\bfrom each player's hand\b/i.test(lower) && !/\bfrom each players' hand\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCountCardsFromEachPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^([a-z]+|\d+) cards from each player's hand$/);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count, cardType: 'any' };
}

export function parseMoveZoneAllFromEachPlayersExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersExile = /\bfrom each player's exile\b/i.test(lower) || /\bfrom each players' exile\b/i.test(lower);
  const fromAllExiles = /\bfrom all exiles\b/i.test(lower);
  if (!fromEachPlayersExile && !fromAllExiles) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i
  );
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppGy =
    /\bfrom each opponent's graveyard\b/i.test(lower) || /\bfrom each opponents' graveyard\b/i.test(lower);
  if (!fromEachOppGy) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppHand = /\bfrom each opponent's hand\b/i.test(lower) || /\bfrom each opponents' hand\b/i.test(lower);
  if (!fromEachOppHand) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppExile = /\bfrom each opponent's exile\b/i.test(lower) || /\bfrom each opponents' exile\b/i.test(lower);
  if (!fromEachOppExile) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}
