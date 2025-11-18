// client/src/App.tsx
// Full App component (named + default export).
// Changes in this variant:
//  - Normalize incoming views to ensure view.zones[playerId] exists for every player
//    and pass a safeView into TableLayout and ZonesPanel to avoid renderer crashes.
//  - Only auto-rejoin on socket connect when a saved seatToken exists (prevents accidental duplicate seats).
//  - Log all join emits with "[JOIN_EMIT]" for debugging duplicate-seat issue.
//  - Use session- and lastJoin-aware seatToken storage when handling joined.
//  - Integrate GameList component so users can browse and join active games.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";
import type {
  ClientGameView,
  PlayerID,
  GameID,
  KnownCardRef,
  ChatMsg,
} from "../../shared/src";
import { TableLayout } from "./components/TableLayout";
import { CardPreviewLayer } from "./components/CardPreviewLayer";
import CommanderConfirmModal from "./components/CommanderConfirmModal";
import NameInUseModal from "./components/NameInUseModal";
import { ZonesPanel } from "./components/ZonesPanel";
import { ScrySurveilModal } from "./components/ScrySurveilModal";
import { BattlefieldGrid, type ImagePref } from "./components/BattlefieldGrid";
import GameList from "./components/GameList";

/* Helpers */
function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name}`;
}
function lastJoinKey() {
  return "mtgedh:lastJoin";
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

/* Small ChatPanel component */
function ChatPanel({ messages, onSend, view }: { messages: ChatMsg[]; onSend: (text: string) => void; view?: ClientGameView | null; }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const submit = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  const displaySender = (from: string | "system") => {
    if (from === "system") return "system";
    const player = view?.players?.find((p: any) => p.id === from);
    return player?.name || from;
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", height: 340, background: "#fafafa" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Chat</div>
      <div style={{ flex: 1, overflow: "auto", padding: 6, background: "#fff", borderRadius: 4 }}>
        {messages.length === 0 && <div style={{ color: "#666" }}>No messages</div>}
        {messages.map(m => (
          <div key={m.id} style={{ marginBottom: 6 }}>
            <div><strong>{displaySender(m.from)}</strong>: {m.message}</div>
            <div style={{ fontSize: 11, color: "#777" }}>{new Date(m.ts).toLocaleTimeString()}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} placeholder="Type message..." style={{ flex: 1 }} />
        <button onClick={submit}>Send</button>
      </div>
    </div>
  );
}

/* App component (named export + default export) */
export function App() {
  // connection + join UI state
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<GameID>("demo");
  const [name, setName] = useState("Player");
  const [joinAsSpectator, setJoinAsSpectator] = useState(false);

  // Name-in-use modal state
  const [nameInUsePayload, setNameInUsePayload] = useState<any | null>(null);
  const [showNameInUseModal, setShowNameInUseModal] = useState(false);

  const lastJoinRef = useRef<{ gameId: GameID; name: string; spectator: boolean } | null>(null);

  // game view state
  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);

  // chat, info, errors
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastInfo, setLastInfo] = useState<string | null>(null);

  // import missing banner
  const [missingImport, setMissingImport] = useState<string[] | null>(null);

  // other UI state
  const [imagePref, setImagePref] = useState<ImagePref>(() => (localStorage.getItem("mtgedh:imagePref") as ImagePref) || "normal");
  const [layout, setLayout] = useState<"rows" | "table">(() => (localStorage.getItem("mtgedh:layout") as ("rows" | "table")) || "table");

  const [peek, setPeek] = useState<{ mode: "scry" | "surveil"; cards: any[] } | null>(null);

  // debug & import-confirm
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<any>(null);
  const [confirmVotes, setConfirmVotes] = useState<Record<string, "pending" | "yes" | "no"> | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // commander suggestion handling
  const [cmdSuggestOpen, setCmdSuggestOpen] = useState(false);
  const [cmdSuggestNames, setCmdSuggestNames] = useState<string[]>([]);
  const [queuedCommanderSuggest, setQueuedCommanderSuggest] = useState<{ gameId: GameID; names: string[] } | null>(null);

  const [importedCandidates, setImportedCandidates] = useState<KnownCardRef[]>([]);

  const [pendingLocalImport, setPendingLocalImport] = useState(false);
  const pendingLocalImportRef = useRef<boolean>(false);
  useEffect(() => { pendingLocalImportRef.current = pendingLocalImport; }, [pendingLocalImport]);

  const [localImportConfirmOpen, setLocalImportConfirmOpen] = useState(false);
  const localImportConfirmRef = useRef<boolean>(false);
  useEffect(() => { localImportConfirmRef.current = localImportConfirmOpen; }, [localImportConfirmOpen]);

  // fallback timer ref for App-level fallback modal
  const fallbackTimerRef = useRef<number | null>(null);

  /* ------------------ Client-side normalization helpers ------------------ */

  const defaultPlayerZones = useMemo(() => ({ hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 }), []);

  // Build a normalized zones map derived from server view; ensures every player id has an object.
  const normalizedZones = useMemo(() => {
    if (!view) return {};
    const out: Record<string, any> = { ...(view.zones || {}) };
    const players = Array.isArray(view.players) ? view.players : [];
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      if (!out[pid]) out[pid] = { ...defaultPlayerZones };
      else {
        // ensure shape exists
        out[pid].hand = Array.isArray(out[pid].hand) ? out[pid].hand : [];
        out[pid].handCount = typeof out[pid].handCount === "number" ? out[pid].handCount : (Array.isArray(out[pid].hand) ? out[pid].hand.length : 0);
        out[pid].library = Array.isArray(out[pid].library) ? out[pid].library : [];
        out[pid].libraryCount = typeof out[pid].libraryCount === "number" ? out[pid].libraryCount : (Array.isArray(out[pid].library) ? out[pid].library.length : 0);
        out[pid].graveyard = Array.isArray(out[pid].graveyard) ? out[pid].graveyard : [];
        out[pid].graveyardCount = typeof out[pid].graveyardCount === "number" ? out[pid].graveyardCount : (Array.isArray(out[pid].graveyard) ? out[pid].graveyard.length : 0);
      }
    }
    return out;
  }, [view, defaultPlayerZones]);

  // safeView is a shallow copy of view with normalized zones. Pass this into child components that read zones.
  const safeView = useMemo(() => {
    if (!view) return view;
    return { ...view, zones: normalizedZones } as ClientGameView;
  }, [view, normalizedZones]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const last = lastJoinRef.current;
      if (last) {
        // Only auto-join when we have a saved seatToken for this game+name to avoid creating duplicates.
        const token = sessionStorage.getItem(seatTokenKey(last.gameId, last.name)) || undefined;
        if (token) {
          const payload = { gameId: last.gameId, playerName: last.name, spectator: last.spectator, seatToken: token };
          console.debug("[JOIN_EMIT] auto-join with seatToken", payload);
          socket.emit("joinGame", payload);
        } else {
          console.debug("[JOIN_EMIT] skipping auto-join (no seatToken) for", last);
        }
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("joined", ({ you: youId, seatToken, gameId: joinedGameId }: any) => {
      setYou(youId);
      // persist last join intent for future reconnect attempts
      lastJoinRef.current = { gameId: joinedGameId, name, spectator: joinAsSpectator };
      // prefer using lastJoinRef name if present to store seatToken under the same key we looked up
      const savedName = lastJoinRef.current?.name ?? name;
      if (seatToken) {
        try { sessionStorage.setItem(seatTokenKey(joinedGameId, savedName), seatToken); } catch (e) { /* ignore */ }
      }
      console.debug("[socket] joined", { you: youId, gameId: joinedGameId, seatToken });
    });

    // Normalized state handler: normalize and set view
    socket.on("state", ({ view: newView }: any) => {
      // setView with the raw newView; we compute safeView separately via useMemo above
      setView(newView);
      console.debug("[socket] state (raw)", newView);
    });

    socket.on("stateDiff", ({ diff }: any) => {
      try {
        if (diff?.full) {
          setView(diff.full);
          console.debug("[socket] stateDiff full (raw)", diff.full);
        } else if (diff?.after) {
          setView(diff.after);
          console.debug("[socket] stateDiff after (raw)", diff.after);
        }
      } catch (e) {
        console.warn("stateDiff handling failed:", e);
      }
    });

    socket.on("priority", ({ player }: any) => setPriority(player));

    socket.on("chat", (msg: ChatMsg) => {
      setChat(prev => [...prev.slice(-199), msg]);
    });

    socket.on("importedDeckCandidates", ({ candidates }: any) => {
      const arr = Array.isArray(candidates) ? candidates : [];
      setImportedCandidates(arr);
      console.debug("[socket] importedDeckCandidates received", arr);
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    });

    socket.on("deckImportMissing", ({ gameId: gid, missing }: any) => {
      setMissingImport(Array.isArray(missing) ? missing : []);
      setChat(prev => [...prev, { id: `m_${Date.now()}`, gameId: gid, from: "system", message: `Missing cards: ${Array.isArray(missing) ? missing.slice(0,10).join(", ") : ""}`, ts: Date.now() }]);
    });

    socket.on("scryPeek", ({ cards }: any) => setPeek({ mode: "scry", cards }));
    socket.on("surveilPeek", ({ cards }: any) => setPeek({ mode: "surveil", cards }));
    socket.on("error", ({ message }: any) => setLastError(message || "Error"));

    socket.on("debugCommanderState", (payload: any) => setDebugData(prev => ({ ...(prev || {}), commanderState: payload })));
    socket.on("debugLibraryDump", (payload: any) => setDebugData(prev => ({ ...(prev || {}), libraryDump: payload })));
    socket.on("debugImportedDeckBuffer", (payload: any) => setDebugData(prev => ({ ...(prev || {}), importBuffer: payload })));

    const onRequest = (payload: any) => {
      setConfirmPayload(payload);
      setConfirmId(payload.confirmId);
      const initial: Record<string, "pending" | "yes" | "no"> = {};
      for (const pid of payload.players || []) initial[pid] = "pending";
      if (payload.initiator) initial[payload.initiator] = "yes";
      setConfirmVotes(initial);
      setConfirmOpen(true);
    };
    const onUpdate = (update: any) => {
      if (!update || !update.confirmId) return;
      if (!confirmId || update.confirmId === confirmId) setConfirmVotes(update.responses);
    };
    const onCancelled = (info: any) => {
      if (!info || !info.confirmId) return;
      if (!confirmId || info.confirmId === confirmId) {
        setConfirmOpen(false);
        setConfirmPayload(null);
        setConfirmVotes(null);
        setConfirmId(null);
        setLastInfo(`Import cancelled${info.reason ? `: ${info.reason}` : ""}`);
        setPendingLocalImport(false);
        setQueuedCommanderSuggest(null);
      }
    };
    const onConfirmed = (info: any) => {
      if (!info || !info.confirmId) return;
      if (!confirmId || info.confirmId === confirmId) {
        setConfirmOpen(false);
        setConfirmPayload(null);
        setConfirmVotes(null);
        setConfirmId(null);
        setLastInfo(`Import applied${info.deckName ? `: ${info.deckName}` : ""}`);
        setPendingLocalImport(false);

        try {
          if (view && info && info.gameId === view.id && info.by && you && info.by === you) {
            setView(prev => {
              if (!prev) return prev;
              const copy: any = { ...prev, zones: { ...(prev.zones || {}) } };
              copy.zones[you] = { ...(copy.zones[you] || {}), hand: [], handCount: 0 };
              return copy;
            });
            socket.emit("getImportedDeckCandidates", { gameId: info.gameId });
          }
        } catch (e) {
          console.warn("import confirm local-hand-clear failed:", e);
        }

        if (queuedCommanderSuggest && queuedCommanderSuggest.gameId === info.gameId) {
          // keep queuedCmdSuggest for TableLayout to act on
        }
      }
    };

    socket.on("importWipeConfirmRequest", onRequest);
    socket.on("importWipeConfirmUpdate", onUpdate);
    socket.on("importWipeCancelled", onCancelled);
    socket.on("importWipeConfirmed", onConfirmed);

    // Suggest commanders: request candidates and schedule an App-level text fallback after WAIT_MS
    socket.on("suggestCommanders", ({ gameId: gid, names }: any) => {
      console.debug("[socket] suggestCommanders", { gameId: gid, names });
      if (!view || gid !== view.id) return;

      try {
        socket.emit("getImportedDeckCandidates", { gameId: gid });
      } catch (e) { /* ignore */ }

      if (localImportConfirmRef.current || pendingLocalImportRef.current || confirmOpen) {
        setQueuedCommanderSuggest({ gameId: gid, names: Array.isArray(names) ? names.slice(0, 2) : [] });
        return;
      }

      setQueuedCommanderSuggest({ gameId: gid, names: Array.isArray(names) ? names.slice(0, 2) : [] });

      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      const WAIT_MS = 900;
      const namesList = Array.isArray(names) ? names.slice(0, 2) : [];
      fallbackTimerRef.current = window.setTimeout(() => {
        if (!importedCandidates || importedCandidates.length === 0) {
          setCmdSuggestNames(namesList);
          setCmdSuggestOpen(true);
          setQueuedCommanderSuggest(null);
        } else {
          setQueuedCommanderSuggest(null);
        }
        fallbackTimerRef.current = null;
      }, WAIT_MS) as unknown as number;
    });

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

      socket.off("importWipeConfirmRequest", onRequest);
      socket.off("importWipeConfirmUpdate", onUpdate);
      socket.off("importWipeConfirmCancelled", onCancelled);
      socket.off("importWipeConfirm", onConfirmed);

      socket.off("suggestCommanders");
      socket.off("nameInUse", onNameInUse);

      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [name, joinAsSpectator, view?.id, confirmId, view, confirmOpen, queuedCommanderSuggest, importedCandidates, you]);

  // actions
  const handleJoin = () => {
    lastJoinRef.current = { gameId, name, spectator: joinAsSpectator };
    const token = sessionStorage.getItem(seatTokenKey(gameId, name)) || undefined;
    const payload = { gameId, playerName: name, spectator: joinAsSpectator, seatToken: token };
    console.debug("[JOIN_EMIT] manual join", payload);
    socket.emit("joinGame", payload);
  };

  // joinFromList: used by GameList to join a selected game
  const joinFromList = (selectedGameId: string) => {
    lastJoinRef.current = { gameId: selectedGameId, name, spectator: joinAsSpectator };
    const token = sessionStorage.getItem(seatTokenKey(selectedGameId, name)) || undefined;
    const payload = { gameId: selectedGameId, playerName: name, spectator: joinAsSpectator, seatToken: token };
    console.debug("[JOIN_EMIT] joinFromList", payload);
    socket.emit("joinGame", payload);
    setGameId(selectedGameId);
  };

  const requestImportDeck = useCallback((list: string, deckName?: string) => {
    if (!view) return;
    setPendingLocalImport(true);
    socket.emit("importDeck", { gameId: view.id, list, deckName });
  }, [view]);

  const requestUseSavedDeck = useCallback((deckId: string) => {
    if (!view) return;
    setPendingLocalImport(true);
    socket.emit("useSavedDeck", { gameId: view.id, deckId });
  }, [view]);

  const handleLocalImportConfirmChange = useCallback((open: boolean) => {
    setLocalImportConfirmOpen(open);
  }, []);

  // Accept both names and optional ids from TableLayout
  const handleCommanderConfirm = useCallback((names: string[], ids?: string[]) => {
    if (!view || !names || names.length === 0) return;
    if (pendingLocalImportRef.current || localImportConfirmRef.current || confirmOpen) {
      setQueuedCommanderSuggest({ gameId: view.id, names: names.slice(0, 2) });
      return;
    }
    const payload: any = { gameId: view.id, commanderNames: names };
    if (ids && ids.length) payload.commanderIds = ids;
    socket.emit("setCommander", payload);
  }, [view, confirmOpen]);

  const fetchDebug = useCallback(() => {
    if (!view) return;
    setDebugLoading(true);
    setDebugData(null);
    setDebugOpen(true);
    const gid = view.id;
    const onceWithTimeout = (eventName: string, timeout = 3000) =>
      new Promise((resolve) => {
        const onResp = (payload: any) => { resolve(payload); };
        (socket as any).once(eventName, onResp);
        setTimeout(() => { (socket as any).off(eventName, onResp); resolve({ error: "timeout" }); }, timeout);
      });
    (socket as any).emit("dumpCommanderState", { gameId: gid });
    (socket as any).emit("dumpLibrary", { gameId: gid });
    (socket as any).emit("dumpImportedDeckBuffer", { gameId: gid });
    Promise.all([
      onceWithTimeout("debugCommanderState"),
      onceWithTimeout("debugLibraryDump"),
      onceWithTimeout("debugImportedDeckBuffer"),
    ]).then(([commanderResp, libResp, bufResp]) => {
      setDebugData({ commanderState: commanderResp, libraryDump: libResp, importBuffer: bufResp });
      setDebugLoading(false);
    }).catch((err) => {
      setDebugData({ error: String(err) });
      setDebugLoading(false);
    });
  }, [view]);

  const respondToConfirm = (accept: boolean) => {
    if (!view || !confirmId || !you) return;
    socket.emit("confirmImportResponse", { gameId: view.id, confirmId, accept });
    setConfirmVotes(prev => prev ? ({ ...prev, [you]: accept ? "yes" : "no" }) : prev);
  };

  const isTable = layout === "table";
  const canPass = !!view && !!you && view.priority === you;
  const isYouPlayer = !!view && !!you && view.players.some(p => p.id === you);

  // determine whether Next Step/Turn should be enabled: allow turnPlayer or pre-game first seat
  const canAdvanceStep = useMemo(() => {
    if (!view || !you) return false;
    if (view.turnPlayer === you) return true;
    const phaseStr = String(view.phase || "").toUpperCase();
    if (phaseStr === "PRE_GAME" && (view.players?.[0]?.id === you)) return true;
    return false;
  }, [view, you]);

  const canAdvanceTurn = canAdvanceStep;

  return (
    <div style={{ padding: 12, fontFamily: "system-ui", display: "grid", gridTemplateColumns: isTable ? "1fr" : "1.2fr 380px", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0 }}>MTGEDH</h1>
            <div style={{ fontSize: 12, color: "#666" }}>Game: {view?.id ?? gameId} • Format: {String(view?.format ?? "")}</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 6, border: "1px solid #eee", borderRadius: 6 }}>
              <button onClick={() => socket.emit("nextStep", { gameId: view?.id })} disabled={!canAdvanceStep}>Next Step</button>
              <button onClick={() => socket.emit("nextTurn", { gameId: view?.id })} disabled={!canAdvanceTurn}>Next Turn</button>
              <button onClick={() => socket.emit("passPriority", { gameId: view?.id, by: you })} disabled={!canPass}>Pass Priority</button>
            </div>
            <div style={{ fontSize: 12, color: "#444" }}>
              Phase: <strong>{String(view?.phase ?? "-")}</strong> {view?.step ? <span>• Step: <strong>{String(view.step)}</strong></span> : null}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={joinAsSpectator} onChange={e => setJoinAsSpectator(e.target.checked)} />
            Spectator
          </label>
          <button onClick={handleJoin} disabled={!connected}>Join</button>
          <button onClick={() => socket.emit("requestState", { gameId })} disabled={!connected}>Refresh</button>
          <button onClick={() => fetchDebug()} disabled={!connected || !view}>Debug</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <GameList onJoin={joinFromList} />
        </div>

        {missingImport && missingImport.length > 0 && (
          <div style={{ background: "#fff6d5", padding: 10, border: "1px solid #f1c40f", borderRadius: 6 }}>
            <strong>Import warning</strong>: Could not resolve these names: {missingImport.slice(0, 10).join(", ")}{missingImport.length > 10 ? ", …" : ""}.
            <button onClick={() => setMissingImport(null)} style={{ marginLeft: 12 }}>Dismiss</button>
          </div>
        )}

        <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
          {safeView ? (
            <TableLayout
              players={safeView.players}
              permanentsByPlayer={new Map((safeView.players || []).map((p:any) => [p.id, (safeView.battlefield || []).filter((perm:any)=>perm.controller===p.id)]))}
              imagePref={imagePref}
              isYouPlayer={isYouPlayer}
              splitLands
              enableReorderForYou={isYouPlayer}
              you={you || undefined}
              zones={safeView.zones}
              commandZone={safeView.commandZone as any}
              format={String(safeView.format || "")}
              showYourHandBelow
              onReorderHand={(order) => safeView && socket.emit("reorderHand", { gameId: safeView.id, order })}
              onShuffleHand={() => safeView && socket.emit("shuffleHand", { gameId: safeView.id })}
              onRemove={(id) => safeView && socket.emit("removePermanent", { gameId: safeView.id, permanentId: id })}
              onCounter={(id, kind, delta) => safeView && socket.emit("updateCounters", { gameId: safeView.id, permanentId: id, deltas: { [kind]: delta } })}
              onBulkCounter={(ids, deltas) => safeView && socket.emit("updateCountersBulk", { gameId: safeView.id, updates: ids.map(id => ({ permanentId: id, deltas })) })}
              onPlayLandFromHand={(cardId) => socket.emit("playLand", { gameId: safeView!.id, cardId })}
              onCastFromHand={(cardId) => socket.emit("beginCast", { gameId: safeView!.id, cardId })}
              reasonCannotPlayLand={() => null}
              reasonCannotCast={() => null}
              threeD={undefined}
              enablePanZoom
              tableCloth={{ imageUrl: "" }}
              worldSize={12000}
              onUpdatePermPos={(id, x, y, z) => safeView && socket.emit("updatePermanentPos", { gameId: safeView.id, permanentId: id, x, y, z })}
              onImportDeckText={(txt, nm) => requestImportDeck(txt, nm)}
              onUseSavedDeck={(deckId) => requestUseSavedDeck(deckId)}
              onLocalImportConfirmChange={(open: boolean) => setLocalImportConfirmOpen(open)}
              suppressCommanderSuggest={localImportConfirmOpen || pendingLocalImport || confirmOpen}
              onConfirmCommander={(names: string[], ids?: string[]) => handleCommanderConfirm(names, ids)}
              gameId={safeView.id}
              stackItems={safeView.stack as any}
              importedCandidates={importedCandidates}
            />
          ) : (
            <div style={{ padding: 20, color: "#666" }}>No game state yet. Join a game to view table.</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ChatPanel messages={chat} onSend={(txt) => {
          if (!view) return;
          const payload = { id: `m_${Date.now()}`, gameId: view.id, from: you ?? "you", message: txt, ts: Date.now() };
          socket.emit("chat", payload);
          setChat(prev => [...prev, payload]);
        }} view={view} />

        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Zones</div>
          {safeView ? <ZonesPanel view={safeView} you={you} isYouPlayer={isYouPlayer} /> : <div style={{ color: "#666" }}>Join a game to see zones.</div>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => requestImportDeck("")}>Import (text)</button>
          <button onClick={() => requestUseSavedDeck("")}>Use Saved</button>
          <button onClick={() => fetchDebug()} disabled={!view}>Debug</button>
        </div>
      </div>

      <CardPreviewLayer />

      {cmdSuggestOpen && safeView && (
        <CommanderConfirmModal
          open={cmdSuggestOpen}
          gameId={safeView.id}
          initialNames={cmdSuggestNames}
          onClose={() => { setCmdSuggestOpen(false); setCmdSuggestNames([]); }}
          onConfirm={(names: string[]) => { handleCommanderConfirm(names); setCmdSuggestOpen(false); setCmdSuggestNames([]); }}
        />
      )}

      {debugOpen && (
        <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", zIndex: 6000 }}>
          <div style={{ width: 900, maxHeight: "80vh", overflow: "auto", background: "#1e1e1e", color: "#fff", padding: 12, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Debug Output</strong>
              <div>
                <button onClick={() => { setDebugOpen(false); setDebugData(null); }}>Close</button>
                <button onClick={() => fetchDebug()} disabled={debugLoading} style={{ marginLeft: 8 }}>Refresh</button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {debugLoading ? <div>Loading...</div> : (
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11 }}>{JSON.stringify(debugData, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmOpen && confirmPayload && (
        <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", zIndex: 7000 }}>
          <div style={{ width: 560, background: "#1e1e1e", color: "#fff", padding: 16, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Confirm importing deck (wipes table)</h3>
            <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 8 }}>
              Player <strong>{confirmPayload.initiator}</strong> is importing a deck{confirmPayload.deckName ? `: ${confirmPayload.deckName}` : ""}.
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
              <div>Resolved cards: {confirmPayload.resolvedCount}</div>
              <div>Declared deck size: {confirmPayload.expectedCount}</div>
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Votes</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {confirmVotes ? Object.entries(confirmVotes).map(([pid, v]) => (
                  <div key={pid} style={{ padding: 8, background: "#0f0f0f", borderRadius: 6, minWidth: 120 }}>
                    <div style={{ fontSize: 12 }}>{safeView?.players?.find((p:any)=>p.id===pid)?.name ?? pid}{pid === you ? " (you)" : ""}</div>
                    <div style={{ fontWeight: 700, color: v === "yes" ? "#8ef58e" : v === "no" ? "#f58e8e" : "#ddd" }}>{v}</div>
                  </div>
                )) : <div>No votes yet</div>}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => { setConfirmOpen(false); setConfirmPayload(null); setConfirmVotes(null); setConfirmId(null); }}>Dismiss</button>
              <button onClick={() => respondToConfirm(false)} style={{ background: "#a00", color: "#fff" }}>Decline</button>
              <button onClick={() => respondToConfirm(true)} style={{ background: "#0a8", color: "#fff" }}>Accept</button>
            </div>
          </div>
        </div>
      )}

      {peek && (
        <ScrySurveilModal
          mode={peek.mode}
          cards={peek.cards}
          imagePref={imagePref}
          onCancel={() => setPeek(null)}
          onConfirm={res => {
            if (!view) return;
            if (peek.mode === "scry")
              socket.emit("confirmScry", { gameId: view.id, keepTopOrder: res.keepTopOrder, bottomOrder: res.bottomOrder || [] });
            else
              socket.emit("confirmSurveil", { gameId: view.id, toGraveyard: res.toGraveyard || [], keepTopOrder: res.keepTopOrder });
            setPeek(null);
          }}
        />
      )}

<NameInUseModal
  open={showNameInUseModal}
  payload={nameInUsePayload}
  onClose={() => { setShowNameInUseModal(false); setNameInUsePayload(null); }}
  onReconnect={(fixedPlayerId: string, seatToken?: string) => {
    const gid = nameInUsePayload?.gameId || gameId;
    const pname = nameInUsePayload?.playerName || name;
    // prefer seatToken supplied by modal (derived from sessionStorage), otherwise fallback
    const token = seatToken ?? sessionStorage.getItem(seatTokenKey(gid, pname));
    console.debug("[JOIN_EMIT] reconnect click", { gameId: gid, playerName: pname, fixedPlayerId, seatToken: token });
    socket.emit("joinGame", { gameId: gid, playerName: pname, spectator: joinAsSpectator, seatToken: token, fixedPlayerId });
    setShowNameInUseModal(false);
    setNameInUsePayload(null);
  }}
  onNewName={(newName: string) => {
    const gid = nameInUsePayload?.gameId || gameId;
    setName(newName);
    lastJoinRef.current = { gameId: gid, name: newName, spectator: joinAsSpectator };
    try { sessionStorage.setItem(lastJoinKey(), JSON.stringify(lastJoinRef.current)); } catch { }
    const token = sessionStorage.getItem(seatTokenKey(gid, newName)) || undefined;
    console.debug("[JOIN_EMIT] new-name join", { gameId: gid, playerName: newName, seatToken: token });
    socket.emit("joinGame", { gameId: gid, playerName: newName, spectator: joinAsSpectator, seatToken: token });
    setShowNameInUseModal(false);
    setNameInUsePayload(null);
  }}
/>
    </div>
  );
}

/* default export retained for compatibility */
export default App;