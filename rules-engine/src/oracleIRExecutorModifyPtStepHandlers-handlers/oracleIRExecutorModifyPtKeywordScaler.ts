/**
 * Origin parent: oracleIRExecutorModifyPtReferenceScaler.ts (resolveReferenceScalerScale).
 * Cluster: keyword-qualified controlled-creature scalers -
 * "for each creature you control with first strike or double strike" (any-of list),
 * "for each creature you control with flying" (single keyword).
 *
 * Public entry: tryResolveControlledCreatureKeywordScaler.
 */

import type { GameState, PlayerID } from '../../../shared/src';
import { permanentMatchesSelectorKeywords, splitSelectorKeywordQualifier } from '../oracleIRSelectorKeywordQualifier';

const CONTROLLED_CREATURE_KEYWORD_SCALER_RE = /^for each creature you control( with .+)$/;

/** Returns null when the scaler text is not a keyword-qualified controlled-creature count. */
export function tryResolveControlledCreatureKeywordScaler(
  state: GameState,
  controllerId: PlayerID,
  normalizedScaler: string,
): number | null {
  const match = String(normalizedScaler || '').match(CONTROLLED_CREATURE_KEYWORD_SCALER_RE);
  if (!match) return null;
  const qualifier = splitSelectorKeywordQualifier(`creature${match[1]}`);
  if (!qualifier.keywordsAll && !qualifier.keywordsAny && !qualifier.keywordsNone) return null;
  if (qualifier.remainder !== 'creature') return null;

  const battlefield = (Array.isArray(state.battlefield) ? state.battlefield : []) as any[];
  const wanted = String(controllerId || '').trim();
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== wanted) return false;
    const typeLine = String(
      permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '',
    ).toLowerCase();
    if (!/\bcreature\b/.test(typeLine)) return false;
    return permanentMatchesSelectorKeywords(permanent, qualifier, battlefield);
  }).length;
}
