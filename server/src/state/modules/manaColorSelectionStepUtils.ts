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
    : ['W', 'U', 'B', 'R', 'G'];
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
    amount: Math.max(1, totalAmount || 1),
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
