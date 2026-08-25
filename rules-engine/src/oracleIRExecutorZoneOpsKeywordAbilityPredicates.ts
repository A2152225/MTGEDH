/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: keyword-ability predicates used by single-target criteria matching.
 * Public entry symbols: cardHasCyclingAbility, cardHasKickerAbility, cardHasForetellAbility,
 * cardHasFlashbackAbility, cardHasAwakenAbility.
 */
import { getCardOracleText } from './oracleIRExecutorZoneOpsCardTypeMatchers';

export function cardHasCyclingAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'cycling')) {
      return true;
    }
  }
  return /\bcycling\b/i.test(getCardOracleText(card));
}

export function cardHasKickerAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'kicker')) {
      return true;
    }
  }
  return /\bkicker\b/i.test(getCardOracleText(card));
}

export function cardHasForetellAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'foretell')) {
      return true;
    }
  }
  return /\bforetell\b/i.test(getCardOracleText(card));
}

export function cardHasFlashbackAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'flashback')) {
      return true;
    }
  }
  return /\bflashback\b/i.test(getCardOracleText(card));
}

export function cardHasAwakenAbility(card: any): boolean {
  return /\bawaken\b/i.test(getCardOracleText(card));
}

export function cardHasMorphAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'morph')) {
      return true;
    }
  }
  return /\bmorph\b/i.test(getCardOracleText(card));
}
