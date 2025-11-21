import { useCallback, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import type {
  ClientGameView,
  GameID,
  KnownCardRef,
  PlayerID,
} from "../../shared/src";

export interface UseImportAndCommanderResult {
  // import state
  pendingLocalImport: boolean;
  setPendingLocalImport: (v: boolean) => void;
  localImportConfirmOpen: boolean;
  handleLocalImportConfirmChange: (open: boolean) => void;

  // import-wipe confirm state
  confirmOpen: boolean;
  confirmPayload: any | null;
  confirmVotes: Record<string, "pending" | "yes" | "no"> | null;
  confirmId: string | null;
  respondToConfirm: (accept: boolean) => void;

  // commander suggestion & modals
  importedCandidates: KnownCardRef[];
  cmdModalOpen: boolean;
  setCmdModalOpen: (open: boolean) => void;
  cmdSuggestedNames: string[];
  cmdSuggestedGameId: GameID | null;
  showCommanderGallery: boolean;

  // handlers to plug into socket events
  handleImportedDeckCandidatesFromServer: (payload: {
    gameId: GameID;
    candidates: KnownCardRef[];
  }) => void;
  handleSuggestCommandersFromServer: (payload: {
    gameId: GameID;
    names?: string[];
  }) => void;
  handleImportWipeRequestFromServer: (payload: any) => void;
  handleImportWipeUpdateFromServer: (update: any) => void;
  handleImportWipeCancelledFromServer: (info: any) => void;
  handleImportWipeConfirmedFromServer: (info: any, view: ClientGameView | null) => void;

  // top-level actions
  requestImportDeck: (list: string, deckName?: string) => void;
  requestUseSavedDeck: (deckId: string) => void;
  handleCommanderConfirm: (names: string[], ids?: string[]) => void;

  // internal bookkeeping you might want to inspect
  queuedCommanderSelection: {
    gameId: GameID;
    names: string[];
    ids?: string[];
  } | null;
}

/**
 * Encapsulates all import + commander selection state/flows that were previously
 * embedded in App.tsx. The goal is to shrink App and keep this logic together.
 */
export function useImportAndCommander(
  safeView: ClientGameView | null,
  you: PlayerID | null
): UseImportAndCommanderResult {
  // --- import + confirm state ---
  const [pendingLocalImport, setPendingLocalImport] = useState(false);
  const pendingLocalImportRef = useRef<boolean>(false);
  pendingLocalImportRef.current = pendingLocalImport;

  const [localImportConfirmOpen, setLocalImportConfirmOpen] = useState(false);
  const localImportConfirmRef = useRef<boolean>(false);
  localImportConfirmRef.current = localImportConfirmOpen;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<any | null>(null);
  const [confirmVotes, setConfirmVotes] =
    useState<Record<string, "pending" | "yes" | "no"> | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // candidates from server
  const [importedCandidates, setImportedCandidates] = useState<KnownCardRef[]>(
    []
  );

  // queue for commander selection when we can't emit yet
  const [queuedCommanderSelection, setQueuedCommanderSelection] = useState<{
    gameId: GameID;
    names: string[];
    ids?: string[];
  } | null>(null);

  // commander suggestion UI state
  const [cmdModalOpen, setCmdModalOpen] = useState(false);
  const [cmdSuggestedNames, setCmdSuggestedNames] = useState<string[]>([]);
  const [cmdSuggestedGameId, setCmdSuggestedGameId] =
    useState<GameID | null>(null);

  // fallback timer ref for "open modal after candidates"
  const suggestTimerRef = useRef<number | null>(null);

  const effectiveGameId: GameID | null = safeView?.id ?? null;

  const handleLocalImportConfirmChange = useCallback((open: boolean) => {
    setLocalImportConfirmOpen(open);
  }, []);

  // --- import actions (client -> server) ---
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

  // --- commander confirm (client-side gating) ---
  const handleCommanderConfirm = useCallback(
    (names: string[], ids?: string[]) => {
      if (!safeView || !names || names.length === 0) return;

      const isPreGame = String(safeView.phase || "")
        .toUpperCase()
        .includes("PRE");
      const singlePlayer =
        Array.isArray(safeView.players) &&
        safeView.players.length === 1 &&
        you === safeView.players[0]?.id;

      // In single-player PRE_GAME, do not queue commander selection; apply immediately.
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
        console.debug("[App] queuing commander selection", {
          gameId: safeView.id,
          names,
          ids,
        });
        return;
      }

      const payload: any = { gameId: safeView.id, commanderNames: names };
      if (ids && ids.length) payload.commanderIds = ids;
      console.debug("[App] emitting setCommander", payload);
      socket.emit("setCommander", payload);
    },
    [safeView, confirmOpen, you]
  );

  // --- import-wipe confirm response ---
  const respondToConfirm = useCallback(
    (accept: boolean) => {
      if (!safeView || !confirmId || !you) return;
      socket.emit("confirmImportResponse", {
        gameId: safeView.id,
        confirmId,
        accept,
      });
      setConfirmVotes((prev) =>
        prev
          ? {
              ...prev,
              [you]: accept ? "yes" : "no",
            }
          : prev
      );
    },
    [safeView, confirmId, you]
  );

  // --- socket event handlers (to be wired in useGameSocket) ---

  const handleImportedDeckCandidatesFromServer = useCallback(
    ({ gameId: gid, candidates }: any) => {
      const arr = Array.isArray(candidates) ? candidates : [];
      setImportedCandidates(arr);
      console.debug("[App] importedDeckCandidates received", {
        gameId: gid,
        count: arr.length,
      });
      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
        suggestTimerRef.current = null;
      }

      // importer-only flow: once we have candidates, import is no longer "pending"
      setPendingLocalImport(false);

      // If a commander suggestion is pending for this game, and we were waiting,
      // open the modal now.
      if (cmdSuggestedGameId === gid && !cmdModalOpen) {
        console.debug(
          "[App] opening commander modal immediately (candidates in)"
        );
        setCmdModalOpen(true);
      }
    },
    [cmdSuggestedGameId, cmdModalOpen]
  );

  const handleSuggestCommandersFromServer = useCallback(
    ({ gameId: gid, names }: any) => {
      console.debug("[App] suggestCommanders received", {
        gameId: gid,
        localViewId: safeView?.id,
        names,
        localImportConfirmOpen,
        pendingLocalImport: pendingLocalImportRef.current,
        confirmOpen,
      });

      const namesList = Array.isArray(names) ? names.slice(0, 2) : [];

      // Save suggestion context
      setCmdSuggestedGameId(gid);
      setCmdSuggestedNames(namesList);

      // Always request candidates
      try {
        socket.emit("getImportedDeckCandidates", { gameId: gid });
      } catch (e) {
        console.warn(
          "[App] suggestCommanders -> getImportedDeckCandidates failed",
          e
        );
      }

      // If import UI is currently showing, don't pop yet; we'll open after confirm
      if (
        localImportConfirmOpen ||
        pendingLocalImportRef.current ||
        confirmOpen
      ) {
        console.debug(
          "[App] suggestCommanders suppressed by import UI; will open after confirm"
        );
        return;
      }

      // Otherwise, schedule modal open (wait briefly for importedCandidates for gallery)
      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
        suggestTimerRef.current = null;
      }

      const WAIT_MS = 600;
      console.debug("[App] scheduling commander modal open", {
        gameId: gid,
        namesList,
        waitMs: WAIT_MS,
      });
      suggestTimerRef.current = window.setTimeout(() => {
        console.debug(
          "[App] suggestCommanders timeout -> opening commander modal",
          {
            gameId: gid,
            importedCandidatesCount: importedCandidates.length,
          }
        );
        setCmdModalOpen(true);
        suggestTimerRef.current = null;
      }, WAIT_MS) as unknown as number;
    },
    [
      safeView?.id,
      localImportConfirmOpen,
      confirmOpen,
      importedCandidates.length,
    ]
  );

  const handleImportWipeRequestFromServer = useCallback((payload: any) => {
    setConfirmPayload(payload);
    setConfirmId(payload.confirmId);
    const initial: Record<string, "pending" | "yes" | "no"> = {};
    for (const pid of payload.players || []) initial[pid] = "pending";
    if (payload.initiator) initial[payload.initiator] = "yes";
    setConfirmVotes(initial);
    setConfirmOpen(true);
  }, []);

  const handleImportWipeUpdateFromServer = useCallback(
    (update: any) => {
      if (!update || !update.confirmId) return;
      if (!confirmId || update.confirmId === confirmId)
        setConfirmVotes(update.responses);
    },
    [confirmId]
  );

  const handleImportWipeCancelledFromServer = useCallback(
    (info: any) => {
      if (!info || !info.confirmId) return;
      if (!confirmId || info.confirmId === confirmId) {
        setConfirmOpen(false);
        setConfirmPayload(null);
        setConfirmVotes(null);
        setConfirmId(null);
        setPendingLocalImport(false);
        setQueuedCommanderSelection(null);
      }
    },
    [confirmId]
  );

  const handleImportWipeConfirmedFromServer = useCallback(
    (info: any, view: ClientGameView | null) => {
      if (!info || !info.confirmId) return;
      if (!confirmId || info.confirmId === confirmId) {
        setConfirmOpen(false);
        setConfirmPayload(null);
        setConfirmVotes(null);
        setConfirmId(null);
        setPendingLocalImport(false);

        // Clear our local hand snapshot for us if we are the importer
        try {
          if (
            view &&
            info &&
            info.gameId === view.id &&
            info.by &&
            you &&
            info.by === you
          ) {
            // local "hand is now empty" assumption; real state comes from server
            // App-level code will call setView; we don't do that here to avoid circular deps.
            try {
              socket.emit("getImportedDeckCandidates", {
                gameId: info.gameId,
              });
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          console.warn("import confirm local-hand-clear failed:", e);
        }

        // If we queued a commander *selection*, emit it now
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
          console.debug(
            "[App] flushing queued commander selection after import",
            payload
          );
          socket.emit("setCommander", payload);
          setQueuedCommanderSelection(null);
        }

        // If we just finished import for this game and have suggestions, show modal.
        if (cmdSuggestedGameId === info.gameId && !cmdModalOpen) {
          console.debug(
            "[App] showing commander modal after import confirmed"
          );
          setCmdModalOpen(true);
        }

        if (!queuedCommanderSelection) {
          try {
            socket.emit("getImportedDeckCandidates", { gameId: info.gameId });
          } catch (e) {
            /* ignore */
          }
        }
      }
    },
    [confirmId, you, queuedCommanderSelection, cmdSuggestedGameId, cmdModalOpen]
  );

  const showCommanderGallery = useMemo(
    () =>
      Boolean(
        cmdModalOpen && cmdSuggestedGameId && importedCandidates.length > 0
      ),
    [cmdModalOpen, cmdSuggestedGameId, importedCandidates.length]
  );

  return {
    pendingLocalImport,
    setPendingLocalImport,
    localImportConfirmOpen,
    handleLocalImportConfirmChange,
    confirmOpen,
    confirmPayload,
    confirmVotes,
    confirmId,
    respondToConfirm,
    importedCandidates,
    cmdModalOpen,
    setCmdModalOpen,
    cmdSuggestedNames,
    cmdSuggestedGameId,
    showCommanderGallery,
    handleImportedDeckCandidatesFromServer,
    handleSuggestCommandersFromServer,
    handleImportWipeRequestFromServer,
    handleImportWipeUpdateFromServer,
    handleImportWipeCancelledFromServer,
    handleImportWipeConfirmedFromServer,
    requestImportDeck,
    requestUseSavedDeck,
    handleCommanderConfirm,
    queuedCommanderSelection,
  };
}