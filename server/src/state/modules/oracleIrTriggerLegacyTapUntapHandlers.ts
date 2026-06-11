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

  const normalizedSimpleTapUntapText = desc.replace(/\s*\([^)]*\)\s*$/i, '').trim();
  const simpleTapUntapTargetEffect = /^(tap or untap|untap or tap|untap|tap)\s+[^.]*\btarget\b[^.]*\.?$/i.exec(normalizedSimpleTapUntapText);
  if (simpleTapUntapTargetEffect) {
    const rawAction = String(simpleTapUntapTargetEffect[1] || '').toLowerCase();
    const explicitAction = String((triggerItem as any).tapUntapAction || (triggerItem as any).action || '').toLowerCase();
    const action: 'tap' | 'untap' | null = rawAction.includes(' or ')
      ? (explicitAction === 'tap' || explicitAction === 'untap' ? explicitAction as 'tap' | 'untap' : null)
      : (rawAction.startsWith('untap') ? 'untap' : 'tap');

    if (action) {
      const targets = Array.isArray((triggerItem as any).targets) ? (triggerItem as any).targets : [];
      for (const target of targets) {
        const targetId = String(typeof target === 'string' ? target : target?.id || '').trim();
        if (!targetId) continue;

        const targetPermanent = (state.battlefield || []).find((perm: any) => perm && String(perm.id || '') === targetId);
        if (!targetPermanent) continue;

        if (action === 'tap') {
          targetPermanent.tapped = true;
          debug(2, `[executeTriggerEffect] Tapped ${targetPermanent.card?.name || targetPermanent.id}`);
        } else {
          targetPermanent.tapped = false;
          debug(2, `[executeTriggerEffect] Untapped ${targetPermanent.card?.name || targetPermanent.id}`);
        }
      }
      return true;
    }
  }

  if (desc.includes('tap target creature')) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        targetPerm.tapped = true;
        debug(2, `[executeTriggerEffect] Tapped ${targetPerm.card?.name || targetPerm.id}`);
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
