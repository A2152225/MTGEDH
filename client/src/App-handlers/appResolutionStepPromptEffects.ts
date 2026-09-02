// Origin parent: client/src/App.tsx
// Cluster moved: leftover resolutionStepPrompt useEffect (preamble, early/late calls, queue listeners).
// Public entry symbols: useAppResolutionStepPromptEffects.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";
import { handleAppResolutionStepPromptEarly } from "./appResolutionStepPromptEarly";
import { handleAppResolutionStepPromptLate } from "./appResolutionStepPromptLate";
import { socket } from "../socket";
import { buildResolutionResponsePayload, matchesPromptFingerprint } from "../utils/loopShortcuts";

export function useAppResolutionStepPromptEffects(p: Record<string, any>) {
  const {
    confirmId,
    connected,
    discardCount,
    dismissResolutionStepUi,
    isLoopShortcutRunningRef,
    lastResolutionStepsRef,
    loopAutoAnsweredStepIdsRef,
    loopShortcutItemsRef,
    loopShortcutReplayRef,
    mulliganBottomLastSubmittedStepId,
    openConfirmFromResolutionStep,
    resolutionPlayerNames,
    safeView,
    safeViewRef,
    scheduleResolutionPromptNudge,
    setActiveResolutionPrompt,
    setAdditionalCostModalData,
    setAdditionalCostModalOpen,
    setAnyColorManaModalData,
    setAnyColorManaModalOpen,
    setBatchExploreIndividual,
    setBatchExplorePrompt,
    setCardNameChoiceModalData,
    setCardNameChoiceModalOpen,
    setCascadeModalOpen,
    setCascadePrompt,
    setCastSpellModalOpen,
    setCastingModeModalData,
    setCastingModeModalOpen,
    setClashData,
    setClashModalOpen,
    setColorChoiceModalData,
    setColorChoiceModalOpen,
    setCounterDistributionModalData,
    setCounterDistributionModalOpen,
    setCounterMovementModalData,
    setCounterMovementModalOpen,
    setCreatureTypeModalData,
    setCreatureTypeModalOpen,
    setDanceWithCalamityCastModalOpen,
    setDanceWithCalamityCastRequest,
    setDanceWithCalamityModalOpen,
    setDanceWithCalamityRequest,
    setDiscardAnyNumber,
    setDiscardCount,
    setDiscardCurrentHandSize,
    setDiscardMaxCount,
    setDiscardMaxHandSize,
    setDiscardMinCount,
    setDiscardModalOpen,
    setDiscardResolutionDescription,
    setDiscardResolutionHand,
    setDiscardResolutionReason,
    setDiscardResolutionStepId,
    setDiscardResolutionTitle,
    setExplorePrompt,
    setFatesealData,
    setFatesealModalOpen,
    setFightTargetModalData,
    setFightTargetModalOpen,
    setGraveyardSelectionModalData,
    setGraveyardSelectionModalOpen,
    setHideawayChoiceData,
    setHideawayChoiceModalOpen,
    setJoinForcesContributions,
    setJoinForcesModalOpen,
    setJoinForcesRequest,
    setJoinForcesResponded,
    setKynaiosChoiceModalOpen,
    setKynaiosChoiceRequest,
    setLibrarySearchData,
    setLibrarySearchModalOpen,
    setLifePaymentModalData,
    setLifePaymentModalOpen,
    setLifeRedistributionData,
    setLifeRedistributionModalOpen,
    setLimDulsVaultModalOpen,
    setLimDulsVaultRequest,
    setLoopShortcutStatusText,
    setManaDistributionModalData,
    setManaDistributionModalOpen,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setMinimizedResolutionStep,
    setModalSpellModalData,
    setModalSpellModalOpen,
    setMulliganBottomCount,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setMutateModalData,
    setMutateModalOpen,
    setMyPendingResolutionCount,
    setOpeningHandActionsModalOpen,
    setOpeningHandActionsStepId,
    setOpponentMayPayPrompt,
    setOpponentMayPayStepId,
    setOptionChoiceModalOpen,
    setOptionChoiceRequest,
    setPeek,
    setPendingSpellXSelection,
    setPendingTriggers,
    setPhyrexianManaModalData,
    setPhyrexianManaModalOpen,
    setPonderModalOpen,
    setPonderRequest,
    setProliferateData,
    setProliferateModalOpen,
    setResolutionPlayerChoiceModalData,
    setResolutionPlayerChoiceModalOpen,
    setReturnControlledPermanentData,
    setReturnControlledPermanentModalOpen,
    setSpellToCast,
    setSquadCostModalData,
    setSquadCostModalOpen,
    setStationCreatureSelectionData,
    setStationCreatureSelectionOpen,
    setTapUntapTargetModalData,
    setTapUntapTargetModalOpen,
    setTargetModalData,
    setTargetModalOpen,
    setTemptingOfferAcceptedBy,
    setTemptingOfferModalOpen,
    setTemptingOfferRequest,
    setTemptingOfferResponded,
    setTriggerModalOpen,
    setTriggerOrderStepId,
    setTwoPileSplitModalOpen,
    setTwoPileSplitRequest,
    setVoteData,
    setVoteModalOpen,
    stopLoopShortcutReplay,
    you,
    youRef,
  } = p;
  // Resolution Queue system handler for Kynaios, Join Forces, Tempting Offer, and Bounce Land
  // Listens for resolution step prompts and opens the appropriate modals
  React.useEffect(() => {
    const handleResolutionStepPrompt = (payload: { gameId: string; step: any }) => {
      if (payload.gameId !== safeView?.id) return;
      
      const step = payload.step;
      const stepId = String(step.id || '');

      // requestCastSpell double-emits the same payment step (STEP_ADDED + explicit).
      // Ignore duplicates the loop already auto-answered so CastSpellModal cannot re-open.
      if (
        loopShortcutReplayRef.current.running
        && stepId
        && loopAutoAnsweredStepIdsRef.current.has(stepId)
      ) {
        return;
      }

      // Server batch still used to leak resolutionStepPrompt while answering
      // payment/triggers. Never open cast-cost / choice UI mid-batch.
      if (isLoopShortcutRunningRef.current) {
        if (stepId) {
          lastResolutionStepsRef.current.set(stepId, step);
        }
        return;
      }

      lastResolutionStepsRef.current.set(stepId, step);
      setMinimizedResolutionStep((prev: any) =>
        prev && prev.stepId !== stepId ? null : prev
      );
      if (!you || !step.playerId || String(step.playerId) === String(you)) {
        setActiveResolutionPrompt({
          stepId,
          title: String(step.sourceName || step.description || 'Pending choice').slice(0, 100),
        });
      }

      const replayState = loopShortcutReplayRef.current;
      if (replayState.running && replayState.waitingPrompt) {
        const expectedPrompt = replayState.waitingPrompt;
        if (!matchesPromptFingerprint(expectedPrompt.fingerprint, step)) {
          stopLoopShortcutReplay('Loop replay paused: an unexpected prompt appeared.');
        } else {
          const response = buildResolutionResponsePayload(
            expectedPrompt.template,
            step,
            safeViewRef.current,
            youRef.current
          );

          if (response) {
            if (stepId) {
              loopAutoAnsweredStepIdsRef.current.add(stepId);
            }
            // Must use live socket.emit — originalSocketEmitRef can be null and would
            // silently skip payment, leaving the loop stuck on "Running…".
            socket.emit('submitResolutionResponse', {
              gameId: payload.gameId,
              stepId,
              selections: response.selections,
              cancelled: false,
            });
            // Keep payment / choice UI closed even if a duplicate prompt arrives later.
            setCastSpellModalOpen(false);
            setSpellToCast(null);
            setActiveResolutionPrompt(null);
            setMinimizedResolutionStep(null);
            replayState.index += 1;
            replayState.waitingPrompt = null;

            const paymentCardId = String(step?.cardId || '').trim();
            if (step?.type === 'mana_payment_choice' && (step as any)?.spellPaymentRequired === true && paymentCardId) {
              replayState.waitingForCastCardId = paymentCardId;
              replayState.castSettle = {
                cardId: paymentCardId,
                sawNonEmptyStack: false,
                startedAt: Date.now(),
              };
            }

            const nextItem = loopShortcutItemsRef.current[replayState.index];
            if (nextItem?.kind === 'resolution_response') {
              replayState.waitingPrompt = nextItem;
              setLoopShortcutStatusText(`Waiting for ${nextItem.label}...`);
              socket.emit('getMyNextResolutionStep', { gameId: payload.gameId });
            } else {
              replayState.waitingForState = true;
              setLoopShortcutStatusText(
                `Waiting for stack/prompts to clear (iteration ${replayState.iteration + 1} of ${replayState.totalIterations})...`
              );
            }
            return;
          }

          stopLoopShortcutReplay('Loop replay paused: a recorded prompt choice is no longer legal.');
        }
      }

      handleAppResolutionStepPromptEarly(step, payload, {
        discardCount,
        mulliganBottomLastSubmittedStepId,
        openConfirmFromResolutionStep,
        safeView,
        safeViewRef,
        setAnyColorManaModalData,
        setAnyColorManaModalOpen,
        setCastSpellModalOpen,
        setCounterDistributionModalData,
        setCounterDistributionModalOpen,
        setCounterMovementModalData,
        setCounterMovementModalOpen,
        setDiscardAnyNumber,
        setDiscardCount,
        setDiscardCurrentHandSize,
        setDiscardMaxCount,
        setDiscardMaxHandSize,
        setDiscardMinCount,
        setDiscardModalOpen,
        setDiscardResolutionDescription,
        setDiscardResolutionHand,
        setDiscardResolutionReason,
        setDiscardResolutionStepId,
        setDiscardResolutionTitle,
        setFightTargetModalData,
        setFightTargetModalOpen,
        setGraveyardSelectionModalData,
        setGraveyardSelectionModalOpen,
        setKynaiosChoiceModalOpen,
        setKynaiosChoiceRequest,
        setLifePaymentModalData,
        setLifePaymentModalOpen,
        setManaDistributionModalData,
        setManaDistributionModalOpen,
        setMayAbilityModalData,
        setMayAbilityModalOpen,
        setMulliganBottomCount,
        setMulliganBottomModalOpen,
        setMulliganBottomStepId,
        setMutateModalData,
        setMutateModalOpen,
        setOpponentMayPayPrompt,
        setOpponentMayPayStepId,
        setOptionChoiceModalOpen,
        setOptionChoiceRequest,
        setPendingSpellXSelection,
        setPhyrexianManaModalData,
        setPhyrexianManaModalOpen,
        setReturnControlledPermanentData,
        setReturnControlledPermanentModalOpen,
        setSpellToCast,
        setStationCreatureSelectionData,
        setStationCreatureSelectionOpen,
        setTapUntapTargetModalData,
        setTapUntapTargetModalOpen,
        setTargetModalData,
        setTargetModalOpen,
        setTwoPileSplitModalOpen,
        setTwoPileSplitRequest,
        you,
      });

      handleAppResolutionStepPromptLate(step, payload, {
        confirmId,
        resolutionPlayerNames,
        safeView,
        setAdditionalCostModalData,
        setAdditionalCostModalOpen,
        setBatchExploreIndividual,
        setBatchExplorePrompt,
        setCardNameChoiceModalData,
        setCardNameChoiceModalOpen,
        setCascadeModalOpen,
        setCascadePrompt,
        setCastingModeModalData,
        setCastingModeModalOpen,
        setClashData,
        setClashModalOpen,
        setColorChoiceModalData,
        setColorChoiceModalOpen,
        setCreatureTypeModalData,
        setCreatureTypeModalOpen,
        setDanceWithCalamityCastModalOpen,
        setDanceWithCalamityCastRequest,
        setDanceWithCalamityModalOpen,
        setDanceWithCalamityRequest,
        setExplorePrompt,
        setFatesealData,
        setFatesealModalOpen,
        setHideawayChoiceData,
        setHideawayChoiceModalOpen,
        setJoinForcesContributions,
        setJoinForcesModalOpen,
        setJoinForcesRequest,
        setJoinForcesResponded,
        setLibrarySearchData,
        setLibrarySearchModalOpen,
        setLifeRedistributionData,
        setLifeRedistributionModalOpen,
        setLimDulsVaultModalOpen,
        setLimDulsVaultRequest,
        setMayAbilityModalData,
        setMayAbilityModalOpen,
        setModalSpellModalData,
        setModalSpellModalOpen,
        setOpeningHandActionsModalOpen,
        setOpeningHandActionsStepId,
        setPeek,
        setPendingTriggers,
        setPonderModalOpen,
        setPonderRequest,
        setProliferateData,
        setProliferateModalOpen,
        setResolutionPlayerChoiceModalData,
        setResolutionPlayerChoiceModalOpen,
        setSquadCostModalData,
        setSquadCostModalOpen,
        setTargetModalData,
        setTargetModalOpen,
        setTemptingOfferAcceptedBy,
        setTemptingOfferModalOpen,
        setTemptingOfferRequest,
        setTemptingOfferResponded,
        setTriggerModalOpen,
        setTriggerOrderStepId,
        setVoteData,
        setVoteModalOpen,
        you,
      });
    };

    const handleResolutionStepCancelled = (payload: { gameId: string; stepId?: string }) => {
      if (payload.gameId !== safeView?.id) return;
      lastResolutionStepsRef.current.delete(String(payload.stepId || ''));
      setActiveResolutionPrompt(null);
      dismissResolutionStepUi();
    };

    const handleNoResolutionStep = (payload: { gameId?: string }) => {
      if (payload.gameId !== safeView?.id) return;
      // During reconnect / before join completes, the server may emit noResolutionStep
      // with NOT_IN_GAME. Dismissing here closes choice/payment UI that is still pending.
      if (!socket.connected) return;
      setMyPendingResolutionCount(0);
      setActiveResolutionPrompt(null);
      dismissResolutionStepUi();
    };

    const handleResolutionQueueChanged = (payload: {
      gameId?: string;
      hasPending?: boolean;
      myPendingCount?: number;
    }) => {
      if (payload.gameId !== safeView?.id) return;
      const pendingForMe = Number(payload.myPendingCount ?? 0);
      setMyPendingResolutionCount(pendingForMe);
      if (pendingForMe === 0) {
        // Same reconnect race: an empty count while disconnected is not authoritative.
        if (!socket.connected) return;
        setActiveResolutionPrompt(null);
        dismissResolutionStepUi();
      }
      if (pendingForMe > 0) {
        scheduleResolutionPromptNudge(payload.gameId!);
      }
    };

    const handleGameResumeProgress = (payload: {
      gameId?: string;
      isRestoring?: boolean;
    }) => {
      if (!payload?.gameId || payload.gameId !== safeView?.id) return;
      if (payload.isRestoring) return;
      lastResolutionStepsRef.current.clear();
      setActiveResolutionPrompt(null);
      dismissResolutionStepUi();
      scheduleResolutionPromptNudge(payload.gameId);
    };
    
    socket.on("resolutionStepPrompt", handleResolutionStepPrompt);
    socket.on("resolutionStepCancelled", handleResolutionStepCancelled);
    socket.on("noResolutionStep", handleNoResolutionStep);
    socket.on("resolutionQueueChanged", handleResolutionQueueChanged);
    socket.on("gameResumeProgress", handleGameResumeProgress);
    
    return () => {
      socket.off("resolutionStepPrompt", handleResolutionStepPrompt);
      socket.off("resolutionStepCancelled", handleResolutionStepCancelled);
      socket.off("noResolutionStep", handleNoResolutionStep);
      socket.off("resolutionQueueChanged", handleResolutionQueueChanged);
      socket.off("gameResumeProgress", handleGameResumeProgress);
    };
  }, [safeView?.id, openConfirmFromResolutionStep, you, mulliganBottomLastSubmittedStepId, dismissResolutionStepUi, scheduleResolutionPromptNudge]);
}
