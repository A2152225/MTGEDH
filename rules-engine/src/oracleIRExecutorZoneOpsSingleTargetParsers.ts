/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: single-target / count-from-hand-or-graveyard parseMoveZone* parsers
 * from parseMoveZoneCountCardsFromTargetPlayersHand through
 * parseMoveZoneSingleTargetFromAGraveyard, plus random-from-graveyard selectors.
 * Public entry symbols: parseMoveZoneSingleTargetFromYourGraveyard,
 * parseMoveZoneRandomSingleFromYourGraveyard, and sibling parsers in this range.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { getCurrentTurnNumber } from './oracleIRExecutorPlayerUtils';
import {
  normalizeCardColor,
  parseCompoundCardTypeFromText,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import {
  normalizeBoundPlayerZoneSelectorText,
  stripMoveZoneSelectorPrefix,
} from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseTrailingZoneCounterRequirement,
  stripPutIntoGraveyardThisTurnQualifier,
  graveyardThisTurnCriteriaFromQualifier,
} from './oracleIRExecutorZoneOpsSingleTargetMatchers';

export function parseMoveZoneCountCardsFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const match = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count, cardType: 'any' };
}

export type MoveZoneAlternateCostColorCardFromHand = MoveZoneSingleTargetCriteria & {
  readonly count: number;
};

export function parseMoveZoneAlternateCostColorCardFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneAlternateCostColorCardFromHand | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ');
  const countedMatch = raw.match(
    /^(\w+) (white|blue|black|red|green) cards? from your hand(?: rather than pay this spell(?:'s)? mana cost)?$/
  );
  if (countedMatch) {
    const count = parseSmallNumberWord(String(countedMatch[1] || '').trim());
    const color = normalizeCardColor(String(countedMatch[2] || '').trim());
    if (!count || count < 1 || !color) return null;
    return { colorsAllOf: [color], cardType: 'any', count };
  }
  const mvMatch = raw.match(
    /^an? (white|blue|black|red|green) card with mana value x from your hand(?: rather than pay this spell(?:'s)? mana cost)?$/
  );
  if (mvMatch) {
    const color = normalizeCardColor(String(mvMatch[1] || '').trim());
    if (!color) return null;
    return { colorsAllOf: [color], cardType: 'any', count: 1, manaValueLte: -1 };
  }
  const match = raw.match(
    /^an? (white|blue|black|red|green) cards? from your hand(?: rather than pay this spell(?:'s)? mana cost)?$/
  );
  if (!match) return null;
  const color = normalizeCardColor(String(match[1] || '').trim());
  if (!color) return null;
  return { colorsAllOf: [color], cardType: 'any', count: 1 };
}

export function parseMoveZoneSingleTargetFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
  ].filter(Boolean);

  for (let raw of candidates) {
    raw = stripMoveZoneSelectorPrefix(raw);
    const embedded = raw.match(
      /(?:you\s+may\s+)?return\s+((?:up to one\s+)?(?:(?:other|another)\s+)?target\s+.+?\s+from\s+your\s+graveyard)(?:\s+to\s+.+)?$/i
    );
    if (embedded) {
      raw = String(embedded[1] || '').trim();
    }

    const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
    const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, 'from your graveyard');
    const cleaned = withCounter.selectorText
      .replace(/\s+with\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+time\s+counters?\s+on\s+it$/i, '')
      .trim();
    const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

    if (!/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+/i.test(lower)) continue;
    if (!/\bfrom your graveyard\b/i.test(lower)) continue;
    // "target X and all other cards with the same name as that card" is a compound selector owned by
    // parseMoveZoneTargetAndSameNamedFromYourGraveyard. Matching it here moves only the one target
    // and silently drops the same-named cards, because the type text still reads as a plain type.
    if (/\band all other cards with the same name\b/i.test(lower)) continue;

    if (/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
      return { cardType: 'any' };
    }

    const m = cleaned.match(/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+(.+?)\s+from\s+your\s+graveyard$/i);
    if (!m) continue;

    const typeText = String(m[1] || '')
      .trim()
      .replace(/,\s*where\s+x\s+is\b.*$/i, '');
    if (!typeText) continue;
    const parsed = parseMoveZoneSingleTargetCriteria(typeText);
    if (!parsed) continue;
    return {
      ...parsed,
      ...(withCounter.requiredCounter && withCounter.requiredCounter !== 'time'
        ? { requiredCounter: withCounter.requiredCounter }
        : {}),
      ...graveyardThisTurnCriteriaFromQualifier(withTurn),
    };
  }
  return null;
}

export function parseMoveZoneSingleTypedCardFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?)?\s+from\s+your\s+graveyard$/i
  );
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  const mvToken = String(match[2] || '').trim().toLowerCase();
  const constrainedText = mvToken
    ? `${typeText} with mana value ${mvToken}${/\bor\s+less\b/i.test(raw) ? ' or less' : ''}`
    : typeText;
  const parsed =
    parseMoveZoneSingleTargetCriteria(constrainedText) ||
    (parseCompoundCardTypeFromText(typeText) ? { cardType: parseCompoundCardTypeFromText(typeText)! } : null) ||
    (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
  return parsed;
}

export function parseMoveZoneRandomSingleFromYourGraveyard(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  rawStep?: string
):
  | MoveZoneSingleTargetCriteria
  | { readonly count: number; readonly criteria: MoveZoneSingleTargetCriteria; readonly useXValue?: boolean }
  | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(rawStep || '').trim(),
  ].filter(Boolean);
  for (let raw of candidates) {
    raw = stripMoveZoneSelectorPrefix(raw);
    const embedded = raw.match(
      /(?:you\s+may\s+)?return\s+((?:x|[a-z0-9]+)\s+cards?\s+at random from your graveyard)(?:\s+to\s+.+)?$/i
    );
    if (embedded) {
      raw = String(embedded[1] || '').trim();
    }
    const cleaned = raw.replace(/[.\s]+$/g, '').trim();
    const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

    if (!/\bat random\b/i.test(lower) && !/\bchosen at random\b/i.test(lower)) continue;
    if (!/\bfrom your graveyard\b/i.test(lower)) continue;

    if (/^x cards? at random from your graveyard$/i.test(lower)) {
      return { count: 0, criteria: { cardType: 'any' }, useXValue: true };
    }

    const chosenAtRandomMatch = cleaned.match(
      /^(?:exile\s+)?target\s+(.+?)\s+from your graveyard chosen at random$/i,
    );
    if (chosenAtRandomMatch) {
      const typeText = String(chosenAtRandomMatch[1] || '').trim();
      const parsed = parseMoveZoneSingleTargetCriteria(typeText);
      if (parsed) return parsed;
    }

    const countMatch = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+at random from your graveyard$/i);
    if (countMatch) {
      const count = parseSmallNumberWord(String(countMatch[1] || '').trim());
      const typeText = String(countMatch[2] || '').trim();
      const criteria = parseMoveZoneSingleTargetCriteria(typeText);
      if (count && count >= 1 && criteria) return { count, criteria };
      continue;
    }

    let match = cleaned.match(/^(?:exile\s+)?(?:a|an|one)\s+(.+?)\s+at random from your graveyard$/i);
    if (!match) {
      match = cleaned.match(/^(?:exile\s+)?(?:a|an|one)\s+(.+?)\s+card\s+from\s+your\s+graveyard\s+at\s+random$/i);
    }
    if (!match) {
      match = cleaned.match(/^(?:exile\s+)?(?:a|an|one)\s+(.+?)\s+from your graveyard at random$/i);
    }
    if (!match) continue;

    const typeText = String(match[1] || '').trim();
    if (!typeText) continue;
    const parsed = parseMoveZoneSingleTargetCriteria(typeText);
    if (parsed) return parsed;
  }
  return null;
}

export function parseMoveZoneTargetAndSameNamedFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const cleaned = stripMoveZoneSelectorPrefix(candidate).replace(/[.\s]+$/g, '').trim();
    const match =
      cleaned.match(
        /^(?:return\s+)?target\s+(.+?)\s+and\s+all\s+other\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+card\s+from\s+your\s+graveyard$/i
      ) ||
      cleaned.match(
        /^(?:you\s+may\s+)?return\s+target\s+(.+?)\s+and\s+all\s+other\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+card\s+from\s+your\s+graveyard(?:\s+to\s+.+)?$/i
      );
    if (!match) continue;

    const typeText = String(match[1] || '').trim();
    if (!typeText) continue;
    return parseMoveZoneSingleTargetCriteria(typeText);
  }
  return null;
}

export function selectRandomMatchingCardIdFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referenceCardName?: string,
  referencePower?: number
):
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'selected'; readonly cardId: string } {
  const selection = selectRandomMatchingCardIdsFromGraveyard(
    state,
    playerId,
    criteria,
    1,
    referenceCardName,
    referencePower
  );
  if (selection.kind !== 'selected') return selection;
  const cardId = selection.cardIds[0];
  return cardId ? { kind: 'selected', cardId } : { kind: 'impossible' };
}

export function selectRandomMatchingCardIdsFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  count: number,
  referenceCardName?: string,
  referencePower?: number
):
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'selected'; readonly cardIds: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const matches = graveyard.filter((card: any) =>
    cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)
  );
  if (matches.length < count) return { kind: 'impossible' };

  const pool = [...matches];
  const selectedIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const randomIndex = pool.length === 1 ? 0 : Math.floor(Math.random() * pool.length);
    const selected = pool.splice(randomIndex, 1)[0];
    const selectedId = String((selected as any)?.id || '').trim();
    if (!selectedId) return { kind: 'impossible' };
    selectedIds.push(selectedId);
  }
  return { kind: 'selected', cardIds: selectedIds };
}

export function parseMoveZoneSingleTargetFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, "from (?:target|that) (?:player|opponent)'s graveyard");
  const cleaned = withCounter.selectorText;
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+(.+?)\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return {
    ...parsed,
    ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
    ...graveyardThisTurnCriteriaFromQualifier(withTurn),
  };
}

function parseReferencedPossessiveZoneSuffixFromSelector(raw: string): {
  readonly role: 'controller' | 'owner';
  readonly zone: 'graveyard' | 'hand' | 'library' | 'exile';
} | null {
  const normalized = String(raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .replace(/\s+/g, ' ');
  const match = normalized.match(/\bfrom\s+its\s+(controller|owner)(?:'|')s\s+(graveyard|hand|library|exile)\b/i);
  if (!match) return null;
  const zone = String(match[2] || '').trim().toLowerCase();
  if (zone !== 'graveyard' && zone !== 'hand' && zone !== 'library' && zone !== 'exile') return null;
  return {
    role: String(match[1] || '').trim().toLowerCase() === 'owner' ? 'owner' : 'controller',
    zone: zone as 'graveyard' | 'hand' | 'library' | 'exile',
  };
}

export function parseMoveZoneSingleTargetFromReferencedPossessiveGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, "from its (?:controller|owner)'s graveyard");
  const cleaned = withCounter.selectorText;
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');
  const suffix = parseReferencedPossessiveZoneSuffixFromSelector(lower);
  if (!suffix || suffix.zone !== 'graveyard') return null;

  if (!/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+cards?\s+from\s+its\s+(?:controller|owner)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+(.+?)\s+from\s+its\s+(?:controller|owner)'s\s+graveyard$/i,
  );
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return {
    ...parsed,
    ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
    ...graveyardThisTurnCriteriaFromQualifier(withTurn),
  };
}

export function parseMoveZoneSingleTargetFromReferencedPossessiveHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');
  const suffix = parseReferencedPossessiveZoneSuffixFromSelector(lower);
  if (!suffix || suffix.zone !== 'hand') return null;

  if (!lower.startsWith('target ')) return null;

  if (/^target\s+cards?\s+from\s+its\s+(?:controller|owner)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+its\s+(?:controller|owner)'s\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneRandomCardFromReferencedPossessiveHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType; readonly random: true }
  | null {
  if (what.kind !== 'raw') return null;
  const lower = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!/^a card from its (?:controller|owner)'s hand(?: at random)?$/i.test(lower)) return null;
  const suffix = parseReferencedPossessiveZoneSuffixFromSelector(lower);
  if (!suffix || suffix.zone !== 'hand') return null;
  return { cardType: 'any', random: true };
}

export function parseMoveZoneSingleTargetFromAGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    stripMoveZoneSelectorPrefix(String((what as any).text || '')),
    stripMoveZoneSelectorPrefix(String((what as any).raw || '')),
  ].filter(Boolean);

  for (const raw of candidates) {
    const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
    const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, 'from a graveyard');
    const cleaned = withCounter.selectorText;
    const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

    if (!/^(?:up to one\s+)?(?:other\s+)?target\s+/i.test(lower)) continue;
    const opponentGraveyard = /\b(?:from|in) (?:an|target) opponent'?s graveyard\b/i.test(lower);
    if (!/\b(?:from|in) (?:a|(?:an|target) opponent'?s) graveyard\b/i.test(lower)) continue;

    if (/^(?:up to one\s+)?(?:other\s+)?target\s+cards?\s+(?:from|in) (?:a|(?:an|target) opponent'?s)\s+graveyard$/i.test(lower)) {
      return { cardType: 'any', ...(opponentGraveyard ? { graveyardOwner: 'opponent' as const } : {}) };
    }

    const m = cleaned.match(/^(?:up to one\s+)?(?:other\s+)?target\s+(.+?)\s+(?:from|in) (?:a|(?:an|target) opponent'?s)\s+graveyard$/i);
    if (!m) continue;

    const typeText = String(m[1] || '').trim();
    if (!typeText) continue;
    const parsed = parseMoveZoneSingleTargetCriteria(typeText);
    if (!parsed) continue;
    return {
      ...parsed,
      ...(opponentGraveyard ? { graveyardOwner: 'opponent' as const } : {}),
      ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
      ...graveyardThisTurnCriteriaFromQualifier(withTurn),
    };
  }
  return null;
}
