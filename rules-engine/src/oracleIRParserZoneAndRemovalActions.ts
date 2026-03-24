import type { OracleEffectStep, OraclePlayerSelector, OracleZone } from './oracleIR';
import {
  inferZoneFromDestination,
  normalizeCounterName,
  splitSacrificeObjectAndCondition,
} from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function parseBattlefieldController(to: OracleZone, toRaw: string): OraclePlayerSelector | undefined {
  if (to !== 'battlefield') return undefined;

  const normalized = normalizeOracleText(toRaw).toLowerCase();
  if (/\bunder\s+your\s+control\b/i.test(normalized)) {
    return { kind: 'you' };
  }

  if (
    /\bunder\s+its\s+owner'?s\s+control\b/i.test(normalized) ||
    /\bunder\s+their\s+owners'?[\s]+\s*control\b/i.test(normalized)
  ) {
    return { kind: 'owner_of_moved_cards' };
  }

  return undefined;
}

function parseMoveZoneBattlefieldCounters(to: OracleZone, toRaw: string): Record<string, number> | undefined {
  if (to !== 'battlefield') return undefined;

  const normalized = normalizeOracleText(toRaw).trim();
  if (!/\bwith\b/i.test(normalized) || !/\bcounters?\b/i.test(normalized)) return undefined;

  const match = normalized.match(/\bwith\s+(a|an|\d+|x|[a-z]+)\s+([^,.]+?)\s+counters?\s+on\s+it\b/i);
  if (!match) return undefined;
  if (/\bof your choice\b/i.test(match[0])) return undefined;

  const qty = parseQuantity(String(match[1] || '').trim());
  if (qty.kind !== 'number') return undefined;

  const amount = Math.max(0, qty.value | 0);
  if (amount <= 0) return undefined;

  const counterName = normalizeCounterName(String(match[2] || ''));
  if (!counterName) return undefined;

  return { [counterName]: amount };
}

function parseMoveZoneStep(args: {
  whatRaw: string;
  toRaw: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep {
  const { whatRaw, toRaw, rawClause, withMeta } = args;
  const what = parseObjectSelector(whatRaw);
  const to = inferZoneFromDestination(toRaw);
  const battlefieldController = parseBattlefieldController(to, toRaw);
  const entersTapped = to === 'battlefield' && !/\buntapped\b/i.test(toRaw) && /\btapped\b/i.test(toRaw) ? true : undefined;
  const withCounters = parseMoveZoneBattlefieldCounters(to, toRaw);
  return withMeta({ kind: 'move_zone', what, to, toRaw, battlefieldController, entersTapped, withCounters, raw: rawClause });
}

export function tryParseZoneAndRemovalClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  const destroyMatch = clause.match(/^destroy\s+(.+)$/i);
  if (destroyMatch) {
    return withMeta({ kind: 'destroy', target: parseObjectSelector(destroyMatch[1]), raw: rawClause });
  }

  const exileFromMatch = clause.match(/^exile\s+(.+?)\s+from\s+(.+)$/i);
  if (exileFromMatch) {
    const whatRaw = `${String(exileFromMatch[1] || '').trim()} from ${String(exileFromMatch[2] || '').trim()}`.trim();
    return withMeta({ kind: 'move_zone', what: parseObjectSelector(whatRaw), to: 'exile', toRaw: 'exile', raw: rawClause });
  }

  const exileMatch = clause.match(/^exile\s+(.+)$/i);
  if (exileMatch) {
    return withMeta({ kind: 'exile', target: parseObjectSelector(exileMatch[1]), raw: rawClause });
  }

  const sacrificeMatch = clause.match(
    /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢]s (?:controller|owner))\s+)?sacrifices?\s+(.+)$/i
  );
  if (sacrificeMatch) {
    const parsedObject = splitSacrificeObjectAndCondition(String(sacrificeMatch[2] || '').trim());
    return withMeta({
      kind: 'sacrifice',
      who: parsePlayerSelector(sacrificeMatch[1]),
      what: parseObjectSelector(parsedObject.objectText),
      ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
      raw: rawClause,
    });
  }

  const sacrificeDefaultMatch = clause.match(/^sacrifice\s+(.+)$/i);
  if (sacrificeDefaultMatch) {
    const parsedObject = splitSacrificeObjectAndCondition(String(sacrificeDefaultMatch[1] || '').trim());
    return withMeta({
      kind: 'sacrifice',
      who: { kind: 'you' },
      what: parseObjectSelector(parsedObject.objectText),
      ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
      raw: rawClause,
    });
  }

  const returnMatch = clause.match(/^return\s+(.+)\s+to\s+(.+)$/i);
  if (returnMatch) {
    return parseMoveZoneStep({
      whatRaw: String(returnMatch[1] || '').trim(),
      toRaw: String(returnMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const putIntoMatch = clause.match(/^put\s+(.+?)\s+into\s+(.+)$/i);
  if (putIntoMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putIntoMatch[1] || '').trim(),
      toRaw: String(putIntoMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const putOnLibraryMatch = clause.match(/^put\s+(.+?)\s+on\s+(.+?library)$/i);
  if (putOnLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putOnLibraryMatch[1] || '').trim(),
      toRaw: String(putOnLibraryMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const putOntoMatch = clause.match(/^put\s+(.+?)\s+onto\s+(.+)$/i);
  if (putOntoMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putOntoMatch[1] || '').trim(),
      toRaw: String(putOntoMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  return null;
}
