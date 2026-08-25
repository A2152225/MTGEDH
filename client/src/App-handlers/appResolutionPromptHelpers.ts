// Origin parent: client/src/App.tsx
// Cluster moved: resolution-prompt helpers (minimized/active prompt state through scheduleResolutionPromptNudge).
// Public entry symbols: useAppResolutionPromptHelpers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useState } from "react";
import { socket } from "../socket";

export function useAppResolutionPromptHelpers() {
  const [minimizedResolutionStep, setMinimizedResolutionStep] = useState<{ stepId: string; title: string } | null>(null);
  const [activeResolutionPrompt, setActiveResolutionPrompt] = useState<{ stepId: string; title: string } | null>(null);
  const resolutionPromptNudgeTimerRef = React.useRef<number | null>(null);

  const minimizeResolutionStep = React.useCallback((stepId: string, title: string) => {
    setMinimizedResolutionStep({ stepId: String(stepId), title: title || 'Pending choice' });
  }, []);
  const restoreResolutionStep = React.useCallback(() => {
    setMinimizedResolutionStep(null);
  }, []);
  const isResolutionStepMinimized = React.useCallback((stepId?: string | null) => {
    return !!stepId && minimizedResolutionStep?.stepId === String(stepId);
  }, [minimizedResolutionStep]);
  const resolutionPromptOpen = React.useCallback((
    modalOpen: boolean,
    stepId?: string | null,
  ) => {
    const id = stepId ?? activeResolutionPrompt?.stepId ?? null;
    return modalOpen && !isResolutionStepMinimized(id);
  }, [activeResolutionPrompt?.stepId, isResolutionStepMinimized]);

  const scheduleResolutionPromptNudge = React.useCallback((gameId: string) => {
    if (resolutionPromptNudgeTimerRef.current) {
      clearTimeout(resolutionPromptNudgeTimerRef.current);
    }
    resolutionPromptNudgeTimerRef.current = window.setTimeout(() => {
      socket.emit('getMyNextResolutionStep', { gameId });
    }, 100);
  }, []);

  return {
    minimizedResolutionStep,
    setMinimizedResolutionStep,
    activeResolutionPrompt,
    setActiveResolutionPrompt,
    minimizeResolutionStep,
    restoreResolutionStep,
    isResolutionStepMinimized,
    resolutionPromptOpen,
    scheduleResolutionPromptNudge,
  };
}
