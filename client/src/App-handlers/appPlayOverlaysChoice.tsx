// Origin parent: client/src/App.tsx
// Cluster moved: triggered-ability through phyrexian-mana overlays
// Public entry symbols: renderAppPlayOverlaysChoice.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import type { KnownCardRef } from "../../../shared/src";
import { TriggeredAbilityModal } from "../components/TriggeredAbilityModal";
import { MulliganBottomModal } from "../components/MulliganBottomModal";
import { DiscardSelectionModal } from "../components/DiscardSelectionModal";
import { OpeningHandActionsModal } from "../components/OpeningHandActionsModal";
import { LibrarySearchModal } from "../components/LibrarySearchModal";
import { TargetSelectionModal } from "../components/TargetSelectionModal";
import { UndoRequestModal } from "../components/UndoRequestModal";
import { SplitCardChoiceModal } from "../components/SplitCardChoiceModal";
import { CreatureTypeSelectModal } from "../components/CreatureTypeSelectModal";
import { LifePaymentModal } from "../components/LifePaymentModal";
import { ColorChoiceModal } from "../components/ColorChoiceModal";
import { CardNameChoiceModal } from "../components/CardNameChoiceModal";
import { AnyColorManaModal } from "../components/AnyColorManaModal";
import { PhyrexianManaChoiceModal } from "../components/PhyrexianManaChoiceModal";

export function renderAppPlayOverlaysChoice(p: Record<string, any>) {
  const {
    anyColorManaModalData,
    anyColorManaModalOpen,
    cardNameChoiceModalData,
    cardNameChoiceModalOpen,
    colorChoiceModalData,
    colorChoiceModalOpen,
    confirmId,
    creatureTypeModalData,
    creatureTypeModalOpen,
    discardAnyNumber,
    discardCount,
    discardCurrentHandSize,
    discardMaxCount,
    discardMaxHandSize,
    discardMinCount,
    discardModalOpen,
    discardResolutionDescription,
    discardResolutionHand,
    discardResolutionReason,
    discardResolutionStepId,
    discardResolutionTitle,
    handleLibrarySearchCancel,
    handleLibrarySearchCastWhileSearching,
    handleLibrarySearchConfirm,
    handleOpeningHandActionsConfirm,
    handleOpeningHandActionsSkip,
    handleOrderTriggersConfirm,
    handleSplitCardCancel,
    handleSplitCardChoose,
    handleTargetCancel,
    handleTargetConfirm,
    handleUndoApprove,
    handleUndoCancel,
    handleUndoReject,
    layout,
    librarySearchData,
    librarySearchModalOpen,
    lifePaymentModalData,
    lifePaymentModalOpen,
    mulliganBottomCount,
    mulliganBottomModalOpen,
    mulliganBottomStepId,
    openingHandActionsModalOpen,
    openingHandActionsStepId,
    pendingTriggers,
    phyrexianManaModalData,
    phyrexianManaModalOpen,
    resolutionPromptOpen,
    safeView,
    setAnyColorManaModalData,
    setAnyColorManaModalOpen,
    setCardNameChoiceModalData,
    setCardNameChoiceModalOpen,
    setColorChoiceModalData,
    setColorChoiceModalOpen,
    setCreatureTypeModalData,
    setCreatureTypeModalOpen,
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
    setLifePaymentModalData,
    setLifePaymentModalOpen,
    setMulliganBottomCount,
    setMulliganBottomLastSubmittedStepId,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setPhyrexianManaModalData,
    setPhyrexianManaModalOpen,
    splitCardData,
    splitCardModalOpen,
    targetModalData,
    targetModalOpen,
    triggerModalOpen,
    triggerOrderStepId,
    undoModalOpen,
    undoRequestData,
    you,
  } = p;
  return (
    <>

      {/* Triggered Ability Modal */}
      <TriggeredAbilityModal
        open={resolutionPromptOpen(triggerModalOpen, triggerOrderStepId)}
        triggers={pendingTriggers}
        onOrderConfirm={handleOrderTriggersConfirm}
      />

      {/* Mulligan Bottom Selection Modal (London Mulligan) */}
      <MulliganBottomModal
        open={resolutionPromptOpen(mulliganBottomModalOpen, mulliganBottomStepId)}
        hand={useMemo(() => {
          if (!safeView || !you) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          return hand.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, you])}
        cardsToBottom={mulliganBottomCount}
        onConfirm={(cardIds) => {
          if (safeView) {
            if (!mulliganBottomStepId) {
              console.warn('[mulligan] Missing resolution stepId; cannot submit HAND_TO_BOTTOM selection.');
              return;
            }
            setMulliganBottomLastSubmittedStepId(mulliganBottomStepId);
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: mulliganBottomStepId,
              selections: cardIds,
              cancelled: false,
            });
          }
          setMulliganBottomModalOpen(false);
          setMulliganBottomCount(0);
          setMulliganBottomStepId(null);
        }}
        onCancel={() => {
          // Can't cancel - must select cards
          // But allow closing to re-open later if needed
          setMulliganBottomModalOpen(false);
        }}
      />

      {/* Cleanup Step Discard Selection Modal */}
      <DiscardSelectionModal
        open={resolutionPromptOpen(discardModalOpen, discardResolutionStepId)}
        hand={useMemo(() => {
          if (discardResolutionHand.length > 0) {
            return discardResolutionHand;
          }
          if (!safeView || !you) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          // Accept ChoiceOption-shaped zone cards (label/imageUrl) as well as full KnownCardRefs.
          return hand
            .map((c: any) => {
              if (!c || !c.id) return null;
              const name = String(c.name || c.label || '').trim();
              if (!name) return null;
              const imageUrl = c.imageUrl || c.image_url || c.image_uris?.normal || c.image_uris?.small;
              return {
                ...c,
                name,
                ...(imageUrl && !c.image_uris
                  ? { image_uris: { normal: imageUrl, small: imageUrl } }
                  : {}),
              } as KnownCardRef;
            })
            .filter((c: KnownCardRef | null): c is KnownCardRef => Boolean(c));
        }, [discardResolutionHand, safeView, you])}
        discardCount={discardCount}
        minDiscardCount={discardMinCount}
        maxDiscardCount={discardMaxCount}
        anyNumberDiscard={discardAnyNumber}
        maxHandSize={discardMaxHandSize}
        currentHandSize={discardCurrentHandSize ?? undefined}
        reason={discardResolutionReason}
        title={discardResolutionTitle ?? undefined}
        description={discardResolutionDescription ?? undefined}
        onConfirm={(cardIds) => {
          if (safeView) {
            if (!discardResolutionStepId) {
              console.warn('[discard] Missing resolution stepId; cannot submit discard selection.');
              return;
            }

            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: discardResolutionStepId,
              selections: cardIds,
              cancelled: false,
            });
          }
          setDiscardModalOpen(false);
          setDiscardCount(0);
          setDiscardMinCount(0);
          setDiscardMaxCount(0);
          setDiscardAnyNumber(false);
          setDiscardMaxHandSize(7);
          setDiscardCurrentHandSize(null);
          setDiscardResolutionHand([]);
          setDiscardResolutionStepId(null);
          setDiscardResolutionReason('cleanup');
          setDiscardResolutionTitle(null);
          setDiscardResolutionDescription(null);
        }}
      />

      {/* Opening Hand Actions Modal (Leylines) */}
      <OpeningHandActionsModal
        open={resolutionPromptOpen(openingHandActionsModalOpen, openingHandActionsStepId)}
        hand={useMemo(() => {
          if (!safeView || !you) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          return hand.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, you])}
        onConfirm={handleOpeningHandActionsConfirm}
        onSkip={handleOpeningHandActionsSkip}
      />

      {/* Library Search Modal (Tutors) */}
      <LibrarySearchModal
        open={resolutionPromptOpen(librarySearchModalOpen, librarySearchData?.stepId)}
        cards={librarySearchData?.cards || []}
        nonSelectableCards={librarySearchData?.nonSelectableCards || []}
        revealedCards={librarySearchData?.revealedCards || []}
        castableWhileSearchingCards={librarySearchData?.castableWhileSearchingCards || []}
        playerId={librarySearchData?.targetPlayerId || you || ''}
        title={librarySearchData?.title || 'Search Library'}
        description={librarySearchData?.description}
        filter={librarySearchData?.filter}
        minSelections={librarySearchData?.minSelections ?? 1}
        maxSelections={librarySearchData?.maxSelections || 1}
        maxTotalManaValue={librarySearchData?.maxTotalManaValue}
        moveTo={librarySearchData?.moveTo || 'hand'}
        mandatory={librarySearchData?.mandatory ?? true}
        shuffleAfter={librarySearchData?.shuffleAfter ?? true}
        splitDestination={librarySearchData?.splitDestination}
        toBattlefield={librarySearchData?.toBattlefield}
        toHand={librarySearchData?.toHand}
        entersTapped={librarySearchData?.entersTapped}
        onConfirm={handleLibrarySearchConfirm}
        onCastWhileSearching={handleLibrarySearchCastWhileSearching}
        onCancel={handleLibrarySearchCancel}
      />

      {/* Target Selection Modal */}
      <TargetSelectionModal
        open={resolutionPromptOpen(targetModalOpen, targetModalData?.stepId)}
        title={targetModalData?.title || 'Select Targets'}
        description={targetModalData?.description}
        contextSteps={targetModalData?.contextSteps}
        selectedMode={targetModalData?.selectedMode}
        viewerPlayerId={you || undefined}
        source={targetModalData?.source}
        targets={targetModalData?.targets || []}
        minTargets={targetModalData?.minTargets ?? 1}
        maxTargets={targetModalData?.maxTargets ?? 1}
        targetGroups={targetModalData?.targetGroups}
        perOpponent={targetModalData?.perOpponent}
        opponents={targetModalData?.opponents}
        targetsPerOpponent={targetModalData?.targetsPerOpponent}
        minTargetsPerOpponent={targetModalData?.minTargetsPerOpponent}
        maxTargetsPerOpponent={targetModalData?.maxTargetsPerOpponent}
        onConfirm={handleTargetConfirm}
        onCancel={handleTargetCancel}
      />

      {/* Undo Request Modal */}
      <UndoRequestModal
        open={undoModalOpen}
        you={you || ''}
        request={undoRequestData}
        onApprove={handleUndoApprove}
        onReject={handleUndoReject}
        onCancel={handleUndoCancel}
      />

      {/* Split/Adventure Card Choice Modal */}
      <SplitCardChoiceModal
        open={splitCardModalOpen}
        cardName={splitCardData?.cardName || ''}
        layout={splitCardData?.layout || ''}
        faces={splitCardData?.faces || []}
        canFuse={splitCardData?.canFuse}
        onChoose={handleSplitCardChoose}
        onCancel={handleSplitCardCancel}
      />

      {/* Creature Type Selection Modal */}
      <CreatureTypeSelectModal
        open={resolutionPromptOpen(creatureTypeModalOpen, creatureTypeModalData?.stepId)}
        title={`Choose a Creature Type for ${creatureTypeModalData?.cardName || 'this card'}`}
        description={creatureTypeModalData?.reason}
        cardName={creatureTypeModalData?.cardName}
        offeredCreatureTypes={creatureTypeModalData?.offeredCreatureTypes}
        canCancel={!creatureTypeModalData?.mandatory}
        allowCustom={!creatureTypeModalData?.offeredCreatureTypes?.length}
        onSelect={(creatureType) => {
          if (creatureTypeModalData && safeView?.id) {
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: creatureTypeModalData.stepId,
              selections: creatureType,
              cancelled: false,
            });
            setCreatureTypeModalOpen(false);
            setCreatureTypeModalData(null);
          }
        }}
        onCancel={() => {
          if (creatureTypeModalData?.mandatory) {
            return;
          }

          if (safeView?.id && creatureTypeModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: creatureTypeModalData.stepId,
            });
          }
          setCreatureTypeModalOpen(false);
          setCreatureTypeModalData(null);
        }}
      />

      {/* Life Payment Modal (Toxic Deluge, Hatred, etc.) */}
      <LifePaymentModal
        open={resolutionPromptOpen(lifePaymentModalOpen, lifePaymentModalData?.stepId)}
        cardName={lifePaymentModalData?.cardName || ''}
        description={lifePaymentModalData?.description || ''}
        cardImageUrl={lifePaymentModalData?.imageUrl}
        currentLife={lifePaymentModalData?.currentLife || 40}
        minPayment={lifePaymentModalData?.minPayment || 0}
        maxPayment={lifePaymentModalData?.maxPayment || 0}
        onConfirm={(lifePayment) => {
          if (safeView?.id && lifePaymentModalData) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: lifePaymentModalData.stepId,
              selections: Number(lifePayment),
              cancelled: false,
            });
            setLifePaymentModalOpen(false);
            setLifePaymentModalData(null);
          }
        }}
        onCancel={() => {
          if (lifePaymentModalData?.mandatory) {
            alert('You must choose a life payment amount to continue.');
            return;
          }

          if (safeView?.id && lifePaymentModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: lifePaymentModalData.stepId,
            });
          }
          setLifePaymentModalOpen(false);
          setLifePaymentModalData(null);
        }}
      />

      {/* Color Choice Modal (Caged Sun, Gauntlet of Power, etc.) */}
      <ColorChoiceModal
        open={resolutionPromptOpen(colorChoiceModalOpen, colorChoiceModalData?.stepId)}
        confirmId={colorChoiceModalData?.confirmId || ''}
        cardName={colorChoiceModalData?.cardName || ''}
        reason={colorChoiceModalData?.reason || ''}
        cardImageUrl={colorChoiceModalData?.imageUrl}
        colors={colorChoiceModalData?.colors}
        canCancel={!colorChoiceModalData?.mandatory}
        onConfirm={(selectedColor) => {
          if (safeView?.id && colorChoiceModalData) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: colorChoiceModalData.stepId,
              selections: selectedColor,
              cancelled: false,
            });
            setColorChoiceModalOpen(false);
            setColorChoiceModalData(null);
          }
        }}
        onCancel={() => {
          if (colorChoiceModalData?.mandatory) {
            return;
          }

          if (safeView?.id && colorChoiceModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: colorChoiceModalData.stepId,
            });
          }
          setColorChoiceModalOpen(false);
          setColorChoiceModalData(null);
        }}
      />

      {/* Card Name Choice Modal (Pithing Needle, Nevermore, etc.) */}
      <CardNameChoiceModal
        open={resolutionPromptOpen(cardNameChoiceModalOpen, cardNameChoiceModalData?.stepId)}
        title={cardNameChoiceModalData ? `Choose a Card Name for ${cardNameChoiceModalData.cardName}` : 'Choose a Card Name'}
        description={cardNameChoiceModalData?.reason}
        cardName={cardNameChoiceModalData?.cardName}
        sourceImageUrl={cardNameChoiceModalData?.imageUrl}
        mandatory={cardNameChoiceModalData?.mandatory ?? true}
        restrictionText={cardNameChoiceModalData?.restrictionText}
        candidateNames={cardNameChoiceModalData?.candidateNames}
        onConfirm={(chosenName) => {
          if (safeView?.id && cardNameChoiceModalData) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: cardNameChoiceModalData.stepId,
              selections: chosenName,
              cancelled: false,
            });
            setCardNameChoiceModalOpen(false);
            setCardNameChoiceModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && cardNameChoiceModalData && cardNameChoiceModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: cardNameChoiceModalData.stepId,
            });
            setCardNameChoiceModalOpen(false);
            setCardNameChoiceModalData(null);
          }
        }}
      />

      {/* Any Color Mana Modal (Birds of Paradise, Chromatic Lantern, etc.) */}
      <AnyColorManaModal
        open={resolutionPromptOpen(anyColorManaModalOpen, anyColorManaModalData?.stepId)}
        activationId={anyColorManaModalData?.activationId || ''}
        permanentId={anyColorManaModalData?.permanentId || ''}
        cardName={anyColorManaModalData?.cardName || ''}
        amount={anyColorManaModalData?.amount || 1}
        allowedColors={anyColorManaModalData?.allowedColors}
        amountByColor={anyColorManaModalData?.amountByColor}
        dynamicAmountSource={anyColorManaModalData?.dynamicAmountSource}
        chosenCreatureType={anyColorManaModalData?.chosenCreatureType}
        cardImageUrl={anyColorManaModalData?.cardImageUrl}
        canCancel={anyColorManaModalData?.mandatory === false}
        onConfirm={(chosenColor) => {
          if (safeView?.id && anyColorManaModalData) {
            if (anyColorManaModalData.stepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: anyColorManaModalData.stepId,
                selections: chosenColor,
                cancelled: false,
              });
            }
            setAnyColorManaModalOpen(false);
            setAnyColorManaModalData(null);
          }
        }}
        onCancel={() => {
          if (anyColorManaModalData?.mandatory !== false) return;
          if (safeView?.id && anyColorManaModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: anyColorManaModalData.stepId,
            });
          }
          setAnyColorManaModalOpen(false);
          setAnyColorManaModalData(null);
        }}
      />

      {/* Phyrexian Mana Choice Modal (Mite Overseer, K'rrik, etc.) */}
      <PhyrexianManaChoiceModal
        open={resolutionPromptOpen(phyrexianManaModalOpen, phyrexianManaModalData?.stepId)}
        cardName={phyrexianManaModalData?.cardName || ''}
        abilityText={phyrexianManaModalData?.abilityText || ''}
        totalManaCost={phyrexianManaModalData?.totalManaCost || ''}
        genericCost={phyrexianManaModalData?.genericCost || 0}
        phyrexianChoices={phyrexianManaModalData?.phyrexianChoices || []}
        playerLife={phyrexianManaModalData?.playerLife || 40}
        cardImageUrl={phyrexianManaModalData?.cardImageUrl}
        onConfirm={(choices) => {
          if (safeView?.id && phyrexianManaModalData) {
            // If this prompt came from spell casting, re-emit castSpellFromHand with the choices.
            // Otherwise, it's for an activated ability and we use the existing confirm event.
            if (phyrexianManaModalData.castSpellArgs) {
              socket.emit('castSpellFromHand', {
                ...phyrexianManaModalData.castSpellArgs,
                phyrexianChoices: choices,
              });
            } else if (phyrexianManaModalData.stepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: phyrexianManaModalData.stepId,
                selections: choices,
                cancelled: false,
              });
            }
            setPhyrexianManaModalOpen(false);
            setPhyrexianManaModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && phyrexianManaModalData?.stepId && phyrexianManaModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: phyrexianManaModalData.stepId,
            });
          }
          setPhyrexianManaModalOpen(false);
          setPhyrexianManaModalData(null);
        }}
      />
    </>
  );
}
