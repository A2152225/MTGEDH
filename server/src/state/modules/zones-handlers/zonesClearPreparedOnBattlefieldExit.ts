// server/src/state/modules/zones-handlers/zonesClearPreparedOnBattlefieldExit.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: clearPreparedStateOnBattlefieldExit.
// Public entry symbols: clearPreparedStateOnBattlefieldExit.

import { clearPreparedPermanent } from "../prepared.js";
import { unpairPermanent } from "../soulbond.js";
import { reportHookFailure } from "../../../../../shared/src/hookFailureReporter.js";

export function clearPreparedStateOnBattlefieldExit(state: any, permanent: any): void {
  if (!permanent) {
    return;
  }

  try {
    unpairPermanent(state, permanent);
  } catch (err) {
    reportHookFailure('soulbond.unpair', err, { source: 'zonesClearPreparedOnBattlefieldExit', cardName: String(permanent?.card?.name || '') });
  }

  const hasPreparedState =
    permanent?.prepared === true ||
    permanent?.isPrepared === true ||
    Boolean(String(permanent?.preparedExileCopyCardId || '').trim()) ||
    permanent?.card?.prepared === true ||
    permanent?.card?.isPrepared === true ||
    Boolean(String(permanent?.card?.preparedExileCopyCardId || '').trim());

  if (!hasPreparedState) {
    return;
  }

  clearPreparedPermanent(state, permanent);
}

