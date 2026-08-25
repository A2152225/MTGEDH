// Origin parent: client/src/App.tsx
// Cluster moved: loop-shortcut state, handlers, and exclusive effects (showLoopShortcutPanel through last replay effect).
// Public entry symbols: useAppLoopShortcutHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useRef, useState } from "react";
import { socket } from "../socket";
import type { ClientGameView, PlayerID } from "../../../shared/src";
import { type LoopShortcutConsentPrompt } from "../components/LoopShortcutConsentModal";
import {
  buildLoopShortcutStackPassKey,
  canAdvanceLoopShortcutAfterState,
  clampLoopShortcutIterations,
  clearLoopShortcutDraft,
  createRecordedEmitItem,
  createRecordedResolutionResponseItem,
  deleteSavedLoopShortcut,
  isLoopShortcutPhaseAdvanceEmit,
  loadLoopShortcutDraft,
  loadSavedLoopShortcuts,
  noteLoopShortcutCastSettleStack,
  sanitizeLoopShortcutItems,
  saveLoopShortcutDraft,
  shouldLoopShortcutAutoPassPriority,
  upsertSavedLoopShortcut,
  type LoopShortcutCastSettleState,
  type LoopShortcutSequenceItem,
  type SavedLoopShortcut,
} from "../utils/loopShortcuts";

const LOOP_SHORTCUT_RECORDABLE_EVENTS = new Set([
  'activateBattlefieldAbility',
  'activateGraveyardAbility',
  'requestCastSpell',
  'castSpellFromHand',
  'completeCastSpell',
  'castCommander',
  // passPriority is intentionally NOT recorded: replaying it with an empty stack
  // advances the phase (main → combat). While waitingForState, the loop auto-passes
  // only when the stack is non-empty (see shouldLoopShortcutAutoPassPriority).
  'playLand',
]);

export type AppLoopShortcutHandlerDeps = {
  safeView: ClientGameView | null | undefined;
  you: PlayerID | null | undefined;
  priority: PlayerID | null | undefined;
  lastError: string | null;
  myPendingResolutionCount: number;
  activeResolutionPrompt: { stepId: string; title: string } | null;
  minimizedResolutionStep: { stepId: string; title: string } | null;
  createGameModalOpen: boolean;
  setSavedDecks: React.Dispatch<React.SetStateAction<any[]>>;
};

export function useAppLoopShortcutHandlers(deps: AppLoopShortcutHandlerDeps) {
  const {
    safeView,
    you,
    priority,
    lastError,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
    createGameModalOpen,
    setSavedDecks,
  } = deps;
