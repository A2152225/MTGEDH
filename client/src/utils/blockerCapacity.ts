import type { BattlefieldPermanent } from '../../../shared/src';
import { getCombinedPermanentText } from './permanentText';

const BLOCKER_CAPACITY_WORDS: Record<string, number> = {
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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function parseBlockerCapacityValue(token?: string): number {
  if (!token) return 1;

  const normalized = token.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return Math.max(0, parseInt(normalized, 10));
  }

  if (BLOCKER_CAPACITY_WORDS[normalized] !== undefined) {
    return BLOCKER_CAPACITY_WORDS[normalized];
  }

  const parts = normalized.split(/[-\s]+/).filter(Boolean);
  if (parts.length > 1) {
    let total = 0;
    for (const part of parts) {
      const value = BLOCKER_CAPACITY_WORDS[part];
      if (value === undefined) {
        return 1;
      }
      total += value;
    }
    if (total > 0) {
      return total;
    }
  }

  return 1;
}

export function getBlockerCapacity(permanent: BattlefieldPermanent): number {
  const combinedText = getCombinedPermanentText(permanent);

  if (!combinedText) {
    return 1;
  }

  if (/can block any number of creatures(?: this turn)?/.test(combinedText)) {
    return Number.POSITIVE_INFINITY;
  }

  let additionalCreatures = 0;
  const additionalCreaturePattern = /can block an additional(?: ((?:\d+|[a-z]+(?:[ -][a-z]+)*)))? creature(?:s)? (?:each combat|this turn)/g;

  for (const match of combinedText.matchAll(additionalCreaturePattern)) {
    additionalCreatures += parseBlockerCapacityValue(match[1] || '1');
  }

  return 1 + additionalCreatures;
}