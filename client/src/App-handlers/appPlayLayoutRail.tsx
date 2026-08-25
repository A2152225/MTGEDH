// Origin parent: client/src/App.tsx
// Cluster moved: utility rail and mobile dock
// Public entry symbols: renderAppPlayLayoutRail.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { readPlayerLife, lifeTotalColor } from "../utils/gameDisplayHelpers";
import type { KnownCardRef, CardFace } from "../../../shared/src";
import { CardPreviewLayer, PreviewSizeControl } from "../components/CardPreviewLayer";
import { MobileActionDock } from "../components/MobileActionDock";
import { YourTurnBanner } from "../components/YourTurnBanner";
import { MobileHandStrip } from "../components/MobileHandStrip";
import { MobilePlaySheets } from "../components/MobilePlaySheets";
import { PhaseNavigator } from "../components/PhaseNavigator";
import { AutoPassSettingsPanel } from "../components/AutoPassSettingsPanel";
import { LoopShortcutPanel } from "../components/LoopShortcutPanel";
import { clampLoopShortcutIterations } from "../utils/loopShortcuts";

export function renderAppPlayLayoutRail(p: Record<string, any>) {
  const {
    allPlayersHaveDecks,
    allPlayersKeptHands,
    appearanceSettings,
    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    autoYesOptional,
    canPass,
    clearPlayerFocus,
    damageReplacementEffectActiveCount,
    damageReplacementMode,
    focusedPlayerId,
    handleClearAllAutoPass,
    handleClearLoopShortcut,
    handleDeckMgrOpenChange,
    handleDeleteSavedLoopShortcut,
    handleFocusPlayer,
    handleIgnoreTriggerSourceFromStack,
    handleLoadSavedLoopShortcut,
    handleRunLoopShortcut,
    handleSaveLoopShortcut,
    handleSelectAllAutoPass,
    handleStartLoopShortcutRecording,
    handleStopIgnoringSource,
    handleStopLoopShortcutRecording,
    handleToggleAutoPass,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    handleToggleAutoPassForTurn,
    handleToggleAutoYesOptional,
    ignoredTriggerSources,
    imagePref,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    isPreGame,
    layout,
    leaveGame,
    loopShortcutItems,
    loopShortcutIterations,
    loopShortcutName,
    loopShortcutStatusText,
    manaPool,
    mobilePlayLayout,
    mobilePlaySheet,
    needsDeckImport,
    openSplitCardChoice,
    phaseAdvanceBlockReason,
    playLandWithPromptSync,
    playerFocusOrder,
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
    utilityRailCollapsed,
    view,
    you,
    yourHandCards,
    yourHandCount,
    yourTurnBannerVisible,
  } = p;
  return (
    <>
      {/* RIGHT COLUMN: docked utilities on wider screens */}
      <div>
        {showUtilityRail && safeView && you && (
          <div
            style={{
              position: 'sticky',
              top: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
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

            {utilityRailCollapsed ? (
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(20,20,30,0.95)',
                  padding: '10px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  alignItems: 'center',
                  color: '#e5e7eb',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93c5fd' }}>
                  {playerFocusOrder.length} Seats
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.4 }}>
                  Expand for focus, phase, auto-pass, and shortcuts.
                </div>
                <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.08)' }} />
                <div style={{ fontSize: 10, color: '#34d399', lineHeight: 1.3 }}>Turn</div>
                <div style={{ fontSize: 11, fontWeight: 600, wordBreak: 'break-word' }}>
                  {playerFocusOrder.find((player: any) => player.id === safeView.turnPlayer)?.name || 'Waiting'}
                </div>
                {safeView.turnPlayer && (
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: lifeTotalColor(readPlayerLife(safeView.life, safeView.turnPlayer)),
                    }}
                  >
                    {readPlayerLife(safeView.life, safeView.turnPlayer)} life
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  style={{
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(20,20,30,0.95)',
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    color: '#e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Player Focus
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
                    Turn-order view switcher. Click a player to center on their board. Click again or use Table overview to pan freely.
                  </div>
                  <button
                    type="button"
                    onClick={clearPlayerFocus}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: focusedPlayerId
                        ? '1px solid rgba(59,130,246,0.85)'
                        : '1px solid rgba(255,255,255,0.08)',
                      background: focusedPlayerId
                        ? 'rgba(255,255,255,0.04)'
                        : 'rgba(30,64,175,0.28)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                    title="Zoom out and pan the full table without snapping to a player board"
                  >
                    Table overview
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {playerFocusOrder.map((player: any, index: number) => {
                      const isTurnPlayer = safeView.turnPlayer === player.id;
                      const isFocused = focusedPlayerId === player.id;
                      const isYouPlayerFocus = you === player.id;
                      const playerLife = readPlayerLife(safeView.life, player.id);
                      return (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => handleFocusPlayer(player.id)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: isFocused
                              ? '1px solid rgba(59,130,246,0.85)'
                              : '1px solid rgba(255,255,255,0.08)',
                            background: isFocused
                              ? 'rgba(30,64,175,0.28)'
                              : 'rgba(255,255,255,0.04)',
                            color: '#fff',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          title={`Center on ${player.name}`}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ fontSize: 10, color: '#9ca3af', minWidth: 18 }}>{index + 1}.</span>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {player.name}{isYouPlayerFocus ? ' (You)' : ''}
                            </span>
                            <span
                              style={{
                                flexShrink: 0,
                                fontSize: 12,
                                fontWeight: 700,
                                color: lifeTotalColor(playerLife),
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={`${player.name}: ${playerLife} life`}
                            >
                              {playerLife}
                            </span>
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {isTurnPlayer && <span style={{ fontSize: 10, color: '#34d399' }}>Turn</span>}
                            {isFocused && <span style={{ fontSize: 10, color: '#93c5fd' }}>Focused</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <PhaseNavigator
                  docked
                  currentPhase={safeView.phase}
                  currentStep={safeView.step}
                  turnPlayer={safeView.turnPlayer}
                  you={you}
                  isYourTurn={safeView.turnPlayer != null && safeView.turnPlayer === you}
                  hasPriority={safeView.priority === you}
                  stackEmpty={!((safeView as any).stack?.length > 0)}
                  allPlayersReady={allPlayersHaveDecks && allPlayersKeptHands}
                  phaseAdvanceBlockReason={phaseAdvanceBlockReason}
                  showDamageReplacementToggle={damageReplacementEffectActiveCount > 1}
                  damageReplacementMode={damageReplacementMode}
                  onSetDamageReplacementMode={(mode) => {
                    if (!safeView?.id) return;
                    setDamageReplacementMode(mode);
                    socket.emit('setReplacementEffectOrder', {
                      gameId: safeView.id,
                      effectType: 'damage',
                      mode,
                      customOrder: [],
                    });
                  }}
                  onOpenReplacementEffectSettings={() => setReplacementEffectSettingsOpen(true)}
                  onAdvanceOneStep={() => socket.emit("nextStep", { gameId: safeView.id })}
                  onPassPriority={() => you && socket.emit("passPriority", { gameId: safeView.id, by: you })}
                  onAdvancingChange={setPhaseNavigatorAdvancing}
                  onSkipToPhase={(targetPhase: string, targetStep?: string) => socket.emit("skipToPhase", { gameId: safeView.id, targetPhase, targetStep })}
                />

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

                  <PreviewSizeControl />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <YourTurnBanner open={yourTurnBannerVisible} />
      <CardPreviewLayer controlMode={showExpandedUtilityRail ? 'hidden' : 'floating'} />

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
          />
        </>
      )}

    </>
  );
}
