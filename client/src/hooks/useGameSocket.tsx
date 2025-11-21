import { useCallback, useEffect, useRef } from "react";
import { socket } from "../socket";
import type {
  ChatMsg,
  ClientGameView,
  GameID,
  PlayerID,
} from "../../shared/src";

import type { UseImportAndCommanderResult } from "./useImportAndCommander";

function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name}`;
}
function lastJoinKey() {
  return "mtgedh:lastJoin";
}

export interface UseGameSocketProps {
  name: string;
  joinAsSpectator: boolean;

  view: ClientGameView | null;
  setView: (v: ClientGameView | null) => void;

  safeView: ClientGameView | null;

  you: PlayerID | null;
  setYou: (you: PlayerID | null) => void;

  setConnected: (c: boolean) => void;
  setPriority: (p: PlayerID | null) => void;
  setChat: (fn: (prev: ChatMsg[]) => ChatMsg[]) => void;

  setMissingImport: (m: string[] | null) => void;
  setLastError: (e: string | null) => void;
  setLastInfo: (i: string | null) => void;

  setDebugOpen: (b: boolean) => void;
  setDebugLoading: (b: boolean) => void;
  setDebugData: (d: any) => void;

  setNameInUsePayload: (p: any | null) => void;
  setShowNameInUseModal: (b: boolean) => void;

  setPeek: (p: any) => void;

  importAndCommander: UseImportAndCommanderResult;
}

/**
 * Encapsulates all socket.io event bindings for the game.
 * App.tsx passes in the relevant setters and the import/commander hook.
 */
export function useGameSocket(props: UseGameSocketProps) {
  const {
    name,
    joinAsSpectator,
    view,
    setView,
    safeView,
    you,
    setYou,
    setConnected,
    setPriority,
    setChat,
    setMissingImport,
    setLastError,
    setLastInfo,
    setDebugOpen,
    setDebugLoading,
    setDebugData,
    setNameInUsePayload,
    setShowNameInUseModal,
    setPeek,
    importAndCommander,
  } = props;

  const {
    pendingLocalImport,
    setPendingLocalImport,
    localImportConfirmOpen,
    confirmOpen,
    confirmId,
    handleImportedDeckCandidatesFromServer,
    handleSuggestCommandersFromServer,
    handleImportWipeRequestFromServer,
    handleImportWipeUpdateFromServer,
    handleImportWipeCancelledFromServer,
    handleImportWipeConfirmedFromServer,
  } = importAndCommander;

  const lastJoinRef = useRef<{
    gameId: GameID;
    name: string;
    spectator: boolean;
  } | null>(null);

  // stable ref to latest view for use in handlers
  const viewRef = useRef<ClientGameView | null>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    try {
      (window as any).socket = socket;
      console.debug("[dev] window.socket exposed for debugging");
    } catch {
      /* ignore */
    }
    return () => {
      try {
        delete (window as any).socket;
      } catch {
        /* ignore */
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
          console.debug("[JOIN_EMIT] auto-join with seatToken", payload);
          socket.emit("joinGame", payload);
        } else {
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
          name,
          spectator: joinAsSpectator,
        };
        const savedName = lastJoinRef.current?.name ?? name;
        if (seatToken) {
          try {
            sessionStorage.setItem(
              seatTokenKey(joinedGameId, savedName),
              seatToken
            );
          } catch {
            /* ignore */
          }
        }
        console.debug("[socket] joined", {
          you: youId,
          gameId: joinedGameId,
          seatToken,
        });
      }
    );

    // Normalized state handler
    socket.on("state", (payload: any) => {
      try {
        let incomingGameId: string | undefined;
        let newView: any | null = null;

        if (!payload) {
          setView(null);
          console.debug("[socket] state (raw) null payload");
          return;
        }

        if (
          payload &&
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

        if (newView) {
          const viewWithId = incomingGameId
            ? { ...newView, id: incomingGameId }
            : newView;
          setView(viewWithId);
        } else {
          setView(null);
        }

        console.debug("[socket] state (raw)", { incomingGameId, newView });
      } catch (e) {
        console.warn("state handler failed:", e);
      }
    });

    socket.on("stateDiff", (payload: any) => {
      try {
        if (!payload) return;

        let incomingGameId: string | undefined;
        let diff: any = null;

        if (
          payload &&
          typeof payload === "object" &&
          "gameId" in payload &&
          "diff" in payload
        ) {
          incomingGameId = payload.gameId;
          diff = payload.diff;
        } else if (
          payload &&
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

        if (diff?.full) {
          const full = diff.full;
          setView(incomingGameId ? { ...full, id: incomingGameId } : full);
          console.debug("[socket] stateDiff full (raw)", {
            incomingGameId,
            view: full,
          });
        } else if (diff?.after) {
          const after = diff.after;
          setView(incomingGameId ? { ...after, id: incomingGameId } : after);
          console.debug("[socket] stateDiff after (raw)", {
            incomingGameId,
            view: after,
          });
        } else {
          console.debug("[socket] stateDiff (unrecognized)", { payload });
        }
      } catch (e) {
        console.warn("stateDiff handling failed:", e);
      }
    });

    socket.on("priority", ({ player }: any) => setPriority(player));

    socket.on("chat", (msg: ChatMsg) => {
      setChat((prev) => [...prev.slice(-199), msg]);
    });

    socket.on(
      "importedDeckCandidates",
      handleImportedDeckCandidatesFromServer
    );

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

    socket.on("scryPeek", ({ cards }: any) =>
      setPeek({ mode: "scry", cards })
    );
    socket.on("surveilPeek", ({ cards }: any) =>
      setPeek({ mode: "surveil", cards })
    );
    socket.on("error", ({ message }: any) =>
      setLastError(message || "Error")
    );

    socket.on("debugCommanderState", (payload: any) =>
      setDebugData((prev: any) => ({ ...(prev || {}), commanderState: payload }))
    );
    socket.on("debugLibraryDump", (payload: any) =>
      setDebugData((prev: any) => ({ ...(prev || {}), libraryDump: payload }))
    );
    socket.on("debugImportedDeckBuffer", (payload: any) =>
      setDebugData((prev: any) => ({ ...(prev || {}), importBuffer: payload }))
    );

    socket.on("importWipeConfirmRequest", handleImportWipeRequestFromServer);
    socket.on("importWipeConfirmUpdate", handleImportWipeUpdateFromServer);
    socket.on("importWipeCancelled", handleImportWipeCancelledFromServer);
    socket.on("importWipeConfirmed", (info: any) =>
      handleImportWipeConfirmedFromServer(info, viewRef.current)
    );

    // Single suggestCommanders handler in App
    socket.on("suggestCommanders", handleSuggestCommandersFromServer);

    const onNameInUse = (payload: any) => {
      setNameInUsePayload(payload);
      setShowNameInUseModal(true);
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
      socket.off("scryPeek");
      socket.off("surveilPeek");
      socket.off("error");

      socket.off("debugCommanderState");
      socket.off("debugLibraryDump");
      socket.off("debugImportedDeckBuffer");

      socket.off("importWipeConfirmRequest", handleImportWipeRequestFromServer);
      socket.off("importWipeConfirmUpdate", handleImportWipeUpdateFromServer);
      socket.off("importWipeCancelled", handleImportWipeCancelledFromServer);
      socket.off("importWipeConfirmed");

      socket.off("suggestCommanders", handleSuggestCommandersFromServer);
      socket.off("nameInUse", onNameInUse);
    };
  }, [
    name,
    joinAsSpectator,
    setConnected,
    setView,
    setPriority,
    setChat,
    setMissingImport,
    setLastError,
    setDebugData,
    handleImportedDeckCandidatesFromServer,
    handleSuggestCommandersFromServer,
    handleImportWipeRequestFromServer,
    handleImportWipeUpdateFromServer,
    handleImportWipeCancelledFromServer,
    handleImportWipeConfirmedFromServer,
  ]);
}

// Optional: helpers for join, requestState, chat, and debug can be simple functions
// you export from here, or small hooks (e.g., useJoinActions) that wrap socket.emit.