// Origin parent: client/src/App.tsx
// Cluster moved: resolution-prompt helpers (minimized/active prompt state through scheduleResolutionPromptNudge).
// Public entry symbols: useAppResolutionPromptHelpers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useState } from "react";
import { socket } from "../socket";

export function useAppResolutionPromptHelpers() {
