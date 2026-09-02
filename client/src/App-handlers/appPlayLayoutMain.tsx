// Origin parent: client/src/App.tsx
// Cluster moved: main play column (join through table)
// Public entry symbols: renderAppPlayLayoutMain.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { TableLayout } from "../components/TableLayout";
import type { KnownCardRef, CardFace } from "../../../shared/src";
import { ResolutionMinimizedChip, ResolutionPromptMinimizeButton } from "../components/ResolutionMinimizedChip";
import { SeatStrip } from "../components/SeatStrip";
import { GameStatusIndicator } from "../components/GameStatusIndicator";
import { GameStatusPhaseStrip } from "../components/GameStatusPhaseStrip";
import { DeckManagerModal } from "../components/DeckManagerModal";
import { AddAIToGameControl } from "../components/AddAIToGameControl";
import GameList from "../components/GameList";
import { AuthSessionPanel } from "../components/AuthSessionPanel";
import { SettingsMenu } from "../components/SettingsMenu";

export function renderAppPlayLayoutMain(p: Record<string, any>) {
  const {
    activeResolutionPrompt,
    aiControlEnabled,
    aiStrategy,
    allPlayersHaveDecks,
    allPlayersKeptHands,
    damageReplacementEffectActiveCount,
    damageReplacementMode,
    appearanceSettings,
    availableUndoCount,
    canKeepHand,
    canMulligan,
    canUnkeepHand,
    chat,
    clearPlayerFocus,
    connected,
    effectiveGameId,
    focusedPlayerId,
    handleCastCommander,
    handleDeckMgrOpenChange,
    handleFocusPlayer,
    handleIgnoreTriggerSourceFromStack,
    handleLocalImportConfirmChange,
    handleOpenUndoMenu,
    handleRequestUndo,
    handleRequestUndoTurnPhaseTargets,
    handleStopIgnoringSource,
    handleToggleAIControl,
    handleUndoToTurnPhase,
    handleUseTopOfLibrary,
    handleViewExile,
    handleViewGraveyard,
    hasKeptHand,
    ignoredCardIds,
    ignoredTriggerSources,
    imagePref,
    importedCandidates,
    isPreGame,
    isResolutionStepMinimized,
    isYouPlayer,
    isSpectator,
    joinCollapsed,
    joinFromList,
    layout,
    leaveGame,
    manaPool,
    minimizeResolutionStep,
    minimizedResolutionStep,
    missingImport,
    mobilePlayLayout,
    mulligansTaken,
    myPendingResolutionCount,
    nameInput,
    authSession,
    needsDeckImport,
    openSplitCardChoice,
    pendingBottomCount,
    phaseAdvanceBlockReason,
    pickRandomDeck,
    pickingRandomDeck,
    playLandWithPromptSync,
    priority,
    randomDeckError,
    randomDeckMessage,
    reasonCannotCast,
    reasonCannotPlayLand,
    requestCastSpellWithPromptSync,
    requestImportDeck,
    requestUseSavedDeck,
    restoreResolutionStep,
    safeView,
    scheduleResolutionPromptNudge,
    setAppearanceModalOpen,
    setCreateGameModalOpen,
    setDamageReplacementMode,
    setDeckBuilderOpen,
    setPhaseNavigatorAdvancing,
    setReplacementEffectSettingsOpen,
    setJoinCollapsed,
    setMissingImport,
    setNameInput,
    setTableDeckMgrOpen,
    setTopDeckMgrAnchorEl,
    showMobileChrome,
    showMulliganUI,
    showTableMulliganUI,
    showTopPanelPregameActions,
    smartUndoCounts,
    tableDeckMgrOpen,
    textColors,
    topDeckMgrAnchorEl,
    undoTurnPhaseTargets,
    view,
    you,
    yourLibraryCount,
  } = p;
  const seatedPlayerCount = ((safeView?.players || []) as any[]).filter(
    (player: any) => player && !player.spectator && !player.isSpectator,
  ).length;
  const seatedAIs = ((safeView?.players || []) as any[])
    .filter((player: any) => player && !player.spectator && !player.isSpectator && player.isAI)
    .map((player: any) => ({
      id: String(player.id),
      name: String(player.name || 'AI Opponent'),
      deckName: typeof player.deckName === 'string' && player.deckName.trim()
        ? player.deckName
        : undefined,
    }));
  const showAddAIControl = Boolean(
    isYouPlayer && isPreGame && !allPlayersKeptHands && safeView?.id,
  );
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, width: "100%", maxWidth: "100%", overflow: "hidden", paddingRight: 8 }}>
        {/* JOIN / ACTIVE GAMES (collapsible/accordion) - at very top */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: joinCollapsed ? "4px 8px" : 8,
            background: "rgba(30, 30, 40, 0.95)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => setJoinCollapsed((c: any) => !c)}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: "#e5e5e5", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#a78bfa" }}>🎮</span>
              Join / Active Games
            </div>
            <div style={{ fontSize: 14, color: "#a78bfa" }}>
              {joinCollapsed ? "▸" : "▾"}
            </div>
          </div>

          {!joinCollapsed && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <AuthSessionPanel
                  user={authSession?.user ?? null}
                  busy={authSession?.busy}
                  error={authSession?.error}
                  nameInput={nameInput}
                  onNameInput={setNameInput}
                  onLogin={(username, password) => authSession?.login ? authSession.login(username, password) : Promise.reject(new Error('Auth is not ready. Refresh the page.'))}
                  onRegister={(payload) => authSession?.register ? authSession.register(payload) : Promise.reject(new Error('Auth is not ready. Refresh the page.'))}
                  onLogout={() => { void authSession?.logout?.(); }}
                />
                <button
                  onClick={() => setCreateGameModalOpen(true)}
                  disabled={!connected}
                  style={{
                    backgroundColor: "#10b981",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "4px 12px",
                    fontSize: 12,
                    cursor: connected ? "pointer" : "not-allowed",
                  }}
                >
                  + Create Game
                </button>
                <button
                  onClick={() => setDeckBuilderOpen(true)}
                  style={{
                    backgroundColor: "#6366f1",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "4px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  🗂️ Deck Builder
                </button>
                <SettingsMenu
                  user={authSession?.user ?? null}
                  busy={authSession?.busy}
                  onLogout={() => { void authSession?.logout?.(); }}
                  onOpenAppearance={() => setAppearanceModalOpen(true)}
                />
              </div>

              <div style={{ marginTop: 8 }}>
                <GameList onJoin={joinFromList} currentPlayerId={you} isAdmin={!!authSession?.user?.isAdmin} />
              </div>
            </>
          )}
        </div>

        {/* HEADER (game id, format) — compact on mobile play */}
        {!showMobileChrome ? (
          safeView ? (
            <div style={{ fontSize: 12, color: textColors.secondary, padding: "0 2px" }}>
              Game: {effectiveGameId} • Format:{" "}
              {String(safeView?.format ?? "")}
            </div>
          ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h1 style={{ margin: 0, color: textColors.primary }}>MTGEDH</h1>
              <div style={{ fontSize: 12, color: textColors.secondary }}>
                Game: {effectiveGameId} • Format:{" "}
                {String(safeView?.format ?? "")}
              </div>
            </div>
          </div>
          )
        ) : (
          <div style={{ fontSize: 11, color: textColors.secondary, padding: '0 2px' }}>
            {String(safeView?.format ?? "Commander")} • {effectiveGameId}
          </div>
        )}

        {/* GAME STATUS INDICATOR - Shows turn, phase, step, priority, special designations, and control buttons */}
        {safeView && (
          <GameStatusIndicator
            compact={showMobileChrome}
            turn={safeView.turn}
            phase={safeView.phase}
            step={safeView.step}
            turnPlayer={safeView.turnPlayer}
            priority={safeView.priority}
            players={safeView.players || []}
            you={you || undefined}
            combat={(safeView as any).combat}
            monarch={(safeView as any).monarch}
            initiative={(safeView as any).initiative}
            dayNight={(safeView as any).dayNight}
            cityBlessing={(safeView as any).cityBlessing}
            isYouPlayer={isYouPlayer}
            isSpectator={isSpectator}
            onPassPriority={() => you && socket.emit("passPriority", { gameId: safeView.id, by: you })}
            isPreGame={isPreGame}
            onJoinAsPlayer={() => joinFromList(safeView.id, false)}
            onSpectate={() => joinFromList(safeView.id, true)}
            phaseStrip={
              <GameStatusPhaseStrip
                currentPhase={safeView.phase}
                currentStep={safeView.step}
                turnPlayer={safeView.turnPlayer}
                you={you}
                isYourTurn={Boolean(isYouPlayer && safeView.turnPlayer != null && safeView.turnPlayer === you)}
                hasPriority={Boolean(isYouPlayer && safeView.priority === you)}
                stackEmpty={!((safeView as any).stack?.length > 0)}
                allPlayersReady={allPlayersHaveDecks && allPlayersKeptHands}
                phaseAdvanceBlockReason={phaseAdvanceBlockReason}
                showDamageReplacementToggle={damageReplacementEffectActiveCount > 1}
                damageReplacementMode={damageReplacementMode}
                onSetDamageReplacementMode={(mode) => {
                  if (!safeView?.id) return;
                  setDamageReplacementMode(mode);
                  socket.emit("setReplacementEffectOrder", {
                    gameId: safeView.id,
                    effectType: "damage",
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
            }
            gameOver={(safeView as any).gameOver}
            immediateConcede={Boolean((safeView as any).houseRules?.immediateConcede)}
            onConcede={() => socket.emit("concede", { gameId: safeView.id })}
            onLeaveGame={() => leaveGame(() => setJoinCollapsed(false))}
            onUndo={(scope) => handleRequestUndo(scope)}
            onOpenUndoMenu={handleOpenUndoMenu}
            availableUndoCount={availableUndoCount}
            smartUndoCounts={smartUndoCounts}
            undoTurnPhaseTargets={undoTurnPhaseTargets}
            onRequestUndoTurnPhaseTargets={handleRequestUndoTurnPhaseTargets}
            onUndoToTurnPhase={handleUndoToTurnPhase}
            onRollDie={(sides: number) => socket.emit("rollDie", { gameId: safeView.id, sides })}
            onFlipCoin={() => socket.emit("flipCoin", { gameId: safeView.id })}
            extraActions={isYouPlayer ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', width: '100%' }}>
                <button
                  ref={setTopDeckMgrAnchorEl}
                  type="button"
                  onClick={() => setTableDeckMgrOpen(true)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: yourLibraryCount === 0
                      ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)'
                      : 'rgba(59, 130, 246, 0.18)',
                    border: yourLibraryCount === 0
                      ? '1px solid rgba(167, 139, 250, 0.8)'
                      : '1px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: 4,
                    color: '#fff',
                    cursor: 'pointer',
                    boxShadow: yourLibraryCount === 0
                      ? '0 0 16px rgba(124, 58, 237, 0.35)'
                      : 'none',
                  }}
                  title={yourLibraryCount === 0 ? 'Import or select a deck' : 'Open deck manager'}
                >
                  📚 {yourLibraryCount === 0 ? 'Import Deck' : 'Decks'}
                </button>

                {isPreGame && (
                  <button
                    type="button"
                    onClick={() => { void pickRandomDeck(); }}
                    disabled={pickingRandomDeck}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      background: yourLibraryCount === 0
                        ? 'rgba(76, 29, 149, 0.35)'
                        : 'rgba(139, 92, 246, 0.18)',
                      border: yourLibraryCount === 0
                        ? '1px solid rgba(167, 139, 250, 0.55)'
                        : '1px solid rgba(167, 139, 250, 0.35)',
                      borderRadius: 4,
                      color: '#fff',
                      cursor: pickingRandomDeck ? 'wait' : 'pointer',
                      opacity: pickingRandomDeck ? 0.7 : 1,
                    }}
                    title={
                      randomDeckError
                      || randomDeckMessage
                      || 'Pick a random deck from local saves, server decks, or precons'
                    }
                  >
                    {pickingRandomDeck ? 'Rolling…' : '🎲 Random Deck'}
                  </button>
                )}

                {showAddAIControl && (
                  <AddAIToGameControl
                    gameId={safeView.id}
                    seatedPlayerCount={seatedPlayerCount}
                    seatedAIs={seatedAIs}
                  />
                )}

                {showTopPanelPregameActions && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid rgba(167, 139, 250, 0.45)',
                      background: 'rgba(45, 27, 105, 0.2)',
                      flex: '1 1 420px',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#ddd6fe', fontWeight: 600 }}>
                      Mulligans: {mulligansTaken}
                    </span>
                    {pendingBottomCount > 0 ? (
                      <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 600 }}>
                        Bottom {pendingBottomCount} card{pendingBottomCount === 1 ? '' : 's'}
                      </span>
                    ) : hasKeptHand ? (
                      <span style={{ fontSize: 12, color: '#86efac', fontWeight: 600 }}>
                        Hand kept
                      </span>
                    ) : null}
                    <button
                      onClick={() => {
                        if (hasKeptHand && canUnkeepHand) {
                          socket.emit("unkeepHand", { gameId: safeView.id });
                          return;
                        }
                        socket.emit("keepHand", { gameId: safeView.id });
                      }}
                      disabled={!canKeepHand && !canUnkeepHand}
                      style={{
                        background: hasKeptHand
                          ? (canUnkeepHand ? '#059669' : '#4b5563')
                          : (canKeepHand ? '#10b981' : '#4b5563'),
                        color: 'white',
                        border: hasKeptHand ? '1px solid rgba(167, 243, 208, 0.55)' : 'none',
                        borderRadius: 4,
                        padding: '6px 12px',
                        cursor: canKeepHand || canUnkeepHand ? 'pointer' : 'not-allowed',
                        opacity: canKeepHand || canUnkeepHand ? 1 : 0.55,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                      title={hasKeptHand && canUnkeepHand ? 'Click again to unlock your hand before the table is fully ready' : undefined}
                    >
                      {hasKeptHand ? '✓ Keep Hand' : 'Keep Hand'}
                    </button>
                    <button
                      onClick={() => socket.emit("mulligan", { gameId: safeView.id })}
                      disabled={!canMulligan}
                      style={{
                        background: canMulligan ? '#f59e0b' : '#4b5563',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 12px',
                        cursor: canMulligan ? 'pointer' : 'not-allowed',
                        opacity: canMulligan ? 1 : 0.55,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Mulligan
                    </button>
                    <button
                      onClick={() => socket.emit("randomizeStartingPlayer", { gameId: safeView.id })}
                      style={{
                        background: '#8b5cf6',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                      title="Randomize seating and which player goes first"
                    >
                      🎲 Random Start
                    </button>
                  </div>
                )}
              </div>
            ) : undefined}
            aiControlEnabled={aiControlEnabled}
            aiStrategy={aiStrategy}
            onToggleAIControl={handleToggleAIControl}
          />
        )}

        {/* IMPORT WARNINGS */}
        {missingImport && missingImport.length > 0 && (
          <div
            role="alert"
            style={{
              background: "rgba(69, 26, 3, 0.96)",
              color: "#fef3c7",
              padding: "10px 12px",
              border: "1px solid #f59e0b",
              borderRadius: 6,
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: "#fde68a" }}>Import warning</strong>: Could not resolve these names:{" "}
            <span style={{ color: "#fff7ed" }}>
              {missingImport.slice(0, 10).join(", ")}
              {missingImport.length > 10 ? ", …" : ""}.
            </span>
            <button
              type="button"
              onClick={() => setMissingImport(null)}
              style={{
                marginLeft: 12,
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #fbbf24",
                background: "rgba(245, 158, 11, 0.2)",
                color: "#fffbeb",
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Mobile deck access — local, server, and precon tabs via DeckManagerModal */}
        {showMobileChrome && needsDeckImport && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(167, 139, 250, 0.55)",
              background: "linear-gradient(90deg, rgba(76, 29, 149, 0.35), rgba(37, 99, 235, 0.25))",
              boxShadow: "0 4px 16px rgba(124, 58, 237, 0.25)",
            }}
          >
            <div style={{ fontSize: 13, color: "#ede9fe", lineHeight: 1.4 }}>
              <strong>Import a deck to play.</strong> Choose from local saves, server decks, or Commander precons.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleDeckMgrOpenChange(true)}
                style={{
                  minHeight: 44,
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid rgba(167, 139, 250, 0.8)",
                  background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Open Deck Manager
              </button>
              <button
                type="button"
                onClick={() => { void pickRandomDeck(); }}
                disabled={pickingRandomDeck}
                style={{
                  minHeight: 44,
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid rgba(167, 139, 250, 0.55)",
                  background: "rgba(76, 29, 149, 0.35)",
                  color: "#ede9fe",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: pickingRandomDeck ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                  opacity: pickingRandomDeck ? 0.7 : 1,
                }}
              >
                {pickingRandomDeck ? 'Rolling…' : 'Random Deck'}
              </button>
              {showAddAIControl && (
                <AddAIToGameControl
                  gameId={safeView.id}
                  seatedPlayerCount={seatedPlayerCount}
                  seatedAIs={seatedAIs}
                  compact
                />
              )}
            </div>
          </div>
        )}

        {showMobileChrome && showAddAIControl && !needsDeckImport && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(96, 165, 250, 0.4)",
              background: "rgba(30, 58, 138, 0.28)",
            }}
          >
            <div style={{ fontSize: 13, color: "#dbeafe" }}>
              {seatedAIs.length > 0
                ? 'Add, remove, or replace AI opponents before everyone keeps their hand.'
                : 'Add an AI opponent before everyone keeps their hand.'}
            </div>
            <AddAIToGameControl
              gameId={safeView.id}
              seatedPlayerCount={seatedPlayerCount}
              seatedAIs={seatedAIs}
              compact
            />
          </div>
        )}

        {safeView && myPendingResolutionCount > 0 && priority === null && !minimizedResolutionStep && (
          <div
            style={{
              marginBottom: 8,
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #f59e0b',
              background: 'rgba(245, 158, 11, 0.12)',
              color: '#fde68a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              fontSize: 13,
            }}
          >
            <span>
              You have a pending choice while the game is resolving. Complete it to continue.
            </span>
            <button
              type="button"
              onClick={() => scheduleResolutionPromptNudge(safeView.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #f59e0b',
                background: '#b45309',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Resume choice
            </button>
          </div>
        )}

        {minimizedResolutionStep && (
          <ResolutionMinimizedChip
            title={minimizedResolutionStep.title}
            onRestore={() => {
              restoreResolutionStep();
              // Re-fetch so options whose affordability changed while minimized
              // (e.g. after tapping lands for a "you may pay" prompt) are refreshed.
              if (safeView?.id) scheduleResolutionPromptNudge(safeView.id);
            }}
          />
        )}

        {activeResolutionPrompt
          && !isResolutionStepMinimized(activeResolutionPrompt.stepId)
          && myPendingResolutionCount > 0 && (
          <div
            style={{
              position: 'fixed',
              top: 12,
              right: 12,
              zIndex: 10005,
            }}
          >
            <ResolutionPromptMinimizeButton
              onMinimize={() => minimizeResolutionStep(
                activeResolutionPrompt.stepId,
                activeResolutionPrompt.title,
              )}
            />
          </div>
        )}

        {safeView && (
          <SeatStrip
            players={safeView.players || []}
            you={you || undefined}
            turnPlayer={safeView.turnPlayer}
            focusedPlayerId={focusedPlayerId}
            monarch={(safeView as any).monarch}
            initiative={(safeView as any).initiative}
            life={safeView.life}
            onFocusPlayer={handleFocusPlayer}
            onClearFocus={clearPlayerFocus}
          />
        )}

        {/* TABLE / PLAYING FIELD (chat handled as overlay inside TableLayout) */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: 4,
            position: "relative",
            minWidth: 0,
          }}
        >
          {safeView ? (
            <TableLayout
              players={safeView.players || []}
              permanentsByPlayer={
                new Map(
                  (safeView.players || []).map((p: any) => [
                    p.id,
                    (safeView.battlefield || []).filter(
                      (perm: any) => perm.controller === p.id
                    ),
                  ])
                )
              }
              imagePref={imagePref}
              isYouPlayer={isYouPlayer}
              splitLands
              enableReorderForYou={isYouPlayer}
              you={you || undefined}
              accountUser={authSession?.user ?? null}
              zones={safeView.zones}
              commandZone={safeView.commandZone as any}
              format={String(safeView.format || "")}
              life={safeView.life}
              commanderDamage={(safeView as any).commanderDamage}
              poisonCounters={(safeView as any).poisonCounters}
              experienceCounters={(safeView as any).experienceCounters}
              energyCounters={(safeView as any).energyCounters}
              speed={(safeView as any).speed}
              enduringStory={(safeView as any).enduringStory}
              showYourHandBelow
              onReorderHand={(order) =>
                safeView &&
                socket.emit("reorderHand", {
                  gameId: safeView.id,
                  order,
                })
              }
              onShuffleHand={() =>
                safeView &&
                socket.emit("shuffleHand", { gameId: safeView.id })
              }
              onPlayLandFromHand={(cardId) =>
                safeView &&
                playLandWithPromptSync({ gameId: safeView.id, cardId })
              }
              onCastFromHand={(cardId) => {
                if (!safeView || !you) return;
                // Find the card in hand to get its name and mana cost
                const zones = safeView.zones?.[you];
                const hand = zones?.hand || [];
                const card = hand.find((c: any) => c?.id === cardId) as KnownCardRef | undefined;
                if (!card) return;
                
                // Check if this is a split/adventure/modal card that needs face selection
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
                  // Regular card - use MTG-compliant flow: request targets first, then payment
                  // Server will check if targets are needed and respond appropriately
                  requestCastSpellWithPromptSync({
                    gameId: safeView.id,
                    cardId,
                  });
                }
              }}
              onUseTopOfLibrary={handleUseTopOfLibrary}
              onCastCommander={handleCastCommander}
              reasonCannotPlayLand={reasonCannotPlayLand}
              reasonCannotCast={reasonCannotCast}
              enablePanZoom
              tableCloth={{ imageUrl: "" }}
              worldSize={12000}
              appearanceSettings={appearanceSettings}
              onViewGraveyard={handleViewGraveyard}
              onViewExile={handleViewExile}
              onUpdatePermPos={(id: string, x: number, y: number, z: number) =>
                safeView &&
                socket.emit("updatePermanentPos", {
                  gameId: safeView.id,
                  permanentId: id,
                  x,
                  y,
                  z,
                })
              }
              onImportDeckText={(txt, nm) => requestImportDeck(txt, nm)}
              onUseSavedDeck={(deckId) => requestUseSavedDeck(deckId)}
              onLocalImportConfirmChange={handleLocalImportConfirmChange}
              externalDeckMgrOpen={tableDeckMgrOpen}
              onDeckMgrOpenChange={handleDeckMgrOpenChange}
              externalDeckMgrAnchorEl={topDeckMgrAnchorEl}
              focusedPlayerId={focusedPlayerId}
              monarch={(safeView as any).monarch}
              initiative={(safeView as any).initiative}
              dayNight={(safeView as any).dayNight}
              cityBlessing={(safeView as any).cityBlessing}
              embedYourHand={!showMobileChrome}
              playAreaBottomInset={showMobileChrome ? mobilePlayLayout.playAreaBottomInset : 0}
              gameId={safeView.id}
              stackItems={safeView.stack as any}
              importedCandidates={importedCandidates}
              chatView={view || undefined}
              priority={safeView.priority}
              phase={String(safeView.phase || '')}
              step={String(safeView.step || '')}
              turnPlayer={safeView.turnPlayer}
              ignoredTriggerSources={ignoredTriggerSources}
              onIgnoreTriggerSource={handleIgnoreTriggerSourceFromStack}
              onStopIgnoringSource={handleStopIgnoringSource}
              manaPool={manaPool}
              manaPools={(safeView as any).manaPool || null}
              // Mulligan UI props
              showMulliganUI={showTableMulliganUI}
              hasKeptHand={hasKeptHand}
              mulligansTaken={mulligansTaken}
              pendingBottomCount={pendingBottomCount}
              canKeepHand={canKeepHand}
              canMulligan={canMulligan}
              isPreGame={isPreGame}
              allPlayersKeptHands={allPlayersKeptHands}
              onKeepHand={() => socket.emit("keepHand", { gameId: safeView?.id })}
              onMulligan={() => socket.emit("mulligan", { gameId: safeView?.id })}
              onRandomizeStart={() => socket.emit("randomizeStartingPlayer", { gameId: safeView?.id })}
              playableCards={(safeView as any)?.playableCards}
              costAdjustments={(safeView as any)?.costAdjustments}
              ignoredCardIds={ignoredCardIds}
              onIgnoreForAutoPass={(permanentId, cardName, imageUrl) => {
                if (safeView?.id) {
                  socket.emit('ignoreCardForAutoPass' as any, {
                    gameId: safeView.id,
                    permanentId,
                    cardName,
                    zone: 'battlefield',
                    imageUrl,
                  });
                }
              }}
              onUnignoreForAutoPass={(permanentId) => {
                if (safeView?.id) {
                  socket.emit('unignoreCardForAutoPass' as any, {
                    gameId: safeView.id,
                    permanentId,
                  });
                }
              }}
            />
          ) : (
            <div style={{ padding: 20, color: "#666" }}>
              No game state yet. Join a game to view table.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
