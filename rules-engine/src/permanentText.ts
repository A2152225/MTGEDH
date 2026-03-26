import type { BattlefieldPermanent } from '../../shared/src';

function normalizeTextEntry(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

export function getPermanentTemporaryEffectDescriptions(permanent: BattlefieldPermanent | any): string[] {
  const temporaryEffects = Array.isArray((permanent as any)?.temporaryEffects)
    ? (permanent as any).temporaryEffects
    : [];

  return temporaryEffects
    .map((effect: any) => normalizeTextEntry(effect?.description))
    .filter((value): value is string => Boolean(value));
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

  fragments.push(...getPermanentTemporaryEffectDescriptions(permanent));
  return fragments;
}

export function getCombinedPermanentText(permanent: BattlefieldPermanent | any): string {
  return getPermanentTextFragments(permanent).join('\n').toLowerCase();
}
