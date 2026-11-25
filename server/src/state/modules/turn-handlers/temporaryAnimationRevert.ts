// Restores the characteristics an until-end-of-turn Oracle IR animation overwrote
// (P/T, type line, granted types, colors). The snapshot is stamped by
// applyAnimatePermanentStep on the temporary effect as `animateRevert`; null marks a
// field the permanent did not have.

const TOP_LEVEL_KEYS = ['power', 'basePower', 'toughness', 'baseToughness', 'type_line', 'grantedTypes', 'subtypes', 'colors'] as const;
const CARD_KEYS = ['type_line', 'subtypes', 'colors'] as const;

export function revertTemporaryAnimation(permanent: any, snapshot: any): void {
  if (!permanent || !snapshot || typeof snapshot !== 'object') return;
  for (const key of TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    if (snapshot[key] == null) delete permanent[key];
    else permanent[key] = snapshot[key];
  }
  const cardSnapshot = snapshot.card;
  if (cardSnapshot && typeof cardSnapshot === 'object' && permanent.card && typeof permanent.card === 'object') {
    const card = { ...permanent.card };
    for (const key of CARD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(cardSnapshot, key)) continue;
      if (cardSnapshot[key] == null) delete card[key];
      else card[key] = cardSnapshot[key];
    }
    permanent.card = card;
  }
  delete permanent.effectivePower;
  delete permanent.effectiveToughness;
}
