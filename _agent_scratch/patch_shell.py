import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

shell = Path(r'D:\Git\MTGEDH\client\src\App-handlers\appPlayShell.tsx')

patch_once(
    shell,
    """      {renderAppPlayLayoutRail({
        allPlayersHaveDecks,
        allPlayersKeptHands,
        appearanceSettings,
        autoPassEmptyStackOnOpponentsTurn,
        autoPassForTurn,
        autoPassSteps,
        autoYesOptional,
        canKeepHand,""",
    """      {renderAppPlayLayoutRail({
        aiControlEnabled,
        allPlayersHaveDecks,
        allPlayersKeptHands,
        appearanceSettings,
        autoPassEmptyStackOnOpponentsTurn,
        autoPassForTurn,
        autoPassSteps,
        autoYesOptional,
        availableUndoCount,
        canKeepHand,""",
)

patch_once(
    shell,
    """        handleClearAllAutoPass,
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
        handleToggleAutoYesOptional,""",
    """        handleClearAllAutoPass,
        handleClearLoopShortcut,
        handleDeckMgrOpenChange,
        handleDeleteSavedLoopShortcut,
        handleFocusPlayer,
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
    shell,
    """        showLoopShortcutPanel,
        showMobileChrome,
        showUtilityRail,
        utilityRailCollapsed,
        view,
        you,
        yourHandCards,
        yourHandCount,
        yourTurnBannerVisible,
      })}""",
    """        showLoopShortcutPanel,
        showMobileChrome,
        showUtilityRail,
        undoTurnPhaseTargets,
        utilityRailCollapsed,
        view,
        you,
        yourHandCards,
        yourHandCount,
        yourTurnBannerVisible,
      })}""",
)

print('shell ok')