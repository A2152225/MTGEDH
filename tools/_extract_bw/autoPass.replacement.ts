  const {
    autoPassSteps,
    handleToggleAutoPass,
    handleClearAllAutoPass,
    handleSelectAllAutoPass,
    autoPassForTurn,
    autoPassEmptyStackOnOpponentsTurn,
    autoYesOptional,
    handleToggleAutoYesOptional,
    handleToggleAutoPassForTurn,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    autoAdvancePhases,
    handleToggleAutoAdvance,
  } = useAppAutoPassHandlers({
    safeView,
    you,
  });
