/**
 * socket/resolution-handlers/resolutionOptionChoiceSelectionIds.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two selection-id readers that OPTION_CHOICE branches use to normalize
 * `response.selections`, which arrives as a string, an array, or an option object depending on the
 * client path - the single-id `extractId` closure and the multi-id `extractSelectionIds` closure
 * that lived inside the land-sacrifice branch.
 * Public entry symbols: extractOptionChoiceSelectionId, extractOptionChoiceSelectionIds.
 *
 * Shared leaf so extracted OPTION_CHOICE handlers do not each re-declare the closure. The parent
 * still declares its own copies for the branches that have not moved yet.
 *
 * Must not import resolution.ts.
 */

/** First selected option id, or null. Mirrors the `extractId` closure in handleOptionChoiceResponse. */
export function extractOptionChoiceSelectionId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

/** Every selected option id, including the `selectedOptionIds` / `optionIds` / `selectedIds` wrappers. */
export function extractOptionChoiceSelectionIds(raw: any): string[] {
  const extractOne = (sel: any): string | null => {
    if (typeof sel === 'string') return sel;
    if (sel && typeof sel === 'object') {
      const optionId = (sel as any).optionId;
      if (typeof optionId === 'string' && optionId.trim()) return optionId;
      const id = (sel as any).id;
      if (typeof id === 'string' && id.trim()) return id;
      const value = (sel as any).value;
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };

  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => extractOne(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (raw && typeof raw === 'object') {
    const wrapped = Array.isArray(raw.selectedOptionIds)
      ? raw.selectedOptionIds
      : (Array.isArray(raw.optionIds) ? raw.optionIds : (Array.isArray(raw.selectedIds) ? raw.selectedIds : null));
    if (wrapped) {
      return wrapped
        .map((entry: any) => extractOne(entry))
        .filter((entry: any): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    const one = extractOne(raw);
    return one ? [one] : [];
  }
  return [];
}
