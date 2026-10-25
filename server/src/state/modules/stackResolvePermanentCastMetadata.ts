/**
 * Batch 24: cast metadata copied from the resolving stack item onto the entering permanent
 * (mana spent, alternate cost, convoke, cast origin, as-enters choices, escape).
 * Origin parent: stackResolvePermanentEntryUtils.ts (moved verbatim to keep that file under 40KB).
 * Public entry symbols: propagateCastMetadataToEnteringPermanent.
 * Leaf: must not import stackResolvePermanentEntryUtils.ts.
 */
export function propagateCastMetadataToEnteringPermanent(item: any, effectiveCard: any, newPermanent: any, wasCastWithMorph: boolean): void {
  // Propagate relevant cast metadata from the stack item onto the permanent/card.
  // This enables ETB intervening-if clauses like "if {R} was spent to cast it".
  if ((item as any).manaColorsSpent && Array.isArray((item as any).manaColorsSpent) && !wasCastWithMorph) {
    (newPermanent as any).manaColorsSpent = (item as any).manaColorsSpent;
    (newPermanent.card as any).manaColorsSpent = (item as any).manaColorsSpent;
  }

  if (typeof (item as any).manaSpentTotal === 'number' && !Number.isNaN((item as any).manaSpentTotal) && !wasCastWithMorph) {
    (newPermanent as any).manaSpentTotal = (item as any).manaSpentTotal;
    (newPermanent.card as any).manaSpentTotal = (item as any).manaSpentTotal;
  }

  if ((item as any).manaSpentBreakdown && typeof (item as any).manaSpentBreakdown === 'object' && !wasCastWithMorph) {
    (newPermanent as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
    (newPermanent.card as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
  }

  // Alternate-cost id (e.g., surge/spectacle/madness/prowl) for intervening-if and other templates.
  if (typeof (item as any).alternateCostId === 'string' && (item as any).alternateCostId.length > 0 && !wasCastWithMorph) {
    (newPermanent as any).alternateCostId = (item as any).alternateCostId;
    (newPermanent.card as any).alternateCostId = (item as any).alternateCostId;
  }

  // Convoke-derived metadata: how many creatures contributed mana.
  if (typeof (item as any).manaFromCreaturesSpent === 'number' && !Number.isNaN((item as any).manaFromCreaturesSpent) && !wasCastWithMorph) {
    (newPermanent as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
    (newPermanent.card as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
  }
  if (Array.isArray((item as any).convokeTappedCreatures) && !wasCastWithMorph) {
    (newPermanent as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
    (newPermanent.card as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
  }

  // Track cast origin (best-effort) for intervening-if clauses like "if you cast it" / "if you cast it from your hand".
  // Only set these on permanents created from resolving a stack item.
  (newPermanent as any).enteredFromCast = true;
  (newPermanent.card as any).enteredFromCast = true;
  // Propagate as-enters choices already chosen on the stack/card (replay restore + spell-time choices).
  const chosenCreatureType = String(
    (item as any)?.chosenCreatureType
    || (effectiveCard as any)?.chosenCreatureType
    || (item as any)?.card?.chosenCreatureType
    || '',
  ).trim();
  if (chosenCreatureType) {
    (newPermanent as any).chosenCreatureType = chosenCreatureType;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenCreatureType = chosenCreatureType;
    }
  }
  const chosenColor = String(
    (item as any)?.chosenColor
    || (effectiveCard as any)?.chosenColor
    || (item as any)?.card?.chosenColor
    || '',
  ).trim();
  if (chosenColor) {
    (newPermanent as any).chosenColor = chosenColor;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenColor = chosenColor;
    }
  }
  const chosenCardName = String(
    (item as any)?.chosenCardName
    || (effectiveCard as any)?.chosenCardName
    || (item as any)?.card?.chosenCardName
    || '',
  ).trim();
  if (chosenCardName) {
    (newPermanent as any).chosenCardName = chosenCardName;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenCardName = chosenCardName;
    }
  }
  const chosenPlayer = String(
    (item as any)?.chosenPlayer
    || (effectiveCard as any)?.chosenPlayer
    || (item as any)?.card?.chosenPlayer
    || '',
  ).trim();
  if (chosenPlayer) {
    (newPermanent as any).chosenPlayer = chosenPlayer;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenPlayer = chosenPlayer;
    }
  }
  if (typeof (item as any).castFromHand === 'boolean') {
    (newPermanent as any).castFromHand = (item as any).castFromHand;
    (newPermanent.card as any).castFromHand = (item as any).castFromHand;
  }
  if (typeof (item as any).source === 'string' && (item as any).source.length > 0) {
    (newPermanent as any).castSourceZone = (item as any).source;
    (newPermanent.card as any).castSourceZone = (item as any).source;
  }
  if (String((effectiveCard as any)?.castWithAbility || (item as any)?.card?.castWithAbility || '').trim().toLowerCase() === 'escape') {
    (newPermanent as any).escapedFrom = 'graveyard';
    (newPermanent.card as any).escapedFrom = 'graveyard';
  }
}
