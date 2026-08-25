/**
 * Extracted from triggerEtbEntryEffects.ts: battlefield entry turn tracking.
 * Cluster moved: incrementTurnCounter, recordPermanentIdEnteredThisTurn,
 * recordBattlefieldEntryTurnTracking.
 * Public: recordBattlefieldEntryTurnTracking
 *
 * Leaf must not import triggerEtbEntryEffects.ts or triggerEtbEntryEffects-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';

function incrementTurnCounter(
  state: any,
  field: string,
  controller: PlayerID,
): void {
  (state as any)[field] = (state as any)[field] || {};
  const key = String(controller);
  (state as any)[field][key] = ((state as any)[field][key] || 0) + 1;
}

function recordPermanentIdEnteredThisTurn(
  state: any,
  field: string,
  controller: PlayerID,
  permanentId: string,
): void {
  (state as any)[field] = (state as any)[field] || {};
  const key = String(controller);
  const byController = (state as any)[field];
  byController[key] = byController[key] || {};
  byController[key][String(permanentId)] = true;
}

export function recordBattlefieldEntryTurnTracking(
  state: any,
  controller: PlayerID,
  permanent: any,
  options?: { trackFaceDownAndSubtype?: boolean },
): void {
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isLand = typeLine.includes('land');
  const isArtifact = typeLine.includes('artifact');
  const isEnchantment = typeLine.includes('enchantment');
  const isPlaneswalker = typeLine.includes('planeswalker');
  const isBattle = typeLine.includes('battle');
  const permanentId = String(permanent?.id || '');

  if (!isLand) {
    incrementTurnCounter(state, 'nonlandPermanentsEnteredBattlefieldThisTurn', controller);
  }
  if (isLand) {
    incrementTurnCounter(state, 'landsEnteredBattlefieldThisTurn', controller);
  }
  if (isCreature) {
    incrementTurnCounter(state, 'creaturesEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'creaturesEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }

    if (options?.trackFaceDownAndSubtype) {
      try {
        const isFaceDown =
          permanent?.faceDown === true || permanent?.isFaceDown === true || permanent?.faceDownCreature === true;
        if (isFaceDown) {
          incrementTurnCounter(state, 'faceDownCreaturesEnteredBattlefieldThisTurnByController', controller);
        }
      } catch {
        // best-effort tracking only
      }

      try {
        const typeLineRaw = String(permanent?.card?.type_line || '');
        const typeLineLower = typeLineRaw.toLowerCase();
        const dashSplit = typeLineLower.split(/\s*(?:[\u2014\u2013\u2012]|-|â€”)\s*/);
        const subtypePart = dashSplit.length > 1 ? dashSplit.slice(1).join(' ') : '';
        const subtypeTokens = subtypePart
          .split(/\s+/)
          .map((t) => t.replace(/[^a-z0-9-]/g, '').trim())
          .filter(Boolean);

        if (subtypeTokens.length) {
          (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype =
            (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype || {};
          const key = String(controller);
          const byController = (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype;
          byController[key] = byController[key] || {};
          for (const st of subtypeTokens) {
            byController[key][st] = (byController[key][st] || 0) + 1;
          }
        }
      } catch {
        // best-effort tracking only
      }
    }
  }
  if (isArtifact) {
    incrementTurnCounter(state, 'artifactsEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'artifactsEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
  if (isEnchantment) {
    incrementTurnCounter(state, 'enchantmentsEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'enchantmentsEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
  if (isPlaneswalker) {
    incrementTurnCounter(state, 'planeswalkersEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'planeswalkersEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
  if (isBattle) {
    incrementTurnCounter(state, 'battlesEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'battlesEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
}
