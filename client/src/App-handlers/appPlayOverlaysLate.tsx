// Origin parent: client/src/App.tsx
// Cluster moved: join-forces through may-auto overlays
// Public entry symbols: renderAppPlayOverlaysLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import { DraggableSettingsPanel } from "../components/DraggableSettingsPanel";
import { ReplacementEffectSettingsPanel } from "../components/ReplacementEffectSettingsPanel";
import { JoinForcesModal } from "../components/JoinForcesModal";
import { TemptingOfferModal } from "../components/TemptingOfferModal";
import { KynaiosChoiceModal } from "../components/KynaiosChoiceModal";
import { OptionChoiceModal } from "../components/OptionChoiceModal";
import { TwoPileSplitModal } from "../components/TwoPileSplitModal";
import { PonderModal } from "../components/PonderModal";
import { DanceWithCalamityCastModal, DanceWithCalamityModal } from "../components/DanceWithCalamityModal";
import { LimDulsVaultModal } from "../components/LimDulsVaultModal";
import { CascadeModal } from "../components/CascadeModal";
import { MutateTargetModal } from "../components/MutateTargetModal";
import { GraveyardSelectionModal } from "../components/GraveyardSelectionModal";
import { IgnoredCardsPanel } from "../components/IgnoredCardsPanel";
import { GameCommunicationsPanel } from "../components/GameCommunicationsPanel";
import { IgnoredTriggersPanel } from "../components/IgnoredTriggersPanel";
import { MayAutoPreferencesPanel } from "../components/MayAutoPreferencesPanel";
import { PriorityModal } from "../components/PriorityModal";
import { AutoPassSettingsPanel } from "../components/AutoPassSettingsPanel";
import { TriggerShortcutsPanel } from "../components/TriggerShortcutsPanel";
import { LoopShortcutPanel } from "../components/LoopShortcutPanel";
import { clampLoopShortcutIterations } from "../utils/loopShortcuts";
import { GameRebuildProgressOverlay } from "../components/GameRebuildProgressOverlay";

export function renderAppPlayOverlaysLate(p: Record<string, any>) {
  const {
    appearanceSettings,
    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    cascadeModalOpen,
    cascadePrompt,
    chat,
    danceWithCalamityCastModalOpen,
    danceWithCalamityCastRequest,
    danceWithCalamityModalOpen,
    danceWithCalamityRequest,
    deckValidation,
    gameLogEntries,
    graveyardSelectionModalData,
    graveyardSelectionModalOpen,
    handleClearAllAutoPass,
    handleClearLoopShortcut,
    handleDeleteSavedLoopShortcut,
    handleJoinForcesContribute,
    handleKynaiosChoiceRespond,
    handleLoadSavedLoopShortcut,
    handleOptionChoiceRespond,
    handleRunLoopShortcut,
    handleSaveLoopShortcut,
    handleSelectAllAutoPass,
    handleStartLoopShortcutRecording,
    handleStopIgnoringSource,
    handleStopLoopShortcutRecording,
    handleTemptingOfferRespond,
    handleToggleAutoPass,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    handleToggleAutoPassForTurn,
    ignoredCards,
    ignoredTriggerSources,
    imagePref,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    isPreGame,
    joinForcesContributions,
    joinForcesModalOpen,
    joinForcesRequest,
    joinForcesResponded,
    kynaiosChoiceModalOpen,
    kynaiosChoiceRequest,
    layout,
    limDulsVaultModalOpen,
    limDulsVaultRequest,
    loopShortcutItems,
    loopShortcutIterations,
    loopShortcutName,
    loopShortcutStatusText,
    mayAutoPreferenceEntries,
    minimizeResolutionStep,
    mobilePlayLayout,
    mutateModalData,
    mutateModalOpen,
    optionChoiceModalOpen,
    optionChoiceRequest,
    ponderModalOpen,
    ponderRequest,
    priority,
    priorityModalOpen,
    replacementEffectSettingsOpen,
    resolutionPromptOpen,
    resolvePlayerName,
    safeView,
    savedLoopShortcuts,
    sendChat,
    setCascadeModalOpen,
    setCascadePrompt,
    setDanceWithCalamityCastModalOpen,
    setDanceWithCalamityCastRequest,
    setDanceWithCalamityModalOpen,
    setDanceWithCalamityRequest,
    setDeckValidation,
    setGraveyardSelectionModalData,
    setGraveyardSelectionModalOpen,
    setJoinForcesModalOpen,
    setLimDulsVaultModalOpen,
    setLimDulsVaultRequest,
    setLoopShortcutIterations,
    setLoopShortcutName,
    setMutateModalData,
    setMutateModalOpen,
    setPonderModalOpen,
    setPonderRequest,
    setPriorityModalOpen,
    setReplacementEffectSettingsOpen,
    setShowLoopShortcutPanel,
    setShowTriggerShortcuts,
    setTemptingOfferModalOpen,
    setTwoPileSplitModalOpen,
    setTwoPileSplitRequest,
    showLoopShortcutPanel,
    showMobileChrome,
    showTriggerShortcuts,
    showUtilityRail,
    temptingOfferAcceptedBy,
    temptingOfferModalOpen,
    temptingOfferRequest,
    temptingOfferResponded,
    twoPileSplitModalOpen,
    twoPileSplitRequest,
    you,
  } = p;
  return (
    <>
      <GameRebuildProgressOverlay gameId={safeView?.id} />
      {/* Join Forces Modal (Collective Voyage, Minds Aglow, etc.) */}
      <JoinForcesModal
        open={resolutionPromptOpen(joinForcesModalOpen, joinForcesRequest?.id)}
        request={joinForcesRequest}
        currentPlayerId={you || ''}
        playerNames={useMemo(() => {
          const names: Record<string, string> = {};
          if (safeView?.players) {
            for (const p of safeView.players) {
              names[p.id] = p.name || p.id;
            }
          }
          return names;
        }, [safeView?.players])}
        responded={joinForcesResponded}
        contributions={joinForcesContributions}
        availableMana={useMemo(() => {
          if (!safeView || !you) return 0;
          // Count untapped lands as available mana
          const battlefield = safeView.battlefield || [];
          const isLandPermanent = (perm: any): boolean => {
            const card = perm?.card as any;
            if (!card) return false;
            const faces = Array.isArray(card.card_faces) ? (card.card_faces as any[]) : null;
            const layout = String(card.layout || '').toLowerCase();
            if (faces && faces.length >= 2) {
              const backOracle = String(faces[1]?.oracle_text || '');
              const isTransformLike = layout === 'transform' || /transforms from/i.test(backOracle);
              if (isTransformLike) {
                const isTransformed = Boolean(perm.transformed);
                const face = isTransformed ? faces[1] : faces[0];
                return /\bland\b/i.test(String(face?.type_line || ''));
              }
              if (layout === 'modal_dfc') {
                const selected = card.selectedMDFCFace;
                if (typeof selected === 'number' && faces[selected]) {
                  return /\bland\b/i.test(String(faces[selected]?.type_line || ''));
                }
              }
            }
            return /\bland\b/i.test(String(card.type_line || ''));
          };
          return battlefield.filter((p: any) => 
            p.controller === you && 
            !p.tapped &&
            isLandPermanent(p)
          ).length;
        }, [safeView, you])}
        onContribute={handleJoinForcesContribute}
        onClose={() => setJoinForcesModalOpen(false)}
      />

      {/* Tempting Offer Modal (Tempt with Reflections, Tempt with Discovery, etc.) */}
      <TemptingOfferModal
        open={resolutionPromptOpen(temptingOfferModalOpen, temptingOfferRequest?.id)}
        request={temptingOfferRequest}
        currentPlayerId={you || ''}
        playerNames={useMemo(() => {
          const names: Record<string, string> = {};
          if (safeView?.players) {
            for (const p of safeView.players) {
              names[p.id] = p.name || p.id;
            }
          }
          return names;
        }, [safeView?.players])}
        responded={temptingOfferResponded}
        acceptedBy={temptingOfferAcceptedBy}
        onRespond={handleTemptingOfferRespond}
        onClose={() => setTemptingOfferModalOpen(false)}
      />
      
      {/* Kynaios Choice Modal (Kynaios and Tiro of Meletis style land/draw choice) */}
      <KynaiosChoiceModal
        open={resolutionPromptOpen(kynaiosChoiceModalOpen, kynaiosChoiceRequest?.stepId)}
        request={kynaiosChoiceRequest}
        controllerName={useMemo(() => {
          if (!kynaiosChoiceRequest || !safeView?.players) return '';
          const controller = safeView.players.find((p: any) => p.id === kynaiosChoiceRequest.sourceController);
          return controller?.name || kynaiosChoiceRequest.sourceController;
        }, [kynaiosChoiceRequest, safeView?.players])}
        onRespond={handleKynaiosChoiceRespond}
      />

      {/* Generic Option Choice Modal (Agitator Ant and similar effects) */}
      <OptionChoiceModal
        open={resolutionPromptOpen(optionChoiceModalOpen, optionChoiceRequest?.stepId)}
        request={optionChoiceRequest}
        onMinimize={
          optionChoiceRequest?.stepId
            ? () => minimizeResolutionStep(
                optionChoiceRequest.stepId,
                optionChoiceRequest.sourceName
                  ? (optionChoiceRequest.causeName
                    ? `${optionChoiceRequest.sourceName}: ${optionChoiceRequest.causeName}`
                    : `${optionChoiceRequest.sourceName}: choice`)
                  : 'Pending choice',
              )
            : undefined
        }
        onRespond={handleOptionChoiceRespond}
      />

      {/* Two-pile split Modal (separate into two piles) */}
      <TwoPileSplitModal
        open={resolutionPromptOpen(twoPileSplitModalOpen, twoPileSplitRequest?.stepId)}
        request={twoPileSplitRequest}
        onRespond={(payload) => {
          if (!safeView?.id || !twoPileSplitRequest) return;
          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId: twoPileSplitRequest.stepId,
            selections: payload,
            cancelled: false,
          });
          setTwoPileSplitModalOpen(false);
          setTwoPileSplitRequest(null);
        }}
      />

      {/* Ponder Modal (Ponder, Index, Telling Time, etc.) */}
      {resolutionPromptOpen(ponderModalOpen, ponderRequest?.stepId) && ponderRequest && (
        <PonderModal
          cards={ponderRequest.cards}
          cardName={ponderRequest.cardName}
          cardImageUrl={ponderRequest.cardImageUrl}
          imagePref={appearanceSettings.imagePref || 'normal'}
          variant={ponderRequest.variant}
          canShuffle={ponderRequest.canShuffle}
          drawAfter={ponderRequest.drawAfter}
          pickToHand={ponderRequest.pickToHand}
          targetPlayerId={ponderRequest.targetPlayerId}
          targetPlayerName={ponderRequest.targetPlayerName}
          isOwnLibrary={ponderRequest.isOwnLibrary}
          onConfirm={(payload) => {
            if (!safeView?.id || !ponderRequest) return;
            
            // Use the resolution queue system
            if (!ponderRequest.stepId) {
              console.error('[Ponder] Missing stepId - must use resolution queue');
              return;
            }
            
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: ponderRequest.stepId,
              selections: {
                newOrder: payload.newOrder,
                shouldShuffle: payload.shouldShuffle,
                toHand: payload.toHand,
              },
              cancelled: false,
            });
            
            setPonderModalOpen(false);
            setPonderRequest(null);
          }}
          onCancel={() => {
            setPonderModalOpen(false);
            setPonderRequest(null);
          }}
        />
      )}

      {resolutionPromptOpen(limDulsVaultModalOpen, limDulsVaultRequest?.stepId) && limDulsVaultRequest && (
        <LimDulsVaultModal
          cards={limDulsVaultRequest.cards}
          cardName={limDulsVaultRequest.cardName}
          cardImageUrl={limDulsVaultRequest.cardImageUrl}
          imagePref={appearanceSettings.imagePref || 'normal'}
          currentLife={limDulsVaultRequest.currentLife}
          totalLifePaid={limDulsVaultRequest.totalLifePaid}
          onContinue={(orderedIds) => {
            if (!safeView?.id || !limDulsVaultRequest) return;
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: limDulsVaultRequest.stepId,
              selections: {
                action: 'continue',
                orderedIds,
              },
              cancelled: false,
            });
            setLimDulsVaultModalOpen(false);
            setLimDulsVaultRequest(null);
          }}
          onFinish={(orderedIds) => {
            if (!safeView?.id || !limDulsVaultRequest) return;
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: limDulsVaultRequest.stepId,
              selections: {
                action: 'finish',
                orderedIds,
              },
              cancelled: false,
            });
            setLimDulsVaultModalOpen(false);
            setLimDulsVaultRequest(null);
          }}
        />
      )}

      {resolutionPromptOpen(danceWithCalamityModalOpen, danceWithCalamityRequest?.stepId) && danceWithCalamityRequest && (
        <DanceWithCalamityModal
          cardName={danceWithCalamityRequest.cardName}
          cardImageUrl={danceWithCalamityRequest.cardImageUrl}
          imagePref={appearanceSettings.imagePref || 'normal'}
          exiledCards={danceWithCalamityRequest.exiledCards}
          totalManaValue={danceWithCalamityRequest.totalManaValue}
          canContinue={danceWithCalamityRequest.canContinue}
          onContinue={() => {
            if (!safeView?.id || !danceWithCalamityRequest) return;
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: danceWithCalamityRequest.stepId,
              selections: {
                action: 'continue',
              },
              cancelled: false,
            });
            setDanceWithCalamityModalOpen(false);
            setDanceWithCalamityRequest(null);
          }}
          onStop={() => {
            if (!safeView?.id || !danceWithCalamityRequest) return;
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: danceWithCalamityRequest.stepId,
              selections: {
                action: 'stop',
              },
              cancelled: false,
            });
            setDanceWithCalamityModalOpen(false);
            setDanceWithCalamityRequest(null);
          }}
        />
      )}

      {resolutionPromptOpen(danceWithCalamityCastModalOpen, danceWithCalamityCastRequest?.stepId) && danceWithCalamityCastRequest && (
        <DanceWithCalamityCastModal
          cardName={danceWithCalamityCastRequest.cardName}
          cardImageUrl={danceWithCalamityCastRequest.cardImageUrl}
          imagePref={appearanceSettings.imagePref || 'normal'}
          exiledCards={danceWithCalamityCastRequest.exiledCards}
          spellCards={danceWithCalamityCastRequest.spellCards}
          totalManaValue={danceWithCalamityCastRequest.totalManaValue}
          onConfirm={(orderedSpellIds) => {
            if (!safeView?.id || !danceWithCalamityCastRequest) return;
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: danceWithCalamityCastRequest.stepId,
              selections: {
                orderedSpellIds,
              },
              cancelled: false,
            });
            setDanceWithCalamityCastModalOpen(false);
            setDanceWithCalamityCastRequest(null);
          }}
        />
      )}
      
      {/* Cascade Modal */}
      {resolutionPromptOpen(cascadeModalOpen, cascadePrompt?.stepId) && cascadePrompt && (
        <CascadeModal
          open={cascadeModalOpen}
          sourceName={cascadePrompt.sourceName}
          cascadeNumber={cascadePrompt.cascadeNumber}
          totalCascades={cascadePrompt.totalCascades}
          hitCard={cascadePrompt.hitCard}
          exiledCards={cascadePrompt.exiledCards}
          onCast={() => {
            if (!safeView?.id || !cascadePrompt) return;
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: cascadePrompt.stepId,
              selections: 'cast',  // String value for clarity
              cancelled: false,
            });
            setCascadeModalOpen(false);
            setCascadePrompt(null);
          }}
          onDecline={() => {
            if (!safeView?.id || !cascadePrompt) return;
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: cascadePrompt.stepId,
              selections: 'decline',  // String value for clarity
              cancelled: false,
            });
            setCascadeModalOpen(false);
            setCascadePrompt(null);
          }}
        />
      )}

      {/* Mutate Target Selection Modal */}
      <MutateTargetModal
        open={resolutionPromptOpen(mutateModalOpen, mutateModalData?.stepId)}
        mutatingCard={{
          id: mutateModalData?.cardId || '',
          name: mutateModalData?.cardName || '',
          imageUrl: mutateModalData?.imageUrl,
          power: mutateModalData?.power,
          toughness: mutateModalData?.toughness,
          mutateCost: mutateModalData?.mutateCost || '',
        }}
        targets={mutateModalData?.targets || []}
        onConfirm={(targetId, onTop) => {
          if (!safeView?.id || !mutateModalData?.stepId) return;
          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId: mutateModalData.stepId,
            selections: {
              targetPermanentId: targetId,
              onTop,
            },
            cancelled: false,
          });
          setMutateModalOpen(false);
          setMutateModalData(null);
        }}
        onCancel={() => {
          if (safeView?.id && mutateModalData?.stepId && mutateModalData.mandatory) {
            socket.emit('cancelResolutionStep', { gameId: safeView.id, stepId: mutateModalData.stepId });
          }
          setMutateModalOpen(false);
          setMutateModalData(null);
        }}
      />

      {/* Graveyard Selection Modal */}
      <GraveyardSelectionModal
        open={resolutionPromptOpen(graveyardSelectionModalOpen, graveyardSelectionModalData?.stepId)}
        title={graveyardSelectionModalData?.title || 'Select from Graveyard'}
        description={graveyardSelectionModalData?.description || ''}
        sourceCard={graveyardSelectionModalData?.sourceCard}
        validTargets={graveyardSelectionModalData?.validTargets || []}
        minTargets={graveyardSelectionModalData?.minTargets ?? 0}
        maxTargets={graveyardSelectionModalData?.maxTargets ?? 0}
        onConfirm={(selectedIds) => {
          if (!safeView?.id || !graveyardSelectionModalData?.stepId) return;
          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId: graveyardSelectionModalData.stepId,
            selections: { selectedCardIds: selectedIds },
            cancelled: false,
          });
          setGraveyardSelectionModalOpen(false);
          setGraveyardSelectionModalData(null);
        }}
        onCancel={() => {
          if (!safeView?.id || !graveyardSelectionModalData?.stepId) {
            setGraveyardSelectionModalOpen(false);
            setGraveyardSelectionModalData(null);
            return;
          }

          if (graveyardSelectionModalData.mandatory) {
            socket.emit('cancelResolutionStep', { gameId: safeView.id, stepId: graveyardSelectionModalData.stepId });
          } else {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: graveyardSelectionModalData.stepId,
              selections: {},
              cancelled: true,
            });
          }

          setGraveyardSelectionModalOpen(false);
          setGraveyardSelectionModalData(null);
        }}
      />

      {/* Deck Validation Status */}
      {deckValidation && !deckValidation.valid && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            padding: '12px 16px',
            zIndex: 9000,
            maxWidth: 400,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: '#dc2626' }}>
              ⚠️ Deck Validation Issues
            </span>
            <button
              onClick={() => setDeckValidation(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#7f1d1d' }}>
            {deckValidation.illegal.slice(0, 3).map((i: any, idx: any) => (
              <div key={idx}>• {i.name}: {i.reason}</div>
            ))}
            {deckValidation.illegal.length > 3 && (
              <div>...and {deckValidation.illegal.length - 3} more</div>
            )}
          </div>
        </div>
      )}

      {/* Ignored Triggers Panel - Separate, persistent UI for viewing/managing auto-resolved triggers */}
      <IgnoredTriggersPanel
        ignoredSources={ignoredTriggerSources}
        onStopIgnoring={handleStopIgnoringSource}
        you={you || undefined}
      />

      {/* Priority Modal - Shows when you gain priority and can respond */}
      <PriorityModal
        open={priorityModalOpen}
        step={(safeView as any)?.step || ''}
        phase={(safeView as any)?.phase || ''}
        onTake={() => {
          setPriorityModalOpen(false);
          // Player wants to take action - notify server to prevent auto-pass
          if (safeView && you) {
            socket.emit("claimPriority", { gameId: safeView.id });
          }
        }}
        onPass={() => {
          setPriorityModalOpen(false);
          if (safeView && you) {
            socket.emit("passPriority", { gameId: safeView.id, by: you });
          }
        }}
        isOpponentsTurn={Boolean(you && safeView?.turnPlayer && safeView.turnPlayer !== you)}
        onPassEmptyStackForTurn={() => {
          setPriorityModalOpen(false);
          if (safeView && you) {
            socket.emit('setAutoPassEmptyStackForTurn', {
              gameId: safeView.id,
              enabled: true,
            });
          }
        }}
        autoPassSteps={autoPassSteps}
        onToggleAutoPass={handleToggleAutoPass}
      />

      {/* Auto-Pass Settings Panel & Trigger Shortcuts - Draggable container in bottom-right */}
      {!showUtilityRail && safeView && you && (
        <DraggableSettingsPanel>
          <AutoPassSettingsPanel
            autoPassSteps={autoPassSteps}
            onToggleAutoPass={handleToggleAutoPass}
            onClearAll={handleClearAllAutoPass}
            onSelectAll={handleSelectAllAutoPass}
            isSinglePlayer={
              // Single player mode: not in pre-game AND only 1 active (non-spectator, non-inactive) player
              !isPreGame && 
              (safeView.players || []).filter((p: any) => !p.spectator && !p.inactive).length === 1
            }
            onToggleAutoPassForTurn={handleToggleAutoPassForTurn}
            autoPassForTurnEnabled={autoPassForTurn}
            autoPassEmptyStackOnOpponentsTurnEnabled={autoPassEmptyStackOnOpponentsTurn}
            onToggleAutoPassEmptyStackOnOpponentsTurn={handleToggleAutoPassEmptyStackOnOpponentsTurn}
          />
          {/* Trigger Shortcuts Button */}
          <button
            onClick={() => setShowTriggerShortcuts(true)}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #444',
              backgroundColor: '#2a2a2a',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 13,
            }}
            title="Configure auto-responses for Smothering Tithe, Rhystic Study, etc."
          >
            ⚡ Trigger Shortcuts
          </button>

          <button
            onClick={() => setShowLoopShortcutPanel((prev: any) => !prev)}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #444',
              backgroundColor: showLoopShortcutPanel ? '#1e3a8a' : '#2a2a2a',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 13,
            }}
            title="Record and replay a manual action line against live legal targets"
          >
            ↻ Loop Shortcuts
          </button>

          <LoopShortcutPanel
            open={showLoopShortcutPanel}
            onClose={() => setShowLoopShortcutPanel(false)}
            isRecording={isLoopShortcutRecording}
            isRunning={isLoopShortcutRunning}
            items={loopShortcutItems}
            shortcutName={loopShortcutName}
            savedShortcuts={savedLoopShortcuts}
            iterationCount={loopShortcutIterations}
            onShortcutNameChange={setLoopShortcutName}
            onIterationCountChange={(count) => setLoopShortcutIterations(clampLoopShortcutIterations(count))}
            onStartRecording={handleStartLoopShortcutRecording}
            onStopRecording={handleStopLoopShortcutRecording}
            onRun={handleRunLoopShortcut}
            onClear={handleClearLoopShortcut}
            onSaveShortcut={handleSaveLoopShortcut}
            onLoadShortcut={handleLoadSavedLoopShortcut}
            onDeleteShortcut={handleDeleteSavedLoopShortcut}
            statusText={loopShortcutStatusText}
          />
        </DraggableSettingsPanel>
      )}

      {/* Replacement Effect Settings Panel - Allows customizing effect ordering */}
      {safeView && you && (
        <ReplacementEffectSettingsPanel
          gameId={safeView.id}
          playerId={you}
          open={replacementEffectSettingsOpen}
          onClose={() => setReplacementEffectSettingsOpen(false)}
        />
      )}

      {/* Trigger Shortcuts Panel - Allows setting auto-responses for Smothering Tithe, etc. */}
      {safeView && you && (
        <TriggerShortcutsPanel
          isOpen={showTriggerShortcuts}
          onClose={() => setShowTriggerShortcuts(false)}
          socket={socket}
          gameId={safeView.id}
          playerId={you}
          currentShortcuts={(safeView as any).triggerShortcuts?.[you] || []}
          activeCards={safeView.battlefield?.map((p: any) => p.card?.name || '').filter(Boolean) || []}
        />
      )}

      {safeView && (
        <GameCommunicationsPanel
          chatMessages={chat}
          gameLogEntries={gameLogEntries}
          onSendChat={sendChat}
          resolvePlayerName={resolvePlayerName}
          bottomInset={showMobileChrome ? mobilePlayLayout.playAreaBottomInset : 0}
        />
      )}

      {/* Ignored Cards Panel - Shows cards ignored for auto-pass */}
      {safeView && you && ignoredCards.length > 0 && (
        <IgnoredCardsPanel
          ignoredCards={ignoredCards}
          you={you}
          onUnignore={(cardId) => {
            socket.emit('unignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
            });
          }}
          onClearAll={() => {
            socket.emit('clearIgnoredCards' as any, {
              gameId: safeView.id,
            });
          }}
        />
      )}

      {/* May auto preferences (Always No / Always Yes / No until targets change) */}
      {safeView && you && mayAutoPreferenceEntries.length > 0 && (
        <MayAutoPreferencesPanel
          preferences={mayAutoPreferenceEntries}
          you={you}
          onClear={(effectKey) => {
            socket.emit('setMayAutoPreference', {
              gameId: safeView.id,
              effectKey,
              value: null,
            });
          }}
          onClearAll={() => {
            for (const entry of mayAutoPreferenceEntries) {
              socket.emit('setMayAutoPreference', {
                gameId: safeView.id,
                effectKey: entry.effectKey,
                value: null,
              });
            }
          }}
        />
      )}
    </>
  );
}
