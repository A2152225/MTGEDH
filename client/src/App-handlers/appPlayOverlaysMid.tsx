// Origin parent: client/src/App.tsx
// Cluster moved: mana-distribution through exile overlays
// Public entry symbols: renderAppPlayOverlaysMid.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import type { KnownCardRef } from "../../../shared/src";
import { ManaDistributionModal } from "../components/ManaDistributionModal";
import { CounterDistributionModal } from "../components/CounterDistributionModal";
import { AdditionalCostModal } from "../components/AdditionalCostModal";
import { SquadCostModal } from "../components/SquadCostModal";
import { CastingModeSelectionModal } from "../components/CastingModeSelectionModal";
import { ModalSpellSelectionModal } from "../components/ModalSpellSelectionModal";
import { ReplacementEffectOrderModal } from "../components/ReplacementEffectOrderModal";
import { GraveyardViewModal } from "../components/GraveyardViewModal";
import { ExileViewModal } from "../components/ExileViewModal";
import { MayAbilityModal } from "../components/MayAbilityModal";

export function renderAppPlayOverlaysMid(p: Record<string, any>) {
  const {
    additionalCostModalData,
    additionalCostModalOpen,
    appearanceSettings,
    castingModeModalData,
    castingModeModalOpen,
    counterDistributionModalData,
    counterDistributionModalOpen,
    exileModalOpen,
    exileModalPlayerId,
    graveyardModalOpen,
    graveyardModalPlayerId,
    handleExileAbility,
    handleGraveyardAbility,
    ignoredCardIds,
    manaDistributionModalData,
    manaDistributionModalOpen,
    manaPool,
    mayAbilityModalData,
    mayAbilityModalOpen,
    minimizeResolutionStep,
    modalSpellModalData,
    modalSpellModalOpen,
    replacementEffectModalData,
    replacementEffectModalOpen,
    resolutionPromptOpen,
    safeView,
    setAdditionalCostModalData,
    setAdditionalCostModalOpen,
    setCastingModeModalData,
    setCastingModeModalOpen,
    setCounterDistributionModalData,
    setCounterDistributionModalOpen,
    setExileModalOpen,
    setExileModalPlayerId,
    setGraveyardModalOpen,
    setGraveyardModalPlayerId,
    setManaDistributionModalData,
    setManaDistributionModalOpen,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setMinimizedResolutionStep,
    setModalSpellModalData,
    setModalSpellModalOpen,
    setReplacementEffectModalData,
    setReplacementEffectModalOpen,
    setSquadCostModalData,
    setSquadCostModalOpen,
    squadCostModalData,
    squadCostModalOpen,
    you,
  } = p;
  return (
    <>
      {/* Mana Distribution Modal (Selvala, Heart of the Wilds, etc.) */}
      <ManaDistributionModal
        open={resolutionPromptOpen(manaDistributionModalOpen, manaDistributionModalData?.stepId)}
        cardName={manaDistributionModalData?.cardName || ''}
        cardImageUrl={manaDistributionModalData?.cardImageUrl}
        totalAmount={manaDistributionModalData?.totalAmount || 0}
        availableColors={manaDistributionModalData?.availableColors || []}
        message={manaDistributionModalData?.message}
        canCancel={manaDistributionModalData?.mandatory === false}
        onConfirm={(distribution) => {
          if (safeView?.id && manaDistributionModalData) {
            if (manaDistributionModalData.stepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: manaDistributionModalData.stepId,
                selections: distribution,
                cancelled: false,
              });
            }
            setManaDistributionModalOpen(false);
            setManaDistributionModalData(null);
          }
        }}
        onCancel={() => {
          if (manaDistributionModalData?.mandatory !== false) return;
          if (safeView?.id && manaDistributionModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: manaDistributionModalData.stepId,
            });
          }
          setManaDistributionModalOpen(false);
          setManaDistributionModalData(null);
        }}
      />

      <CounterDistributionModal
        open={resolutionPromptOpen(counterDistributionModalOpen, counterDistributionModalData?.stepId)}
        cardName={counterDistributionModalData?.cardName || ''}
        cardImageUrl={counterDistributionModalData?.cardImageUrl}
        counterType={counterDistributionModalData?.counterType || '+1/+1'}
        totalAmount={counterDistributionModalData?.totalAmount || 0}
        minPerTarget={counterDistributionModalData?.minPerTarget ?? 1}
        targets={counterDistributionModalData?.targets || []}
        message={counterDistributionModalData?.message}
        canCancel={counterDistributionModalData?.mandatory === false}
        onConfirm={(distribution) => {
          if (safeView?.id && counterDistributionModalData?.stepId) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: counterDistributionModalData.stepId,
              selections: distribution,
              cancelled: false,
            });
          }
          setCounterDistributionModalOpen(false);
          setCounterDistributionModalData(null);
        }}
        onCancel={() => {
          if (counterDistributionModalData?.mandatory !== false) return;
          if (safeView?.id && counterDistributionModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: counterDistributionModalData.stepId,
            });
          }
          setCounterDistributionModalOpen(false);
          setCounterDistributionModalData(null);
        }}
      />

      {/* Additional Cost Modal (Discard/Sacrifice as additional cost) */}
      <AdditionalCostModal
        open={resolutionPromptOpen(additionalCostModalOpen, additionalCostModalData?.resolutionStepId)}
        cardId={additionalCostModalData?.cardId || ''}
        cardName={additionalCostModalData?.cardName || ''}
        costType={additionalCostModalData?.costType || 'discard'}
        amount={additionalCostModalData?.amount || 0}
        title={additionalCostModalData?.title || ''}
        description={additionalCostModalData?.description || ''}
        imageUrl={additionalCostModalData?.imageUrl}
        availableCards={additionalCostModalData?.availableCards}
        availableTargets={additionalCostModalData?.availableTargets}
        availableCounters={additionalCostModalData?.availableCounters}
        effectId={additionalCostModalData?.effectId}
        canCancel={
          additionalCostModalData?.resolutionStepId
            ? additionalCostModalData?.resolutionStepMandatory === false
            : true
        }
        onConfirm={(selectedIds) => {
          if (safeView?.id && additionalCostModalData) {
            if (additionalCostModalData.resolutionStepId) {
              const chosen = selectedIds[0];
              const selections =
                additionalCostModalData.resolutionSourceChoiceId && chosen === additionalCostModalData.resolutionSourceChoiceId
                  ? { type: 'source' }
                  : (additionalCostModalData.resolutionStepType === 'additional_cost_payment' ? selectedIds : chosen);

              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: additionalCostModalData.resolutionStepId,
                selections,
                cancelled: false,
              });
            }
            setAdditionalCostModalOpen(false);
            setAdditionalCostModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && additionalCostModalData?.resolutionStepId && additionalCostModalData?.resolutionStepMandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: additionalCostModalData.resolutionStepId,
            });
          }
          setAdditionalCostModalOpen(false);
          setAdditionalCostModalData(null);
        }}
      />

      {/* Squad Cost Modal (Pay squad cost multiple times) */}
      <SquadCostModal
        open={resolutionPromptOpen(squadCostModalOpen, squadCostModalData?.resolutionStepId)}
        cardId={squadCostModalData?.cardId || ''}
        cardName={squadCostModalData?.cardName || ''}
        squadCost={squadCostModalData?.squadCost || ''}
        imageUrl={squadCostModalData?.imageUrl}
        effectId={squadCostModalData?.effectId}
        availableMana={(manaPool as unknown as Record<string, number>) || undefined}
        onConfirm={(timesPaid) => {
          if (safeView?.id && squadCostModalData?.resolutionStepId) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: squadCostModalData.resolutionStepId,
              selections: timesPaid,
              cancelled: false,
            });
            setSquadCostModalOpen(false);
            setSquadCostModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && squadCostModalData?.resolutionStepId && squadCostModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: squadCostModalData.resolutionStepId,
            });
          }
          setSquadCostModalOpen(false);
          setSquadCostModalData(null);
        }}
      />

      {/* "You may" optional ability modal */}
      <MayAbilityModal
        open={resolutionPromptOpen(mayAbilityModalOpen, mayAbilityModalData?.stepId)}
        data={mayAbilityModalData}
        onMinimize={
          mayAbilityModalData?.stepId
            ? () => minimizeResolutionStep(
                mayAbilityModalData.stepId,
                mayAbilityModalData.sourceName
                  ? `${mayAbilityModalData.sourceName}: optional ability`
                  : 'Optional ability',
              )
            : undefined
        }
        onYes={(stepId) => {
          if (safeView?.id) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId,
              selections: ['yes'],
              cancelled: false,
            });
          }
          setMinimizedResolutionStep(null);
          setMayAbilityModalOpen(false);
          setMayAbilityModalData(null);
        }}
        onNo={(stepId) => {
          if (safeView?.id) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId,
              selections: ['no'],
              cancelled: true,
            });
          }
          setMinimizedResolutionStep(null);
          setMayAbilityModalOpen(false);
          setMayAbilityModalData(null);
        }}
      />

      {/* Casting Mode Selection Modal (Overload, Abundant Harvest, etc.) */}
      <CastingModeSelectionModal
        open={resolutionPromptOpen(castingModeModalOpen, castingModeModalData?.resolutionStepId)}
        cardId={castingModeModalData?.cardId || ''}
        cardName={castingModeModalData?.cardName || ''}
        source={castingModeModalData?.source}
        title={castingModeModalData?.title || ''}
        description={castingModeModalData?.description || ''}
        imageUrl={castingModeModalData?.imageUrl}
        modes={castingModeModalData?.modes || []}
        effectId={castingModeModalData?.effectId}
        onConfirm={(selectedMode) => {
          if (safeView?.id && castingModeModalData) {
            if (castingModeModalData.resolutionStepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: castingModeModalData.resolutionStepId,
                selections: selectedMode,
                cancelled: false,
              });
            }
            setCastingModeModalOpen(false);
            setCastingModeModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && castingModeModalData?.resolutionStepId && castingModeModalData?.resolutionStepMandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: castingModeModalData.resolutionStepId,
            });
          }
          setCastingModeModalOpen(false);
          setCastingModeModalData(null);
        }}
      />

      {/* Modal Spell Selection Modal (Spree, Choose One/Two, Charms, etc.) */}
      <ModalSpellSelectionModal
        open={resolutionPromptOpen(modalSpellModalOpen, modalSpellModalData?.resolutionStepId)}
        cardName={modalSpellModalData?.cardName || ''}
        imageUrl={modalSpellModalData?.imageUrl}
        description={modalSpellModalData?.description}
        modes={modalSpellModalData?.modes || []}
        modeCount={modalSpellModalData?.modeCount || 1}
        canChooseAny={modalSpellModalData?.canChooseAny || modalSpellModalData?.isSpree}
        minModes={modalSpellModalData?.minModes}
        pBudget={modalSpellModalData?.pBudget}
        canRepeatModes={modalSpellModalData?.canRepeatModes}
        onConfirm={(selectedModeIds) => {
          if (safeView?.id && modalSpellModalData) {
            if (modalSpellModalData.resolutionStepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: modalSpellModalData.resolutionStepId,
                selections: selectedModeIds,
                cancelled: false,
              });
            }
            setModalSpellModalOpen(false);
            setModalSpellModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && modalSpellModalData?.resolutionStepId && modalSpellModalData?.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: modalSpellModalData.resolutionStepId,
            });
          }
          setModalSpellModalOpen(false);
          setModalSpellModalData(null);
        }}
      />

      {/* Replacement Effect Order Modal (Minimize/Maximize/Custom) */}
      <ReplacementEffectOrderModal
        open={replacementEffectModalOpen}
        effectType={replacementEffectModalData?.effectType || 'damage'}
        effects={replacementEffectModalData?.effects || []}
        baseAmount={replacementEffectModalData?.baseAmount || 0}
        initialMode={replacementEffectModalData?.initialMode}
        onConfirm={(orderedEffects, mode) => {
          if (safeView?.id && replacementEffectModalData) {
            socket.emit("setReplacementEffectOrder", {
              gameId: safeView.id,
              effectType: replacementEffectModalData.effectType,
              effectIds: orderedEffects.map(e => e.id),
              mode,
              effectId: replacementEffectModalData.effectId,
            });
            setReplacementEffectModalOpen(false);
            setReplacementEffectModalData(null);
          }
        }}
        onCancel={() => {
          setReplacementEffectModalOpen(false);
          setReplacementEffectModalData(null);
        }}
      />

      {/* Graveyard View Modal */}
      <GraveyardViewModal
        open={graveyardModalOpen}
        cards={useMemo(() => {
          if (!safeView || !graveyardModalPlayerId) return [];
          const zones = safeView.zones?.[graveyardModalPlayerId];
          const graveyard = zones?.graveyard || [];
          return graveyard.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, graveyardModalPlayerId])}
        playerId={graveyardModalPlayerId || ''}
        canActivate={you === graveyardModalPlayerId}
        onClose={() => {
          setGraveyardModalOpen(false);
          setGraveyardModalPlayerId(null);
        }}
        onActivateAbility={handleGraveyardAbility}
        playableCards={you === graveyardModalPlayerId ? (safeView as any)?.playableCards : undefined}
        graveyardAbilityHints={you === graveyardModalPlayerId ? (safeView as any)?.graveyardAbilityHints?.[graveyardModalPlayerId || ''] : undefined}
        appearanceSettings={appearanceSettings}
        onIgnoreForPlayability={(cardId, cardName, imageUrl) => {
          if (safeView?.id) {
            socket.emit('ignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
              cardName,
              zone: 'graveyard',
              imageUrl,
            });
          }
        }}
        onUnignoreForPlayability={(cardId) => {
          if (safeView?.id) {
            socket.emit('unignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
            });
          }
        }}
        ignoredCardIds={ignoredCardIds}
      />

      {/* Exile View Modal */}
      <ExileViewModal
        open={exileModalOpen}
        cards={useMemo(() => {
          if (!safeView || !exileModalPlayerId) return [];
          const zones = safeView.zones?.[exileModalPlayerId];
          const exile = zones?.exile || [];
          return Array.isArray(exile) ? (exile.filter((c: any) => c && c.name) as KnownCardRef[]) : [];
        }, [safeView, exileModalPlayerId])}
        playerId={exileModalPlayerId || ''}
        currentTurn={(safeView as any)?.turnNumber ?? (safeView as any)?.turn}
        canActivate={you === exileModalPlayerId}
        onClose={() => {
          setExileModalOpen(false);
          setExileModalPlayerId(null);
        }}
        onActivateAbility={handleExileAbility}
        playableCards={you === exileModalPlayerId ? (safeView as any)?.playableCards : undefined}
        appearanceSettings={appearanceSettings}
        onIgnoreForPlayability={(cardId, cardName, imageUrl) => {
          if (safeView?.id) {
            socket.emit('ignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
              cardName,
              zone: 'exile',
              imageUrl,
            });
          }
        }}
        onUnignoreForPlayability={(cardId) => {
          if (safeView?.id) {
            socket.emit('unignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
            });
          }
        }}
        ignoredCardIds={ignoredCardIds}
      />
    </>
  );
}
