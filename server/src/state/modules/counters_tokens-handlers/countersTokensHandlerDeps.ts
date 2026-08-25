// server/src/state/modules/counters_tokens-handlers/countersTokensHandlerDeps.ts
// Runtime seam so extracted leaves can call runSBA / zone movers without
// importing counters_tokens.ts (parent) or this folder's index.
// Origin parent: server/src/state/modules/counters_tokens.ts.

import type { GameContext } from "../../context.js";

export type CountersTokensHandlerDeps = {
  runSBA: (ctx: GameContext) => void;
  movePermanentToGraveyard: (
    ctx: GameContext,
    permanentId: string,
    triggerDeathEffects?: boolean,
  ) => boolean;
  applyCounterModifications: (
    gameState: any,
    targetPermanentId: string,
    deltas: Record<string, number>,
  ) => Record<string, number>;
  clearPreparedStateOnBattlefieldExit: (state: any, permanent: any) => void;
  updateGodCreatureStatus: (ctx: GameContext) => void;
};

let deps: Partial<CountersTokensHandlerDeps> = {};

export function setCountersTokensHandlerDeps(next: Partial<CountersTokensHandlerDeps>): void {
  deps = { ...deps, ...next };
}

export function getCountersTokensHandlerDeps(): CountersTokensHandlerDeps {
  const runSBA = deps.runSBA;
  const movePermanentToGraveyard = deps.movePermanentToGraveyard;
  const applyCounterModifications = deps.applyCounterModifications;
  const clearPreparedStateOnBattlefieldExit = deps.clearPreparedStateOnBattlefieldExit;
  const updateGodCreatureStatus = deps.updateGodCreatureStatus;
  if (
    !runSBA ||
    !movePermanentToGraveyard ||
    !applyCounterModifications ||
    !clearPreparedStateOnBattlefieldExit ||
    !updateGodCreatureStatus
  ) {
    throw new Error("counters_tokens handler deps not initialized");
  }
  return {
    runSBA,
    movePermanentToGraveyard,
    applyCounterModifications,
    clearPreparedStateOnBattlefieldExit,
    updateGodCreatureStatus,
  };
}
