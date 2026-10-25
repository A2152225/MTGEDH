// server/src/state/modules/persistedGrantedAbilityLoss.ts
// Persisted (non-spec) grants in perm.grantedAbilities -- e.g. a resolved "target creature gains
// \"{T}: ...\"" or a copied quoted ability -- obey "loses all abilities" in timestamp order (CR 613.7):
// a quoted activated / triggered grant survives only when its abilityGrantTimestamps stamp is later
// than every loss effect on the permanent. Unstamped grants lose to any removal (conservative).
// Keyword entries are left to the keyword-loss paths.
// Public entry symbols: persistedGrantedAbilitiesSurvivingLoss.

import { permanentKeywordLossTimestamp } from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { readAbilityGrantTimestamp } from '../../../../rules-engine/src/abilityEffectTimestamps.js';
import { battlefieldMayRemoveAbilities, isQuotedAbilityGrantText } from './staticEffectSpecGrantRecipientWrite.js';

export function persistedGrantedAbilitiesSurvivingLoss(permanent: any, battlefield: readonly any[] | undefined): unknown[] {
  const entries: unknown[] = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  if (!entries.some((e) => isQuotedAbilityGrantText(String(e || '')))) return entries;
  const board = Array.isArray(battlefield) ? battlefield : [];
  if (!battlefieldMayRemoveAbilities([...board, permanent])) return entries;
  const lossTs = permanentKeywordLossTimestamp(permanent, 'all abilities', board);
  if (lossTs === undefined) return entries;
  return entries.filter((e) => !isQuotedAbilityGrantText(String(e || ''))
    || (Number.isFinite(lossTs) && (readAbilityGrantTimestamp(permanent, e) ?? -Infinity) > lossTs));
}
