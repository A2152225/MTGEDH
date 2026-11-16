/**
 * Thran Portal-style static: mana abilities of this land cost an additional
 * N life to activate. Labels the payment UI and makes auto-pay account for
 * that life (prefer sources with no life cost; never spend more life than
 * the payer has).
 */
import type { Color, ManaPaymentSource, SuggestedPaymentSelection } from './manaUtils';
import { calculateSuggestedPayment } from './manaUtils';

export function parseAdditionalLifeToActivateManaAbilities(oracle: string): number | null {
  const match = String(oracle || '').replace(/\u2019/g, "'").match(
    /mana abilities of this (?:land|permanent) cost an additional (\d+) life to activate/i,
  );
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function additionalManaAbilityLifeCostFromCard(card: any): number {
  return parseAdditionalLifeToActivateManaAbilities(String(card?.oracle_text || card?.oracleText || '')) || 0;
}

export function withAdditionalManaAbilityLifeCost<T extends { lifeCost?: number }>(
  ability: T,
  extra: number,
): T {
  const add = Math.max(0, Math.floor(Number(extra) || 0));
  if (add <= 0) return ability;
  const current = Math.max(0, Math.floor(Number(ability.lifeCost) || 0));
  return { ...ability, lifeCost: current + add };
}

export function formatManaAbilityPaymentLabel(label: string, lifeCost?: number): string {
  const amount = Math.max(0, Math.floor(Number(lifeCost) || 0));
  if (amount <= 0) return label;
  return `${label} (plus ${amount} life)`;
}

function suggestionManaAmount(suggestions: Map<string, SuggestedPaymentSelection> | undefined): number {
  if (!suggestions || suggestions.size === 0) return 0;
  let total = 0;
  for (const entry of suggestions.values()) total += Math.max(0, Number(entry?.count) || 0);
  return total;
}

export function paymentMapLifeCost(
  suggestions: Map<string, SuggestedPaymentSelection> | undefined,
  sources: readonly ManaPaymentSource[],
): number {
  if (!suggestions || suggestions.size === 0) return 0;
  const byId = new Map<string, ManaPaymentSource>();
  for (const source of sources) {
    byId.set(String(source.id), source);
    if (source.sourcePermanentId) byId.set(String(source.sourcePermanentId), source);
  }
  let total = 0;
  const counted = new Set<string>();
  for (const key of suggestions.keys()) {
    const source = byId.get(String(key));
    if (!source) continue;
    const id = String(source.id);
    if (counted.has(id)) continue;
    counted.add(id);
    total += Math.max(0, Math.floor(Number(source.lifeCost) || 0));
  }
  return total;
}

export function calculateSuggestedPaymentAccountingForLife(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  sources: ManaPaymentSource[],
  colorsToPreserve: Set<Color>,
  floatingMana?: any,
  purpose?: any,
  currentLife?: number,
): Map<string, SuggestedPaymentSelection> {
  const lifeCap = Number.isFinite(Number(currentLife)) ? Math.max(0, Math.floor(Number(currentLife))) : Number.POSITIVE_INFINITY;
  const free = sources.filter((source) => !(Number(source.lifeCost) > 0));
  const affordable = sources.filter((source) => !(Number(source.lifeCost) > lifeCap));
  const freeSuggestion = calculateSuggestedPayment(cost, free, colorsToPreserve, floatingMana, purpose);
  const paidSuggestion = calculateSuggestedPayment(cost, affordable, colorsToPreserve, floatingMana, purpose);
  if (suggestionManaAmount(freeSuggestion) >= suggestionManaAmount(paidSuggestion)) return freeSuggestion;
  if (paymentMapLifeCost(paidSuggestion, affordable) <= lifeCap) return paidSuggestion;
  return freeSuggestion;
}
