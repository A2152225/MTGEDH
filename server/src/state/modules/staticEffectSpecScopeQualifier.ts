// server/src/state/modules/staticEffectSpecScopeQualifier.ts
// Extra recipient filters on a declarative scope: "creature tokens", "creatures with flying",
// "each creature you control with a +1/+1 counter on it".
// Keyword checks read printed keywords and persisted grants only (not other statics), which avoids
// layer-6 recursion inside the spec pass.
// Public entry symbols: permanentMatchesScopeQualifier.

import type { StaticEffectScopeQualifier } from './staticEffectSpecTypes.js';

function hasPrintedOrGrantedKeyword(permanent: any, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  const lists = [permanent?.card?.keywords, permanent?.grantedAbilities, permanent?.grantedKeywords];
  for (const list of lists) {
    if (Array.isArray(list) && list.some((k: unknown) => String(k || '').trim().toLowerCase() === kw)) return true;
  }
  const oracle = String(permanent?.card?.oracle_text || '').toLowerCase().replace(/\([^)]*\)/g, '');
  return oracle.split(/\n+/).some((line) => {
    const words = line.trim().replace(/\.$/, '');
    return /^[a-z ,]+$/.test(words) && words.split(/,\s*|\s+and\s+/).map((w) => w.trim()).includes(kw);
  });
}

export function permanentMatchesScopeQualifier(permanent: any, qualifier: StaticEffectScopeQualifier): boolean {
  if (qualifier.token === true && permanent?.isToken !== true && permanent?.card?.isToken !== true) return false;
  if (qualifier.token === false && (permanent?.isToken === true || permanent?.card?.isToken === true)) return false;
  if (qualifier.keyword && !hasPrintedOrGrantedKeyword(permanent, qualifier.keyword)) return false;
  if (qualifier.counter && !(Number(permanent?.counters?.[qualifier.counter] || 0) > 0)) return false;
  if (qualifier.anyCounter && !Object.values(permanent?.counters || {}).some((n) => Number(n) > 0)) return false;
  const typeLine = String(permanent?.typeSetOverride?.typeLine || permanent?.card?.type_line || '').toLowerCase();
  if (qualifier.legendary && !/\blegendary\b/.test(typeLine)) return false;
  if (qualifier.subtype && !new RegExp('\\b' + qualifier.subtype.toLowerCase() + 's?\\b').test(typeLine)) return false;
  if (qualifier.colors?.length) {
    const own = (Array.isArray(permanent?.card?.colors) ? permanent.card.colors : []).map((c: unknown) => String(c).toUpperCase());
    if (!qualifier.colors.some((c) => own.includes(String(c).toUpperCase()))) return false;
  }
  return true;
}
