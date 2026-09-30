// server/src/state/modules/sourceLinkedPtModifiers.ts
// "For as long as <condition>" P/T pumps (Thran Weaponry, Flowstone Armor, Zelyon Sword, Endoskeleton,
// Spirit Shield, Ashnod's Battle Gear, Tawnos's Weaponry, "... while this Equipment remains attached to it",
// "... for as long as you control <source / a Forest>").
// The Oracle IR executor stamps `linkCondition` (+ `sourceId`, `linkControllerId`) on the powerToughness
// modifier. The modifier counts only while the condition holds (isSourceLinkedModifierActive, used by
// sumLongDurationPtModifiers) and is removed when it stops (expireSourceLinkedPtModifiers, run from the
// derived-effects sync). Modifiers without a linkCondition, or checked without a game state, are untouched.
// Public entry symbols: isSourceLinkedModifierActive, expireSourceLinkedPtModifiers.

type LinkCondition = { kind?: string; matching?: string };

function findBattlefieldPermanent(state: any, id: string): any | undefined {
  if (!id) return undefined;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((perm: any) => String(perm?.id || '') === id);
}

function permanentTypeLine(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function permanentMatchesWord(perm: any, word: string): boolean {
  const needle = String(word || '').trim().toLowerCase();
  if (!needle) return false;
  if (String(perm?.card?.name || '').trim().toLowerCase() === needle) return true;
  return new RegExp(`\\b${needle.replace(/[^a-z ]/g, '')}s?\\b`).test(permanentTypeLine(perm));
}

/** Whether a source-linked P/T modifier on `host` still applies. Always true without a link or a state. */
export function isSourceLinkedModifierActive(modifier: any, host: any, state?: any): boolean {
  const link: LinkCondition | undefined = modifier?.linkCondition;
  if (!link || !link.kind) return true;
  if (!state || !Array.isArray(state.battlefield)) return true;
  const sourceId = String(modifier?.sourceId || '').trim();
  const source = findBattlefieldPermanent(state, sourceId);
  const controllerId = String(modifier?.linkControllerId || source?.controller || host?.controller || '').trim();
  switch (link.kind) {
    case 'source_tapped':
      return Boolean(source) && source.tapped === true;
    case 'source_attached':
      return Boolean(source) && String(source.attachedTo || '') === String(host?.id || '');
    case 'controller_controls_source':
      return Boolean(source) && (!modifier?.linkControllerId || String(source.controller || '') === controllerId);
    case 'controller_controls_matching':
      return state.battlefield.some((perm: any) =>
        perm && String(perm.controller || '') === controllerId && permanentMatchesWord(perm, String(link.matching || '')),
      );
    default:
      return true;
  }
}

/**
 * Drops source-linked P/T modifiers whose condition stopped holding (source untapped / left / unattached,
 * control lost). Returns how many modifiers were removed.
 */
export function expireSourceLinkedPtModifiers(state: any): number {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let removed = 0;
  for (const perm of battlefield) {
    if (!perm || !Array.isArray(perm.modifiers) || perm.modifiers.length === 0) continue;
    const kept = perm.modifiers.filter((modifier: any) => isSourceLinkedModifierActive(modifier, perm, state));
    const dropped = perm.modifiers.length - kept.length;
    if (dropped <= 0) continue;
    removed += dropped;
    if (kept.length === 0) delete perm.modifiers;
    else perm.modifiers = kept;
    delete perm.effectivePower;
    delete perm.effectiveToughness;
  }
  return removed;
}