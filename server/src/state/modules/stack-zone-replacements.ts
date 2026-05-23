import { evaluateStackGraveyardDestinationReplacement } from './replacement-effects.js';

export function shouldExileStackCardInsteadOfGraveyard(stackItem: any): boolean {
  if (!stackItem) return false;
  return evaluateStackGraveyardDestinationReplacement(stackItem).replacementDestination === 'exile';
}