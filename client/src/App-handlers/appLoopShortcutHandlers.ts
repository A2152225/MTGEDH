// Origin parent: client/src/App.tsx
// Cluster moved: loop-shortcut state, handlers, and exclusive effects (showLoopShortcutPanel through last replay effect).
// Public entry symbols: useAppLoopShortcutHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useRef, useState } from "react";
import { socket } from "../socket";
import type { ClientGameView, PlayerID } from "../../../shared/src";
import { type LoopShortcutConsentPrompt } from "../components/LoopShortcutConsentModal";
import {
  buildLoopShortcutStackPassKey,
  canAdvanceLoopShortcutAfterState,
  clampLoopShortcutIterations,
  clearLoopShortcutDraft,
  createRecordedEmitItem,
  createRecordedResolutionResponseItem,
  deleteSavedLoopShortcut,
  isLoopShortcutPhaseAdvanceEmit,
  loadLoopShortcutDraft,
  loadSavedLoopShortcuts,
  noteLoopShortcutCastSettleStack,
  sanitizeLoopShortcutItems,
  saveLoopShortcutDraft,
  shouldLoopShortcutAutoPassPriority,
  upsertSavedLoopShortcut,
  type LoopShortcutCastSettleState,
  type LoopShortcutSequenceItem,
  type SavedLoopShortcut,
} from "../utils/loopShortcuts";

const LOOP_SHORTCUT_RECORDABLE_EVENTS = new Set([
  'activateBattlefieldAbility',
  'activateGraveyardAbility',
  'requestCastSpell',
  'castSpellFromHand',
  'completeCastSpell',
  'castCommander',
  // passPriority is intentionally NOT recorded: replaying it with an empty stack
  // advances the phase (main → combat). While waitingForState, the loop auto-passes
  // only when the stack is non-empty (see shouldLoopShortcutAutoPassPriority).
  'playLand',
]);

export type AppLoopShortcutHandlerDeps = {
  safeView: ClientGameView | null;
  you: PlayerID | null;
  priority: PlayerID | null;
  lastError: string | null;
  myPendingResolutionCount: number;
  activeResolutionPrompt: { stepId: string; title: string } | null;
  minimizedResolutionStep: { stepId: string; title: string } | null;
  createGameModalOpen: boolean;
  setSavedDecks: React.Dispatch<React.SetStateAction<any[]>>;
  setPriorityModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useAppLoopShortcutHandlers(deps: AppLoopShortcutHandlerDeps) {
  const {
    safeView,
    you,
    priority,
    lastError,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
    createGameModalOpen,
    setSavedDecks,
    setPriorityModalOpen,
  } = deps;
  const [showLoopShortcutPanel, setShowLoopShortcutPanel] = useState(false);
  const [loopShortcutName, setLoopShortcutName] = useState('Loop Shortcut');
  const [loopShortcutItems, setLoopShortcutItems] = useState<LoopShortcutSequenceItem[]>([]);
  const [savedLoopShortcuts, setSavedLoopShortcuts] = useState<SavedLoopShortcut[]>([]);
  const [loopShortcutIterations, setLoopShortcutIterations] = useState(1);
  const [loopShortcutStatusText, setLoopShortcutStatusText] = useState('Idle.');
  const [isLoopShortcutRecording, setIsLoopShortcutRecording] = useState(false);
  const [isLoopShortcutRunning, setIsLoopShortcutRunning] = useState(false);
  const [loopShortcutConsentPrompt, setLoopShortcutConsentPrompt] = useState<LoopShortcutConsentPrompt | null>(null);
  const [loopShortcutAwaitingConsent, setLoopShortcutAwaitingConsent] = useState(false);
  const loopShortcutProposerAwaitingRef = useRef(false);

  const safeViewRef = useRef<ClientGameView | null>(safeView);
  const youRef = useRef<PlayerID | null>(you);
  const loopShortcutItemsRef = useRef<LoopShortcutSequenceItem[]>([]);
  const isLoopShortcutRecordingRef = useRef(false);
  const isLoopShortcutRunningRef = useRef(false);
  const lastResolutionStepsRef = useRef<Map<string, any>>(new Map());
  const originalSocketEmitRef = useRef<((event: string, ...args: any[]) => any) | null>(null);
  const loopShortcutReplayRef = useRef<{
    running: boolean;
    index: number;
    iteration: number;
    totalIterations: number;
    waitingForState: boolean;
    waitingForCastCardId: string | null;
    castSettle: LoopShortcutCastSettleState | null;
    waitingPrompt: Extract<LoopShortcutSequenceItem, { kind: 'resolution_response' }> | null;
  }>({
    running: false,
    index: 0,
    iteration: 0,
    totalIterations: 0,
    waitingForState: false,
    waitingForCastCardId: null,
    castSettle: null,
    waitingPrompt: null,
  });
  const loopShortcutLastErrorRef = useRef<string | null>(null);
  const loopShortcutLoadedGameIdRef = useRef<string | null>(null);
  /** Dedupes stack-drain passPriority emits for the same priority/stack snapshot. */
  const loopShortcutStackPassKeyRef = useRef<string | null>(null);
  const loopShortcutStackPassAtRef = useRef<number>(0);
  /** Step ids the loop already auto-answered — ignore duplicate resolutionStepPrompt emits. */
  const loopAutoAnsweredStepIdsRef = useRef<Set<string>>(new Set());

  React.useEffect(() => {
    safeViewRef.current = safeView;
  }, [safeView]);

  React.useEffect(() => {
    youRef.current = you;
  }, [you]);

  const priorityRef = useRef<PlayerID | null>(priority);
  React.useEffect(() => {
    priorityRef.current = priority;
  }, [priority]);

  React.useEffect(() => {
    loopShortcutItemsRef.current = loopShortcutItems;
  }, [loopShortcutItems]);

  React.useEffect(() => {
    isLoopShortcutRecordingRef.current = isLoopShortcutRecording;
  }, [isLoopShortcutRecording]);

  React.useEffect(() => {
    isLoopShortcutRunningRef.current = isLoopShortcutRunning;
  }, [isLoopShortcutRunning]);

  React.useEffect(() => {
    const activeGameId = safeView?.id || null;
    if (!activeGameId) {
      loopShortcutLoadedGameIdRef.current = null;
      setSavedLoopShortcuts([]);
      return;
    }

    if (loopShortcutLoadedGameIdRef.current === activeGameId) {
      return;
    }

    loopShortcutLoadedGameIdRef.current = activeGameId;
    const saved = loadSavedLoopShortcuts(localStorage, activeGameId);
    const draft = loadLoopShortcutDraft(localStorage, activeGameId);

    setSavedLoopShortcuts(saved);
    lastResolutionStepsRef.current.clear();

    if (draft) {
      setLoopShortcutName(draft.name);
      setLoopShortcutItems(draft.items);
      setLoopShortcutIterations(clampLoopShortcutIterations(draft.iterationCount));
      setLoopShortcutStatusText(`Restored loop shortcut draft "${draft.name}".`);
    } else {
      setLoopShortcutName('Loop Shortcut');
      setLoopShortcutItems([]);
      setLoopShortcutIterations(1);
      setLoopShortcutStatusText('Idle.');
    }
  }, [safeView?.id]);

  React.useEffect(() => {
    const activeGameId = safeView?.id;
    if (!activeGameId) {
      return;
    }

    if (loopShortcutItems.length === 0) {
      clearLoopShortcutDraft(localStorage, activeGameId);
      return;
    }

    saveLoopShortcutDraft(localStorage, activeGameId, {
      name: loopShortcutName.trim() || 'Loop Shortcut',
      items: loopShortcutItems,
      iterationCount: clampLoopShortcutIterations(loopShortcutIterations),
      updatedAt: Date.now(),
    });
  }, [safeView?.id, loopShortcutItems, loopShortcutIterations, loopShortcutName]);

  // Fetch saved decks when create game modal opens
  const refreshSavedDecks = React.useCallback(() => {
    fetch('/api/decks')
      .then(res => res.ok ? res.json() : { decks: [] })
      .then(data => setSavedDecks(data.decks || []))
      .catch(() => setSavedDecks([]));
  }, []);

  React.useEffect(() => {
    if (createGameModalOpen) {
      refreshSavedDecks();
    }
  }, [createGameModalOpen, refreshSavedDecks]);

  const stopLoopShortcutReplay = React.useCallback((message: string) => {
    const activeGameId = safeViewRef.current?.id;
    if (activeGameId) {
      socket.emit('setLoopShortcutStackDrain', { gameId: activeGameId, enabled: false });
    }
    loopShortcutReplayRef.current = {
      running: false,
      index: 0,
      iteration: 0,
      totalIterations: 0,
      waitingForState: false,
      waitingForCastCardId: null,
      castSettle: null,
      waitingPrompt: null,
    };
    loopAutoAnsweredStepIdsRef.current.clear();
    loopShortcutStackPassKeyRef.current = null;
    loopShortcutStackPassAtRef.current = 0;
    isLoopShortcutRunningRef.current = false;
    setIsLoopShortcutRunning(false);
    setLoopShortcutStatusText(message);
  }, []);

  const advanceLoopShortcutReplay = React.useCallback(() => {
    const replayState = loopShortcutReplayRef.current;
    const currentView = safeViewRef.current;

    // Always use the live socket. Do not depend on originalSocketEmitRef — if that
    // ref is null (effect timing), the loop would sit on "Running…" forever.
    if (!replayState.running || !currentView?.id) {
      return;
    }

    const items = loopShortcutItemsRef.current;

    while (replayState.running) {
      if (replayState.index >= items.length) {
        if (replayState.iteration + 1 >= replayState.totalIterations) {
          stopLoopShortcutReplay('Loop replay complete.');
          return;
        }

        replayState.iteration += 1;
        replayState.index = 0;
      }

      const nextItem = items[replayState.index];
      if (!nextItem) {
        stopLoopShortcutReplay('Loop replay stopped: no recorded actions remain.');
        return;
      }

      // Legacy recordings may include passPriority; never emit it during a loop.
      // Wait for a quiet board instead so empty-stack passes cannot advance the phase.
      if (isLoopShortcutPhaseAdvanceEmit(nextItem)) {
        replayState.index += 1;
        replayState.waitingForState = true;
        replayState.waitingPrompt = null;
        setLoopShortcutStatusText(
          `Waiting for stack/prompts to clear (iteration ${replayState.iteration + 1} of ${replayState.totalIterations})...`
        );
        return;
      }

      if (nextItem.kind === 'resolution_response') {
        replayState.waitingPrompt = nextItem;
        replayState.waitingForState = false;
        setLoopShortcutStatusText(`Waiting for ${nextItem.label}...`);
        // Nudge server in case we missed the original resolutionStepPrompt emit.
        socket.emit('getMyNextResolutionStep', { gameId: currentView.id });
        return;
      }

      const payload = JSON.parse(JSON.stringify(nextItem.payload || {}));
      payload.gameId = currentView.id;
      socket.emit(nextItem.event, payload);
      replayState.index += 1;

      const followingItem = items[replayState.index];
      if (followingItem?.kind === 'resolution_response') {
        replayState.waitingPrompt = followingItem;
        replayState.waitingForState = false;
        setLoopShortcutStatusText(`Waiting for ${followingItem.label}...`);
        socket.emit('getMyNextResolutionStep', { gameId: currentView.id });
        return;
      }

      replayState.waitingForState = true;
      replayState.waitingPrompt = null;
      setLoopShortcutStatusText(
        `Running iteration ${replayState.iteration + 1} of ${replayState.totalIterations}...`
      );
      return;
    }
  }, [stopLoopShortcutReplay]);

  const handleStartLoopShortcutRecording = React.useCallback(() => {
    setLoopShortcutItems([]);
    lastResolutionStepsRef.current.clear();
    setIsLoopShortcutRecording(true);
    setLoopShortcutStatusText('Recording in progress. Perform the loop once.');
  }, []);

  const handleStopLoopShortcutRecording = React.useCallback(() => {
    setIsLoopShortcutRecording(false);
    const sanitized = sanitizeLoopShortcutItems(loopShortcutItemsRef.current);
    if (sanitized.removedPassPriorityCount > 0) {
      setLoopShortcutItems(sanitized.items);
      setLoopShortcutStatusText(
        `Recorded ${sanitized.items.length} step${sanitized.items.length === 1 ? '' : 's'} ` +
        `(removed ${sanitized.removedPassPriorityCount} passPriority — those advance the phase).`
      );
      return;
    }
    setLoopShortcutStatusText(
      loopShortcutItemsRef.current.length > 0
        ? `Recorded ${loopShortcutItemsRef.current.length} step${loopShortcutItemsRef.current.length === 1 ? '' : 's'}.`
        : 'Recording stopped with no captured actions.'
    );
  }, []);

  const handleClearLoopShortcut = React.useCallback(() => {
    stopLoopShortcutReplay('Idle.');
    setIsLoopShortcutRecording(false);
    setLoopShortcutItems([]);
    lastResolutionStepsRef.current.clear();
    setLoopShortcutStatusText('Idle.');
  }, [stopLoopShortcutReplay]);

  const handleSaveLoopShortcut = React.useCallback(() => {
    const activeGameId = safeViewRef.current?.id;
    if (!activeGameId || loopShortcutItemsRef.current.length === 0) return;

    const normalizedName = loopShortcutName.trim() || 'Loop Shortcut';
    const existing = savedLoopShortcuts.find(
      item => item.name.trim().toLowerCase() === normalizedName.toLowerCase()
    );

    const sanitized = sanitizeLoopShortcutItems(loopShortcutItemsRef.current);
    if (sanitized.items.length === 0) return;

    const nextSaved = upsertSavedLoopShortcut(localStorage, activeGameId, {
      id: existing?.id || `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      items: sanitized.items,
      iterationCount: clampLoopShortcutIterations(loopShortcutIterations),
      updatedAt: Date.now(),
    });

    setSavedLoopShortcuts(nextSaved);
    setLoopShortcutName(normalizedName);
    if (sanitized.removedPassPriorityCount > 0) {
      setLoopShortcutItems(sanitized.items);
      setLoopShortcutStatusText(
        `Saved shortcut "${normalizedName}" (removed ${sanitized.removedPassPriorityCount} passPriority).`
      );
      return;
    }
    setLoopShortcutStatusText(`Saved shortcut "${normalizedName}".`);
  }, [loopShortcutIterations, loopShortcutName, savedLoopShortcuts]);

  const handleLoadSavedLoopShortcut = React.useCallback((shortcutId: string) => {
    const activeGameId = safeViewRef.current?.id;
    if (!activeGameId) return;

    const shortcuts = loadSavedLoopShortcuts(localStorage, activeGameId);
    setSavedLoopShortcuts(shortcuts);

    const shortcut = shortcuts.find(item => item.id === shortcutId);
    if (!shortcut) return;

    stopLoopShortcutReplay('Idle.');
    setIsLoopShortcutRecording(false);
    setLoopShortcutName(shortcut.name);
    const sanitized = sanitizeLoopShortcutItems(shortcut.items);
    setLoopShortcutItems(sanitized.items);
    setLoopShortcutIterations(clampLoopShortcutIterations(shortcut.iterationCount));
    setLoopShortcutStatusText(
      sanitized.removedPassPriorityCount > 0
        ? `Loaded "${shortcut.name}" (removed ${sanitized.removedPassPriorityCount} passPriority).`
        : `Loaded saved shortcut "${shortcut.name}".`
    );
  }, [stopLoopShortcutReplay]);

  const handleDeleteSavedLoopShortcut = React.useCallback((shortcutId: string) => {
    const activeGameId = safeViewRef.current?.id;
    if (!activeGameId) return;

    const shortcuts = deleteSavedLoopShortcut(localStorage, activeGameId, shortcutId);
    setSavedLoopShortcuts(shortcuts);
    setLoopShortcutStatusText('Deleted saved shortcut.');
  }, []);

  const startLoopShortcutReplay = React.useCallback((totalIterations: number) => {
    if (!safeViewRef.current?.id || loopShortcutItemsRef.current.length === 0) return;

    const sanitized = sanitizeLoopShortcutItems(loopShortcutItemsRef.current);
    if (sanitized.removedPassPriorityCount > 0) {
      setLoopShortcutItems(sanitized.items);
    }
    if (sanitized.items.length === 0) {
      setLoopShortcutStatusText('Loop has no runnable steps after removing passPriority.');
      return;
    }

    const iterations = clampLoopShortcutIterations(totalIterations);
    loopShortcutItemsRef.current = sanitized.items;
    isLoopShortcutRunningRef.current = true;
    setIsLoopShortcutRunning(true);
    setLoopShortcutAwaitingConsent(false);
    setLoopShortcutStatusText(`Batching ${iterations} iteration(s) on server...`);

    socket.emit('executeLoopShortcutBatch', {
      gameId: safeViewRef.current.id,
      name: loopShortcutName.trim() || 'Loop Shortcut',
      items: sanitized.items,
      iterationCount: iterations,
    });
  }, [loopShortcutName]);

  const handleRunLoopShortcut = React.useCallback(() => {
    if (!safeViewRef.current?.id || loopShortcutItemsRef.current.length === 0) return;
    if (loopShortcutAwaitingConsent || isLoopShortcutRunning) return;

    const sanitized = sanitizeLoopShortcutItems(loopShortcutItemsRef.current);
    if (sanitized.removedPassPriorityCount > 0) {
      setLoopShortcutItems(sanitized.items);
    }
    if (sanitized.items.length === 0) {
      setLoopShortcutStatusText('Loop has no runnable steps after removing passPriority.');
      return;
    }
    loopShortcutItemsRef.current = sanitized.items;

    const requested = clampLoopShortcutIterations(loopShortcutIterations);
    const players = Array.isArray((safeViewRef.current as any)?.players)
      ? ((safeViewRef.current as any).players as any[])
      : [];
    const humanOpponents = players.filter((p: any) => {
      const id = String(p?.id || '').trim();
      if (!id || id === String(youRef.current || '')) return false;
      if (p?.spectator === true || p?.isSpectator === true) return false;
      if (p?.isAI === true || p?.ai === true) return false;
      return true;
    });

    // Solo / all-AI tables: batch immediately.
    if (humanOpponents.length === 0) {
      startLoopShortcutReplay(requested);
      return;
    }

    setLoopShortcutAwaitingConsent(true);
    loopShortcutProposerAwaitingRef.current = true;
    setLoopShortcutStatusText(
      `Waiting for ${humanOpponents.length} opponent${humanOpponents.length === 1 ? '' : 's'} to allow or interrupt the loop...`,
    );
    socket.emit('proposeLoopShortcut', {
      gameId: safeViewRef.current.id,
      name: loopShortcutName.trim() || 'Loop Shortcut',
      summary: `${sanitized.items.length} step(s) × up to ${requested} iteration(s)`,
      iterationCount: requested,
    });
  }, [
    isLoopShortcutRunning,
    loopShortcutAwaitingConsent,
    loopShortcutIterations,
    loopShortcutName,
    startLoopShortcutReplay,
  ]);

  React.useEffect(() => {
    const onConsentPrompt = (payload: any) => {
      if (!payload || String(payload.gameId || '') !== String(safeViewRef.current?.id || '')) return;
      if (String(payload.proposerId || '') === String(youRef.current || '')) return;
      setLoopShortcutConsentPrompt({
        gameId: String(payload.gameId),
        proposalId: String(payload.proposalId),
        proposerId: String(payload.proposerId),
        proposerName: String(payload.proposerName || 'Opponent'),
        name: String(payload.name || 'Loop Shortcut'),
        summary: String(payload.summary || ''),
        requestedIterations: clampLoopShortcutIterations(payload.requestedIterations),
      });
    };

    const onConsentWaiting = (payload: any) => {
      if (!payload || String(payload.gameId || '') !== String(safeViewRef.current?.id || '')) return;
      setLoopShortcutAwaitingConsent(true);
      setLoopShortcutStatusText('Waiting for opponents to allow or interrupt the loop...');
    };

    const onConsentResult = (payload: any) => {
      if (!payload || String(payload.gameId || '') !== String(safeViewRef.current?.id || '')) return;
      setLoopShortcutConsentPrompt(null);
      setLoopShortcutAwaitingConsent(false);

      if (payload.cancelled || payload.approved === false) {
        loopShortcutProposerAwaitingRef.current = false;
        setLoopShortcutStatusText('Loop shortcut cancelled.');
        return;
      }

      const effective = clampLoopShortcutIterations(payload.effectiveIterations);
      const interrupted = payload.interrupted === true;
      if (loopShortcutProposerAwaitingRef.current) {
        loopShortcutProposerAwaitingRef.current = false;
        setLoopShortcutStatusText(
          interrupted
            ? `Opponents capped the loop at ${effective} iteration(s). Batching...`
            : `Opponents allowed the full loop (${effective}). Batching...`,
        );
        startLoopShortcutReplay(effective);
      }
    };

    const onBatchProgress = (payload: any) => {
      if (!payload || String(payload.gameId || '') !== String(safeViewRef.current?.id || '')) return;
      setIsLoopShortcutRunning(true);
      setLoopShortcutStatusText(String(payload.message || 'Batching loop...'));
    };

    const onBatchResult = (payload: any) => {
      if (!payload || String(payload.gameId || '') !== String(safeViewRef.current?.id || '')) return;
      // Observers get a status ping; only the runner clears the running flag.
      if (payload.observer === true) {
        setLoopShortcutStatusText(String(payload.message || 'Opponent finished a loop shortcut.'));
        // Still resync — opponent loops also mutate the shared board.
        try {
          socket.emit('requestState', { gameId: payload.gameId });
        } catch {
          // best-effort
        }
        return;
      }
      setIsLoopShortcutRunning(false);
      isLoopShortcutRunningRef.current = false;
      loopShortcutReplayRef.current.running = false;
      if (safeViewRef.current?.id) {
        socket.emit('setLoopShortcutStackDrain', { gameId: safeViewRef.current.id, enabled: false });
      }
      setLoopShortcutStatusText(String(payload.message || (payload.ok ? 'Loop batch complete.' : 'Loop batch stopped.')));
      // Final batch broadcast can be dropped/oversized after huge token deltas;
      // explicitly resync so the board updates without a manual refresh.
      try {
        socket.emit('requestState', { gameId: payload.gameId });
      } catch {
        // best-effort
      }
    };

    socket.on('loopShortcutConsentPrompt', onConsentPrompt);
    socket.on('loopShortcutConsentWaiting', onConsentWaiting);
    socket.on('loopShortcutConsentResult', onConsentResult);
    socket.on('loopShortcutBatchProgress', onBatchProgress);
    socket.on('loopShortcutBatchResult', onBatchResult);
    return () => {
      socket.off('loopShortcutConsentPrompt', onConsentPrompt);
      socket.off('loopShortcutConsentWaiting', onConsentWaiting);
      socket.off('loopShortcutConsentResult', onConsentResult);
      socket.off('loopShortcutBatchProgress', onBatchProgress);
      socket.off('loopShortcutBatchResult', onBatchResult);
    };
  }, [startLoopShortcutReplay]);

  React.useEffect(() => {
    const originalEmit = socket.emit.bind(socket);
    originalSocketEmitRef.current = originalEmit as any;

    (socket as any).emit = ((event: string, ...args: any[]) => {
      const payload = args[0];
      const activeGameId = safeViewRef.current?.id;

      if (
        !loopShortcutReplayRef.current.running &&
        isLoopShortcutRecordingRef.current &&
        activeGameId &&
        payload &&
        typeof payload === 'object' &&
        String((payload as any).gameId || '') === String(activeGameId)
      ) {
        if (event === 'submitResolutionResponse') {
          const stepId = String((payload as any).stepId || '');
          const step = lastResolutionStepsRef.current.get(stepId);
          if (step) {
            const item = createRecordedResolutionResponseItem(
              step,
              (payload as any).selections,
              safeViewRef.current,
              youRef.current
            );
            if (item) {
              setLoopShortcutItems(prev => [...prev, item]);
            }
          }
        } else if (LOOP_SHORTCUT_RECORDABLE_EVENTS.has(event)) {
          setLoopShortcutItems(prev => [...prev, createRecordedEmitItem(event, payload as any, activeGameId)]);
        }
      }

      return originalEmit(event, ...args);
    }) as any;

    return () => {
      (socket as any).emit = originalEmit as any;
      originalSocketEmitRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const replayState = loopShortcutReplayRef.current;
    if (!safeView || !replayState.running) {
      return;
    }

    const playerId = youRef.current;
    const hasActiveResolutionPrompt = Boolean(activeResolutionPrompt || minimizedResolutionStep);
    const waitingForCastCardId = replayState.waitingForCastCardId;
    replayState.castSettle = noteLoopShortcutCastSettleStack(replayState.castSettle, safeView);

    // Drain Summon / Reflections / Aura Shards whenever the loop is running — not only
    // while waitingForState (GY prompt wait still needs stack cleared first).
    if (shouldLoopShortcutAutoPassPriority({
      view: safeView,
      playerId,
      priorityPlayerId: priority,
      myPendingResolutionCount,
      hasActiveResolutionPrompt,
      waitingForCastCardId,
    })) {
      const passKey = buildLoopShortcutStackPassKey(safeView, playerId, priority);
      const now = Date.now();
      const sameKeyRecently =
        loopShortcutStackPassKeyRef.current === passKey
        && (now - loopShortcutStackPassAtRef.current) < 750;
      if (!sameKeyRecently) {
        if (safeView.id && playerId) {
          socket.emit('passPriority', { gameId: safeView.id, by: playerId });
          loopShortcutStackPassKeyRef.current = passKey;
          loopShortcutStackPassAtRef.current = now;
          setPriorityModalOpen(false);
          setLoopShortcutStatusText(
            `Passing to resolve stack (iteration ${replayState.iteration + 1} of ${replayState.totalIterations})...`
          );
        }
      }
      return;
    }

    if (!replayState.waitingForState) {
      return;
    }

    if (!canAdvanceLoopShortcutAfterState({
      view: safeView,
      myPendingResolutionCount,
      hasActiveResolutionPrompt,
      waitingForCastCardId,
      playerId,
      castSettle: replayState.castSettle,
    })) {
      setLoopShortcutStatusText(
        `Waiting for stack/prompts to clear (iteration ${replayState.iteration + 1} of ${replayState.totalIterations})...`
      );
      return;
    }

    loopShortcutStackPassKeyRef.current = null;
    loopShortcutStackPassAtRef.current = 0;
    replayState.waitingForState = false;
    replayState.waitingForCastCardId = null;
    replayState.castSettle = null;
    advanceLoopShortcutReplay();
  }, [
    safeView,
    priority,
    advanceLoopShortcutReplay,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
  ]);

  // Re-check cast-settle timeout / stack drain while the loop is active.
  React.useEffect(() => {
    if (!isLoopShortcutRunning) return;
    const id = window.setInterval(() => {
      const replayState = loopShortcutReplayRef.current;
      if (!replayState.running) return;

      const view = safeViewRef.current;
      const playerId = youRef.current;
      if (!view || !playerId) return;

      // If we're waiting on a recorded prompt, keep asking the server for it.
      if (replayState.waitingPrompt) {
        socket.emit('getMyNextResolutionStep', { gameId: view.id });
        return;
      }

      const hasActiveResolutionPrompt = Boolean(activeResolutionPrompt || minimizedResolutionStep);
      replayState.castSettle = noteLoopShortcutCastSettleStack(replayState.castSettle, view);
      const priorityPlayerId = priorityRef.current;

      if (shouldLoopShortcutAutoPassPriority({
        view,
        playerId,
        priorityPlayerId,
        myPendingResolutionCount,
        hasActiveResolutionPrompt,
        waitingForCastCardId: replayState.waitingForCastCardId,
      })) {
        const passKey = buildLoopShortcutStackPassKey(view, playerId, priorityPlayerId);
        const now = Date.now();
        const sameKeyRecently =
          loopShortcutStackPassKeyRef.current === passKey
          && (now - loopShortcutStackPassAtRef.current) < 750;
        if (!sameKeyRecently && view.id) {
          socket.emit('passPriority', { gameId: view.id, by: playerId });
          loopShortcutStackPassKeyRef.current = passKey;
          loopShortcutStackPassAtRef.current = now;
          setPriorityModalOpen(false);
          setLoopShortcutStatusText(
            `Passing to resolve stack (iteration ${replayState.iteration + 1} of ${replayState.totalIterations})...`
          );
        }
        return;
      }

      if (!replayState.waitingForState) return;
      if (!canAdvanceLoopShortcutAfterState({
        view,
        myPendingResolutionCount,
        hasActiveResolutionPrompt,
        waitingForCastCardId: replayState.waitingForCastCardId,
        playerId,
        castSettle: replayState.castSettle,
      })) {
        setLoopShortcutStatusText(
          `Waiting for stack/prompts to clear (iteration ${replayState.iteration + 1} of ${replayState.totalIterations})...`
        );
        return;
      }

      loopShortcutStackPassKeyRef.current = null;
      loopShortcutStackPassAtRef.current = 0;
      replayState.waitingForState = false;
      replayState.waitingForCastCardId = null;
      replayState.castSettle = null;
      advanceLoopShortcutReplay();
    }, 400);
    return () => window.clearInterval(id);
  }, [
    isLoopShortcutRunning,
    advanceLoopShortcutReplay,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
  ]);

  React.useEffect(() => {
    if (!lastError || lastError === loopShortcutLastErrorRef.current) {
      loopShortcutLastErrorRef.current = lastError;
      return;
    }

    loopShortcutLastErrorRef.current = lastError;
    if (loopShortcutReplayRef.current.running) {
      stopLoopShortcutReplay(`Loop replay stopped: ${lastError}`);
    }
  }, [lastError, stopLoopShortcutReplay]);

  React.useEffect(() => {
    if (!safeView?.id && loopShortcutReplayRef.current.running) {
      stopLoopShortcutReplay('Loop replay stopped: no active game.');
    }
  }, [safeView?.id, stopLoopShortcutReplay]);

  return {
    showLoopShortcutPanel,
    setShowLoopShortcutPanel,
    loopShortcutName,
    setLoopShortcutName,
    loopShortcutItems,
    savedLoopShortcuts,
    loopShortcutIterations,
    setLoopShortcutIterations,
    loopShortcutStatusText,
    setLoopShortcutStatusText,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    loopShortcutConsentPrompt,
    setLoopShortcutConsentPrompt,
    loopShortcutAwaitingConsent,
    refreshSavedDecks,
    handleStartLoopShortcutRecording,
    handleStopLoopShortcutRecording,
    handleClearLoopShortcut,
    handleSaveLoopShortcut,
    handleLoadSavedLoopShortcut,
    handleDeleteSavedLoopShortcut,
    handleRunLoopShortcut,
    stopLoopShortcutReplay,
    safeViewRef,
    youRef,
    loopShortcutItemsRef,
    isLoopShortcutRunningRef,
    lastResolutionStepsRef,
    loopShortcutReplayRef,
    loopAutoAnsweredStepIdsRef,
  };
}
