/**
 * Thin docked PhaseNavigator for the top game status bar.
 * Keeps GameStatusIndicator under the ~40KB file budget.
 */

import React from "react";
import { PhaseNavigator } from "./PhaseNavigator";
import type { PlayerID } from "../../../shared/src";

export interface GameStatusPhaseStripProps {
  currentPhase?: string;
  currentStep?: string;
  turnPlayer?: PlayerID;
  you?: PlayerID;
  isYourTurn: boolean;
  hasPriority: boolean;
  stackEmpty: boolean;
  allPlayersReady?: boolean;
  phaseAdvanceBlockReason?: string | null;
  showDamageReplacementToggle?: boolean;
  damageReplacementMode?: "minimize" | "maximize" | "custom" | "auto";
  onSetDamageReplacementMode?: (mode: "minimize" | "maximize" | "custom" | "auto") => void;
  onOpenReplacementEffectSettings?: () => void;
  onAdvanceOneStep: () => void;
  onPassPriority: () => void;
  onAdvancingChange?: (isAdvancing: boolean) => void;
  onSkipToPhase?: (targetPhase: string, targetStep?: string) => void;
}

export function GameStatusPhaseStrip(props: GameStatusPhaseStripProps) {
  return <PhaseNavigator docked {...props} />;
}

export default GameStatusPhaseStrip;
