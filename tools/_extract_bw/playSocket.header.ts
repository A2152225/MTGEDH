// Origin parent: client/src/App.tsx
// Cluster moved: play-socket / combat / priority / undo / AI listener effects.
// Public entry symbols: useAppPlaySocketEffects.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";
import { socket } from "../socket";
import type { BattlefieldPermanent, ClientGameView, ManaPool, PlayerID } from "../../../shared/src";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import type { UndoBoundaryPreview, UndoRequestData } from "../components/UndoRequestModal";
import { canCreatureAttackNow, isCurrentlyCreature } from "../utils/creatureUtils";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export type AppPlaySocketEffectDeps = {
  safeView: ClientGameView | null | undefined;
  you: PlayerID | null | undefined;
  canCreatureAttack: (perm: BattlefieldPermanent) => boolean;
  myPendingResolutionCount: number;
  activeResolutionPrompt: { stepId: string; title: string } | null;
  minimizedResolutionStep: { stepId: string; title: string } | null;
  combatPreviewAttackTargets: Record<string, string> | null;
  combatMode: "attackers" | "blockers";
  combatModalOpen: boolean;
  combatModalReadOnly: boolean;
  lastError: string | null;
  lastCombatErrorSeenRef: React.MutableRefObject<string | null>;
  hasAutoSkippedAttackers: React.MutableRefObject<string | null>;
  hasShownBlockersModal: React.MutableRefObject<string | null>;
  lastPriorityStep: React.MutableRefObject<string | null>;
  hadPriorityRef: React.MutableRefObject<boolean>;
  lastCanRespond: React.MutableRefObject<boolean | null>;
  autoPassSteps: Set<string>;
  autoPassForTurn: boolean;
  phaseNavigatorAdvancing: boolean;
  pendingTriggers: TriggerPromptData[];
  undoRequestData: UndoRequestData | null;
  connected: boolean;
  setNameInUsePayload: Setter<any>;
  setShowNameInUseModal: Setter<boolean>;
  setCombatControlMode: Setter<"attackers" | "blockers">;
  setCombatControlModalOpen: Setter<boolean>;
  setCombatModalOpen: Setter<boolean>;
  setCombatModalError: Setter<string | null>;
  setCombatModalReadOnly: Setter<boolean>;
  setCombatModalMinimized: Setter<boolean>;
  setCombatMode: Setter<"attackers" | "blockers">;
  setCombatPreviewAttackTargets: Setter<Record<string, string> | null>;
  setPriorityModalOpen: Setter<boolean>;
  setIgnoredTriggerSources: Setter<any>;
  setDeckValidation: Setter<any>;
  setIgnoredCards: Setter<any>;
  setDamageReplacementMode: Setter<any>;
  setReplacementEffectModalOpen: Setter<boolean>;
  setReplacementEffectModalData: Setter<any>;
  setManaPool: Setter<ManaPool | null>;
  setUndoRequestData: Setter<UndoRequestData | null>;
  setUndoModalOpen: Setter<boolean>;
  setAvailableUndoCount: Setter<number>;
  setUndoTurnPhaseTargets: Setter<any>;
  setSmartUndoCounts: Setter<any>;
  setAiControlEnabled: Setter<boolean>;
  setAiStrategy: Setter<string>;
};

export function useAppPlaySocketEffects(deps: AppPlaySocketEffectDeps) {
  const {
    safeView,
    you,
    canCreatureAttack,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
    combatPreviewAttackTargets,
    combatMode,
    combatModalOpen,
    combatModalReadOnly,
    lastError,
    lastCombatErrorSeenRef,
    hasAutoSkippedAttackers,
    hasShownBlockersModal,
    lastPriorityStep,
    hadPriorityRef,
    lastCanRespond,
    autoPassSteps,
    autoPassForTurn,
    phaseNavigatorAdvancing,
    pendingTriggers,
    undoRequestData,
    connected,
    setNameInUsePayload,
    setShowNameInUseModal,
    setCombatControlMode,
    setCombatControlModalOpen,
    setCombatModalOpen,
    setCombatModalError,
    setCombatModalReadOnly,
    setCombatModalMinimized,
    setCombatMode,
    setCombatPreviewAttackTargets,
    setPriorityModalOpen,
    setIgnoredTriggerSources,
    setDeckValidation,
    setIgnoredCards,
    setDamageReplacementMode,
    setReplacementEffectModalOpen,
    setReplacementEffectModalData,
    setManaPool,
    setUndoRequestData,
    setUndoModalOpen,
    setAvailableUndoCount,
    setUndoTurnPhaseTargets,
    setSmartUndoCounts,
    setAiControlEnabled,
    setAiStrategy,
  } = deps;
