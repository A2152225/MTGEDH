// Origin parent: client/src/App.tsx
// Cluster moved: cast/combat/resolution modal confirm handlers (handleCastSpellConfirm through playLandWithPromptSync)
// Public entry symbols: useAppPlayModalHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";
import type { PaymentItem } from "../../../shared/src";
import type { CombatControlDeclarations } from "../components/CombatControlModal";
import type { AttackerSelection, BlockerSelection } from "../components/CombatSelectionModal";
import { socket } from "../socket";
import { debug } from "../utils/debug";
import { buildPlayLandRequestPayload } from "../utils/playLandRequestPayload";

export function useAppPlayModalHandlers(p: Record<string, any>) {
  const {
    clashData,
    combatControlMode,
    combatMode,
    fatesealData,
    hideawayChoiceData,
    ignoredTriggerSources,
    librarySearchData,
    lifeRedistributionData,
    openingHandActionsStepId,
    proliferateData,
    returnControlledPermanentData,
    safeView,
    setCastSpellModalOpen,
    setClashData,
    setClashModalOpen,
    setCombatControlModalOpen,
    setCombatModalError,
    setCombatModalMinimized,
    setFatesealData,
    setFatesealModalOpen,
    setHideawayChoiceData,
    setHideawayChoiceModalOpen,
    setIgnoredTriggerSources,
    setLibrarySearchData,
    setLibrarySearchModalOpen,
    setLifeRedistributionData,
    setLifeRedistributionModalOpen,
    setOpeningHandActionsModalOpen,
    setOpeningHandActionsStepId,
    setPendingTriggers,
    setProliferateData,
    setProliferateModalOpen,
    setReturnControlledPermanentData,
    setReturnControlledPermanentModalOpen,
    setSpellToCast,
    setTargetModalData,
    setTargetModalOpen,
    setTriggerModalOpen,
    setTriggerOrderStepId,
    setUndoModalOpen,
    setUndoRequestData,
    setVoteData,
    setVoteModalOpen,
    spellToCast,
    targetModalData,
    triggerOrderStepId,
    undoRequestData,
    voteData,
  } = p;
  // Handle cast spell confirmation from modal - works for both hand and commander spells
  const handleCastSpellConfirm = (
    payment: PaymentItem[],
    alternateCostId?: string,
    xValue?: number,
    convokeTappedCreatures?: string[],
    sneakReturnedCreatureId?: string,
    webSlingingReturnedCreatureId?: string,
  ) => {
    if (!safeView || !spellToCast) return;

    // Resolution Queue spell payment: respond to the step instead of emitting payment completion directly.
    const paymentStepId = (spellToCast as any).paymentStepId as string | undefined;
    if (paymentStepId) {
      socket.emit('submitResolutionResponse', {
        gameId: safeView.id,
        stepId: paymentStepId,
        selections: {
          payment: payment.length > 0 ? payment : undefined,
          xValue,
          alternateCostId,
          convokeTappedCreatures,
          sneakReturnedCreatureId,
          webSlingingReturnedCreatureId,
        },
        cancelled: false,
      });
      setCastSpellModalOpen(false);
      setSpellToCast(null);
      return;
    }
    
    debug(2, `[Client] Casting ${spellToCast.isCommander ? 'commander' : 'spell'}: ${spellToCast.cardName} with payment:`, payment);
    if (convokeTappedCreatures && convokeTappedCreatures.length > 0) {
      debug(2, `[Client] Convoke: tapping ${convokeTappedCreatures.length} creature(s):`, convokeTappedCreatures);
    }
    
    if (spellToCast.isCommander) {
      // Cast commander from command zone
      socket.emit("castCommander", {
        gameId: safeView.id,
        commanderNameOrId: spellToCast.cardId,
        payment: payment.length > 0 ? payment : undefined,
      });
    } else if (spellToCast.effectId) {
      // MTG-compliant flow: targets were already selected, now completing with payment
      // Use completeCastSpell to finalize
      const payload = {
        gameId: safeView.id,
        cardId: spellToCast.cardId,
        targets: spellToCast.targets,
        payment: payment.length > 0 ? payment : undefined,
        effectId: spellToCast.effectId,
        xValue,
        alternateCostId,
        convokeTappedCreatures,
        sneakReturnedCreatureId,
        webSlingingReturnedCreatureId,
      };
      socket.emit("completeCastSpell", payload);
    } else {
      // Legacy flow: direct cast from hand (will check targets on server)
      const payload = {
        gameId: safeView.id,
        cardId: spellToCast.cardId,
        payment: payment.length > 0 ? payment : undefined,
        xValue,
        alternateCostId,
        sneakReturnedCreatureId,
        webSlingingReturnedCreatureId,
        convokeTappedCreatures,
      };
      socket.emit("castSpellFromHand", payload);
    }
    
    setCastSpellModalOpen(false);
    setSpellToCast(null);
  };

  const handleCastSpellCancel = () => {
    // If this was a Resolution Queue spell payment step, cancel via submitResolutionResponse.
    if (safeView && spellToCast && (spellToCast as any).paymentStepId) {
      socket.emit('submitResolutionResponse', {
        gameId: safeView.id,
        stepId: String((spellToCast as any).paymentStepId),
        selections: {},
        cancelled: true,
      });
    }
    setCastSpellModalOpen(false);
    setSpellToCast(null);
  };

  // Handle casting commander through the shared spell-cast request flow
  const handleCastCommander = (commanderId: string, commanderName: string, _manaCost?: string, _tax?: number) => {
    // Defensive validation: ensure commanderId is not undefined or empty
    if (!commanderId || (typeof commanderId === 'string' && commanderId.trim() === '')) {
      console.error('[handleCastCommander] Invalid commanderId:', { commanderId, commanderName });
      alert(`Cannot cast commander: Invalid commander ID. This may be a bug - please refresh and try again.`);
      return;
    }

    if (!safeView) return;

    requestCastSpellWithPromptSync({
      gameId: safeView.id,
      cardId: commanderId,
      fromZone: 'command',
    });
  };

  // Combat handlers
  const handleDeclareAttackers = (attackers: AttackerSelection[]) => {
    if (!safeView) return;
    socket.emit("declareAttackers", {
      gameId: safeView.id,
      attackers,
    });
    // Keep the modal open until the server either commits attackers or queues attack-tax payment.
    setCombatModalMinimized(false);
  };

  const handleDeclareBlockers = (blockers: BlockerSelection[]) => {
    if (!safeView) return;
    setCombatModalError(null);
    socket.emit("declareBlockers", {
      gameId: safeView.id,
      blockers,
    });
    // Do not close immediately. If the server rejects the blocks, we need to keep (or re-open)
    // the modal so the defending player can correct them.
  };

  const handleSkipCombat = () => {
    if (!safeView) return;
    if (combatMode === 'attackers') {
      socket.emit("skipDeclareAttackers", { gameId: safeView.id });
      // Keep the modal open until the server advances the step. Skip is rejected
      // when goaded / must-attack creatures are able to attack.
    } else {
      setCombatModalError(null);
      socket.emit("skipDeclareBlockers", { gameId: safeView.id });
      // Same rationale as handleDeclareBlockers: let the server close this via blockersDeclaredBy.
    }
  };

  const handleDeclareControlledCombat = (selections: CombatControlDeclarations) => {
    if (!safeView) return;

    if (combatControlMode === 'attackers') {
      socket.emit('declareControlledAttackers', {
        gameId: safeView.id,
        attackers: selections.attackers || [],
      });
    } else {
      socket.emit('declareControlledBlockers', {
        gameId: safeView.id,
        blockers: selections.blockers || [],
      });
    }

    setCombatControlModalOpen(false);
  };

  // Return-controlled-permanent handler - player selects which permanent to return
  const handleReturnControlledPermanentSelect = (permanentId: string) => {
    if (!safeView || !returnControlledPermanentData) return;
    
    const stepId = (returnControlledPermanentData as any).stepId;
    if (!stepId) {
      debug(1, '[ReturnControlledPermanent] Missing stepId - prompt must use resolution queue');
      return;
    }
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: permanentId,
      cancelled: false,
    });
    debug(2, '[ReturnControlledPermanent] Completed resolution step via resolution queue');
    
    setReturnControlledPermanentModalOpen(false);
    setReturnControlledPermanentData(null);
  };

  const handleHideawayChoiceConfirm = (selectedIds: string[]) => {
    if (!safeView || !hideawayChoiceData) return;

    const stepId = hideawayChoiceData.stepId;
    if (!stepId || selectedIds.length === 0) {
      debug(1, '[HideawayChoice] Missing stepId or selection - prompt must use resolution queue');
      return;
    }

    const selectedId = String(selectedIds[0] || '').trim();
    if (hideawayChoiceData.pendingDraftCardId && Array.isArray(hideawayChoiceData.attachOptions)) {
      socket.emit('submitResolutionResponse', {
        gameId: safeView.id,
        stepId,
        selections: { cardId: hideawayChoiceData.pendingDraftCardId, attachId: selectedId },
        cancelled: false,
      });
      setHideawayChoiceModalOpen(false);
      setHideawayChoiceData(null);
      return;
    }

    const selectedCard = (hideawayChoiceData.cards || []).find(
      (card: any) => String(card.cardId || card.id || '') === selectedId,
    );
    const attachOptions = Array.isArray(selectedCard?.attachOptions) ? selectedCard.attachOptions : [];
    if (attachOptions.length > 1) {
      setHideawayChoiceData({
        ...hideawayChoiceData,
        pendingDraftCardId: selectedId,
        attachOptions,
        title: `Attach ${selectedCard?.cardName || 'Aura'}`,
        subtitle: 'Choose a legal host or player',
        confirmButtonText: 'Attach',
      });
      return;
    }

    socket.emit('submitResolutionResponse', {
      gameId: safeView.id,
      stepId,
      selections:
        attachOptions.length === 1
          ? { cardId: selectedId, attachId: attachOptions[0].cardId }
          : selectedId,
      cancelled: false,
    });
    debug(2, '[HideawayChoice] Completed resolution step via resolution queue');

    setHideawayChoiceModalOpen(false);
    setHideawayChoiceData(null);
  };

  const handleHideawayChoiceCancel = () => {
    if (!safeView || !hideawayChoiceData?.stepId) return;

    socket.emit('submitResolutionResponse', {
      gameId: safeView.id,
      stepId: hideawayChoiceData.stepId,
      selections: [],
      cancelled: true,
    });

    setHideawayChoiceModalOpen(false);
    setHideawayChoiceData(null);
  };

  // Proliferate handler - player selects targets to proliferate
  const handleProliferateConfirm = (selectedIds: string[]) => {
    if (!safeView || !proliferateData) return;
    
    // Use the resolution queue system
    if (!proliferateData.stepId) {
      console.error('[Proliferate] Missing stepId - must use resolution queue');
      return;
    }
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: proliferateData.stepId,
      selections: selectedIds,
      cancelled: false,
    });
    
    setProliferateModalOpen(false);
    setProliferateData(null);
  };
  
  const handleLifeRedistributionConfirm = (payload: { lifeByPlayerId: Record<string, number> }) => {
    if (!safeView || !lifeRedistributionData) return;

    if (!lifeRedistributionData.stepId) {
      console.error('[LifeRedistribution] Missing stepId - must use resolution queue');
      return;
    }

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: lifeRedistributionData.stepId,
      selections: payload,
      cancelled: false,
    });

    setLifeRedistributionModalOpen(false);
    setLifeRedistributionData(null);
  };
  
  // Fateseal handler - player orders opponent's library
  const handleFatesealConfirm = (payload: { keepTopOrder: string[]; bottomOrder: string[] }) => {
    if (!safeView || !fatesealData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: fatesealData.stepId,
      selections: payload,
      cancelled: false,
    });
    
    setFatesealModalOpen(false);
    setFatesealData(null);
  };
  
  // Clash handler - player chooses whether to put card on bottom
  const handleClashConfirm = (putOnBottom: boolean) => {
    if (!safeView || !clashData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: clashData.stepId,
      selections: putOnBottom,
      cancelled: false,
    });
    
    setClashModalOpen(false);
    setClashData(null);
  };
  
  // Vote handler - player submits their vote
  const handleVoteConfirm = (choice: string) => {
    if (!safeView || !voteData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: voteData.stepId,
      selections: choice,
      cancelled: false,
    });
    
    setVoteModalOpen(false);
    setVoteData(null);
  };

  // Handle "ignore this source" from stack UI - for triggers already on stack
  const handleIgnoreTriggerSourceFromStack = (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => {
    if (!safeView) return;
    const sourceKey = sourceId || sourceName;
    setIgnoredTriggerSources((prev: any) => {
      const next = new Map(prev);
      next.set(sourceKey, { sourceId: sourceId || undefined, sourceName, count: 0, effect, imageUrl });
      return next;
    });

    if (sourceId) {
      socket.emit('yieldToTriggerSource', {
        gameId: safeView.id,
        sourceId,
        sourceName,
      });
    }
  };

  // Stop ignoring a trigger source
  const handleStopIgnoringSource = (sourceKey: string) => {
    if (!safeView) {
      setIgnoredTriggerSources((prev: any) => {
        const next = new Map(prev);
        next.delete(sourceKey);
        return next;
      });
      return;
    }

    const entry = ignoredTriggerSources.get(sourceKey);
    const sourceId = entry?.sourceId;
    if (sourceId) {
      socket.emit('unyieldToTriggerSource', {
        gameId: safeView.id,
        sourceId,
      });
    }
    setIgnoredTriggerSources((prev: any) => {
      const next = new Map(prev);
      next.delete(sourceKey);
      return next;
    });
  };

  // Handle ordering of multiple simultaneous triggers
  const handleOrderTriggersConfirm = (orderedTriggerIds: string[]) => {
    if (!safeView) return;

    // Trigger ordering is handled via Resolution Queue now.
    if (triggerOrderStepId) {
      socket.emit('submitResolutionResponse', {
        gameId: safeView.id,
        stepId: triggerOrderStepId,
        selections: orderedTriggerIds,
        cancelled: false,
      });
      setTriggerOrderStepId(null);
      setPendingTriggers((prev: any) => prev.filter((t: any) => !orderedTriggerIds.includes(t.id)));
      setTriggerModalOpen(false);
      return;
    }

    // No active trigger-order resolution step; just close ordering UI.
    setPendingTriggers((prev: any) => prev.filter((t: any) => !orderedTriggerIds.includes(t.id)));
    setTriggerModalOpen(false);
  };

  // Library search handlers (Tutor effects)
  const handleLibrarySearchConfirm = (
    selectedCardIds: string[], 
    moveTo: string,
    splitAssignments?: { toBattlefield: string[]; toHand: string[] }
  ) => {
    if (!safeView || !librarySearchData) return;
    const resolvedMoveTo = librarySearchData.splitDestination ? moveTo : librarySearchData.moveTo;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: (librarySearchData as any).stepId,
      selections: selectedCardIds,
      cancelled: false,
      // Include split assignments for Cultivate/Kodama's Reach effects
      splitAssignments,
      moveTo: resolvedMoveTo,
    });
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  const handleLibrarySearchCancel = () => {
    if (!safeView || !librarySearchData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: (librarySearchData as any).stepId,
      selections: [],
      cancelled: true,
    });
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  const handleLibrarySearchCastWhileSearching = (cardId: string) => {
    if (!safeView || !librarySearchData) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: (librarySearchData as any).stepId,
      selections: {
        action: 'cast_panglacial_wurm',
        cardId,
      },
      cancelled: false,
    });
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  // Target selection handlers
  const handleTargetConfirm = (selectedTargetIds: string[]) => {
    if (!safeView || !targetModalData) return;

    if (targetModalData.stepId) {
      socket.emit("submitResolutionResponse", {
        gameId: safeView.id,
        stepId: targetModalData.stepId,
        selections: selectedTargetIds,
        cancelled: false,
      });
    }
    setTargetModalOpen(false);
    setTargetModalData(null);
  };

  const handleTargetCancel = () => {
    if (!safeView) return;

    if (targetModalData?.stepId) {
      socket.emit("cancelResolutionStep", {
        gameId: safeView.id,
        stepId: targetModalData.stepId,
      });
    }
    setTargetModalOpen(false);
    setTargetModalData(null);
  };

  // Opening hand actions handlers (Leylines)
  const handleOpeningHandActionsConfirm = (selectedCardIds: string[]) => {
    if (!safeView) return;
    if (!openingHandActionsStepId) return;

    socket.emit('submitResolutionResponse', {
      gameId: safeView.id,
      stepId: openingHandActionsStepId,
      selections: selectedCardIds,
      cancelled: false,
    });
    setOpeningHandActionsModalOpen(false);
    setOpeningHandActionsStepId(null);
  };

  const handleOpeningHandActionsSkip = () => {
    if (!safeView) return;
    if (!openingHandActionsStepId) return;

    socket.emit('submitResolutionResponse', {
      gameId: safeView.id,
      stepId: openingHandActionsStepId,
      selections: [],
      cancelled: true,
    });
    setOpeningHandActionsModalOpen(false);
    setOpeningHandActionsStepId(null);
  };

  // Undo handlers
  const handleUndoApprove = () => {
    if (!safeView || !undoRequestData) return;
    socket.emit("respondUndo", {
      gameId: safeView.id,
      undoId: undoRequestData.undoId,
      approved: true,
    });
  };

  const handleUndoReject = () => {
    if (!safeView || !undoRequestData) return;
    socket.emit("respondUndo", {
      gameId: safeView.id,
      undoId: undoRequestData.undoId,
      approved: false,
    });
    setUndoModalOpen(false);
    setUndoRequestData(null);
  };

  const handleUndoCancel = () => {
    if (!safeView || !undoRequestData) return;
    socket.emit("cancelUndo", {
      gameId: safeView.id,
      undoId: undoRequestData.undoId,
    });
    setUndoModalOpen(false);
    setUndoRequestData(null);
  };

  const handleRequestUndo = (scope: 'step' | 'phase' | 'previousPhase' | 'turn') => {
    if (!safeView) return;

    switch (scope) {
      case 'step':
        socket.emit('requestUndoToStep', { gameId: safeView.id });
        break;
      case 'phase':
        socket.emit('requestUndoToPhase', { gameId: safeView.id });
        break;
      case 'previousPhase':
        socket.emit('requestUndoToPreviousPhase', { gameId: safeView.id });
        break;
      case 'turn':
        socket.emit('requestUndoToTurn', { gameId: safeView.id });
        break;
    }
  };

  const requestCastSpellWithPromptSync = React.useCallback((payload: {
    gameId: string;
    cardId: string;
    faceIndex?: number;
    fromZone?: 'exile' | 'hand' | 'graveyard' | 'library' | 'command';
  }) => {
    socket.emit('requestCastSpell', payload);

    window.setTimeout(() => {
      socket.emit('getMyNextResolutionStep', { gameId: payload.gameId });
    }, 0);
  }, []);

  const playLandWithPromptSync = React.useCallback((payload: {
    gameId: string;
    cardId: string;
    selectedFace?: number;
    fromZone?: 'exile' | 'hand' | 'graveyard' | 'library';
  }) => {
    socket.emit('playLand', buildPlayLandRequestPayload(payload));

    window.setTimeout(() => {
      socket.emit('getMyNextResolutionStep', { gameId: payload.gameId });
    }, 0);
  }, []);


  return {
    handleCastSpellConfirm,
    handleCastSpellCancel,
    handleCastCommander,
    handleDeclareAttackers,
    handleDeclareBlockers,
    handleSkipCombat,
    handleDeclareControlledCombat,
    handleReturnControlledPermanentSelect,
    handleHideawayChoiceConfirm,
    handleHideawayChoiceCancel,
    handleProliferateConfirm,
    handleLifeRedistributionConfirm,
    handleFatesealConfirm,
    handleClashConfirm,
    handleVoteConfirm,
    handleIgnoreTriggerSourceFromStack,
    handleStopIgnoringSource,
    handleOrderTriggersConfirm,
    handleLibrarySearchConfirm,
    handleLibrarySearchCancel,
    handleLibrarySearchCastWhileSearching,
    handleTargetConfirm,
    handleTargetCancel,
    handleOpeningHandActionsConfirm,
    handleOpeningHandActionsSkip,
    handleUndoApprove,
    handleUndoReject,
    handleUndoCancel,
    handleRequestUndo,
    requestCastSpellWithPromptSync,
    playLandWithPromptSync,
  };
}
