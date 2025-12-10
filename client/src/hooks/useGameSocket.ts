import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { socket } from "../socket";
import type {
  ClientGameView,
  PlayerID,
  GameID,
  KnownCardRef,
  ChatMsg,
} from "../../../shared/src";

/* Helpers shared with App */

function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name}`;
}
function lastJoinKey() {
  return "mtgedh:lastJoin";
}

export type ImportConfirmVotes = Record<string, "pending" | "yes" | "no">;

export interface UseGameSocketState {
  connected: boolean;
  gameIdInput: GameID;
  setGameIdInput: (id: GameID) => void;
  nameInput: string;
  setNameInput: (v: string) => void;

  you: PlayerID | null;
  view: ClientGameView | null;
  safeView: ClientGameView | null;
  priority: PlayerID | null;

  chat: ChatMsg[];
  setChat: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  lastError: string | null;
  lastInfo: string | null;

  missingImport: string[] | null;
  setMissingImport: React.Dispatch<React.SetStateAction<string[] | null>>;

  importedCandidates: KnownCardRef[];
  pendingLocalImport: boolean;
  localImportConfirmOpen: boolean;

  // commander suggestion UI
  cmdModalOpen: boolean;
  setCmdModalOpen: (open: boolean) => void;
  cmdSuggestedNames: string[];
  cmdSuggestedGameId: GameID | null;

  // confirm UI (import or judge)
  confirmOpen: boolean;
  confirmPayload: any | null;
  confirmVotes: ImportConfirmVotes | null;
  confirmId: string | null;

  debugOpen: boolean;
  debugLoading: boolean;
  debugData: any;

  // actions
  handleJoin: () => void;
  joinFromList: (gameId: string) => void;
  leaveGame: (onLeft?: () => void) => void;
  requestImportDeck: (list: string, deckName?: string) => void;
  requestUseSavedDeck: (deckId: string) => void;
  handleLocalImportConfirmChange: (open: boolean) => void;
  handleCommanderConfirm: (names: string[], ids?: string[]) => void;
  fetchDebug: () => void;
  respondToConfirm: (accept: boolean) => void;

  setCmdSuggestedGameId: (gid: GameID | null) => void;
  setCmdSuggestedNames: (names: string[]) => void;
  setDebugOpen: (open: boolean) => void;
}

// Storage key for cached player name
const PLAYER_NAME_KEY = 'mtgedh:playerName';

function getCachedPlayerName(): string {
  try {
    const stored = sessionStorage.getItem(PLAYER_NAME_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // Ignore storage errors
  }
  return 'Player';
}

function cachePlayerName(name: string): void {
  try {
    if (name && name.trim()) {
      sessionStorage.setItem(PLAYER_NAME_KEY, name.trim());
    }
  } catch {
    // Ignore storage errors
  }
}

export function useGameSocket(): UseGameSocketState {
  // connection + join UI state
  const [connected, setConnected] = useState(false);
  const [gameIdInput, setGameIdInput] = useState<GameID>("demo");
  // Initialize from cached value
  const [nameInput, setNameInput] = useState<string>(getCachedPlayerName);

  const lastJoinRef = useRef<{
    gameId: GameID;
    name: string;
    spectator: boolean;
  } | null>(null);
  
  // Cache the player name whenever it changes
  const handleSetNameInput = useCallback((name: string) => {
    setNameInput(name);
    cachePlayerName(name);
  }, []);

  // game state
  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);

  // chat & info
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastInfo, setLastInfo] = useState<string | null>(null);

  // import missing banner
  const [missingImport, setMissingImport] = useState<string[] | null>(null);

  // commander suggestion state
  const [cmdModalOpen, setCmdModalOpen] = useState(false);
  const [cmdSuggestedNames, setCmdSuggestedNames] = useState<string[]>([]);
  const [cmdSuggestedGameId, setCmdSuggestedGameId] =
    useState<GameID | null>(null);

  // debug & confirm
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<any | null>(null);
  const [confirmVotes, setConfirmVotes] =
    useState<ImportConfirmVotes | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // imported candidates
  const [importedCandidates, setImportedCandidates] = useState<KnownCardRef[]>(
    []
  );

  const [pendingLocalImport, setPendingLocalImport] = useState(false);
  const pendingLocalImportRef = useRef<boolean>(false);
  useEffect(() => {
    pendingLocalImportRef.current = pendingLocalImport;
  }, [pendingLocalImport]);

  const [localImportConfirmOpen, setLocalImportConfirmOpen] = useState(false);
  const localImportConfirmRef = useRef<boolean>(false);
  useEffect(() => {
    localImportConfirmRef.current = localImportConfirmOpen;
  }, [localImportConfirmOpen]);

  // commander selection queue
  const [queuedCommanderSelection, setQueuedCommanderSelection] = useState<{
    gameId: GameID;
    names: string[];
    ids?: string[];
  } | null>(null);

  // timer for deferred commander modal
  const suggestTimerRef = useRef<number | null>(null);

  /* ----------- client-side normalization helpers ----------- */

  const defaultPlayerZones = useMemo(
    () => ({
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    }),
    []
  );

  const normalizedZones = useMemo(() => {
    if (!view) return {};
    const out: Record<string, any> = { ...(view.zones || {}) };
    const players = Array.isArray(view.players) ? view.players : [];
    for (const p of players) {
      const pid = p?.id ?? (p as any)?.playerId;
      if (!pid) continue;
      if (!out[pid]) out[pid] = { ...defaultPlayerZones };
      else {
        out[pid].hand = Array.isArray(out[pid].hand) ? out[pid].hand : [];
        out[pid].handCount =
          typeof out[pid].handCount === "number"
            ? out[pid].handCount
            : Array.isArray(out[pid].hand)
            ? out[pid].hand.length
            : 0;
        out[pid].library = Array.isArray(out[pid].library)
          ? out[pid].library
          : [];
        out[pid].libraryCount =
          typeof out[pid].libraryCount === "number"
            ? out[pid].libraryCount
            : Array.isArray(out[pid].library)
            ? out[pid].library.length
            : 0;
        out[pid].graveyard = Array.isArray(out[pid].graveyard)
          ? out[pid].graveyard
          : [];
        out[pid].graveyardCount =
          typeof out[pid].graveyardCount === "number"
            ? out[pid].graveyardCount
            : Array.isArray(out[pid].graveyard)
            ? out[pid].graveyard.length
            : 0;
      }
    }
    return out;
  }, [view, defaultPlayerZones]);

  const safeView = useMemo(() => {
    if (!view) return view;
    return { ...view, zones: normalizedZones } as ClientGameView;
  }, [view, normalizedZones]);

  /* ----------- socket wiring ----------- */

  useEffect(() => {
    try {
      (window as any).socket = socket;
      // eslint-disable-next-line no-console
      console.debug("[useGameSocket] window.socket exposed for debugging");
    } catch {
      // ignore
    }
    return () => {
      try {
        delete (window as any).socket;
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const last = lastJoinRef.current;
      if (last) {
        const token =
          sessionStorage.getItem(seatTokenKey(last.gameId, last.name)) ||
          undefined;
        if (token) {
          const payload = {
            gameId: last.gameId,
            playerName: last.name,
            spectator: last.spectator,
            seatToken: token,
          };
          // eslint-disable-next-line no-console
          console.debug("[JOIN_EMIT] auto-join with seatToken", payload);
          socket.emit("joinGame", payload);
        } else {
          // eslint-disable-next-line no-console
          console.debug(
            "[JOIN_EMIT] skipping auto-join (no seatToken) for",
            last
          );
        }
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on(
      "joined",
      ({ you: youId, seatToken, gameId: joinedGameId }: any) => {
        setYou(youId);
        lastJoinRef.current = {
          gameId: joinedGameId,
          name: nameInput,
          spectator: joinAsSpectator,
        };
        const savedName = lastJoinRef.current?.name ?? nameInput;
        if (seatToken) {
          try {
            sessionStorage.setItem(
              seatTokenKey(joinedGameId, savedName),
              seatToken
            );
          } catch {
            // ignore
          }
        }
        // eslint-disable-next-line no-console
        console.debug("[socket] joined", {
          you: youId,
          gameId: joinedGameId,
          seatToken,
        });
      }
    );

    /**
     * Helper: Check if we should accept state updates for this game
     * Returns true if the incoming gameId matches the game we're currently joined to
     */
    const shouldAcceptStateUpdate = (incomingGameId: string | undefined): boolean => {
      if (!incomingGameId) return false;
      if (!lastJoinRef.current) {
        // eslint-disable-next-line no-console
        console.debug("[socket] state update ignored - not joined to any game");
        return false;
      }
      if (lastJoinRef.current.gameId !== incomingGameId) {
        // eslint-disable-next-line no-console
        console.debug("[socket] state update ignored - different game", {
          incomingGameId,
          currentJoin: lastJoinRef.current.gameId,
        });
        return false;
      }
      return true;
    };

    // full state => always hard-replace
    socket.on("state", (payload: any) => {
      try {
        if (!payload) {
          setView(null);
          // eslint-disable-next-line no-console
          console.debug("[socket] state (raw) null payload");
          return;
        }

        let incomingGameId: string | undefined;
        let newView: any | null = null;

        if (
          typeof payload === "object" &&
          "gameId" in payload &&
          "view" in payload
        ) {
          incomingGameId = payload.gameId;
          newView = payload.view;
        } else {
          newView = payload;
          incomingGameId =
            (payload && (payload.id || payload.gameId)) || undefined;
        }

        // CRITICAL FIX: Ignore state updates for games we've left
        // This prevents the race condition where leaving a game clears state,
        // but then a delayed state broadcast re-populates it
        if (!shouldAcceptStateUpdate(incomingGameId)) {
          return;
        }

        if (newView) {
          const viewWithId = incomingGameId
            ? { ...newView, id: incomingGameId }
            : newView;
          setView(viewWithId);
        } else {
          setView(null);
        }

        // eslint-disable-next-line no-console
        console.debug("[socket] state (raw)", { incomingGameId, newView });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("state handler failed:", e);
      }
    });

    // diff => treat as full replacement when diff.full/after present
    socket.on("stateDiff", (payload: any) => {
      try {
        if (!payload) return;
        let incomingGameId: string | undefined;
        let diff: any = null;

        if (
          typeof payload === "object" &&
          "gameId" in payload &&
          "diff" in payload
        ) {
          incomingGameId = payload.gameId;
          diff = payload.diff;
        } else if (
          typeof payload === "object" &&
          ("full" in payload || "after" in payload)
        ) {
          diff = payload;
          incomingGameId =
            (payload.full && payload.full.id) ||
            (payload.after && payload.after.id) ||
            undefined;
        } else {
          diff = { after: payload };
        }

        // CRITICAL FIX: Ignore state updates for games we've left
        // This prevents the race condition where leaving a game clears state,
        // but then a delayed state broadcast re-populates it
        if (!shouldAcceptStateUpdate(incomingGameId)) {
          return;
        }

        if (diff?.full) {
          const full = diff.full;
          setView(incomingGameId ? { ...full, id: incomingGameId } : full);
          // eslint-disable-next-line no-console
          console.debug("[socket] stateDiff full (raw)", {
            incomingGameId,
            view: full,
          });
        } else if (diff?.after) {
          const after = diff.after;
          setView(incomingGameId ? { ...after, id: incomingGameId } : after);
          // eslint-disable-next-line no-console
          console.debug("[socket] stateDiff after (raw)", {
            incomingGameId,
            view: after,
          });
        } else {
          // eslint-disable-next-line no-console
          console.debug("[socket] stateDiff (unrecognized)", { payload });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("stateDiff handling failed:", e);
      }
    });

    socket.on("priority", ({ player }: any) => setPriority(player));

    socket.on("chat", (msg: ChatMsg) => {
      setChat((prev) => [...prev.slice(-199), msg]);
    });

    socket.on("importedDeckCandidates", ({ gameId: gid, candidates }: any) => {
      const arr = Array.isArray(candidates) ? candidates : [];
      setImportedCandidates(arr);
      // eslint-disable-next-line no-console
      console.debug("[useGameSocket] importedDeckCandidates", {
        gameId: gid,
        count: arr.length,
      });
      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
        suggestTimerRef.current = null;
      }
      setPendingLocalImport(false);

      if (cmdSuggestedGameId === gid && !cmdModalOpen) {
        setCmdModalOpen(true);
      }
    });

    socket.on("deckImportMissing", ({ gameId: gid, missing }: any) => {
      setMissingImport(Array.isArray(missing) ? missing : []);
      setChat((prev) => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          gameId: gid,
          from: "system",
          message: `Missing cards: ${
            Array.isArray(missing) ? missing.slice(0, 10).join(", ") : ""
          }`,
          ts: Date.now(),
        },
      ]);
    });

    socket.on("error", ({ message }: any) =>
      setLastError(message || "Error")
    );

    socket.on("debugCommanderState", (payload: any) =>
      setDebugData((prev: Record<string, any> | null) => ({ ...(prev || {}), commanderState: payload }))
    );
    socket.on("debugLibraryDump", (payload: any) =>
      setDebugData((prev: Record<string, any> | null) => ({ ...(prev || {}), libraryDump: payload }))
    );
    socket.on("debugImportedDeckBuffer", (payload: any) =>
      setDebugData((prev: Record<string, any> | null) => ({ ...(prev || {}), importBuffer: payload }))
    );

    // generic confirm workflow (import or judge)
    const onConfirmRequest = (payload: any) => {
      // Update all confirm-related state atomically
      // React 18+ batches these updates automatically
      const initial: ImportConfirmVotes = {};
      for (const pid of payload.players || []) initial[pid] = "pending";
      if (payload.initiator) initial[payload.initiator] = "yes";
      
      setConfirmPayload(payload);
      setConfirmId(payload.confirmId);
      setConfirmVotes(initial);
      setConfirmOpen(true);
    };
    const onConfirmUpdate = (update: any) => {
      if (!update || !update.confirmId) return;
      // Only update if we have a matching confirmId
      if (confirmId && update.confirmId === confirmId)
        setConfirmVotes(update.responses);
    };
    const onConfirmCancelled = (info: any) => {
      if (!info || !info.confirmId) return;
      // Only clear if we have a matching confirmId or if we have no confirmId
      if (!confirmId || info.confirmId === confirmId) {
        setConfirmOpen(false);
        setConfirmPayload(null);
        setConfirmVotes(null);
        setConfirmId(null);

        const kind = confirmPayload?.kind || "import";
        const base =
          kind === "judge"
            ? "Judge request cancelled"
            : "Import cancelled";
        setLastInfo(
          `${base}${info.reason ? `: ${info.reason}` : ""}`
        );

        // Only import uses these:
        setPendingLocalImport(false);
        setQueuedCommanderSelection(null);
      }
    };
    const onConfirmConfirmed = (info: any) => {
      if (!info || !info.confirmId) return;
      if (!confirmId || info.confirmId === confirmId) {
        const kind = confirmPayload?.kind || "import";

        setConfirmOpen(false);
        setConfirmPayload(null);
        setConfirmVotes(null);
        setConfirmId(null);

        if (kind === "judge") {
          setLastInfo("Judge request approved.");
          // No local deck-hand clearing needed
        } else {
          setLastInfo(
            `Import applied${info.deckName ? `: ${info.deckName}` : ""}`
          );
          setPendingLocalImport(false);

          try {
            if (view && info && info.gameId === view.id && info.by && you) {
              setView((prev) => {
                if (!prev) return prev;
                const copy: any = {
                  ...prev,
                  zones: { ...(prev.zones || {}) },
                };

                copy.zones[you] = {
                  ...(copy.zones[you] || {}),
                  hand: [],
                  handCount: 0,
                };
                return copy;
              });
              socket.emit("getImportedDeckCandidates", {
                gameId: info.gameId,
              });
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("import confirm local-hand-clear failed:", e);
          }

          if (
            queuedCommanderSelection &&
            queuedCommanderSelection.gameId === info.gameId
          ) {
            const payload: any = {
              gameId: info.gameId,
              commanderNames: queuedCommanderSelection.names,
            };
            if (
              queuedCommanderSelection.ids &&
              queuedCommanderSelection.ids.length
            ) {
              payload.commanderIds = queuedCommanderSelection.ids;
            }
            // eslint-disable-next-line no-console
            console.debug(
              "[useGameSocket] flushing queued commander selection",
              payload
            );
            socket.emit("setCommander", payload);
            setQueuedCommanderSelection(null);
          }

          if (cmdSuggestedGameId === info.gameId && !cmdModalOpen) {
            setCmdModalOpen(true);
          }

          if (!queuedCommanderSelection) {
            socket.emit("getImportedDeckCandidates", {
              gameId: info.gameId,
            });
          }
        }
      }
    };

    // import confirm events
    socket.on("importWipeConfirmRequest", onConfirmRequest);
    socket.on("importWipeConfirmUpdate", onConfirmUpdate);
    socket.on("importWipeCancelled", onConfirmCancelled);
    socket.on("importWipeConfirmed", onConfirmConfirmed);

    // judge confirm events
    socket.on("judgeConfirmRequest", onConfirmRequest);
    socket.on("judgeConfirmUpdate", onConfirmUpdate);
    socket.on("judgeCancelled", onConfirmCancelled);
    socket.on("judgeConfirmed", onConfirmConfirmed);

    // suggestCommanders flow
    socket.on("suggestCommanders", ({ gameId: gid, names }: any) => {
      const namesList = Array.isArray(names) ? names.slice(0, 2) : [];
      setCmdSuggestedGameId(gid);
      setCmdSuggestedNames(namesList);

      try {
        socket.emit("getImportedDeckCandidates", { gameId: gid });
      } catch {
        // ignore
      }

      if (
        localImportConfirmOpen ||
        pendingLocalImportRef.current ||
        confirmOpen
      ) {
        return;
      }

      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
        suggestTimerRef.current = null;
      }

      const WAIT_MS = 600;
      suggestTimerRef.current = window.setTimeout(() => {
        setCmdModalOpen(true);
        suggestTimerRef.current = null;
      }, WAIT_MS) as unknown as number;
    });

    const onNameInUse = (payload: any) => {
      // let App control the modal; we just stash this on socket for now
      (socket as any)._lastNameInUsePayload = payload;
    };
    socket.on("nameInUse", onNameInUse);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("joined");
      socket.off("state");
      socket.off("stateDiff");
      socket.off("priority");
      socket.off("chat");
      socket.off("importedDeckCandidates");
      socket.off("deckImportMissing");
      socket.off("error");
      socket.off("debugCommanderState");
      socket.off("debugLibraryDump");
      socket.off("debugImportedDeckBuffer");

      socket.off("importWipeConfirmRequest", onConfirmRequest);
      socket.off("importWipeConfirmUpdate", onConfirmUpdate);
      socket.off("importWipeCancelled", onConfirmCancelled);
      socket.off("importWipeConfirmed", onConfirmConfirmed);

      socket.off("judgeConfirmRequest", onConfirmRequest);
      socket.off("judgeConfirmUpdate", onConfirmUpdate);
      socket.off("judgeCancelled", onConfirmCancelled);
      socket.off("judgeConfirmed", onConfirmConfirmed);

      socket.off("suggestCommanders");
      socket.off("nameInUse", onNameInUse);

      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
        suggestTimerRef.current = null;
      }
    };
  }, [
    nameInput,
    joinAsSpectator,
    confirmId,
    view,
    confirmOpen,
    queuedCommanderSelection,
    importedCandidates.length,
    you,
    safeView?.id,
    localImportConfirmOpen,
    cmdSuggestedGameId,
    cmdModalOpen,
    confirmPayload,
  ]);

  /* ----------- actions exposed to App ----------- */

  const handleJoin = useCallback(() => {
    lastJoinRef.current = {
      gameId: gameIdInput,
      name: nameInput,
      spectator: false, // Always join as player from manual join button
    };
    try {
      sessionStorage.setItem(
        lastJoinKey(),
        JSON.stringify(lastJoinRef.current)
      );
    } catch {
      // ignore
    }
    const token =
      sessionStorage.getItem(seatTokenKey(gameIdInput, nameInput)) ||
      undefined;
    const payload = {
      gameId: gameIdInput,
      playerName: nameInput,
      spectator: false, // Always join as player from manual join button
      seatToken: token,
    };
    // eslint-disable-next-line no-console
    console.debug("[JOIN_EMIT] manual join", payload);
    socket.emit("joinGame", payload);
  }, [gameIdInput, nameInput]);

  const joinFromList = useCallback(
    (selectedGameId: string, spectator?: boolean) => {
      // If spectator parameter is provided, use it; otherwise default to false (join as player)
      const isSpectator = spectator !== undefined ? spectator : false;
      
      lastJoinRef.current = {
        gameId: selectedGameId,
        name: nameInput,
        spectator: isSpectator,
      };
      try {
        sessionStorage.setItem(
          lastJoinKey(),
          JSON.stringify(lastJoinRef.current)
        );
      } catch {
        // ignore
      }
      const token =
        sessionStorage.getItem(seatTokenKey(selectedGameId, nameInput)) ||
        undefined;
      const payload = {
        gameId: selectedGameId,
        playerName: nameInput,
        spectator: isSpectator,
        seatToken: token,
      };
      // eslint-disable-next-line no-console
      console.debug("[JOIN_EMIT] joinFromList", payload);
      socket.emit("joinGame", payload);
      setGameIdInput(selectedGameId as GameID);
    },
    [nameInput]
  );

  // Leave the current game and clear session data
  const leaveGame = useCallback((onLeft?: () => void) => {
    const gameId = safeView?.id || lastJoinRef.current?.gameId;
    // Use the name from lastJoinRef (the name we actually joined with) if available
    // This ensures we clear the correct seatToken
    const playerName = lastJoinRef.current?.name;
    
    if (gameId) {
      // Emit leave event to server
      socket.emit("leaveGame", { gameId });
      // eslint-disable-next-line no-console
      console.debug("[LEAVE_EMIT] leaving game", gameId);
      
      // Clear the seatToken for this game/name combination
      // Only clear if we have a valid playerName from the join
      if (playerName) {
        try {
          sessionStorage.removeItem(seatTokenKey(gameId, playerName));
        } catch { /* ignore */ }
      }
    }
    
    // Clear lastJoinRef so we don't auto-rejoin on reconnect
    lastJoinRef.current = null;
    
    // Clear lastJoin from sessionStorage
    try {
      sessionStorage.removeItem(lastJoinKey());
    } catch { /* ignore */ }
    
    // Reset local state
    setView(null);
    setYou(null);
    setChat([]);
    setMissingImport(null);
    setImportedCandidates([]);
    setCmdModalOpen(false);
    setCmdSuggestedGameId(null);
    setCmdSuggestedNames([]);
    setConfirmOpen(false);
    setConfirmPayload(null);
    
    // eslint-disable-next-line no-console
    console.debug("[LEAVE_EMIT] cleared session data for game", gameId);
    
    // Call the optional callback (e.g., to re-expand game browser)
    if (onLeft) {
      onLeft();
    }
  }, [safeView]);

  const requestImportDeck = useCallback(
    (list: string, deckName?: string) => {
      if (!safeView) return;
      setPendingLocalImport(true);
      socket.emit("importDeck", { gameId: safeView.id, list, deckName });
    },
    [safeView]
  );

  const requestUseSavedDeck = useCallback(
    (deckId: string) => {
      if (!safeView) return;
      setPendingLocalImport(true);
      socket.emit("useSavedDeck", { gameId: safeView.id, deckId });
    },
    [safeView]
  );

  const handleLocalImportConfirmChange = useCallback((open: boolean) => {
    setLocalImportConfirmOpen(open);
  }, []);

  const handleCommanderConfirm = useCallback(
    (names: string[], ids?: string[]) => {
      if (!safeView || !names || names.length === 0) return;

      const phaseStr = String(safeView.phase || "").toUpperCase();
      const isPreGame = phaseStr.includes("PRE") || phaseStr === "";
      const singlePlayer =
        Array.isArray(safeView.players) &&
        safeView.players.length === 1 &&
        you === safeView.players[0]?.id;

      const mustQueue =
        !isPreGame &&
        !singlePlayer &&
        (pendingLocalImportRef.current ||
          localImportConfirmRef.current ||
          confirmOpen);

      if (mustQueue) {
        setQueuedCommanderSelection({
          gameId: safeView.id,
          names: names.slice(0, 2),
          ids: ids && ids.length ? ids.slice(0, 2) : undefined,
        });
        // eslint-disable-next-line no-console
        console.debug("[useGameSocket] queuing commander selection", {
          gameId: safeView.id,
          names,
          ids,
        });
        return;
      }

      const payload: any = { gameId: safeView.id, commanderNames: names };
      if (ids && ids.length) payload.commanderIds = ids;
      // eslint-disable-next-line no-console
      console.debug("[useGameSocket] emitting setCommander", payload);
      socket.emit("setCommander", payload);
    },
    [safeView, confirmOpen, you]
  );

  const fetchDebug = useCallback(() => {
    if (!safeView) {
      setDebugData({ error: "Invalid gameId for debug" });
      setDebugLoading(false);
      setDebugOpen(true);
      return;
    }
    setDebugLoading(true);
    setDebugData(null);
    setDebugOpen(true);
    const gid = safeView.id;
    const onceWithTimeout = (eventName: string, timeout = 3000) =>
      new Promise((resolve) => {
        const onResp = (payload: any) => {
          resolve(payload);
        };
        (socket as any).once(eventName, onResp);
        setTimeout(() => {
          (socket as any).off(eventName, onResp);
          resolve({ error: "timeout" });
        }, timeout);
      });

    (socket as any).emit("dumpCommanderState", { gameId: gid });
    (socket as any).emit("dumpLibrary", { gameId: gid });
    (socket as any).emit("dumpImportedDeckBuffer", { gameId: gid });

    Promise.all([
      onceWithTimeout("debugCommanderState"),
      onceWithTimeout("debugLibraryDump"),
      onceWithTimeout("debugImportedDeckBuffer"),
    ])
      .then(([commanderResp, libResp, bufResp]) => {
        setDebugData({
          commanderState: commanderResp,
          libraryDump: libResp,
          importBuffer: bufResp,
        });
        setDebugLoading(false);
      })
      .catch((err) => {
        setDebugData({ error: String(err) });
        setDebugLoading(false);
      });
  }, [safeView]);

  const respondToConfirm = useCallback(
    (accept: boolean) => {
      if (!safeView || !confirmId || !you || !confirmPayload) return;
      const kind = confirmPayload.kind || "import";

      if (kind === "judge") {
        socket.emit("judgeConfirmResponse", {
          gameId: safeView.id,
          confirmId,
          accept,
        });
      } else {
        socket.emit("confirmImportResponse", {
          gameId: safeView.id,
          confirmId,
          accept,
        });
      }

      setConfirmVotes((prev) =>
        prev
          ? {
              ...prev,
              [you]: accept ? "yes" : "no",
            }
          : prev
      );
    },
    [safeView, confirmId, you, confirmPayload]
  );

  return {
    connected,
    gameIdInput,
    setGameIdInput,
    nameInput,
    setNameInput: handleSetNameInput,

    you,
    view,
    safeView,
    priority,

    chat,
    setChat,
    lastError,
    lastInfo,

    missingImport,
    setMissingImport,

    importedCandidates,
    pendingLocalImport,
    localImportConfirmOpen,

    cmdModalOpen,
    setCmdModalOpen,
    cmdSuggestedNames,
    cmdSuggestedGameId,
    setCmdSuggestedGameId,
    setCmdSuggestedNames,

    confirmOpen,
    confirmPayload,
    confirmVotes,
    confirmId,

    debugOpen,
    debugLoading,
    debugData,
    setDebugOpen,

    // actions
    handleJoin,
    joinFromList,
    leaveGame,
    requestImportDeck,
    requestUseSavedDeck,
    handleLocalImportConfirmChange,
    handleCommanderConfirm,
    fetchDebug,
    respondToConfirm,
  };
}