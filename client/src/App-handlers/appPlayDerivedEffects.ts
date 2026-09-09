// Origin parent: client/src/App.tsx
// Cluster moved: leftover derived effects and memos
// Public entry symbols: useAppPlayDerivedEffects.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useEffect, useMemo, useRef } from "react";
import type { BattlefieldPermanent, ChatMsg, KnownCardRef } from "../../../shared/src";
import { useGameStateLog } from "../hooks/useGameStateLog";
import { useRandomDeckPicker } from "../hooks/useRandomDeckPicker";
import { socket } from "../socket";
import { toast } from "../components/ToastHost";
import { isLandTypeLine, prettyPhase, prettyStep } from "../utils/gameDisplayHelpers";
import { buildAvailableManaSourcesForPlayer } from "../utils/manaSourceBuilder";
import { notifyUnfocusedYourTurn } from "../utils/turnAttentionNotify";
import { shouldAutoOpenMobileMulliganHand } from "../utils/mobilePlayActions";

export function useAppPlayDerivedEffects(p: Record<string, any>) {
  const {
    autoAdvancePhases,
    batchExplorePrompt,
    chat,
    cmdModalOpen,
    cmdSuggestedGameId,
    discardCount,
    discardModalOpen,
    explorePrompt,
    gameIdInput,
    hasPromptedDeckImport,
    importedCandidates,
    layout,
    mobilePlayLayout,
    mulliganBottomLastSubmittedStepId,
    mulliganBottomModalOpen,
    peek,
    phaseNavigatorAdvancing,
    previousTurnRef,
    priority,
    requestImportDeck,
    requestUseSavedDeck,
    safeView,
    setChat,
    setFocusedPlayerId,
    setGameOverData,
    setGameOverModalOpen,
    setJoinCollapsed,
    setMobilePlaySheet,
    setMulliganBottomCount,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setPeek,
    setShowDeckImportPrompt,
    setTableDeckMgrOpen,
    setYourTurnBannerVisible,
    showDeckImportPrompt,
    utilityRailCollapsed,
    view,
    viewportWidth,
    you,
    yourTurnBannerVisible,
  } = p;
  // Explore prompt handler
  // Legacy explorePrompt / batchExplorePrompt listeners removed - now handled via Resolution Queue.

  // Interaction request handlers
  useEffect(() => {
    // Tap/Untap Target Request handler
    // tap/untap target selection is handled via Resolution Queue (resolutionStepPrompt)

    return () => {
    };
  }, [safeView?.id]);

  // Scry/Surveil peek handlers
  useEffect(() => {
    const handleScryPeek = (data: { gameId: string; cards: any[] }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      setPeek({ mode: "scry", cards: data.cards });
    };

    const handleSurveilPeek = (data: { gameId: string; cards: any[] }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      setPeek({ mode: "surveil", cards: data.cards });
    };

    socket.on("scryPeek", handleScryPeek);
    socket.on("surveilPeek", handleSurveilPeek);
    return () => {
      socket.off("scryPeek", handleScryPeek);
      socket.off("surveilPeek", handleSurveilPeek);
    };
  }, [safeView?.id]);

  // Game over notification listener
  useEffect(() => {
    const handleGameOver = (data: { 
      gameId: string; 
      type: 'victory' | 'defeat' | 'eliminated' | 'draw';
      winnerId?: string;
      winnerName?: string;
      loserId?: string;
      loserName?: string;
      message?: string;
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      
      let notificationType: 'victory' | 'defeat' | 'eliminated' | 'draw' = data.type;
      let message = data.message || '';
      
      // Determine notification type based on who we are
      if (data.type === 'victory' && data.winnerId === you) {
        notificationType = 'victory';
        message = message || "You've Won!";
      } else if (data.type === 'defeat' && data.loserId === you) {
        notificationType = 'defeat';
        message = message || "Defeated";
      } else if (data.type === 'eliminated' && data.loserId === you) {
        notificationType = 'eliminated';
        message = message || "Eliminated";
      } else if (data.type === 'draw') {
        notificationType = 'draw';
        message = message || "Draw!";
      } else if (data.winnerId && data.winnerId !== you) {
        // Someone else won
        notificationType = 'defeat';
        message = `${data.winnerName || 'Opponent'} has won the game`;
      }
      
      setGameOverData({
        type: notificationType,
        message,
        winnerId: data.winnerId,
        winnerName: data.winnerName,
      });
      setGameOverModalOpen(true);
      
      // Auto-close after 3 seconds
      setTimeout(() => {
        setGameOverModalOpen(false);
        setGameOverData(null);
      }, 3000);
    };

    const handlePlayerEliminated = (data: { 
      gameId: string; 
      playerId: string;
      playerName: string;
      reason?: string;
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      
      if (data.playerId === you) {
        setGameOverData({
          type: 'eliminated',
          message: 'Eliminated',
        });
        setGameOverModalOpen(true);
        
        setTimeout(() => {
          setGameOverModalOpen(false);
          setGameOverData(null);
        }, 3000);
      }
    };

    const handlePlayerConceded = (data: {
      gameId: string;
      playerId: string;
      playerName: string;
      message?: string;
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      
      // If you conceded, show a brief notification
      if (data.playerId === you) {
        setGameOverData({
          type: 'eliminated',
          message: 'You Conceded',
        });
        setGameOverModalOpen(true);
        
        setTimeout(() => {
          setGameOverModalOpen(false);
          setGameOverData(null);
        }, 2000);
      }
    };

    socket.on("gameOver", handleGameOver);
    socket.on("playerEliminated", handlePlayerEliminated);
    socket.on("playerConceded", handlePlayerConceded);
    return () => {
      socket.off("gameOver", handleGameOver);
      socket.off("playerEliminated", handlePlayerEliminated);
      socket.off("playerConceded", handlePlayerConceded);
    };
  }, [safeView?.id, you]);

  const isTable = layout === "table";
  const showUtilityRail =
    isTable &&
    !!safeView &&
    !!you &&
    viewportWidth >= 900 &&
    !mobilePlayLayout.showMobileChrome;
  const showExpandedUtilityRail = showUtilityRail && !utilityRailCollapsed;
  const playerFocusOrder = useMemo(() => {
    if (!safeView?.players || safeView.players.length === 0) return [];
    const activePlayers = [...safeView.players]
      .filter((player: any) => !player.spectator && !player.inactive)
      .sort((a: any, b: any) => a.seat - b.seat);
    const startIdx = safeView.turnPlayer
      ? activePlayers.findIndex((player: any) => player.id === safeView.turnPlayer)
      : -1;
    if (startIdx < 0) return activePlayers;
    return [...activePlayers.slice(startIdx), ...activePlayers.slice(0, startIdx)];
  }, [safeView]);
  const yourLibraryCount = useMemo(() => {
    if (!safeView || !you) return 0;
    const yourZones = safeView.zones?.[you] as any;
    if (!yourZones) return 0;
    if (typeof yourZones.libraryCount === 'number') return yourZones.libraryCount;
    if (Array.isArray(yourZones.library)) return yourZones.library.length;
    return 0;
  }, [safeView, you]);
  const canPass = !!safeView && !!you && safeView.priority === you;
  const youEntry =
    !!safeView && !!you && Array.isArray(safeView.players)
      ? (safeView.players as any[]).find((p: any) => p && p.id === you)
      : undefined;
  const youFlaggedSpectator = !!(youEntry && (youEntry.spectator || youEntry.isSpectator));
  const isYouPlayer = !!youEntry && !youFlaggedSpectator;
  const isSpectator = !!safeView && !!you && !isYouPlayer;
  const showMobileChrome =
    isTable && mobilePlayLayout.showMobileChrome && !!safeView && !!you && isYouPlayer;
  const needsDeckImport = yourLibraryCount === 0;
  const yourHandCards = useMemo((): KnownCardRef[] => {
    if (!safeView || !you) return [];
    const hand = safeView.zones?.[you]?.hand;
    if (!Array.isArray(hand)) return [];
    return hand.filter((c): c is KnownCardRef => !!c && typeof c === 'object' && 'id' in c);
  }, [safeView, you]);
  const yourHandCount = useMemo(() => {
    if (!safeView || !you) return 0;
    const zones = safeView.zones?.[you] as any;
    if (!zones) return 0;
    if (typeof zones.handCount === 'number') return zones.handCount;
    if (Array.isArray(zones.hand)) return zones.hand.length;
    return 0;
  }, [safeView, you]);

  useEffect(() => {
    if (!showMobileChrome || !you) return;
    setJoinCollapsed(true);
  }, [showMobileChrome, you]);

  const handleFocusPlayer = React.useCallback((playerId: string) => {
    setFocusedPlayerId((prev: any) => (prev === playerId ? null : playerId));
  }, []);

  const clearPlayerFocus = React.useCallback(() => {
    setFocusedPlayerId(null);
  }, []);

  useEffect(() => {
    if (!showMobileChrome) setMobilePlaySheet(null);
  }, [showMobileChrome]);

  // Pre-game and mulligan state
  const isPreGame = useMemo(() => {
    if (!safeView) return false;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    return phaseStr === "" || phaseStr === "PRE_GAME";
  }, [safeView]);

  useEffect(() => {
    const gameId = safeView?.id;
    const turnPlayer = safeView?.turnPlayer ?? null;
    const prev = previousTurnRef.current;
    const becameYourTurn =
      !!you &&
      !!turnPlayer &&
      turnPlayer === you &&
      !isPreGame &&
      prev.gameId === gameId &&
      prev.turnPlayer != null &&
      prev.turnPlayer !== turnPlayer;

    previousTurnRef.current = { gameId, turnPlayer };

    if (becameYourTurn) {
      setYourTurnBannerVisible(true);
      notifyUnfocusedYourTurn();
    }
  }, [safeView?.id, safeView?.turnPlayer, you, isPreGame]);

  const previousPriorityRef = useRef<{ gameId?: string; priority?: string | null }>({});

  useEffect(() => {
    const gameId = safeView?.id;
    const currentPriority = safeView ? (safeView.priority ?? null) : (priority ?? null);
    const prev = previousPriorityRef.current;
    const gainedYourPriority =
      !!you &&
      isYouPlayer &&
      !!currentPriority &&
      currentPriority === you &&
      !isPreGame &&
      prev.gameId === gameId &&
      prev.priority != null &&
      prev.priority !== currentPriority;

    previousPriorityRef.current = { gameId, priority: currentPriority };

    if (gainedYourPriority) {
      notifyUnfocusedYourTurn();
    }
  }, [safeView?.id, safeView?.priority, priority, you, isYouPlayer, isPreGame]);

  useEffect(() => {
    if (!yourTurnBannerVisible) return;
    const timeoutId = window.setTimeout(() => setYourTurnBannerVisible(false), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [yourTurnBannerVisible]);

  const mulliganState = useMemo(() => {
    if (!safeView || !you) return null;
    return (safeView as any).mulliganState?.[you] || null;
  }, [safeView, you]);

  const hasKeptHand = mulliganState?.hasKeptHand || false;
  const mulligansTaken = mulliganState?.mulligansTaken || 0;
  const pendingBottomCount = mulliganState?.pendingBottomCount || 0;

  // Auto-open mulligan bottom modal when pending bottom selection detected (from state)
  React.useEffect(() => {
    if (pendingBottomCount <= 0 || hasKeptHand) return;

    const stepIdFromState = (mulliganState as any)?.pendingBottomStepId;
    if (typeof stepIdFromState === 'string' && stepIdFromState.length > 0) {
      if (mulliganBottomLastSubmittedStepId && stepIdFromState === mulliganBottomLastSubmittedStepId) {
        return;
      }
      setMulliganBottomCount(pendingBottomCount);
      setMulliganBottomStepId(stepIdFromState);
      if (!mulliganBottomModalOpen) {
        setMulliganBottomModalOpen(true);
      }
      return;
    }

    // If we don't have a step id yet, request it; don't open a modal the user can't submit.
    if (safeView?.id) {
      socket.emit('getMyNextResolutionStep', { gameId: safeView.id });
    }
  }, [
    pendingBottomCount,
    hasKeptHand,
    mulliganState,
    safeView?.id,
    mulliganBottomLastSubmittedStepId,
    mulliganBottomModalOpen,
  ]);

  // Auto-close mulligan bottom modal once the server clears the pending state.
  React.useEffect(() => {
    if (!mulliganBottomModalOpen) return;
    if (hasKeptHand || pendingBottomCount === 0) {
      setMulliganBottomModalOpen(false);
      setMulliganBottomCount(0);
      setMulliganBottomStepId(null);
    }
  }, [mulliganBottomModalOpen, hasKeptHand, pendingBottomCount]);

  // Show mulligan buttons if player hasn't kept their hand yet
  // This should work even if we've moved past PRE_GAME (e.g., to UNTAP)
  // because the player still needs to keep their hand before continuing
  const needsToKeepHand = isYouPlayer && !hasKeptHand && pendingBottomCount === 0;
  
  // Can mulligan if haven't kept and haven't hit max mulligans
  const canMulligan = needsToKeepHand && mulligansTaken < 6;
  const canKeepHand = needsToKeepHand;
  
  // Show the mulligan UI if in pre-game OR if hand hasn't been kept yet
  const showMulliganUI = (isPreGame || !hasKeptHand) && isYouPlayer;

  // Check if all players have kept their hands
  const allPlayersKeptHands = useMemo(() => {
    if (!safeView) return false;
    const players = safeView.players || [];
    const mulliganStateAll = (safeView as any).mulliganState || {};
    
    for (const player of players) {
      if ((player as any).spectator) continue;
      const state = mulliganStateAll[player.id];
      if (!state || !state.hasKeptHand) {
        return false;
      }
    }
    return players.length > 0;
  }, [safeView]);

  const canUnkeepHand = isPreGame && hasKeptHand && !allPlayersKeptHands && pendingBottomCount === 0;

  // Check if all players have imported decks (library + hand > 0)
  const allPlayersHaveDecks = useMemo(() => {
    if (!safeView) return false;
    const players = safeView.players || [];
    const zones = safeView.zones || {};
    
    for (const player of players) {
      if ((player as any).spectator) continue;
      const playerZones = zones[player.id];
      const libraryCount = playerZones?.libraryCount ?? 0;
      const handCount = playerZones?.handCount ?? 0;
      if (libraryCount === 0 && handCount === 0) {
        return false;
      }
    }
    return players.length > 0;
  }, [safeView]);

  // Determine reason why phase advancement might be blocked (only during pregame)
  const phaseAdvanceBlockReason = useMemo(() => {
    if (!isPreGame) return null; // Only block during pregame
    if (!allPlayersHaveDecks) return 'Waiting for all players to import decks';
    if (!allPlayersKeptHands) return 'Waiting for all players to keep hands';
    return 'Starting game…';
  }, [isPreGame, allPlayersHaveDecks, allPlayersKeptHands]);

  const showTopPanelPregameActions = isYouPlayer && isPreGame && showMulliganUI;

  const {
    pickRandomDeck,
    pickingRandomDeck,
    randomDeckMessage,
    randomDeckError,
  } = useRandomDeckPicker({
    gameId: safeView?.id,
    canServer: isYouPlayer,
    onImportText: requestImportDeck,
    onUseSavedDeck: requestUseSavedDeck,
  });
  const showTableMulliganUI = showMulliganUI && !isPreGame;

  const autoOpenedMulliganHandKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const decision = shouldAutoOpenMobileMulliganHand({
      showMobileChrome,
      needsToKeepHand,
      handCount: yourHandCount,
      gameId: safeView?.id,
      mulligansTaken,
      lastOpenedKey: autoOpenedMulliganHandKeyRef.current,
    });
    if (decision.key) autoOpenedMulliganHandKeyRef.current = decision.key;
    if (decision.open) setMobilePlaySheet('hand');
  }, [showMobileChrome, needsToKeepHand, yourHandCount, safeView?.id, mulligansTaken, setMobilePlaySheet]);

  const damageReplacementEffectActiveCount = useMemo(() => {
    const n = Number((safeView as any)?.replacementEffectHints?.damageActiveCount ?? 0);
    return Number.isFinite(n) ? n : 0;
  }, [safeView]);

  // Auto-collapse join panel whenever a live game view is up (player or spectator)
  React.useEffect(() => {
    if (safeView) {
      setJoinCollapsed(true);
    }
  }, [safeView?.id]);

  // Auto-show deck import prompt for players without a deck (when joining in pre-game)
  React.useEffect(() => {
    if (!isYouPlayer || !isPreGame || !you || !safeView) return;
    if (hasPromptedDeckImport.current) return;

    // Check if player has no cards in library yet
    const zones = safeView.zones?.[you];
    const libraryCount = zones?.libraryCount ?? 0;
    const handCount = zones?.handCount ?? 0;

    // If no deck loaded (library + hand both empty), prompt for deck import
    if (libraryCount === 0 && handCount === 0) {
      hasPromptedDeckImport.current = true;
      setShowDeckImportPrompt(true);
    }
  }, [isYouPlayer, isPreGame, you, safeView]);

  // Open the full deck manager (local / server / precons) when auto-prompt fires.
  React.useEffect(() => {
    if (showDeckImportPrompt) {
      setTableDeckMgrOpen(true);
    }
  }, [showDeckImportPrompt]);

  const handleDeckMgrOpenChange = React.useCallback((open: boolean) => {
    setTableDeckMgrOpen(open);
    if (!open) {
      setShowDeckImportPrompt(false);
    }
  }, []);

  // Reset prompt state when leaving game
  React.useEffect(() => {
    if (!you) {
      hasPromptedDeckImport.current = false;
      setShowDeckImportPrompt(false);
    }
  }, [you]);

  // Auto-advance phases effect
  // Automatically passes priority during phases where the player can't do much:
  // - Untap step (nothing to do during untap except special abilities)
  // - Draw step (after drawing, usually just pass)
  // - Cleanup step (unless special abilities like Sundial of the Infinite)
  React.useEffect(() => {
    if (!autoAdvancePhases || !safeView || !you) return;
    // Don't auto-advance if PhaseNavigator is actively advancing through phases
    // This prevents interference when user clicks to advance to a specific phase
    if (phaseNavigatorAdvancing) return;
    // Only auto-advance if it's our turn and we have priority
    if (safeView.priority !== you) return;
    if (safeView.turnPlayer == null || safeView.turnPlayer !== you) return;
    
    // Only auto-advance during certain phases/steps
    const step = String(safeView.step || '').toLowerCase();
    const phase = String(safeView.phase || '').toLowerCase();
    
    // Don't auto-advance if there's something on the stack
    if ((safeView as any).stack?.length > 0) return;
    
    // Don't auto-advance during cleanup if we have pending discard selection
    const isCleanup = step === 'cleanup' || phase.includes('cleanup');
    if (isCleanup && discardModalOpen && discardCount > 0) return;
    
    // Phases/steps that can be auto-advanced:
    // - untap step (no player usually needs to respond)
    // - cleanup step (usually just pass unless special abilities like Sundial of the Infinite)
    // Note: Not auto-advancing draw step as the player may want to cast instants after drawing
    const autoAdvanceableSteps = ['untap', 'cleanup'];
    
    // Check if we're in an auto-advance step
    const shouldAutoAdvance = 
      autoAdvanceableSteps.includes(step) ||
      phase.includes('untap') ||
      isCleanup;
    
    if (shouldAutoAdvance) {
      // Small delay to allow any animations/updates
      const timer = setTimeout(() => {
        socket.emit('nextStep', { gameId: safeView.id });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoAdvancePhases, safeView, you, phaseNavigatorAdvancing]);

  const canAdvanceStep = useMemo(() => {
    if (!safeView || !you) return false;
    // During pregame, must have all players ready before advancing
    if (isPreGame && (!allPlayersHaveDecks || !allPlayersKeptHands)) return false;
    if (safeView.turnPlayer != null && safeView.turnPlayer === you) return true;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    if (phaseStr === "PRE_GAME" && safeView.players?.[0]?.id === you)
      return true;
    return false;
  }, [safeView, you, isPreGame, allPlayersHaveDecks, allPlayersKeptHands]);

  const canAdvanceTurn = canAdvanceStep;

  const effectiveGameId = safeView?.id ?? gameIdInput;

  const showCommanderGallery =
    cmdModalOpen && cmdSuggestedGameId && importedCandidates.length > 0;

  const phaseLabel = prettyPhase(safeView?.phase);
  const stepLabelRaw = safeView?.step ? String(safeView.step) : "";
  const stepLabel = prettyStep(stepLabelRaw);

  const sendChat = (txt: string) => {
    if (!safeView) return;
    const trimmed = txt.trim();

    // Slash command: /judge
    if (trimmed.toLowerCase() === "/judge") {
      socket.emit("requestJudge", { gameId: safeView.id });
      return;
    }

    if (!view) return;
    const payload: ChatMsg = {
      id: `m_${Date.now()}`,
      gameId: view.id,
      from: you ?? "you",
      message: txt,
      ts: Date.now(),
    };
    socket.emit("chat", payload);
    setChat((prev: any) => [...prev, payload]);
  };

  const resolvePlayerName = React.useCallback((playerId: string) => {
    const player = safeView?.players?.find((p: any) => String(p.id) === String(playerId));
    return player?.name || playerId;
  }, [safeView?.players]);

  const gameLogEntries = useGameStateLog(safeView, resolvePlayerName);

  // Hand interaction helpers: used to gate client UI; server still validates rules.
  const getHandPlayableTypeLine = (card: {
    type_line?: string | null;
    layout?: string | null;
    card_faces?: Array<{ type_line?: string | null }> | null;
  }) => {
    const layout = String(card?.layout || '').toLowerCase();
    if (layout === 'transform' && Array.isArray(card?.card_faces) && card.card_faces.length > 0) {
      return card.card_faces[0]?.type_line || card.type_line || '';
    }
    if (layout === 'modal_dfc' && Array.isArray(card?.card_faces) && card.card_faces.length > 0) {
      const spellFace = card.card_faces.find((face) => !isLandTypeLine(String(face?.type_line || '')));
      if (spellFace?.type_line) {
        return spellFace.type_line;
      }
    }
    return card.type_line || '';
  };

  const reasonCannotPlayLand = (card: {
    type_line?: string | null;
    layout?: string | null;
    card_faces?: Array<{ type_line?: string | null }> | null;
  }) => {
    if (!safeView || !you) return "No game state";
    if (!isLandTypeLine(getHandPlayableTypeLine(card))) return "Not a land";

    const turnPlayer = safeView.turnPlayer;
    const phase = safeView.phase;
    const landsPlayedThisTurn =
      (safeView as any).landsPlayedThisTurn?.[you] || 0;
    // Get max lands per turn from game state, default to 1 if not set
    const maxLandsPerTurn =
      (safeView as any).maxLandsPerTurn?.[you] || 1;

    if (turnPlayer == null || turnPlayer !== you) return "Not your turn";
    if (!phase || !String(phase).toLowerCase().includes("main")) {
      return "Can only play lands during your main phase";
    }
    if (landsPlayedThisTurn >= maxLandsPerTurn) {
      return maxLandsPerTurn > 1
        ? `You have already played ${landsPlayedThisTurn} land(s) this turn (max ${maxLandsPerTurn})`
        : "You have already played a land this turn";
    }

    return null;
  };

  const reasonCannotCast = (card: {
    type_line?: string | null;
    layout?: string | null;
    card_faces?: Array<{ type_line?: string | null }> | null;
  }) => {
    if (!safeView || !you) return "No game state";
    if (isLandTypeLine(getHandPlayableTypeLine(card))) return "Lands are played, not cast";
    // Check priority instead of turn - you can cast instants on other players' turns
    if (safeView.priority !== you) return "You don't have priority";
    return null;
  };

  // Check if an artifact meets metalcraft requirement (3+ artifacts on battlefield)
  const checkMetalcraft = (playerId: string): boolean => {
    if (!safeView) return false;
    const battlefield = (safeView.battlefield || []).filter((perm: any) => perm.controller === playerId);
    const artifactCount = battlefield.filter((perm: any) => {
      const card = perm.card;
      if (!card || !('type_line' in card)) return false;
      return ((card as any).type_line || '').toLowerCase().includes('artifact');
    }).length;
    return artifactCount >= 3;
  };

  // Get available mana sources (untapped lands and mana-producing artifacts/creatures)
  const getAvailableManaSourcesForPlayer = (
    playerId: string,
    options?: { excludePermanentIds?: string[] },
  ) => {
    if (!safeView) return [];
    const battlefield = (safeView.battlefield || []) as BattlefieldPermanent[];
    const buildSources = () => buildAvailableManaSourcesForPlayer(playerId, battlefield, options);

    if (checkMetalcraft(playerId)) {
      return buildSources();
    }

    return buildSources().filter((source) => {
      const sourcePermanent = battlefield.find((perm) => String(perm.id || '') === String(source.sourcePermanentId || source.id || ''));
      const oracleText = String((sourcePermanent?.card as any)?.oracle_text || '').toLowerCase();
      if (!oracleText.includes('metalcraft')) return true;
      return false;
    });
  };


  return {
    isTable,
    showUtilityRail,
    showExpandedUtilityRail,
    playerFocusOrder,
    yourLibraryCount,
    canPass,
    isYouPlayer,
    isSpectator,
    showMobileChrome,
    needsDeckImport,
    yourHandCards,
    yourHandCount,
    handleFocusPlayer,
    clearPlayerFocus,
    isPreGame,
    mulliganState,
    hasKeptHand,
    mulligansTaken,
    pendingBottomCount,
    needsToKeepHand,
    canMulligan,
    canKeepHand,
    showMulliganUI,
    allPlayersKeptHands,
    canUnkeepHand,
    allPlayersHaveDecks,
    phaseAdvanceBlockReason,
    showTopPanelPregameActions,
    showTableMulliganUI,
    damageReplacementEffectActiveCount,
    handleDeckMgrOpenChange,
    canAdvanceStep,
    canAdvanceTurn,
    effectiveGameId,
    showCommanderGallery,
    phaseLabel,
    stepLabelRaw,
    stepLabel,
    sendChat,
    resolvePlayerName,
    gameLogEntries,
    pickRandomDeck,
    pickingRandomDeck,
    randomDeckError,
    randomDeckMessage,
    getHandPlayableTypeLine,
    reasonCannotPlayLand,
    reasonCannotCast,
    checkMetalcraft,
    getAvailableManaSourcesForPlayer,
  };
}
