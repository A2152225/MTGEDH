// Origin parent: client/src/App.tsx
// Cluster moved: split-card / zone / join-forces handlers plus combat memos.
// Public entry symbols: useAppPlayCombatHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import type { BattlefieldPermanent, CardFace, KnownCardRef } from "../../../shared/src";
import type { CardFaceOption } from "../components/SplitCardChoiceModal";
import { socket } from "../socket";
import { canCreatureBlockNow, isCurrentlyCreature } from "../utils/creatureUtils";
import { debugError } from "../utils/debug";

export function useAppPlayCombatHandlers(p: Record<string, any>) {
  const {
    canCreatureAttack,
    joinForcesRequest,
    kynaiosChoiceRequest,
    layout,
    optionChoiceRequest,
    playLandWithPromptSync,
    requestCastSpellWithPromptSync,
    safeView,
    setCastSpellModalOpen,
    setExileModalOpen,
    setExileModalPlayerId,
    setGraveyardModalOpen,
    setGraveyardModalPlayerId,
    setJoinForcesModalOpen,
    setJoinForcesRequest,
    setKynaiosChoiceModalOpen,
    setKynaiosChoiceRequest,
    setOptionChoiceModalOpen,
    setOptionChoiceRequest,
    setSpellToCast,
    setSplitCardData,
    setSplitCardModalOpen,
    setTemptingOfferModalOpen,
    setTemptingOfferRequest,
    splitCardData,
    temptingOfferRequest,
    you,
  } = p;
