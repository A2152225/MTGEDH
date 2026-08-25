// Origin parent: client/src/App.tsx
// Cluster moved: auto-pass handlers (autoPassSteps through handleToggleAutoAdvance).
// Public entry symbols: useAppAutoPassHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useState } from "react";
import { socket } from "../socket";
import type { ClientGameView, PlayerID } from "../../../shared/src";
import { debug } from "../utils/debug";

export type AppAutoPassHandlerDeps = {
  safeView: ClientGameView | null | undefined;
  you: PlayerID | null | undefined;
};

export function useAppAutoPassHandlers(deps: AppAutoPassHandlerDeps) {
  const { safeView, you } = deps;
