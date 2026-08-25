// server/src/state/modules/upkeep-triggers-handlers/upkeepEchoHelpers.ts
// Origin parent: server/src/state/modules/upkeep-triggers.ts
// Cluster moved: shouldTriggerEcho (echo cost fires on the control-change upkeep).
// Public entry symbols: shouldTriggerEcho.

import { getLastUpkeepMarker } from "./upkeepMarkerHelpers.js";

export function shouldTriggerEcho(state: any, permanent: any): boolean {
  const controllerId = String(permanent?.controller || '').trim();
  const entryMarkerRaw =
    (permanent as any)?.echoControlUpkeepMarker ??
    (permanent as any)?.card?.echoControlUpkeepMarker;
  const entryMarker = Number(entryMarkerRaw);
  if (controllerId && Number.isFinite(entryMarker)) {
    return entryMarker === getLastUpkeepMarker(state, controllerId);
  }

  const recentControlFlags = [
    (permanent as any)?.cameUnderYourControlThisTurn,
    (permanent as any)?.gainedControlThisTurn,
    (permanent as any)?.cameUnderControlThisTurn,
    (permanent as any)?.enteredThisTurn,
    (permanent as any)?.enteredBattlefieldThisTurn,
    (permanent as any)?.card?.cameUnderYourControlThisTurn,
    (permanent as any)?.card?.gainedControlThisTurn,
    (permanent as any)?.card?.cameUnderControlThisTurn,
    (permanent as any)?.card?.enteredThisTurn,
    (permanent as any)?.card?.enteredBattlefieldThisTurn,
  ];

  if (recentControlFlags.some((flag) => flag === true)) {
    return true;
  }

  if (recentControlFlags.some((flag) => typeof flag === 'boolean')) {
    return false;
  }

  return false;
}
