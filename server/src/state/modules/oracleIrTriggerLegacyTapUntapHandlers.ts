import type { PlayerID } from '../../../../shared/src/index.js';
import { syncPreparedPermanentAfterControlChange } from './prepared.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export function applyRetiredTriggerLegacyTapUntapInlineBatch(params: {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  const { controller, sourceName, desc, triggerItem, state } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  if (desc.includes('untap all other creatures you control') && !desc.includes('combat phase')) {
    const battlefield = state.battlefield || [];
    const untapSourceId = triggerItem.source || triggerItem.permanentId;
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      if (String(perm.id || '') === String(untapSourceId || '')) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      if (perm.tapped) {
        perm.tapped = false;
        debug(2, `[executeTriggerEffect] Untapped ${perm.card?.name || perm.id}`);
      }
    }
    return true;
  }

  if (desc.includes('untap all creatures you control') && !desc.includes('combat phase')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      if (perm.tapped) {
        perm.tapped = false;
        debug(2, `[executeTriggerEffect] Untapped ${perm.card?.name || perm.id}`);
      }
    }
    return true;
  }

  if (/^each player gains control of all creatures they own\.?$/i.test(desc.trim())) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent) continue;

      const typeLine = String(permanent.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      const ownerId = String(permanent.owner || '').trim();
      const previousController = String(permanent.controller || '').trim();
      if (!ownerId || ownerId === previousController) continue;

      permanent.controller = ownerId;
      syncPreparedPermanentAfterControlChange(state, permanent, previousController);
      (permanent as any).summoningSickness = true;
      debug(2, `[executeTriggerEffect] ${permanent.card?.name || permanent.id} returned to owner control (${ownerId})`);
    }
    return true;
  }

  return false;
}
