/** Confirm payload for BOTTOM_ORDER (Warp World remainder, tutor leftovers). */

export function bottomOrderIdsFromPeekConfirm(payload: {
  keepTopOrder?: string[];
  bottomOrder?: string[];
}): string[] {
  if (Array.isArray(payload.bottomOrder) && payload.bottomOrder.length > 0) {
    return payload.bottomOrder.map((id) => String(id || '').trim()).filter(Boolean);
  }
  if (Array.isArray(payload.keepTopOrder) && payload.keepTopOrder.length > 0) {
    return payload.keepTopOrder.map((id) => String(id || '').trim()).filter(Boolean);
  }
  return [];
}
