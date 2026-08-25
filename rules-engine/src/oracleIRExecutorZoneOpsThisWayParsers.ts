/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: mill/discard/exile-this-way follow-up parsers from
 * parseMoveZoneRestOfExiledCards through parseMoveZoneUpToTargetCreaturesExcludingTypeLineTerm,
 * plus cardHasAdventureCharacteristics.
 * Public entry symbols: cardHasAdventureCharacteristics, parseMoveZoneAllCardsMilledThisWay,
 * parseMoveZoneAllCardsDiscardedThisWay, parseMoveZoneTypedCardFromHandOrGraveyard,
 * parseMoveZoneTypedCardsRevealedThisWay, and sibling parseMoveZone* in this range.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import {
  getCardOracleText,
  parseCompoundCardTypeFromText,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { shufflePlayerGraveyardIntoLibrary } from './oracleIRExecutorZoneOpsShuffleIntoLibrary';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import {
  parseAmongThemTypeConstraints,
  parseRevealedThisWayTypeText,
  stepHasAmongThemRestToLibrary,
} from './oracleIRExecutorZoneOpsAmongThemParsers';
import type { AmongThemMoveCriteria, ContextualThemSplitSpec } from './oracleIRExecutorZoneOpsAmongThemParsers';

export function getCardTypeLineLower(card: any): string {
  return String(card?.type_line || card?.card?.type_line || '').toLowerCase().trim();
}

export function parseMoveZoneRestOfExiledCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the rest of the exiled cards';
}

export function parseMoveZoneAllPermanentsYouOwn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): 'you_own' | 'they_own' | false {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'all permanents you own') return 'you_own';
  if (raw === 'all permanents they own') return 'they_own';
  return false;
}

export function parseMoveZoneReturnThisCardAndUpToOneOtherFromGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly otherCardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^this card and up to one other target (.+?) card from your graveyard$/
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { otherCardType: parsed };
}

export function parseMoveZoneUpToXTargetPermanents(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'up to x target permanents';
}

export function cardHasAdventureCharacteristics(card: any): boolean {
  const typeLine = getCardTypeLineLower(card);
  if (typeLine.includes('adventure')) return true;
  const layout = String(card?.layout || card?.card?.layout || '').trim().toLowerCase();
  return layout === 'adventure';
}

export type MilledThisWaySpec = {
  readonly cardType: SimpleCardType;
  readonly maxCount?: number;
  readonly anyNumber?: boolean;
};

export function parseMoveZoneAllCardsMilledThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MilledThisWaySpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const anyNumberMatch = raw.match(/^any number of\s+(.+?)\s+cards?\s+milled this way$/);
  if (anyNumberMatch) {
    const parsed = parseSimpleCardTypeFromText(String(anyNumberMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed, anyNumber: true };
  }
  const upToOneMatch = raw.match(/^up to one\s+(.+?)\s+card milled this way$/);
  if (upToOneMatch) {
    const parsed = parseSimpleCardTypeFromText(String(upToOneMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed, maxCount: 1 };
  }
  const singleMatch = raw.match(/^(?:a|an)\s+(.+?)\s+card milled this way$/);
  if (singleMatch) {
    const parsed = parseSimpleCardTypeFromText(String(singleMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed };
  }
  const eachMatch = raw.match(/^each\s+(.+?)\s+cards?\s+milled this way$/);
  if (eachMatch) {
    const parsed = parseSimpleCardTypeFromText(String(eachMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed };
  }
  const match = raw.match(/^all\s+(.+?)\s+cards?\s+milled this way$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export type DiscardedThisWaySpec = MilledThisWaySpec;

export function parseMoveZoneAllCardsDiscardedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): DiscardedThisWaySpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const upToOneMatch = raw.match(/^up to one\s+(.+?)\s+card discarded this way$/);
  if (upToOneMatch) {
    const parsed = parseSimpleCardTypeFromText(String(upToOneMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed, maxCount: 1 };
  }
  const singleMatch = raw.match(/^(?:a|an)\s+(.+?)\s+card discarded this way$/);
  if (singleMatch) {
    const parsed = parseSimpleCardTypeFromText(String(singleMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed };
  }
  const eachMatch = raw.match(/^each\s+(.+?)\s+cards?\s+discarded this way$/);
  if (eachMatch) {
    const parsed = parseSimpleCardTypeFromText(String(eachMatch[1] || '').trim());
    if (!parsed) return null;
    return { cardType: parsed };
  }
  const match = raw.match(/^all\s+(.+?)\s+cards?\s+discarded this way$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneOpponentChoicePermanentToHand(
  what: {
    readonly kind: string;
    readonly text?: string;
    readonly raw?: string;
  },
  stepRaw?: string
): boolean {
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(stepRaw || '').trim(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/[\u2019]/g, "'")
      .replace(/[.\s]+$/g, '')
      .trim()
      .toLowerCase();
    if (
      /^target opponent chooses a permanent they control(?: and returns it to its owner's hand)?$/.test(
        normalized
      )
    ) {
      return true;
    }
  }
  return false;
}

export type ExiledCardsWithCounterSpec = {
  readonly counterName: string;
  readonly controllerOwned?: boolean;
};

function cardHasNamedCounter(card: any, counterName: string): boolean {
  const counters = card?.counters;
  if (!counters || typeof counters !== 'object') return false;
  const normalized = String(counterName || '').trim().toLowerCase();
  if (!normalized) return false;
  for (const [key, value] of Object.entries(counters)) {
    if (String(key).trim().toLowerCase() === normalized && Number(value) > 0) return true;
  }
  return false;
}

export function findAllExiledCardsWithCounter(
  state: GameState,
  counterName: string,
  ownerId?: PlayerID
): Array<{ readonly playerId: PlayerID; readonly cardId: string }> {
  const matches: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    for (const card of exile) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || !cardHasNamedCounter(card, counterName)) continue;
      if (ownerId) {
        const cardOwner = String((card as any)?.owner || playerId).trim() as PlayerID;
        if (cardOwner !== ownerId) continue;
      }
      matches.push({ playerId, cardId });
    }
  }
  return matches;
}

export function parseMoveZoneAllExiledCardsWithCounter(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): ExiledCardsWithCounterSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const ownedMatch = raw.match(/^all exiled cards you own with ([a-z0-9+/-]+) counters? on them$/);
  if (ownedMatch) {
    const counterName = String(ownedMatch[1] || '').trim();
    if (!counterName) return null;
    return { counterName, controllerOwned: true };
  }
  const match = raw.match(/^all exiled cards with ([a-z0-9+/-]+) counters? on them$/);
  if (!match) return null;
  const counterName = String(match[1] || '').trim();
  if (!counterName) return null;
  return { counterName };
}

export function parseMoveZoneAllAdventureCardsFromMilledCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'all cards that have an adventure from among the milled cards' ||
    raw === 'all cards that have an adventure from among milled cards'
  );
}

export function cardHasNonManaActivatedAbility(card: any): boolean {
  const oracle = getCardOracleText(card);
  if (!oracle.includes(':')) return false;
  const clauses = oracle.split(/\n+/);
  for (const clause of clauses) {
    const trimmed = String(clause || '').trim();
    if (!trimmed.includes(':')) continue;
    if (
      /^(\{[^}]+\}(?:,\s*\{[^}]+\})*):\s*Add\s+(?:\{[WUBRGC]\}|\{[WUBRGC]\}\{[WUBRGC]\}|one mana)/i.test(
        trimmed
      )
    ) {
      continue;
    }
    if (/^(\{[^}]+\}(?:,\s*\{[^}]+\})*):\s*Add\s+/i.test(trimmed) && !/\b(?:draw|damage|destroy|exile|return|create|put|target)\b/i.test(trimmed)) {
      continue;
    }
    return true;
  }
  return false;
}

export function parseMoveZoneAllNonManaActivatedCreaturesFromMilledCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw ===
      "all creature cards with activated abilities that aren't mana abilities from among the milled cards" ||
    raw ===
      'all creature cards with activated abilities that are not mana abilities from among the milled cards'
  );
}

export function parseMoveZoneCardFromChosenPile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card from the chosen pile';
}

export function parseMoveZoneAllCardsFromPileOfYourChoice(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all cards from the pile of your choice';
}

export function parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all creatures blocking or blocked by target creature';
}

export function parseMoveZoneThoseLands(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'those lands';
}

export function parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .replace(/[.\s]+$/g, '')
    .trim();
  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  const match = lower.match(
    /^(?:a|an)\s+(.+?)\s+card\s+of\s+(?:target\s+)?(?:an?\s+)?(?:opponent(?:'s)?|their)\s+choice\s+from\s+(?:target\s+)?(?:an?\s+)?(?:opponent(?:'s)?|their|that\s+player(?:'s)?|your)\s+graveyard$/
  );
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed = parseMoveZoneSingleTargetCriteria(typeText) || parseMoveZoneSingleTargetCriteria(`${typeText} card`);
  if (!parsed) return null;
  return {
    ...parsed,
    fromHandOrGraveyardOwner: /\byour\s+graveyard\b/.test(lower) ? 'controller' : 'target_player',
  };
}

export function parseMoveZoneAdventureCardThatPlayerOwnsFromExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'a card that has an adventure that player owns from exile' ||
    raw === "a card that has an adventure that opponent owns from exile"
  );
}

export function parseMoveZoneAllCreatureTokens(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all creature tokens';
}

export function parseMoveZoneTargetCreatureOwnerLibraryChoice(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  stepRaw?: string
): boolean {
  if (what.kind !== 'raw') return false;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(stepRaw || '').trim(),
  ].filter(Boolean);
  for (const text of candidates) {
    if (
      /target creature(?:'|\u2019)?s owner puts it on (?:their|its) choice of the top or bottom of (?:their|its owner'?s?) library/i.test(
        text
      )
    ) {
      return true;
    }
  }
  return false;
}

export function parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType; readonly manaValueLte?: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'all creatures on the battlefield and all creature cards in graveyards') {
    return { cardType: 'creature' };
  }
  const mvCompoundMatch = raw.match(
    /^all creatures and planeswalkers with mana value (\d+) or less from the battlefield and all creature and planeswalker cards with mana value \1 or less from all graveyards$/
  );
  if (mvCompoundMatch) {
    const manaValueLte = Number.parseInt(String(mvCompoundMatch[1] || ''), 10);
    if (Number.isFinite(manaValueLte)) {
      return { cardType: 'creature_or_planeswalker', manaValueLte };
    }
  }
  return null;
}

export function parseMoveZoneAnyNumberCardsFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: 'any' } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'any number of cards from your hand') return { cardType: 'any' };
  return null;
}

export function shuffleSelectedCardsFromHandIntoLibrary(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const selected =
    preferred.size > 0
      ? hand.filter((card: any) => preferred.has(String(card?.id || '').trim()))
      : hand;
  if (selected.length === 0) return { state, log: [] };

  const selectedIds = new Set(
    selected.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
  );
  const keptHand = hand.filter((card: any) => !selectedIds.has(String(card?.id || '').trim()));
  const library = Array.isArray(player.library) ? [...player.library] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: keptHand, library: [...library, ...selected] } as any) : p
  );

  return {
    state: { ...state, players: updatedPlayers as any } as GameState,
    log: [`${playerId} shuffles ${selected.length} card(s) from hand into library`],
  };
}
export function parseMoveZoneShuffleSourceArtifactAndGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'this artifact and your graveyard' ||
    raw === 'this permanent and your graveyard' ||
    raw === 'this enchantment and your graveyard'
  );
}

export function parseMoveZoneAllExiledWithNamedSource(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): string | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^all cards exiled with (.+)$/);
  if (!match) return null;
  const name = String(match[1] || '').trim();
  return name || null;
}

export function shuffleSourcePermanentAndGraveyardIntoLibrary(
  state: GameState,
  controllerId: PlayerID,
  sourceId: string
): GameState {
  const wantedSourceId = String(sourceId || '').trim();
  const battlefield = [...((state.battlefield || []) as any[])];
  const sourceIndex = wantedSourceId
    ? battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === wantedSourceId)
    : -1;
  const sourcePermanent = sourceIndex >= 0 ? battlefield[sourceIndex] : null;
  const sourceCard =
    sourcePermanent && !(sourcePermanent as any)?.isToken
      ? buildZoneObjectWithRetainedCounters((sourcePermanent as any)?.card, sourcePermanent, 'library')
      : null;
  const nextBattlefield =
    sourceIndex >= 0 ? battlefield.filter((_: any, index: number) => index !== sourceIndex) : battlefield;
  let nextState = { ...(state as any), battlefield: nextBattlefield } as GameState;
  if (sourceCard) {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    if (player) {
      const library = Array.isArray(player.library) ? [...player.library, sourceCard] : [sourceCard];
      nextState = {
        ...nextState,
        players: nextState.players.map(p => (p.id === controllerId ? ({ ...(p as any), library } as any) : p)),
      } as GameState;
    }
  }
  return shufflePlayerGraveyardIntoLibrary(nextState, controllerId);
}

export function parseMoveZoneThatCardReference(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that card' || raw.startsWith('that card ') || raw === 'that card from a graveyard';
}

export function parseMoveZoneTypedCardFromHandOrGraveyard(
  what: {
    readonly kind: string;
    readonly text?: string;
    readonly raw?: string;
  },
  rawStep?: string
): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(rawStep || '').trim(),
  ].filter(Boolean);
  for (let raw of candidates) {
    raw = raw.replace(/[.\s]+$/g, '').trim();
    const ontoBfFromHandOrGy = raw.match(
      /^(?:you\s+may\s+)?put\s+((?:a|an)\s+.+?)\s+onto\s+the\s+battlefield\s+from\s+your\s+hand\s+or\s+graveyard/i
    );
    if (ontoBfFromHandOrGy) {
      raw = String(ontoBfFromHandOrGy[1] || '').trim();
    }
    const cleaned = raw.replace(/[.\s]+$/g, '').trim();
    const landsMvMatch = cleaned.match(
      /^(?:a|an)\s+(.+?)\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+the\s+number\s+of\s+lands\s+you\s+control(?:\s+from\s+your\s+hand(?:\s+or\s+graveyard)?)?$/i
    );
    if (landsMvMatch) {
      const parsed = parseSimpleCardTypeFromText(String(landsMvMatch[1] || '').trim());
      if (parsed) {
        return { cardType: parsed, manaValueLteLandsControlled: true, fromHandOrGraveyardOwner: 'controller' };
      }
    }
    const match =
      cleaned.match(
        /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+(\d+)(?:\s+or\s+less)?)?\s+from\s+your\s+hand\s+or\s+graveyard$/i
      ) ||
      cleaned.match(
        /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+(\d+)(?:\s+or\s+less)?)?\s+from\s+that\s+player(?:'s|'s)?\s+graveyard\s+or\s+hand$/i
      );
    if (!match) continue;
    const typeText = String(match[1] || '').trim();
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!parsed) continue;
    const fromHandOrGraveyardOwner = /that\s+player/i.test(cleaned) ? 'target_player' : 'controller';
    const mv = Number.parseInt(String(match[2] || ''), 10);
    if (Number.isFinite(mv) && /\bor\s+less\b/i.test(cleaned)) {
      return { cardType: parsed, manaValueLte: mv, fromHandOrGraveyardOwner };
    }
    return { cardType: parsed, fromHandOrGraveyardOwner };
  }
  return null;
}

export function parseMoveZoneTypedCardMvLessThanReferenceFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^(?:a|an)\s+(.+?)\s+card\s+with\s+mana\s+value\s+less\s+than\s+that\s+creature's\s+mana\s+value\s+from\s+your\s+hand$/
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function stepHasRevealedThisWayRestToLibrary(step: {
  readonly raw?: string;
  readonly toRaw?: string;
}): boolean {
  return stepHasAmongThemRestToLibrary(step);
}

export function parseMoveZoneTypedCardsRevealedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  if (/^the nonland cards revealed this way$/i.test(raw)) {
    return { cardType: 'nonland', anyNumber: true };
  }
  if (/^all cards revealed this way$/i.test(raw)) {
    return { cardType: 'any' };
  }
  if (/^all cards of the chosen type revealed this way$/i.test(raw)) {
    return { cardType: 'creature', anyNumber: true, usesChosenCreatureType: true };
  }
  if (/^all creature cards of the chosen type revealed this way$/i.test(raw)) {
    return { cardType: 'creature', anyNumber: true, usesChosenCreatureType: true };
  }
  const match = raw.match(/^all\s+(.+?)\s+cards?\s+revealed this way$/i);
  if (!match) return null;
  return parseRevealedThisWayTypeText(String(match[1] || '').trim());
}

export function parseMoveZoneSingleCardRevealedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+revealed this way$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed =
    parseAmongThemTypeConstraints(typeText) ||
    (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
  if (!parsed) return null;
  return parsed;
}

export function parseMoveZoneContextualThemSplit(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): ContextualThemSplitSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'any number of them') {
    return { kind: 'any_number_hand_graveyard_rest' };
  }
  const upToThemLibraryTopRestMatch = raw.match(
    /^up to ([a-z0-9]+) of them(?: .*)? and the rest$/
  );
  if (upToThemLibraryTopRestMatch) {
    const count = parseSmallNumberWord(String(upToThemLibraryTopRestMatch[1] || '').trim());
    if (count && count > 0) return { kind: 'count_library_top_graveyard_rest', count };
  }
  const countThemMatch = raw.match(/^([a-z0-9]+) of them$/);
  if (countThemMatch) {
    const count = parseSmallNumberWord(String(countThemMatch[1] || '').trim());
    if (count && count > 0) return { kind: 'count_hand_graveyard_rest', count };
  }
  const countThoseMatch = raw.match(/^([a-z0-9]+) of those cards$/);
  if (countThoseMatch) {
    const count = parseSmallNumberWord(String(countThoseMatch[1] || '').trim());
    if (count && count > 0) return { kind: 'count_those_cards', count };
  }
  return null;
}

export function parseMoveZoneAnyNumberThosePermanentCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of those permanent cards';
}

export function parseMoveZoneThoseCreatureCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'those creature cards';
}

export function parseMoveZoneCompoundCountThemBfHandSplit(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  step?: { readonly to?: string; readonly toRaw?: string; readonly raw?: string }
): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw' || !step) return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^([a-z0-9]+) of them onto the battlefield(?: tapped)? under your control and the rest$/i
  );
  if (!match || step.to !== 'hand') return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;
  return {
    cardType: 'any',
    maxCount,
    bfHandSplit: true,
    entersTappedFromWhat: /\btapped\b/i.test(raw) || /\btapped\b/i.test(String(step.toRaw || '')),
  };
}

export function parseMoveZoneAnyNumberBasicLandSubtypeYouControlToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly subtype: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of (plains|islands?|swamps?|mountains?|forests?|wastes?) you control$/);
  if (!match) return null;
  const subtype = String(match[1] || '').trim().toLowerCase().replace(/s$/, '');
  if (!subtype) return null;
  return { subtype };
}

export function parseMoveZoneAnyNumberMountainsYouControlToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  return Boolean(parseMoveZoneAnyNumberBasicLandSubtypeYouControlToHand(what)?.subtype === 'mountain');
}

export function parseMoveZoneThemAntecedent(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'them';
}

export function parseMoveZoneReturnContextualThemToBattlefield(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === "then return them to the battlefield under their owners' control" ||
    raw === "return them to the battlefield under their owners' control" ||
    raw === "then return it to the battlefield under its owner's control" ||
    raw === "return it to the battlefield under its owner's control"
  );
}

export function parseMoveZoneUpToTargetCreaturesExcludingTypeLineTerm(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly excludeTypeLineTerm: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^up to ([a-z0-9]+) target non([a-z-]+) creatures$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  const excludeTypeLineTerm = String(match[2] || '').trim().toLowerCase();
  if (!count || count < 1 || !excludeTypeLineTerm) return null;
  return { count, excludeTypeLineTerm };
}

