// Origin parent: client/src/App.tsx
// Cluster moved: utility rail and mobile dock
// Public entry symbols: renderAppPlayLayoutRail.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import type { KnownCardRef, CardFace } from "../../../shared/src";
import { CardPreviewLayer, PreviewSizeControl } from "../components/CardPreviewLayer";
import { MobileActionDock } from "../components/MobileActionDock";
import { YourTurnBanner } from "../components/YourTurnBanner";
import { MobileHandStrip } from "../components/MobileHandStrip";
import { MobilePlaySheets } from "../components/MobilePlaySheets";
import { AutoPassSettingsPanel } from "../components/AutoPassSettingsPanel";
import { IgnoredCardsPanel } from "../components/IgnoredCardsPanel";
import { LoopShortcutPanel } from "../components/LoopShortcutPanel";
import { ManualModeControl } from "../components/ManualModeControl";
import { clampLoopShortcutIterations } from "../utils/loopShortcuts";
import { getMobilePrimaryActionMode } from "../utils/mobilePlayActions";

export function renderAppPlayLayoutRail(p: Record<string, any>) {
  const {
    allPlayersHaveDecks,
    allPlayersKeptHands,
    appearanceSettings,
    aiControlEnabled,
    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    autoYesOptional,
    availableUndoCount,
    canKeepHand,
    canMulligan,
    canPass,
    canUnkeepHand,
    damageReplacementEffectActiveCount,
    damageReplacementMode,
    handleClearAllAutoPass,
    handleClearLoopShortcut,
    handleDeckMgrOpenChange,
    handleDeleteSavedLoopShortcut,
    handleIgnoreTriggerSourceFromStack,
    handleLoadSavedLoopShortcut,
    handleOpenUndoMenu,
    handleRequestUndoTurnPhaseTargets,
    handleRunLoopShortcut,
    handleSaveLoopShortcut,
    handleSelectAllAutoPass,
    handleStartLoopShortcutRecording,
    handleStopIgnoringSource,
    handleStopLoopShortcutRecording,
    handleToggleAIControl,
    handleToggleAutoPass,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    handleToggleAutoPassForTurn,
    handleToggleAutoYesOptional,
    handleUndoToTurnPhase,
    hasKeptHand,
    ignoredCards,
    ignoredTriggerSources,
    imagePref,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    isPreGame,
    isSpectator,
    isYouPlayer,
    layout,
    leaveGame,
    loopShortcutItems,
    loopShortcutIterations,
    loopShortcutName,
    loopShortcutStatusText,
    manaPool,
    mobilePlayLayout,
    mobilePlaySheet,
    mulligansTaken,
    needsDeckImport,
    needsToKeepHand,
    openSplitCardChoice,
    phaseAdvanceBlockReason,
    playLandWithPromptSync,
    priority,
    reasonCannotCast,
    reasonCannotPlayLand,
    requestCastSpellWithPromptSync,
    safeView,
    savedLoopShortcuts,
    setDamageReplacementMode,
    setJoinCollapsed,
    setLoopShortcutIterations,
    setLoopShortcutName,
    setMobilePlaySheet,
    setPhaseNavigatorAdvancing,
    setReplacementEffectSettingsOpen,
    setShowLoopShortcutPanel,
    setShowTriggerShortcuts,
    setUtilityRailCollapsed,
    showExpandedUtilityRail,
    showLoopShortcutPanel,
    showMobileChrome,
    showUtilityRail,
    undoTurnPhaseTargets,
    utilityRailCollapsed,
    view,
    you,
    yourHandCards,
    yourHandCount,
    yourTurnBannerVisible,
  } = p;

  const mobilePrimaryMode = getMobilePrimaryActionMode({
    isSeatedPlayer: !!isYouPlayer && !isSpectator,
    needsToKeepHand: !!needsToKeepHand,
    canUnkeepHand: !!canUnkeepHand,
  });
  const emitKeepHand = () => {
    if (!safeView?.id) return;
    if (hasKeptHand && canUnkeepHand) {
      socket.emit("unkeepHand", { gameId: safeView.id });
      return;
    }
    socket.emit("keepHand", { gameId: safeView.id });
  };
  const emitMulligan = () => {
    if (!safeView?.id) return;
    socket.emit("mulligan", { gameId: safeView.id });
  };
  const emitUnkeepHand = () => {
    if (!safeView?.id) return;
    socket.emit("unkeepHand", { gameId: safeView.id });
  };
  const emitRandomizeStart = () => {
    if (!safeView?.id) return;
    socket.emit("randomizeStartingPlayer", { gameId: safeView.id });
  };

  const handleUnignoreCard = (cardId: string) => {
    if (!safeView) return;
    socket.emit("unignoreCardForAutoPass" as any, {
      gameId: safeView.id,
      cardId,
    });
  };

  const handleClearIgnoredCards = () => {
    if (!safeView) return;
    socket.emit("clearIgnoredCards" as any, {
      gameId: safeView.id,
    });
  };

  return (
    <>
      {/* RIGHT COLUMN: docked utilities on wider screens */}
      <div style={{ minWidth: 0, width: '100%', overflow: 'hidden', maxWidth: '100%', boxSizing: 'border-box', ...(showUtilityRail ? null : { display: 'none' }) }}>
        {showUtilityRail && safeView && you && (
          <div
            style={{
              position: 'sticky',
              top: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              width: '100%',
              zIndex: 20,
              overflow: 'hidden',
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            <div
              style={{
                padding: utilityRailCollapsed ? '10px 8px' : '10px 12px',
                borderRadius: 10,
                background: 'linear-gradient(90deg, rgba(15,15,25,0.95), rgba(25,25,40,0.95))',
                border: '1px solid rgba(99,102,241,0.3)',
                color: '#e5e7eb',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                justifyContent: utilityRailCollapsed ? 'center' : 'space-between',
                gap: 8,
              }}
            >
              <span>{utilityRailCollapsed ? 'Rail' : 'Utility Rail'}</span>
              <button
                type="button"
                onClick={() => setUtilityRailCollapsed((prev: any) => !prev)}
                style={{
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  padding: utilityRailCollapsed ? '8px 6px' : '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  minWidth: utilityRailCollapsed ? 48 : undefined,
                }}
                title={utilityRailCollapsed ? 'Expand utility rail' : 'Collapse utility rail'}
              >
                {utilityRailCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>

            {utilityRailCollapsed && !isSpectator && (
              <IgnoredCardsPanel
                variant="rail"
                railCollapsed
                ignoredCards={ignoredCards || []}
                you={you}
                onUnignore={handleUnignoreCard}
                onClearAll={handleClearIgnoredCards}
                onExpandRail={() => setUtilityRailCollapsed(false)}
              />
            )}

            {!utilityRailCollapsed && (
              <>
                {!isSpectator && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <AutoPassSettingsPanel
                    docked
                    defaultCollapsed
                    autoPassSteps={autoPassSteps}
                    onToggleAutoPass={handleToggleAutoPass}
                    onClearAll={handleClearAllAutoPass}
                    onSelectAll={handleSelectAllAutoPass}
                    isSinglePlayer={
                      !isPreGame &&
                      (safeView.players || []).filter((p: any) => !p.spectator && !p.inactive).length === 1
                    }
                    onToggleAutoPassForTurn={handleToggleAutoPassForTurn}
                    autoPassForTurnEnabled={autoPassForTurn}
                    autoPassEmptyStackOnOpponentsTurnEnabled={autoPassEmptyStackOnOpponentsTurn}
                    onToggleAutoPassEmptyStackOnOpponentsTurn={handleToggleAutoPassEmptyStackOnOpponentsTurn}
                    autoYesOptionalEnabled={autoYesOptional}
                    onToggleAutoYesOptional={handleToggleAutoYesOptional}
                  />

                  <IgnoredCardsPanel
                    variant="rail"
                    ignoredCards={ignoredCards || []}
                    you={you}
                    onUnignore={handleUnignoreCard}
                    onClearAll={handleClearIgnoredCards}
                  />

                  <button
                    onClick={() => setShowTriggerShortcuts(true)}
                    style={{
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

                  <ManualModeControl
                    variant="rail"
                    gameId={safeView.id}
                    you={you}
                    view={safeView}
                  />

                </div>
                )}
                <PreviewSizeControl />
              </>
            )}
          </div>
        )}
      </div>

      <YourTurnBanner open={yourTurnBannerVisible} />
      <CardPreviewLayer controlMode={showExpandedUtilityRail ? 'hidden' : 'floating'} />

      {/* Loop panel is shared by desktop rail + mobile Tools hub (rail is off on mobile). */}
      {(showUtilityRail || showMobileChrome) && safeView && you && !isSpectator && (
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
      )}

      {/* Mobile bottom action dock — only on touch devices with narrow
          viewports during an active table. Surfaces the most-used Pass action
          where the desktop utility rail is hidden. Desktop is unaffected
          because the gate requires both touch input AND viewport < 900. */}
      {showMobileChrome && (
        <>
          <MobileHandStrip
            cards={yourHandCards}
            handCount={yourHandCount}
            imagePref={imagePref}
            thumbWidth={mobilePlayLayout.handStripThumbWidth}
            playableCards={(safeView as any)?.playableCards}
            costAdjustments={(safeView as any)?.costAdjustments}
            appearanceSettings={appearanceSettings}
            onPlayLand={(cardId) =>
              safeView && playLandWithPromptSync({ gameId: safeView.id, cardId })
            }
            onCast={(cardId) => {
              if (!safeView || !you) return;
              const zones = safeView.zones?.[you];
              const hand = zones?.hand || [];
              const card = hand.find((c: any) => c?.id === cardId) as KnownCardRef | undefined;
              if (!card) return;
              const layout = (card as any).layout || '';
              const cardFaces = (card as any).card_faces as CardFace[] | undefined;
              const hasFaces = cardFaces && cardFaces.length >= 2;
              const needsFaceChoice = hasFaces && (
                layout === 'split' ||
                layout === 'adventure' ||
                layout === 'modal_dfc'
              );
              if (needsFaceChoice && cardFaces) {
                openSplitCardChoice(cardId, card, 'hand');
              } else {
                requestCastSpellWithPromptSync({ gameId: safeView.id, cardId });
              }
            }}
            reasonCannotPlayLand={reasonCannotPlayLand}
            reasonCannotCast={reasonCannotCast}
            onExpandHand={() => setMobilePlaySheet('hand')}
            dockHeight={mobilePlayLayout.orientation === 'portrait' ? 56 : 52}
          />
          <MobileActionDock
            onPassPriority={() => socket.emit("passPriority", { gameId: safeView.id, by: you })}
            passDisabled={!canPass}
            highlightPass={safeView.priority === you}
            handCount={yourHandCount}
            stackCount={safeView.stack?.length ?? 0}
            onOpenHand={() => setMobilePlaySheet('hand')}
            onOpenStack={() => setMobilePlaySheet('stack')}
            onOpenMana={() => setMobilePlaySheet('mana')}
            onOpenMore={() => setMobilePlaySheet('more')}
            onOpenDeck={() => handleDeckMgrOpenChange(true)}
            highlightDeck={needsDeckImport}
            deckLabel={needsDeckImport ? "Import" : "Deck"}
            primaryMode={mobilePrimaryMode}
            canKeepHand={canKeepHand}
            canMulligan={canMulligan}
            canUnkeepHand={canUnkeepHand}
            mulligansTaken={mulligansTaken}
            onKeepHand={emitKeepHand}
            onMulligan={emitMulligan}
            onUnkeepHand={emitUnkeepHand}
          />
          <MobilePlaySheets
            activeSheet={mobilePlaySheet}
            onClose={() => setMobilePlaySheet(null)}
            handCards={yourHandCards}
            handCount={yourHandCount}
            imagePref={imagePref}
            playableCards={(safeView as any)?.playableCards}
            costAdjustments={(safeView as any)?.costAdjustments}
            appearanceSettings={appearanceSettings}
            onPlayLand={(cardId) =>
              safeView && playLandWithPromptSync({ gameId: safeView.id, cardId })
            }
            onCast={(cardId) => {
              if (!safeView || !you) return;
              const zones = safeView.zones?.[you];
              const hand = zones?.hand || [];
              const card = hand.find((c: any) => c?.id === cardId) as KnownCardRef | undefined;
              if (!card) return;
              const layout = (card as any).layout || '';
              const cardFaces = (card as any).card_faces as CardFace[] | undefined;
              const hasFaces = cardFaces && cardFaces.length >= 2;
              const needsFaceChoice = hasFaces && (
                layout === 'split' ||
                layout === 'adventure' ||
                layout === 'modal_dfc'
              );
              if (needsFaceChoice && cardFaces) {
                openSplitCardChoice(cardId, card, 'hand');
              } else {
                requestCastSpellWithPromptSync({ gameId: safeView.id, cardId });
              }
            }}
            onReorderHand={(order) =>
              safeView && socket.emit("reorderHand", { gameId: safeView.id, order })
            }
            reasonCannotPlayLand={reasonCannotPlayLand}
            reasonCannotCast={reasonCannotCast}
            stack={(safeView.stack as any) || []}
            battlefield={safeView?.battlefield}
            players={safeView.players}
            you={you || undefined}
            priority={safeView.priority}
            onPassPriority={() => you && socket.emit("passPriority", { gameId: safeView.id, by: you })}
            onResolveAllTriggers={() => safeView && socket.emit("resolveAllTriggers", { gameId: safeView.id })}
            onResolveIdenticalTriggers={(count) => safeView && socket.emit("resolveIdenticalTriggers" as any, { gameId: safeView.id, count })}
            ignoredTriggerSources={ignoredTriggerSources}
            onIgnoreTriggerSource={handleIgnoreTriggerSourceFromStack}
            onStopIgnoringSource={handleStopIgnoringSource}
            manaPool={manaPool}
            phase={String(safeView.phase || '')}
            step={String(safeView.step || '')}
            turnPlayer={safeView.turnPlayer}
            isYourTurn={safeView.turnPlayer != null && safeView.turnPlayer === you}
            hasPriority={safeView.priority === you}
            stackEmpty={!((safeView as any).stack?.length > 0)}
            allPlayersReady={allPlayersHaveDecks && allPlayersKeptHands}
            phaseAdvanceBlockReason={phaseAdvanceBlockReason}
            onAdvanceOneStep={() => socket.emit("nextStep", { gameId: safeView.id })}
            onSkipToPhase={(targetPhase, targetStep) =>
              socket.emit("skipToPhase", { gameId: safeView.id, targetPhase, targetStep })
            }
            onConcede={() => socket.emit("concede", { gameId: safeView.id })}
            onLeaveGame={() => leaveGame(() => setJoinCollapsed(false))}
            primaryMode={mobilePrimaryMode}
            canKeepHand={canKeepHand}
            canMulligan={canMulligan}
            canUnkeepHand={canUnkeepHand}
            mulligansTaken={mulligansTaken}
            onKeepHand={emitKeepHand}
            onMulligan={emitMulligan}
            onUnkeepHand={emitUnkeepHand}
            onRandomizeStart={emitRandomizeStart}
            isPreGame={isPreGame}
            autoPassSteps={autoPassSteps}
            onToggleAutoPass={handleToggleAutoPass}
            onClearAllAutoPass={handleClearAllAutoPass}
            onSelectAllAutoPass={handleSelectAllAutoPass}
            isSinglePlayer={
              !isPreGame &&
              (safeView.players || []).filter((pl: any) => !pl.spectator && !pl.inactive).length === 1
            }
            onToggleAutoPassForTurn={handleToggleAutoPassForTurn}
            autoPassForTurnEnabled={autoPassForTurn}
            autoPassEmptyStackOnOpponentsTurnEnabled={autoPassEmptyStackOnOpponentsTurn}
            onToggleAutoPassEmptyStackOnOpponentsTurn={handleToggleAutoPassEmptyStackOnOpponentsTurn}
            autoYesOptionalEnabled={autoYesOptional}
            onToggleAutoYesOptional={handleToggleAutoYesOptional}
            ignoredCards={ignoredCards || []}
            onUnignoreCard={handleUnignoreCard}
            onClearIgnoredCards={handleClearIgnoredCards}
            onOpenTriggerShortcuts={() => {
              setMobilePlaySheet(null);
              setShowTriggerShortcuts(true);
            }}
            onOpenLoopShortcuts={() => {
              setMobilePlaySheet(null);
              setShowLoopShortcutPanel(true);
            }}
            gameId={safeView.id}
            view={safeView}
            availableUndoCount={availableUndoCount}
            undoTurnPhaseTargets={undoTurnPhaseTargets || []}
            onOpenUndoMenu={handleOpenUndoMenu}
            onRequestUndoTurnPhaseTargets={handleRequestUndoTurnPhaseTargets}
            onUndoToTurnPhase={handleUndoToTurnPhase}
            aiControlEnabled={aiControlEnabled}
            onToggleAIControl={handleToggleAIControl}
            onRollDie={(sides: number) => safeView && socket.emit("rollDie", { gameId: safeView.id, sides })}
            onFlipCoin={() => safeView && socket.emit("flipCoin", { gameId: safeView.id })}
            isSpectator={!!isSpectator}
          />
        </>
      )}

    </>
  );
}
