/**
 * Life-pair, destroy and library-search unknown-step recovery for the oracle IR
 * postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 586-980 of the
 * pre-split file).
 * Cluster moved: the `unknown` step re-parsers that recover paired life loss/gain, the
 * destroy clause fallbacks and reminder-fragment guard, library search criteria
 * normalization, for-each gain-life scalers, and enters-as-a-copy steps.
 * Public entry symbols: re-exported at the foot of this file; the postprocess parent
 * imports them back and remains the only caller.
 */
import type { OracleEffectStep } from './oracleIR';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

function parseForEachLifePairUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const match = raw.match(/^for\s+each\s+(.+?),\s+(.+?)\s+loses?\s+(that much|that many|\d+|x|[a-z]+)\s+life\s+and\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life$/i);
  if (!match) return null;
  const context = String(match[1] || '').trim();
  return [
    {
      kind: 'lose_life',
      who: parsePlayerSelector(String(match[2] || '').trim()),
      amount: parseQuantity(`${String(match[3] || '').trim()} for each ${context}`),
      raw: `${String(match[2] || '').trim()} loses ${String(match[3] || '').trim()} life for each ${context}`,
    },
    {
      kind: 'gain_life',
      who: parsePlayerSelector(String(match[4] || '').trim()),
      amount: parseQuantity(`${String(match[5] || '').trim()} for each ${context}`),
      raw: `${String(match[4] || '').trim()} ${/^you$/i.test(String(match[4] || '').trim()) ? 'gain' : 'gains'} ${String(match[5] || '').trim()} life for each ${context}`,
    },
  ];
}

function parseLifePairUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^�\s*/, '')
    .replace(/^then\s+/i, '')
    .trim();
  const reversedMatch = raw.match(/^(that much|that many|\d+|x|[a-z]+)\s+life\s+and\s+you\s+gain\s+(that much|that many|\d+|x|[a-z]+)\.?$/i);
  if (reversedMatch) {
    const amount = parseQuantity(String(reversedMatch[1] || '').trim());
    return [
      {
        kind: 'lose_life',
        who: { kind: 'each_opponent' },
        amount,
        raw: `each opponent loses ${String(reversedMatch[1] || '').trim()} life`,
        ...(step.sequence ? { sequence: step.sequence } : {}),
      },
      {
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: parseQuantity(String(reversedMatch[2] || '').trim()),
        raw: `you gain ${String(reversedMatch[2] || '').trim()} life`,
        ...(step.sequence ? { sequence: step.sequence } : {}),
      },
    ];
  }
  const match = raw.match(/^(.+?)\s+loses?\s+(that much|that many|\d+|x|[a-z]+)\s+life\s+and\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life(?:,\s+where\s+.+)?$/i);
  if (!match) return null;
  return [
    {
      kind: 'lose_life',
      who: parsePlayerSelector(String(match[1] || '').trim()),
      amount: parseQuantity(String(match[2] || '').trim()),
      raw: `${String(match[1] || '').trim()} loses ${String(match[2] || '').trim()} life`,
      ...(step.sequence ? { sequence: step.sequence } : {}),
    },
    {
      kind: 'gain_life',
      who: parsePlayerSelector(String(match[3] || '').trim()),
      amount: parseQuantity(String(match[4] || '').trim()),
      raw: `${String(match[3] || '').trim()} ${/^you$/i.test(String(match[3] || '').trim()) ? 'gain' : 'gains'} ${String(match[4] || '').trim()} life`,
      ...(step.sequence ? { sequence: step.sequence } : {}),
    },
  ];
}

function parseUntilEndTriggeredLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^until\s+end\s+of\s+turn,\s+whenever\s+.+?,\s+(.+?)\s+loses?\s+(\d+|x|[a-z]+)\s+life\s+for\s+each\s+(.+)$/i);
  if (!match) return null;
  return {
    kind: 'lose_life',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    amount: parseQuantity(`${String(match[2] || '').trim()} for each ${String(match[3] || '').trim()}`),
    duration: 'end_of_turn',
    raw,
  } as unknown as OracleEffectStep;
}

function parseForAnyNumberOpponentsDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^for\s+any\s+number\s+of\s+opponents,\s+(destroy\s+.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed?.kind === 'destroy' ? parsed : null;
}

function parseDestroyClauseFallback(rawClause: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).replace(/[.)"�]+$/g, '').trim();
  if (!/^destroy\b/i.test(normalized)) return null;
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(normalized).clause,
    rawClause: normalized,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (parsed?.kind === 'destroy') return parsed;

  const targetMatch = normalized.match(/^destroy\s+(.+)$/i);
  if (!targetMatch) return null;
  return {
    kind: 'destroy',
    target: parseObjectSelector(String(targetMatch[1] || '').trim()),
    raw: normalized,
  };
}

function isDestroyReminderFragment(candidate: string): boolean {
  const normalized = normalizeOracleText(String(candidate || '')).toLowerCase();
  if (!normalized) return false;
  if (normalized === 'destroy them' || normalized === 'destroy it') return true;
  if (/don'?t destroy them/.test(normalized)) return true;
  if (/effects that say "destroy"/.test(normalized)) return true;
  if (/damage and effects that say "destroy"/.test(normalized)) return true;
  return false;
}

function parseWrappedDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const candidates: string[] = [];

  const parenthetical = raw.match(/\((destroy\s+[^)]+)\)/i);
  if (parenthetical) {
    const fragment = String(parenthetical[1] || '').trim();
    if (!isDestroyReminderFragment(fragment)) {
      candidates.push(fragment);
    }
  }

  const otherwise = raw.match(/^otherwise,?\s+(destroy\s+.+)$/i);
  if (otherwise) candidates.push(String(otherwise[1] || '').trim());

  const triggerBody = raw.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(?:you\s+may\s+)?(destroy\s+.+)$/i);
  if (triggerBody) candidates.push(String(triggerBody[1] || '').trim());

  const destroyOccurrence = raw.match(/\b(destroy\s+.+)$/i);
  if (destroyOccurrence) {
    const fragment = String(destroyOccurrence[1] || '').trim();
    if (!isDestroyReminderFragment(fragment)) {
      candidates.push(fragment);
    }
  }

  const forEach = raw.match(/^for\s+each\s+opponent,\s+(destroy\s+.+)$/i);
  if (forEach) candidates.push(String(forEach[1] || '').trim());

  const stickerPrefix = raw.match(/^(?:\{[^}]+\}\s*)+[-��]\s+(?:(?:when|whenever)\b.+?,\s+)?(?:you\s+may\s+)?(destroy\s+.+)$/i);
  if (stickerPrefix) candidates.push(String(stickerPrefix[1] || '').trim());

  const direct = raw.match(/^(destroy\s+.+)$/i);
  if (direct) candidates.push(String(direct[1] || '').trim());

  for (const candidate of candidates) {
    const beforeCounterTail = candidate.replace(/\s+and\s+put\b.+$/i, '').trim();
    const parsed = parseDestroyClauseFallback(beforeCounterTail);
    if (parsed) return parsed;
  }
  return null;
}

function parseSearchResultCount(raw: string): number | undefined {
  const normalized = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  switch (normalized) {
    case 'a':
    case 'an':
    case 'one':
      return 1;
    case 'two':
      return 2;
    case 'three':
      return 3;
    case 'four':
      return 4;
    case 'five':
      return 5;
    case 'six':
      return 6;
    case 'seven':
      return 7;
    case 'eight':
      return 8;
    case 'nine':
      return 9;
    case 'ten':
      return 10;
    case 'eleven':
      return 11;
    case 'twelve':
      return 12;
    default:
      return undefined;
  }
}

function normalizeLibrarySearchCriteria(rawCriteria: string): {
  text: string;
  maxResults?: number | 'any_number';
  whereX?: { kind: 'where'; raw: string };
} {
  let criteria = String(rawCriteria || '').trim();
  let maxResults: number | 'any_number' | undefined;
  let whereX: { kind: 'where'; raw: string } | undefined;

  const equalToMatch = criteria.match(/^(?:a\s+number\s+of|x)\s+(.+?)\s+(?:cards?\s+)?equal\s+to\s+(.+)$/i);
  if (equalToMatch) {
    criteria = String(equalToMatch[1] || '').trim();
    whereX = { kind: 'where', raw: String(equalToMatch[2] || '').trim() };
  }

  const upToMatch = criteria.match(/^up to\s+([a-z0-9]+)\s+(.+)$/i);
  if (upToMatch) {
    maxResults = parseSearchResultCount(String(upToMatch[1] || ''));
    criteria = String(upToMatch[2] || '').trim();
  }

  const anyNumberMatch = criteria.match(/^any number of\s+(.+)$/i);
  if (anyNumberMatch) {
    criteria = String(anyNumberMatch[1] || '').trim();
    maxResults = 'any_number';
  }

  const exactCountMatch = criteria.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(.+)$/i);
  if (exactCountMatch) {
    maxResults = parseSearchResultCount(String(exactCountMatch[1] || ''));
    criteria = String(exactCountMatch[2] || '').trim();
  }

  criteria = criteria
    .replace(/^(?:a|an)\s+/i, '')
    .replace(/\bcards?\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: criteria, maxResults, ...(whereX ? { whereX } : {}) };
}

function parseLibrarySearchUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^�\s*/, '')
    .replace(/[.)]+$/g, '')
    .trim();
  if (!raw || /\bcan't\b[\s\S]*\bsearch\b/i.test(raw)) return null;

  // Do not pull bare search_library out of ability-word / If � instead � lines �
  // those must stay intact for conditional expansion (Traverse the Ulvenwald).
  const withoutAbilityWord = raw.replace(/^[A-Z][A-Za-z' -]{1,40}\s*[-��]\s+/u, '').trim();
  if (/^if\b/i.test(withoutAbilityWord) || /\binstead\s+search\b/i.test(raw)) {
    return null;
  }

  const searchStart = raw.match(/\b((?:(?:you|each player|its controller|that player|that opponent)\s+(?:may\s+)?)?search(?:es)?\s+(?:your|their|that player's|that player�s|target player's|target player�s|that opponent's|that opponent�s|its controller's|its owner's)\s+library[\s\S]*)$/i);
  if (!searchStart) return null;
  const searchClause = String(searchStart[1] || '').trim();
  const searchMatch = searchClause.match(/^(?:(you|each player|its controller|that player|that opponent)\s+(?:may\s+)?)?search(?:es)?\s+(your|their|that player's|that player�s|target player's|target player�s|that opponent's|that opponent�s|its controller's|its owner's)\s+library(?:\s+(?:and\/or|and)\s+graveyard)?\s+for\s+([\s\S]+)$/i);
  if (!searchMatch) return null;

  const subject = String(searchMatch[1] || '').trim();
  const libraryOwner = String(searchMatch[2] || '').toLowerCase();
  const afterFor = String(searchMatch[3] || '').trim();
  const split = afterFor.match(/^([\s\S]+?)(?:,\s*([\s\S]+)|\s+and\s+((?:put|reveal|cast|exile)\b[\s\S]+))?$/i);
  if (!split) return null;

  const { text: criteriaText, maxResults, whereX: criteriaWhereX } = normalizeLibrarySearchCriteria(String(split[1] || '').trim());
  let tail = String(split[2] || split[3] || '').trim();
  let whereX: { kind: 'where'; raw: string } | undefined = criteriaWhereX;
  const whereMatch = tail.match(/^where\s+x\s+is\s+(.+?)(?:,\s*(.+))?$/i);
  if (whereMatch) {
    whereX = { kind: 'where', raw: String(whereMatch[1] || '').trim() };
    tail = String(whereMatch[2] || '').trim();
  }
  const combined = `${searchClause} ${tail}`.trim();
  const destination = /\bonto\s+the\s+battlefield\b/i.test(tail)
    ? 'battlefield'
    : /\binto\s+your\s+graveyard\b|\bgraveyard\b/i.test(tail)
      ? 'graveyard'
      : /\bexile\b/i.test(tail)
        ? 'exile'
        : /\bon\s+top\b/i.test(tail)
          ? 'top'
          : /\bon\s+the\s+bottom\b|\bbottom\b/i.test(tail)
            ? 'bottom'
            : 'hand';
  const who = subject
    ? parsePlayerSelector(subject)
    : /^its controller/.test(libraryOwner)
      ? { kind: 'controller_of_referenced_object' as const }
      : /^its owner/.test(libraryOwner)
        ? { kind: 'owner_of_referenced_object' as const }
        : libraryOwner === 'their'
      ? parsePlayerSelector('that player')
      : /^that player/.test(libraryOwner)
        ? parsePlayerSelector('that player')
        : /^target player/.test(libraryOwner)
          ? parsePlayerSelector('target player')
          : /^that opponent/.test(libraryOwner)
            ? parsePlayerSelector('that opponent')
      : { kind: 'you' as const };

  return {
    kind: 'search_library',
    who,
    criteria: { kind: 'raw', text: criteriaText },
    destination,
    revealFound: /\breveal\b/i.test(combined) || undefined,
    entersTapped: destination === 'battlefield' && /\btapped\b/i.test(tail) || undefined,
    shuffle: /\bshuffle\b/i.test(combined) || undefined,
    maxResults,
    ...(whereX ? { whereX } : {}),
    optional: /\bmay\s+search\b/i.test(searchClause) || undefined,
    raw: searchClause,
  };
}

function parsePrefixedDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const body = raw
    .replace(/^\+\s*(?:\{[^}]+\}\s*)+[-��]\s*/i, '')
    .replace(/^[A-Za-z][A-Za-z0-9 ',\-]+\s+-\s+(?:\{[^}]+\}\s+-\s+)?/i, '')
    .trim();
  if (body === raw || !/^destroy\b/i.test(body)) return null;
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(body).clause,
    rawClause: body,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed?.kind === 'destroy' ? parsed : null;
}

function parseTimedDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^at\s+end\s+of\s+combat,\s+(destroy\s+.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed?.kind === 'destroy' ? ({ ...parsed, timing: 'end_of_combat' } as unknown as OracleEffectStep) : null;
}

function parseForEachGainLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^for\s+each\s+(.+?),\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life$/i);
  if (!match) return null;
  return {
    kind: 'gain_life',
    who: parsePlayerSelector(String(match[2] || '').trim()),
    amount: parseQuantity(`${String(match[3] || '').trim()} for each ${String(match[1] || '').trim()}`),
    raw,
  } as unknown as OracleEffectStep;
}

function parseForEachManaGainLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^for\s+each\s+(.+?),\s+add\s+\{[^}]+\}\s+and\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life$/i);
  if (!match) return null;
  return {
    kind: 'gain_life',
    who: parsePlayerSelector(String(match[2] || '').trim()),
    amount: parseQuantity(`${String(match[3] || '').trim()} for each ${String(match[1] || '').trim()}`),
    raw,
  } as unknown as OracleEffectStep;
}

function parseEnterAsCopyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const enterAsCopy = raw.match(
    /^you\s+may\s+have\s+this\s+(creature|land|permanent)\s+enter(?:\s+tapped)?\s+as\s+a\s+copy\s+of\s+any\s+(creature|land|permanent)\s+on\s+the\s+battlefield$/i,
  );
  if (!enterAsCopy) return null;
  const selfKind = String(enterAsCopy[1] || 'creature').toLowerCase();
  const copyOf = String(enterAsCopy[2] || 'creature').toLowerCase();
  const tapped = /\benter\s+tapped\s+as\s+a\s+copy\b/i.test(raw);
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector(selfKind === 'land' ? 'this land' : 'this creature'),
    effectText: [
      tapped
        ? `may enter tapped as a copy of any ${copyOf} on the battlefield`
        : `may enter as a copy of any ${copyOf} on the battlefield`,
    ],
    duration: 'static',
    raw,
  } as unknown as OracleEffectStep;
}

export {
  isDestroyReminderFragment,
  parseEnterAsCopyUnknownStep,
  parseForAnyNumberOpponentsDestroyUnknownStep,
  parseForEachGainLifeUnknownStep,
  parseForEachLifePairUnknownStep,
  parseForEachManaGainLifeUnknownStep,
  parseLibrarySearchUnknownStep,
  parseLifePairUnknownStep,
  parsePrefixedDestroyUnknownStep,
  parseTimedDestroyUnknownStep,
  parseUntilEndTriggeredLifeUnknownStep,
  parseWrappedDestroyUnknownStep,
};
