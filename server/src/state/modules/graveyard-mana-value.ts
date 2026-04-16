type ManaValueConstraint = {
  targetFilterExactManaValue?: number;
  targetFilterMinManaValue?: number;
  targetFilterMaxManaValue?: number;
};

export type DynamicManaValueContext = {
  gameState?: any;
  controllerId?: string;
  sourceName?: string;
  sourcePermanent?: any;
};

function normalizeText(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getSourcePower(sourcePermanent: any): number | undefined {
  return parseNumber(
    sourcePermanent?.effectivePower
      ?? sourcePermanent?.basePower
      ?? sourcePermanent?.power
      ?? sourcePermanent?.card?.power,
  );
}

function resolveDynamicManaValueReference(referenceText: string, context?: DynamicManaValueContext): number | undefined {
  const normalizedReference = normalizeText(referenceText);
  if (!normalizedReference) {
    return undefined;
  }

  const sourcePower = getSourcePower(context?.sourcePermanent);
  const normalizedSourceName = normalizeText(context?.sourceName);
  if (
    normalizedReference === "this creature's power"
    || normalizedReference === "this permanent's power"
    || normalizedReference === "this card's power"
    || normalizedReference === 'its power'
    || (normalizedSourceName && normalizedReference === `${normalizedSourceName}'s power`)
  ) {
    return sourcePower;
  }

  const controllerId = String(context?.controllerId || context?.sourcePermanent?.controller || '').trim();
  const gameState = context?.gameState;

  if (normalizedReference.includes('life you gained this turn')) {
    return controllerId ? parseNumber(gameState?.lifeGainedThisTurn?.[controllerId]) ?? 0 : undefined;
  }

  if (normalizedReference.includes('life you lost this turn')) {
    return controllerId ? parseNumber(gameState?.lifeLostThisTurn?.[controllerId]) ?? 0 : undefined;
  }

  if (
    normalizedReference.includes('experience counters you have')
    || normalizedReference.includes('number of experience counters you have')
    || normalizedReference === 'your experience counters'
  ) {
    return controllerId ? parseNumber(gameState?.experienceCounters?.[controllerId]) ?? 0 : undefined;
  }

  return undefined;
}

export function inferManaValueConstraintFromText(effectText: string, context?: DynamicManaValueContext): ManaValueConstraint {
  const lower = normalizeText(effectText);
  if (!lower.includes('mana value')) {
    return {};
  }

  const minManaValueMatch = lower.match(/mana value (\d+) or (?:greater|more)/);
  if (minManaValueMatch) {
    const parsedMinManaValue = parseNumber(minManaValueMatch[1]);
    return Number.isFinite(parsedMinManaValue)
      ? { targetFilterMinManaValue: parsedMinManaValue }
      : {};
  }

  const maxManaValueMatch = lower.match(/mana value (\d+) or (?:less|fewer)/);
  if (maxManaValueMatch) {
    const parsedMaxManaValue = parseNumber(maxManaValueMatch[1]);
    return Number.isFinite(parsedMaxManaValue)
      ? { targetFilterMaxManaValue: parsedMaxManaValue }
      : {};
  }

  const exactManaValueMatch = lower.match(/mana value (\d+)(?!\s+or\s+(?:less|fewer|greater|more))/);
  if (exactManaValueMatch) {
    const parsedExactManaValue = parseNumber(exactManaValueMatch[1]);
    return Number.isFinite(parsedExactManaValue)
      ? { targetFilterExactManaValue: parsedExactManaValue }
      : {};
  }

  const maxDynamicMatch = lower.match(/mana value less than or equal to (.+?)(?=\s+(?:from|in)\b|[.,;]|$)/);
  if (maxDynamicMatch) {
    const resolvedValue = resolveDynamicManaValueReference(String(maxDynamicMatch[1] || ''), context);
    return Number.isFinite(resolvedValue)
      ? { targetFilterMaxManaValue: Number(resolvedValue) }
      : {};
  }

  const minDynamicMatch = lower.match(/mana value greater than or equal to (.+?)(?=\s+(?:from|in)\b|[.,;]|$)/);
  if (minDynamicMatch) {
    const resolvedValue = resolveDynamicManaValueReference(String(minDynamicMatch[1] || ''), context);
    return Number.isFinite(resolvedValue)
      ? { targetFilterMinManaValue: Number(resolvedValue) }
      : {};
  }

  const exactDynamicMatch = lower.match(/mana value equal to (.+?)(?=\s+(?:from|in)\b|[.,;]|$)/);
  if (exactDynamicMatch) {
    const resolvedValue = resolveDynamicManaValueReference(String(exactDynamicMatch[1] || ''), context);
    return Number.isFinite(resolvedValue)
      ? { targetFilterExactManaValue: Number(resolvedValue) }
      : {};
  }

  return {};
}