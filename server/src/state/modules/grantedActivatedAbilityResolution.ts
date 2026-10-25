/**
 * Server side of `<cardId>-granted-<n>` activation ids: rebuilds the exact list the client
 * indexes (view grantedAbilities badges, i.e. persisted + continuous spec grants, then live
 * attachment quotes) so quoted abilities granted by statics ("Creatures you control have
 * \"{T}: ...\"", Goddric's "{R}: Dragons ...") can be activated.
 * Public: listGrantedActivatedAbilityLinesForPermanent, resolveGrantedActivatedAbilityLine.
 */
import { collectEffectiveGrantedAbilityTexts } from '../../../../shared/src/attachmentAbilityGrants.js';
import { listGrantedActivatedAbilityLines } from '../../../../shared/src/grantedActivatedAbilityList.js';
import { collectBattlefieldAbilityBadgesForView } from './battlefieldAbilityBadges.js';
import { getContinuousGrantedAbilitiesForPermanent } from './staticEffectSpec.js';

export function listGrantedActivatedAbilityLinesForPermanent(permanent: any, state: any): string[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let continuous: string[] = [];
  try {
    continuous = getContinuousGrantedAbilitiesForPermanent(permanent, state);
  } catch {
    continuous = [];
  }
  const badges = collectBattlefieldAbilityBadgesForView(permanent, continuous, battlefield);
  const entries = collectEffectiveGrantedAbilityTexts({ ...permanent, grantedAbilities: badges }, battlefield);
  return listGrantedActivatedAbilityLines(entries);
}

/** The granted line behind index n, or '' when the index is stale. */
export function resolveGrantedActivatedAbilityLine(permanent: any, state: any, index: number): string {
  const lines = listGrantedActivatedAbilityLinesForPermanent(permanent, state);
  return String(lines[index] || '').trim();
}
