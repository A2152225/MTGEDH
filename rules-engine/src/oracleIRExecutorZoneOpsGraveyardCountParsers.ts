/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: contiguous parseMoveZone* count/all-from-graveyard parsers starting at
 * parseMoveZoneAllFromYourGraveyard, plus stripMoveZoneSelectorPrefix.
 * Public entry symbols: parseMoveZoneAllFromYourGraveyard,
 * parseMoveZoneAllFromTargetPlayersGraveyard, parseMoveZoneCountFromYourGraveyard,
 * parseMoveZoneCountFromTargetPlayersGraveyard.
 *
 * Also exports normalizeBoundPlayerZoneSelectorText (closed over by this cluster;
 * the parent still uses it in later parsers) and stripMoveZoneSelectorPrefix.
 */
import {
  parseCreatureSubtypeWord,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import {
  parseMoveZoneSingleTargetCriteria,
  type MoveZoneSingleTargetCriteria,
} from './oracleIRExecutorZoneOpsSingleTargetCriteria';

/** Map shorthand owner zones ("an opponent's graveyard") to bound-target phrasing the parsers already understand. */
export function normalizeBoundPlayerZoneSelectorText(text: string): string {
  return String(text || '')
    .replace(/\bin an opponent's (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bin target opponent's (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bin a player's (graveyard|hand|exile)\b/gi, "from target player's $1")
    .replace(/\bin target player's (graveyard|hand|exile)\b/gi, "from target player's $1")
    .replace(/\bin their (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bfrom an opponent's (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bfrom a player's (graveyard|hand|exile)\b/gi, "from target player's $1")
    .replace(/\b(?:the )?defending player'?s (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bfrom their (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bof their library\b/gi, "of target opponent's library");
}

export function parseMoveZoneAllFromYourGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/[.\s]+$/g, '')
    .replace(/\s+until\s+this\b.*$/i, '')
    .trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  const eachFromGyMatch = cleaned.match(/^each\s+(.+)\s+from\s+your\s+graveyard$/i);
  if (eachFromGyMatch) {
    const descriptor = String(eachFromGyMatch[1] || '')
      .trim()
      .replace(/[.\s]+$/g, '');
    if (!descriptor) return null;
    if (/^cards?$/i.test(descriptor)) return { cardType: 'any' };
    const parsedCriteria =
      parseMoveZoneSingleTargetCriteria(descriptor) ||
      parseMoveZoneSingleTargetCriteria(descriptor.replace(/\s+cards?$/i, '')) ||
      parseMoveZoneSingleTargetCriteria(`${descriptor.replace(/\s+cards?$/i, '')} cards`);
    if (parsedCriteria) return parsedCriteria;
    const typeText = descriptor.replace(/\s+cards?$/i, '').trim();
    const creatureSubtype = parseCreatureSubtypeWord(typeText);
    if (creatureSubtype) {
      return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
    }
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!parsed) return null;
    return { cardType: parsed };
  }

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/^all\s+instant\s+and\s+sorcery\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'instant_or_sorcery' };
  }

  if (/^all artifact and enchantment cards from your graveyard$/i.test(lower)) {
    return { cardType: 'artifact_or_enchantment' };
  }

  if (/^all artifact, enchantment, and planeswalker cards from your graveyard$/i.test(lower)) {
    return { cardType: 'permanent', typeLineTermsAnyOf: ['artifact', 'enchantment', 'planeswalker'] };
  }

  if (/^all mount and vehicle cards from your graveyard$/i.test(lower)) {
    return { cardType: 'permanent', typeLineTermsAnyOf: ['mount', 'vehicle'] };
  }

  const allCreaturePlaneswalkerMvMatch = lower.match(
    /^all creature and planeswalker cards with mana value (x|\d+) or less from your graveyard$/
  );
  if (allCreaturePlaneswalkerMvMatch) {
    const token = String(allCreaturePlaneswalkerMvMatch[1] || '').trim().toLowerCase();
    return {
      cardType: 'creature_or_planeswalker',
      manaValueLte: token === 'x' ? -1 : Number.parseInt(token, 10),
    };
  }

  const withoutNumericOrLess = lower
    .replace(/\binstant\s+and\s+sorcery\b/g, 'instant or sorcery')
    .replace(/\bmana value (?:\d+|x) or less\b/g, '')
    .replace(/\bpower \d+ or less\b/g, '');
  if (/\b(and|or)\b/i.test(withoutNumericOrLess)) return null;

  const fromGyMatch = cleaned.match(/^all\s+(.+)\s+from\s+your\s+graveyard$/i);
  if (!fromGyMatch) return null;

  const descriptor = String(fromGyMatch[1] || '')
    .trim()
    .replace(/[.\s]+$/g, '');
  if (!descriptor) return null;
  if (/^cards?$/i.test(descriptor)) return { cardType: 'any' };

  const parsedCriteria =
    parseMoveZoneSingleTargetCriteria(descriptor) ||
    parseMoveZoneSingleTargetCriteria(descriptor.replace(/\s+cards?$/i, '')) ||
    parseMoveZoneSingleTargetCriteria(`${descriptor.replace(/\s+cards?$/i, '')} cards`);
  if (parsedCriteria) return parsedCriteria;

  const typeText = descriptor.replace(/\s+cards?$/i, '').trim();
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  }
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function stripMoveZoneSelectorPrefix(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[\u2022•]\s+/, '')
    .replace(/^[a-z0-9][a-z0-9\s'.,/&-]{0,40}\s+-\s+/i, '')
    .replace(/^repair\s+-\s+/i, '')
    .trim();
}

export function parseMoveZoneAllFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | {
      readonly cardType: SimpleCardType;
      readonly excludeBasicLands?: boolean;
      readonly requiresFlashback?: boolean;
      readonly faceDown?: boolean;
      readonly shuffleExiledPile?: boolean;
    }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/^all cards with flashback from (?:target|that) (?:player|opponent)'s graveyard$/i.test(lower)) {
    return { cardType: 'any', requiresFlashback: true };
  }
  const faceDownPileMatch = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard\s+in\s+a\s+face-down\s+pile(?:,\s*shuffle\s+that\s+pile)?$/i
  );
  if (faceDownPileMatch) {
    const parsed = parseSimpleCardTypeFromText(String(faceDownPileMatch[1] || '').trim());
    if (parsed) return { cardType: parsed, faceDown: true, shuffleExiledPile: true };
  }
  if (
    /^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard\s+other\s+than\s+basic\s+land\s+cards?$/i.test(
      lower
    )
  ) {
    return { cardType: 'any', excludeBasicLands: true };
  }
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCountFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly count: number; readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  let m = cleaned.match(/^([a-z0-9]+)\s+target\s+cards?\s+from\s+your\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  if (/^that many cards from your graveyard(?: instead)?$/i.test(lower)) {
    return { count: -1, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const count = parseSmallNumberWord(String(m[1] || ''));
  if (count === null || count <= 0) return null;

  const typeText = String(m[2] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { count, cardType: parsed };
}

export function parseMoveZoneCountFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly count: number; readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (lower.startsWith('all ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  let m = cleaned.match(/^([a-z0-9]+)\s+target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+target\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    const typeText = String(m[2] || '').trim();
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!parsed) return null;
    return { count, cardType: parsed };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const count = parseSmallNumberWord(String(m[1] || ''));
  if (count === null || count <= 0) return null;

  const typeText = String(m[2] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { count, cardType: parsed };
}

