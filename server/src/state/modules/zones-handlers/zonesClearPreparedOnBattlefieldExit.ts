// server/src/state/modules/zones-handlers/zonesClearPreparedOnBattlefieldExit.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: clearPreparedStateOnBattlefieldExit.
// Public entry symbols: clearPreparedStateOnBattlefieldExit.

import { clearPreparedPermanent } from "../prepared.js";

export function clearPreparedStateOnBattlefieldExit(state: any, permanent: any): void {
  if (!permanent) {
    return;
  }

  try {
    const { unpairPermanent } = require('../soulbond.js') as typeof import('../soulbond.js');
    unpairPermanent(state, permanent);
  } catch {
    // best-effort soulbond cleanup
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

