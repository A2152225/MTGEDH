/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: all-from-hand/exile/library what-parsers and owned-card return helpers
 * from parseMoveZoneAllFromYourHand through parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom.
 * Public entry symbols: parseMoveZoneAllFromYourHand, returnAllOwnedMatchingCardsToPlayerHand.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';
import {
  cardMatchesType,
  normalizeCardColor,
  parseCompoundCardTypeFromText,
  parseCreatureSubtypeWord,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import {
  stripFaceDownSuffix,
  stripPutIntoGraveyardThisTurnQualifier,
  graveyardThisTurnCriteriaFromQualifier,
} from './oracleIRExecutorZoneOpsSingleTargetMatchers';

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;

export function parseMoveZoneAllFromYourHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = stripFaceDownSuffix(raw.replace(/[.\s]+$/g, '').trim());
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your hand\b/i.test(lower) && !/^all\s+cards?\s+from\s+your\s+hand(?:\s+face\s+down)?$/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+(?:the\s+)?cards?\s+from\s+your\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromYourExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your exile\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneTheCardFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the card from your graveyard' || raw === 'the chosen card from your graveyard';
}

export function parseMoveZoneUpToXLandsFromHandAndOrGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | {
      readonly cardType: 'land';
      readonly useXValue: true;
      readonly fromHandOnly?: boolean;
      readonly xReferenceSacrificedCreaturePower?: boolean;
    }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'up to x land cards from your hand and/or graveyard') {
    return { cardType: 'land', useXValue: true };
  }
  if (raw === 'up to x land cards from your hand') {
    return { cardType: 'land', useXValue: true, fromHandOnly: true, xReferenceSacrificedCreaturePower: true };
  }
  return null;
}

export function parseMoveZoneAllFromTargetPlayerHandAndGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .replace(/[.\s]+$/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (
    raw ===
      "all noncreature, nonland cards from that player's hand and graveyard" ||
    raw ===
      "all noncreature, nonland cards from target player's hand and graveyard" ||
    raw ===
      "all noncreature, nonland cards from target opponent's hand and graveyard"
  ) {
    return { cardType: 'noncreature_nonland_permanent' };
  }
  if (
    raw === "all cards from that player's hand and graveyard" ||
    raw === "all cards from target player's hand and graveyard" ||
    raw === "all cards from target opponent's hand and graveyard"
  ) {
    return { cardType: 'any' };
  }
  return null;
}

export function selectContextualCardsWithTotalManaValueLte(
  cards: readonly any[],
  cardType: SimpleCardType,
  totalManaValueLte: number,
  maxCount: number,
  preferredIds: readonly string[] = []
): string[] {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = cards.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !cardMatchesType(card, cardType)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : cards.filter((card: any) => cardMatchesType(card, cardType));
  const selected: string[] = [];
  let total = 0;
  for (const card of pool) {
    if (selected.length >= maxCount) break;
    const mv = getCardManaValue(card);
    if (mv === null) continue;
    if (total + mv > totalManaValueLte) continue;
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    selected.push(cardId);
    total += mv;
  }
  return selected;
}

export function parseMoveZoneAllFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllTypedCardsTargetPlayerOwns(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^all\s+(.+?)\s+target\s+player\s+owns$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  if (!typeText) return null;
  const parsed =
    parseSimpleCardTypeFromText(typeText) ||
    parseSimpleCardTypeFromText(`${typeText} card`) ||
    parseCompoundCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function returnAllOwnedMatchingCardsToPlayerHand(
  state: GameState,
  ownerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  let workingState = state;
  const combinedLog: string[] = [];

  const battlefieldIds = ((workingState.battlefield || []) as any[])
    .filter((perm) => {
      const permOwner = String(perm?.owner || perm?.controller || '').trim();
      return permOwner === ownerId && cardMatchesType(perm, cardType);
    })
    .map((perm) => String(perm?.id || '').trim())
    .filter(Boolean);
  if (battlefieldIds.length > 0) {
    const battlefieldResult = moveBattlefieldPermanentsByIdToOwnersHands(workingState, battlefieldIds);
    workingState = battlefieldResult.state;
    combinedLog.push(...battlefieldResult.log);
  }

  const cardsToHand: any[] = [];
  const graveyardUpdates = new Map<PlayerID, any[]>();
  const exileUpdates = new Map<PlayerID, any[]>();

  for (const player of workingState.players || []) {
    const zonePlayerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!zonePlayerId) continue;

    const graveyard = Array.isArray((player as any)?.graveyard) ? [...(player as any).graveyard] : [];
    const keptGraveyard: any[] = [];
    for (const card of graveyard) {
      const cardOwner = String((card as any)?.owner || zonePlayerId).trim();
      if (cardOwner === ownerId && cardMatchesType(card, cardType)) {
        cardsToHand.push(card);
      } else {
        keptGraveyard.push(card);
      }
    }
    if (keptGraveyard.length !== graveyard.length) {
      graveyardUpdates.set(zonePlayerId, keptGraveyard);
    }

    const exile = Array.isArray((player as any)?.exile) ? [...(player as any).exile] : [];
    const keptExile: any[] = [];
    for (const card of exile) {
      const cardOwner = String((card as any)?.owner || zonePlayerId).trim();
      if (cardOwner === ownerId && cardMatchesType(card, cardType)) {
        cardsToHand.push(stripImpulsePermissionMarkers(card));
      } else {
        keptExile.push(card);
      }
    }
    if (keptExile.length !== exile.length) {
      exileUpdates.set(zonePlayerId, keptExile);
    }
  }

  if (cardsToHand.length > 0 || graveyardUpdates.size > 0 || exileUpdates.size > 0) {
    let nextState = cardsToHand.length > 0 ? clearPlayableFromExileForCards(workingState, ownerId, cardsToHand) : workingState;
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player) => {
        const playerId = String((player as any)?.id || '').trim() as PlayerID;
        const nextPlayer: any = { ...(player as any) };
        if (graveyardUpdates.has(playerId)) {
          nextPlayer.graveyard = graveyardUpdates.get(playerId);
        }
        if (exileUpdates.has(playerId)) {
          nextPlayer.exile = exileUpdates.get(playerId);
        }
        if (playerId === ownerId && cardsToHand.length > 0) {
          const hand = Array.isArray(nextPlayer.hand) ? [...nextPlayer.hand] : [];
          nextPlayer.hand = [...hand, ...cardsToHand];
        }
        return nextPlayer;
      }),
    } as GameState;
    workingState = nextState;
    if (cardsToHand.length > 0) {
      combinedLog.push(`${ownerId} returns ${cardsToHand.length} owned ${cardType} card(s) to hand`);
    }
  }

  return { state: workingState, log: combinedLog };
}

export function parseMoveZoneAllFromTargetPlayersLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s library\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+library$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+library$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s exile\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | Pick<MoveZoneSingleTargetCriteria, 'cardType' | 'colorsAnyOf' | 'creatureTypesAnyOf' | 'putIntoGraveyardThisTurn' | 'putIntoGraveyardFromLibraryThisTurn'>
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const cleaned = withTurn.selectorText.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;

  const fromEachPlayersGy =
    /\bfrom each player's graveyard\b/i.test(lower) || /\bfrom each players' graveyard\b/i.test(lower);
  const fromAllGys = /\bfrom all graveyards\b/i.test(lower) || /\bin all graveyards\b/i.test(lower);
  if (!fromEachPlayersGy && !fromAllGys) return null;

  const colorQualifiedMatch = cleaned.match(
    /^all cards that are ((?:white|blue|black|red|green)(?:\s+or\s+(?:white|blue|black|red|green))*) from (?:each player's graveyard|each players' graveyard|all graveyards)$/i
  );
  if (colorQualifiedMatch) {
    const colorsAnyOf = String(colorQualifiedMatch[1] || '')
      .split(/\s+or\s+/i)
      .map(color => normalizeCardColor(color))
      .filter((color): color is string => Boolean(color));
    if (colorsAnyOf.length > 0) return { cardType: 'any', colorsAnyOf };
  }

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i.test(lower)) {
    return { cardType: 'any', ...graveyardThisTurnCriteriaFromQualifier(withTurn) };
  }

  const inAllGysMatch = cleaned.match(/^all\s+(.+?)\s+cards?\s+in\s+all\s+graveyards$/i);
  if (inAllGysMatch) {
    const typeText = String(inAllGysMatch[1] || '').trim();
    const parsed = parseCompoundCardTypeFromText(typeText) || parseSimpleCardTypeFromText(typeText);
    if (!parsed) return null;
    return { cardType: parsed, ...graveyardThisTurnCriteriaFromQualifier(withTurn) };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i
  );
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) {
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [creatureSubtype],
      ...graveyardThisTurnCriteriaFromQualifier(withTurn),
    };
  }
  const parsed = parseCompoundCardTypeFromText(typeText) || parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed, ...graveyardThisTurnCriteriaFromQualifier(withTurn) };
}

export function parseMoveZoneMassBattlefieldCreatureBounce(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | {
      readonly excludeTypeLineTerm?: string;
      readonly excludeChosenCreatureType?: true;
      readonly excludeCardColor?: string;
      readonly eachCreatureWithoutCounter?: string;
      readonly chosenCreaturesOnly?: true;
    }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (
    raw === 'each chosen creature' ||
    raw === 'the chosen creatures' ||
    raw === 'all chosen creatures'
  ) {
    return { chosenCreaturesOnly: true };
  }
  const withoutCounterMatch = raw.match(/^each creature without a (\+1\/\+1) counter on it$/);
  if (withoutCounterMatch) {
    return { eachCreatureWithoutCounter: String(withoutCounterMatch[1] || '').trim() };
  }
  if (
    raw === "all creatures that aren't of the chosen type" ||
    raw === "all creatures that are not of the chosen type"
  ) {
    return { excludeChosenCreatureType: true };
  }
  const nonColorMatch = raw.match(/^all non(white|blue|black|red|green) creatures$/);
  if (nonColorMatch) {
    return { excludeCardColor: String(nonColorMatch[1] || '').trim() };
  }
  let match = raw.match(/^each non-([a-z'-]+) creature$/);
  if (match) return { excludeTypeLineTerm: String(match[1] || '').trim() };
  match = raw.match(/^all non-([a-z'-]+) creatures$/);
  if (match) {
    const term = String(match[1] || '').trim();
    if (/^(white|blue|black|red|green)$/.test(term)) {
      return { excludeCardColor: term };
    }
    return { excludeTypeLineTerm: term };
  }
  return null;
}

export function parseMoveZoneAllColoredPermanentsToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^all (white|blue|black|red|green) permanents$/);
  if (!match) return null;
  const colorMap: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };
  const color = colorMap[String(match[1] || '').trim()];
  if (!color) return null;
  return { cardType: 'permanent', colorsAnyOf: [color] };
}

export function parseMoveZoneAllNoncreatureNonlandPermanentsToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'all noncreature, nonland permanents' || raw === 'all noncreature nonland permanents') {
    return { cardType: 'noncreature_nonland_permanent' };
  }
  return null;
}

export function parseMoveZoneUnlessPaysManaFromStepText(
  stepRaw?: string,
  toRaw?: string
): { readonly mana: string } | null {
  const combined = `${String(stepRaw || '')} ${String(toRaw || '')}`.replace(/[\u2019]/g, "'");
  const match = combined.match(/\bunless\s+(?:its\s+controller|they)\s+pays?\s+(\{[^}]+\})/i);
  if (!match) return null;
  const mana = String(match[1] || '').trim();
  return mana ? { mana } : null;
}

export function parseMoveZoneAnyNumberTypedFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of (.+?) cards from your hand$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAnyNumberFromYourHandFaceDown(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'any number of cards from your hand face down') return { cardType: 'any' };
  const match = raw.match(/^any number of (.+?) cards from your hand face down$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all cards in your graveyard destroyed this way';
}

export function parseMoveZoneCompoundArtifactCreatureLandGyHandsExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw ===
      'all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands'
  );
}

export function parseMoveZoneAllCardsFromAllHandsAndGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all cards from all hands and graveyards';
}

export function parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature card from your hand that shares a creature type with each creature tapped this way';
}

export function parseMoveZoneEachCreatureThatDealtDamageThisTurn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each creature that dealt damage this turn';
}

export function parseMoveZoneCountTypedCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(two|\d+|[a-z]+) (.+?) cards?$/);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  const cardType = parseSimpleCardTypeFromText(String(match[2] || '').trim()) || 'any';
  return { count, cardType };
}

export function parseMoveZoneCreatureYouDontControlLowestToughness(what: {
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
  return (
    raw ===
      "a creature you don't control with the lowest toughness among creatures you don't control" ||
    raw ===
      "visit - return a creature you don't control with the lowest toughness among creatures you don't control"
  );
}

export function parseMoveZoneThatManyCreatureCardsFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that many creature cards from your graveyard';
}

export function parseMoveZoneEachCreatureExcludingListedTypes(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly excludedCreatureTypes: readonly string[] } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '')
    .trim()
    .replace(/\u2019/g, "'")
    .replace(/[.\s]+$/g, '');
  const match = raw.match(/^each creature that isn't a (.+)$/i);
  if (!match) return null;
  const excludedCreatureTypes = String(match[1] || '')
    .split(/\s*,\s*|\s+or\s+/i)
    .map(type => type.trim().replace(/^or\s+/i, ''))
    .filter(Boolean);
  if (excludedCreatureTypes.length === 0) return null;
  return { excludedCreatureTypes };
}

export function parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards(what: {
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
  return raw === "all cards from all opponents' hands and graveyards";
}

export function parseMoveZoneCreatureHandTotalPowerToughnessLte(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalPowerToughnessLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[.\s]+$/g, '');
  const match = raw.match(/^a creature card with total power and toughness (\d+) or less from your hand$/);
  if (!match) return null;
  const total = Number.parseInt(String(match[1] || ''), 10);
  if (!Number.isFinite(total)) return null;
  return { totalPowerToughnessLte: total };
}

export function parseMoveZoneTargetNonlandSameNameMassExile(what: {
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
  return (
    raw ===
    'target nonland card from a graveyard, all other cards from graveyards with the same name as that card, and all permanents with that name'
  );
}

export function parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom(what: {
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
  return (
    raw ===
    'up to one nonland card from among them and put the rest on the bottom of your library in a random order'
  );
}

