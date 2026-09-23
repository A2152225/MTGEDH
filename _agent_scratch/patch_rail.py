import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

rail = Path(r'D:\Git\MTGEDH\client\src\App-handlers\appPlayLayoutRail.tsx')

# Destructure additional props
patch_once(
    rail,
    """    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    autoYesOptional,
    canKeepHand,""",
    """    aiControlEnabled,
    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    autoYesOptional,
    availableUndoCount,
    canKeepHand,""",
)

patch_once(
    rail,
    """    handleClearAllAutoPass,
    handleClearLoopShortcut,
    handleDeckMgrOpenChange,
    handleDeleteSavedLoopShortcut,
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
    handleToggleAutoYesOptional,""",
    """    handleClearAllAutoPass,
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
    handleUndoToTurnPhase,""",
)

patch_once(
    rail,
    """    setShowLoopShortcutPanel,
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
  } = p;""",
    """    setShowLoopShortcutPanel,
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
  } = p;""",
)

# Pass tools props into MobilePlaySheets
patch_once(
    rail,
    """            onRandomizeStart={emitRandomizeStart}
            isPreGame={isPreGame}
          />
        </>
      )}""",
    """            onRandomizeStart={emitRandomizeStart}
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
            onOpenTriggerShortcuts={() => setShowTriggerShortcuts(true)}
            onOpenLoopShortcuts={() => setShowLoopShortcutPanel(true)}
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
      )}""",
)

print('rail ok')