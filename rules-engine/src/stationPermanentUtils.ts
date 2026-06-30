export function isStationPermanentTypeLine(typeLine: string): boolean {
  const normalized = String(typeLine || '').toLowerCase();
  return normalized.includes('spacecraft') || normalized.includes('planet');
}

const STATION_STATIC_KEYWORD_NAMES = [
  'flying',
  'vigilance',
  'trample',
  'haste',
  'deathtouch',
  'lifelink',
  'menace',
  'reach',
  'hexproof',
  'indestructible',
  'defender',
  'shroud',
] as const;

function normalizeStationThresholdEffectText(effect: string): string {
  return String(effect || '')
    .trim()
    .replace(/[.)]+$/g, '')
    .replace(/\s+/g, ' ');
}

function isStationStaticKeywordOnlyEffect(normalized: string): boolean {
  if (/^ward\s+\d+$/i.test(normalized)) {
    return true;
  }

  const keywordPattern = new RegExp(
    `^(?:${STATION_STATIC_KEYWORD_NAMES.join('|')})(?:,\\s*(?:${STATION_STATIC_KEYWORD_NAMES.join('|')}|ward\\s+\\d+))*$`,
    'i',
  );
  return keywordPattern.test(normalized);
}

/**
 * Station threshold lines like `8+ | Flying` or `3+ | This becomes an artifact creature`
 * are continuous static grants, not activated abilities. Only include threshold text
 * that represents a player action (inner activation costs, once-per-turn casts, etc.).
 */
export function isActivatableStationThresholdEffect(effect: string): boolean {
  const normalized = normalizeStationThresholdEffectText(effect);
  if (!normalized) {
    return false;
  }

  if (/^once during each of your turns\b/i.test(normalized)) {
    return true;
  }

  if (/\byou may cast\b/i.test(normalized) && /\bfrom your graveyard\b/i.test(normalized)) {
    return true;
  }

  if (/\byou may activate\b/i.test(normalized)) {
    return true;
  }

  if (isStationStaticKeywordOnlyEffect(normalized)) {
    return false;
  }

  if (
    /\bcreatures you control (?:have|gain)\b/i.test(normalized)
    && !/\buntil end of turn\b/i.test(normalized)
  ) {
    return false;
  }

  if (
    /\ball creatures\b/i.test(normalized)
    && /\b(?:have|gain)\b/i.test(normalized)
    && !/\buntil end of turn\b/i.test(normalized)
  ) {
    return false;
  }

  if (/^you may play an additional land on each of your turns$/i.test(normalized)) {
    return false;
  }

  if (/^this becomes an (?:artifact )?creature$/i.test(normalized)) {
    return false;
  }

  return false;
}

export function isOnceDuringEachOfYourTurnActivatedEffect(effect: string): boolean {
  const withoutThresholdPrefix = String(effect || '')
    .trim()
    .replace(/^\d+\+\s*\|\s*/i, '');
  const normalized = normalizeStationThresholdEffectText(withoutThresholdPrefix);
  return /^once during each of your turns\b/i.test(normalized);
}

export function hasUsedOnceDuringEachActivatedAbilityThisTurn(
  permanent: { activatedAbilityIndicesThisTurn?: Record<number, true> } | null | undefined,
  abilityIndex: number,
): boolean {
  return Boolean(permanent?.activatedAbilityIndicesThisTurn?.[abilityIndex]);
}

export function markOnceDuringEachActivatedAbilityUsedThisTurn(
  permanent: { activatedAbilityIndicesThisTurn?: Record<number, true> },
  abilityIndex: number,
): void {
  if (!permanent.activatedAbilityIndicesThisTurn) {
    permanent.activatedAbilityIndicesThisTurn = {};
  }
  permanent.activatedAbilityIndicesThisTurn[abilityIndex] = true;
}

export function clearActivatedAbilityUsageThisTurn(
  permanent: { activatedAbilityIndicesThisTurn?: Record<number, true> },
): void {
  if (permanent.activatedAbilityIndicesThisTurn) {
    delete permanent.activatedAbilityIndicesThisTurn;
  }
}

export function hasOncePerTurnActivatedAbilityPendingOnStack(
  stack: Array<{ source?: string; oncePerTurnActivated?: boolean; activatedAbilityIndex?: number }> | null | undefined,
  permanentId: string,
  abilityIndex: number,
): boolean {
  return (stack || []).some((item) => {
    if (String(item?.source || '') !== String(permanentId)) {
      return false;
    }
    if (!item?.oncePerTurnActivated) {
      return false;
    }
    if (!Number.isFinite(Number(item?.activatedAbilityIndex))) {
      return true;
    }
    return Number(item?.activatedAbilityIndex) === abilityIndex;
  });
}

export function hasExhaustedOnceDuringEachGraveyardCastActivation(
  permanent: { activatedAbilityIndicesThisTurn?: Record<number, true> } | null | undefined,
  state: { castFromGraveyardThisTurn?: Record<string, boolean> } | null | undefined,
  playerId: string,
): boolean {
  if (Boolean(state?.castFromGraveyardThisTurn?.[String(playerId)])) {
    return true;
  }
  const used = permanent?.activatedAbilityIndicesThisTurn;
  return Boolean(used && Object.keys(used).length > 0);
}

export function isRecognizedActivatedAbilityCostText(cost: string): boolean {
  const costLower = String(cost || '').trim().toLowerCase();
  return (
    cost.includes('{') ||
    costLower.includes('tap') ||
    costLower.includes('sacrifice') ||
    costLower.includes('discard') ||
    (costLower.includes('remove') && costLower.includes('counter')) ||
    (costLower.includes('pay') && costLower.includes('life')) ||
    costLower.includes('exile') ||
    costLower.includes('return')
  );
}

/**
 * Charge-counter threshold at which a Station permanent becomes a creature,
 * or the primary station tier used for UI labels when no explicit reminder exists.
 */
export function readStationChargeCreatureThresholdFromOracleText(oracleText: string): number {
  const text = String(oracleText || '');

  const inlineMatch = text.match(/station\s*(\d+)/i);
  if (inlineMatch) {
    return parseInt(inlineMatch[1], 10);
  }

  const stationParenAtMatch = text.match(
    /\bStation\s*\([\s\S]*?\bat\s+(\d+)\+\.?[\s\S]*?\)/i,
  );
  if (stationParenAtMatch) {
    return parseInt(stationParenAtMatch[1], 10);
  }

  const creatureReminderMatch = text.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
  if (creatureReminderMatch) {
    return parseInt(creatureReminderMatch[1], 10);
  }

  const thresholdLineMatch = text.match(/station(?:\s*\([^)]*\))?\s*(?:\r?\n)+\s*(\d+)\+\s*\|/i);
  if (thresholdLineMatch) {
    return parseInt(thresholdLineMatch[1], 10);
  }

  return 0;
}

export function isStationPermanentCreatureNow(
  permanent: {
    readonly stationed?: boolean;
    readonly grantedTypes?: readonly string[];
    readonly counters?: Readonly<Record<string, number>>;
    readonly stationThreshold?: number;
    readonly card?: { readonly oracle_text?: string };
  },
  oracleText?: string,
): boolean {
  if (permanent?.stationed === true) return true;
  if (Array.isArray(permanent?.grantedTypes) && permanent.grantedTypes.includes('Creature')) {
    return true;
  }

  const chargeCounters = Number(permanent?.counters?.charge ?? permanent?.counters?.['charge'] ?? 0);
  const explicitThreshold = Number(permanent?.stationThreshold ?? 0);
  if (explicitThreshold > 0 && chargeCounters >= explicitThreshold) {
    return true;
  }

  const oracle = String(oracleText ?? permanent?.card?.oracle_text ?? '');
  const parsedThreshold = readStationChargeCreatureThresholdFromOracleText(oracle);
  return parsedThreshold > 0 && chargeCounters >= parsedThreshold;
}
