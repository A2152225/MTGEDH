const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseCountToken(rawValue: string | undefined): number {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  if (/^\d+$/.test(normalized)) {
    return Math.max(0, parseInt(normalized, 10) || 0);
  }

  return NUMBER_WORDS[normalized] || 0;
}

export function getOpponentMayPayDrawCount(sourceName: string, effectText: string): number {
  const normalizedSourceName = String(sourceName || '').trim().toLowerCase();
  const normalizedEffectText = String(effectText || '').trim().toLowerCase();

  if (
    normalizedSourceName.includes('rhystic study') ||
    normalizedSourceName.includes('mystic remora') ||
    normalizedSourceName.includes('esper sentinel')
  ) {
    return 1;
  }

  if (/draws?\s+a\s+card/i.test(normalizedEffectText)) {
    return 1;
  }

  const drawCountMatch = normalizedEffectText.match(/draws?\s+(\d+)\s+cards?/i);
  if (drawCountMatch) {
    return Math.max(0, parseInt(drawCountMatch[1], 10) || 0);
  }

  return 0;
}

export function getOpponentMayPayTreasureCount(sourceName: string, effectText: string): number {
  const normalizedSourceName = String(sourceName || '').trim().toLowerCase();
  const normalizedEffectText = String(effectText || '').trim().toLowerCase();

  if (normalizedSourceName.includes('smothering tithe')) {
    return 1;
  }

  const treasureCountMatch = normalizedEffectText.match(
    /creates?\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?treasure(?:\s+token)?s?/i
  );
  if (!treasureCountMatch) {
    return 0;
  }

  const parsedCount = parseCountToken(treasureCountMatch[1]);
  return parsedCount > 0 ? parsedCount : 1;
}

export function buildOpponentMayPayRecordedOutcome(sourceName: string, effectText: string): {
  declineDrawCount?: number;
  declineTreasureCount?: number;
} {
  const declineDrawCount = getOpponentMayPayDrawCount(sourceName, effectText);
  const declineTreasureCount = getOpponentMayPayTreasureCount(sourceName, effectText);

  return {
    ...(declineDrawCount > 0 ? { declineDrawCount } : {}),
    ...(declineTreasureCount > 0 ? { declineTreasureCount } : {}),
  };
}