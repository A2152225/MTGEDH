// Origin parent: client/src/App.tsx
// Cluster moved: early play modal and combat state
// Public entry symbols: useAppPlayStateEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useRef, useState } from "react";
import type { PaymentCostAdjustment, KnownCardRef } from "../../../shared/src";
import type { ImagePref } from "../components/BattlefieldGrid";
import type { ExploreResult } from "../components/BatchExploreModal";
import type { AlternateCost } from "../components/CastSpellModal";
import type { ExploreCard } from "../components/ExploreModal";
import type { LifeRedistributionPlayer } from "../components/LifeRedistributionModal";
import type { MobilePlaySheet } from "../components/MobilePlaySheets";
import type { OpponentMayPayPrompt } from "../components/OpponentMayPayModal";
import type { ProliferateTarget } from "../components/ProliferateModal";
import type { CardFaceOption } from "../components/SplitCardChoiceModal";
import type { TargetOption, TargetSelectionGroup } from "../components/TargetSelectionModal";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import type { UndoBoundaryPreview, UndoRequestData } from "../components/UndoRequestModal";
import type { AppearanceSettings } from "../utils/appearanceSettings";
import { loadAppearanceSettings, saveAppearanceSettings } from "../utils/appearanceSettings";

export function useAppPlayStateEarly(p: Record<string, any>) {
  const {
    safeView,
    you,
  } = p;
