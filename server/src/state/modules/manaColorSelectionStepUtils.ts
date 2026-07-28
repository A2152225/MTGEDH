import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';

export type AnyCombinationManaSelectionFields = {
  selectionKind: 'distribution' | 'any_color';
  description: string;
  allowedColors: string[];
  amount?: number;
  totalAmount?: number;
  availableColors?: string[];
};

const ALL_COLORED_MANA = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * Resolve allowed mana colors from getCreatureCountManaAmount's color field.
 * - `any_combination` / `any_one_color` → all five colors
 * - `combination:U,R` → only those colors (e.g. Vivi Ornitier)
 */
export function resolveAllowedColorsForCombinationMana(colorField: string): string[] {
  const raw = String(colorField || '').trim();
  if (raw.toLowerCase().startsWith('combination:')) {
    const parts = raw
      .slice('combination:'.length)
      .split(',')
      .map((part) => String(part || '').trim().toUpperCase())
      .filter((part) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(part));
    if (parts.length > 0) return parts;
  }
  return [...ALL_COLORED_MANA];
}

export function isCombinationOrAnyColorManaField(colorField: string): boolean {
  const raw = String(colorField || '').trim();
  return (
    raw === 'any_combination'
    || raw === 'any_one_color'
    || raw.toLowerCase().startsWith('combination:')
  );
}

/**
 * Build resolution-step fields for dynamic colored mana production.
 * Returns null when there is no mana to add (caller should skip the prompt).
 *
 * - any_one_color (Three Tree City): pick one color, add `totalAmount` of it
 * - any_combination / combination:U,R: distribute `totalAmount` across allowed colors
 */
export function buildManaProductionColorSelectionFields(options: {
  totalAmount: number;
  cardName: string;
  colorMode: string;
}): AnyCombinationManaSelectionFields | null {
  const totalAmount = Math.max(0, Number(options.totalAmount || 0));
  if (totalAmount <= 0) return null;

  const colorMode = String(options.colorMode || '').trim();
  const allowedColors = resolveAllowedColorsForCombinationMana(colorMode);
  const cardName = String(options.cardName || 'Mana');

  if (colorMode === 'any_one_color') {
    return {
      selectionKind: 'any_color',
      description: totalAmount === 1
        ? `Choose a color for ${cardName}'s mana.`
        : `Choose a color to add ${totalAmount} mana from ${cardName}.`,
      amount: totalAmount,
      allowedColors,
    };
  }

  return buildAnyCombinationManaSelectionFields({
    totalAmount,
    cardName,
    allowedColors,
  });
}

/**
 * Build resolution-step fields for "any combination of colors" mana production.
 * Amounts above 1 require distribution; single mana uses any_color.
 */
export function buildAnyCombinationManaSelectionFields(options: {
  totalAmount: number;
  cardName: string;
  allowedColors?: string[];
}): AnyCombinationManaSelectionFields {
  const allowedColors = options.allowedColors?.length
    ? [...options.allowedColors]
    : [...ALL_COLORED_MANA];
  const totalAmount = Math.max(0, Number(options.totalAmount || 0));
  const cardName = String(options.cardName || 'Mana');

  if (totalAmount > 1) {
    return {
      selectionKind: 'distribution',
      description: `Choose how to distribute ${totalAmount} mana from ${cardName}.`,
      totalAmount,
      allowedColors,
      availableColors: allowedColors,
    };
  }

  return {
    selectionKind: 'any_color',
    description: `Choose a color for ${cardName}'s mana.`,
    amount: Math.max(1, totalAmount),
    allowedColors,
  };
}

export function hasPendingManaColorSelectionForPermanent(
  gameId: string,
  permanentId: string,
  playerId?: string,
): boolean {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const steps = Array.isArray(queue?.steps) ? queue.steps : [];
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return false;

  return steps.some((step: any) => {
    if (String(step?.type || '') !== ResolutionStepType.MANA_COLOR_SELECTION) return false;
    const stepPermanentId = String(step?.permanentId || step?.sourceId || '').trim();
    if (stepPermanentId !== normalizedPermanentId) return false;
    if (playerId && String(step?.playerId || '').trim() !== String(playerId).trim()) return false;
    return true;
  });
}
