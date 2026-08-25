/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: typed/count-from-hand and simple what-parsers from
 * parseMoveZoneTypedCardFromYourHand through MoveZoneUpToTargetCountSpec.
 * Public entry symbols: parseMoveZoneTypedCardFromYourHand, parseMoveZoneCountFromYourHand,
 * and sibling parsers in this range; type MoveZoneUpToTargetCountSpec.
 */
import {
  parseCreatureSubtypeWord,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';

export function parseMoveZoneTypedCardFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();

  const lesserPowerMatch = cleaned.match(
    /^(?:a|an)\s+creature\s+card\s+with\s+lesser\s+power\s+from\s+your\s+hand$/i
  );
  if (lesserPowerMatch) return { cardType: 'creature', powerLtReference: true };

  const equalOrLesserMvMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+equal\s+or\s+lesser\s+mana\s+value\s+from\s+your\s+hand$/i
  );
  if (equalOrLesserMvMatch) return { cardType: 'permanent', manaValueLteReferenceManaValue: true };

  const landsControlledMvMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+the\s+number\s+of\s+lands\s+you\s+control\s+from\s+your\s+hand$/i
  );
  if (landsControlledMvMatch) return { cardType: 'permanent', manaValueLteLandsControlled: true };

  const creaturePowerMvMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+that\s+creature's\s+power\s+from\s+your\s+hand$/i
  );
  if (creaturePowerMvMatch) return { cardType: 'permanent', manaValueLteReferencePower: true };

  const artifactDamageMvMatch = cleaned.match(
    /^(?:a|an)\s+artifact\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+that\s+damage\s+from\s+your\s+hand$/i
  );
  if (artifactDamageMvMatch) return { cardType: 'artifact', manaValueLteReferenceDamage: true };

  const broodcallerMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+that\s+damage\s+from\s+your\s+hand$/i
  );
  if (broodcallerMatch) {
    return { cardType: 'permanent', manaValueLteReferenceDamage: true };
  }

  const timeCountersMatch = cleaned.match(
    /^(?:a|an)\s+(?:(nonland)\s+)?card\s+from\s+your\s+hand\s+with\s+a\s+number\s+of\s+time\s+counters\s+on\s+it\s+equal\s+to\s+its\s+mana\s+value$/i
  );
  if (timeCountersMatch) {
    return {
      cardType: timeCountersMatch[1] ? 'nonland' : 'any',
      timeCountersEqualManaValue: true,
    };
  }

  const colorlessGteMatch = cleaned.match(
    /^(?:a|an)\s+colorless\s+card\s+with\s+mana\s+value\s+(\d+)\s+or\s+greater\s+from\s+your\s+hand$/i
  );
  if (colorlessGteMatch) {
    const mv = Number.parseInt(String(colorlessGteMatch[1] || ''), 10);
    if (Number.isFinite(mv)) return { cardType: 'any', isColorless: true, manaValueGte: mv };
  }

  const nonartifactNonlandMatch = cleaned.match(/^(?:a|an)\s+nonartifact,?\s+nonland\s+card\s+from\s+your\s+hand$/i);
  if (nonartifactNonlandMatch) return { cardType: 'any', typeLineTermsNoneOf: ['artifact', 'land'] };

  const chargeCounterMvMatch = cleaned.match(
    /^(?:a|an)\s+creature\s+card\s+with\s+mana\s+value\s+equal\s+to\s+the\s+number\s+of\s+charge\s+counters\s+on\s+this\s+artifact\s+from\s+your\s+hand$/i
  );
  if (chargeCounterMvMatch) return { cardType: 'creature', manaValueEqReferenceChargeCounters: true };

  const constrainedMatch = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?\s+from\s+your\s+hand$/i
  );
  if (constrainedMatch) {
    const typeText = String(constrainedMatch[1] || '').trim();
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!parsed) return null;
    const mvToken = String(constrainedMatch[2] || '').trim().toLowerCase();
    if (mvToken === 'x') {
      return { cardType: parsed, manaValueLte: -1 };
    }
    const mv = Number.parseInt(mvToken, 10);
    if (!Number.isFinite(mv)) return null;
    return { cardType: parsed, manaValueLte: mv };
  }

  const chosenTypeHandMatch = cleaned.match(
    /^(?:a|an)\s+creature\s+card\s+of\s+the\s+chosen\s+type\s+from\s+your\s+hand$/i
  );
  if (chosenTypeHandMatch) {
    return { cardType: 'creature', usesChosenCreatureType: true };
  }

  const match = cleaned.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+your\s+hand$/i);
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  }
  const parsedCriteria = parseMoveZoneSingleTargetCriteria(typeText);
  if (parsedCriteria) return parsedCriteria;
  const parsedCardType = parseSimpleCardTypeFromText(typeText);
  return parsedCardType ? { cardType: parsedCardType } : null;
}

export function parseMoveZoneTheCardsFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType; readonly possessive: 'your' | 'their' } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'the cards from your hand' || raw === 'the cards in your hand') {
    return { cardType: 'any', possessive: 'your' };
  }
  if (
    raw === 'the cards from their hand' ||
    raw === 'the cards in their hand' ||
    raw === "the cards from that player's hand" ||
    raw === "the cards in that player's hand" ||
    raw === "the cards from that players hand" ||
    raw === "the cards in that players hand"
  ) {
    return { cardType: 'any', possessive: 'their' };
  }
  return null;
}

export function parseMoveZoneTheCardsFromTargetOpponentHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === "the cards from target opponent's hand" || raw === "the cards from that opponent's hand") {
    return { cardType: 'any' };
  }
  return null;
}

export function parseMoveZoneCardFromAGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'a card from a graveyard') return { cardType: 'any' };
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+a\s+graveyard$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'target creature card from a graveyard and target creature on the battlefield';
}

export function parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'this artifact and all cards from all graveyards' ||
    raw === 'this permanent and all cards from all graveyards'
  );
}

export function parseMoveZoneCountFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly topOrBottomBoth?: boolean } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');
  if (lower.startsWith('all ') || lower.startsWith('up to ') || lower.startsWith('target ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;

  const match = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+your\s+hand(?:\s+both)?$/i);
  if (!match) return null;

  const count = parseSmallNumberWord(String(match[1] || ''));
  if (count === null || count <= 0) return null;
  return { count, ...(/\bboth\b/i.test(lower) ? { topOrBottomBoth: true } : {}) };
}

export type MoveZoneUpToTargetCountSpec = {
  readonly maxCount: number;
  readonly criteria: MoveZoneSingleTargetCriteria;
  readonly useReferenceAmount?: boolean;
  readonly useXValue?: boolean;
};
