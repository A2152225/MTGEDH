// Origin parent: client/src/App.tsx
// Cluster moved: late play resolution-modal state
// Public entry symbols: useAppPlayStateLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo, useState } from "react";
import type { KnownCardRef, ManaPool } from "../../../shared/src";
import { useAppResolutionPromptHelpers } from "./appResolutionPromptHelpers";
import type { CastingMode } from "../components/CastingModeSelectionModal";
import type { GraveyardCard } from "../components/GraveyardSelectionModal";
import type { IgnoredCard } from "../components/IgnoredCardsPanel";
import type { JoinForcesRequest } from "../components/JoinForcesModal";
import type { KynaiosChoiceRequest } from "../components/KynaiosChoiceModal";
import type { MayAbilityModalData } from "../components/MayAbilityModal";
import type { SpellMode } from "../components/ModalSpellSelectionModal";
import type { MutateTarget } from "../components/MutateTargetModal";
import type { OptionChoiceRequest } from "../components/OptionChoiceModal";
import type { PeekCard, PonderVariant } from "../components/PonderModal";
import type { PlayerTarget } from "../components/PlayerTargetSelectionModal";
import type { OrderingMode, ReplacementEffectItem } from "../components/ReplacementEffectOrderModal";
import type { StationCreature, StationInfo } from "../components/StationCreatureSelectionModal";
import type { TemptingOfferRequest } from "../components/TemptingOfferModal";
import type { TwoPileSplitRequest } from "../components/TwoPileSplitModal";
import { useIsTouch } from "../hooks/useIsTouch";
import { useMobilePlayLayout } from "../hooks/useMobilePlayLayout";
import { useViewport } from "../hooks/useViewport";

export function useAppPlayStateLate(p: Record<string, any>) {
  const {
    confirmId,
    priority,
    safeView,
    you,
  } = p;
