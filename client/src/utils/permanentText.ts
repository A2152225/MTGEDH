import type { BattlefieldPermanent } from '../../../shared/src';

function normalizeTextEntry(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

export function getPermanentTextFragments(permanent: BattlefieldPermanent | any): string[] {
  const fragments: string[] = [];

  const cardOracle = normalizeTextEntry((permanent as any)?.card?.oracle_text);
  if (cardOracle) fragments.push(cardOracle);

  const permanentOracle = normalizeTextEntry((permanent as any)?.oracle_text);
  if (permanentOracle && permanentOracle !== cardOracle) {
    fragments.push(permanentOracle);
  }

  if (Array.isArray((permanent as any)?.grantedAbilities) && (permanent as any).grantedAbilities.length > 0) {
    fragments.push((permanent as any).grantedAbilities.join('\n'));
  }

  const temporaryEffects = Array.isArray((permanent as any)?.temporaryEffects)
    ? (permanent as any).temporaryEffects
    : [];
  for (const effect of temporaryEffects) {
    const description = normalizeTextEntry(effect?.description);
    if (description) {
      fragments.push(description);
    }
  }

  return fragments;
}

export function getCombinedPermanentText(permanent: BattlefieldPermanent | any): string {
  return getPermanentTextFragments(permanent).join('\n').toLowerCase();
}