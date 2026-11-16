// Origin parent: client/src/App-handlers/appPlayRuntime.ts
// Combat-damage-assignment overlay state + confirm, kept out of TableLayout
// and App.tsx so those files stay under the size cap.
// Public entry symbols: useAppDamageAssignmentOverlay.

import { useCallback, useState } from "react";
import type { DamageAssignment } from "../components/DamageAssignmentModal";
import { socket } from "../socket";
import {
  buildCombatDamageAssignmentResponse,
  type CombatDamageAssignmentModalData,
} from "../utils/combatDamageAssignment";

export function useAppDamageAssignmentOverlay(p: { safeView?: any }) {
  const [damageAssignmentModalOpen, setDamageAssignmentModalOpen] = useState(false);
  const [damageAssignmentData, setDamageAssignmentData] = useState<CombatDamageAssignmentModalData | null>(null);

  const handleDamageAssignmentConfirm = useCallback((
    assignments: DamageAssignment[],
    trampleDamage: number,
  ) => {
    const data = damageAssignmentData;
    if (!p.safeView || !data?.stepId) return;
    const response = buildCombatDamageAssignmentResponse({
      assignments,
      trampleDamage,
      assignmentMode: data.assignmentMode,
      defendingPlayerId: data.defendingPlayerId,
      stepId: data.stepId,
    });
    socket.emit("submitResolutionResponse", {
      gameId: p.safeView.id,
      stepId: response.stepId,
      selections: response.selections,
      cancelled: false,
    });
    setDamageAssignmentModalOpen(false);
    setDamageAssignmentData(null);
  }, [damageAssignmentData, p.safeView]);

  const damageAssignmentOverlay = {
    damageAssignmentModalOpen,
    damageAssignmentData,
    handleDamageAssignmentConfirm,
  };

  return {
    damageAssignmentModalOpen,
    setDamageAssignmentModalOpen,
    damageAssignmentData,
    setDamageAssignmentData,
    handleDamageAssignmentConfirm,
    damageAssignmentOverlay,
  };
}
