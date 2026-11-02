// client/src/utils/beamMeUpUi.ts
// UI41: Beam me up (Star Trek) presentation helpers.
// - mergeGraveyardAbilityHints: adds server graveyard ability hints (e.g. 'beam-me-up') to the table's
//   graveyard right-click menu, the same way GraveyardViewModal merges them.
// - getReturnToHandCostPresentation: relabels the reused sacrifice-as-cost TARGET_SELECTION prompt when the
//   cost is returning a creature to hand (returnToHandForCost / targetTypes 'return_to_hand_cost').

export interface ZoneAbilityEntry { id: string; label: string; description: string; cost?: string }
export interface GraveyardAbilityHintLike { id?: string; label?: string; description?: string; cost?: string; activatable?: boolean }

export function mergeGraveyardAbilityHints(abilities: ZoneAbilityEntry[], zone: string, hints?: readonly GraveyardAbilityHintLike[] | null): ZoneAbilityEntry[] {
  if (zone !== 'graveyard' || !Array.isArray(hints) || hints.length === 0) return abilities;
  const out = abilities.slice();
  for (const hint of hints) {
    const id = String(hint?.id || '');
    if (!id || hint?.activatable === false || out.some((a) => a.id === id)) continue;
    out.push({ id, label: String(hint.label || id), description: String(hint.description || ''), ...(hint.cost ? { cost: String(hint.cost) } : {}) });
  }
  return out;
}

export function isReturnToHandCostStep(step: any): boolean {
  if (!step) return false;
  if (step.returnToHandForCost === true || step.returnToHandAbilityAsCost === true) return true;
  return Array.isArray(step.targetTypes) && step.targetTypes.includes('return_to_hand_cost');
}

export function getReturnToHandCostPresentation(step: any): { title: string; description: string; confirmLabel: string } | undefined {
  if (!isReturnToHandCostStep(step)) return undefined;
  const type = String(step.returnType || '').trim();
  const noun = type ? (/^[aeiou]/i.test(type) ? `an ${type}` : `a ${type}`) : 'a creature';
  const source = String(step.sourceName || step.cardName || '').trim();
  const title = `${source ? `${source}: ` : ''}Return ${noun} to hand`;
  const raw = String(step.description || '').trim();
  const description = raw && !/\bsacrific/i.test(raw)
    ? raw
    : `Choose ${String(step.targetDescription || `${type || 'creature'} you control`)} to return to its owner's hand.`;
  return { title, description, confirmLabel: 'Return to Hand' };
}
