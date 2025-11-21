import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { CommanderSelectModal } from "./components/CommanderSelectModal";
import NameInUseModal from "./components/NameInUseModal";
import { ZonesPanel } from "./components/ZonesPanel";
import { ScrySurveilModal } from "./components/ScrySurveilModal";
import { BattlefieldGrid, type ImagePref } from "./components/BattlefieldGrid";
import GameList from "./components/GameList";

import { useImportAndCommander } from "./hooks/useImportAndCommander";
import { useGameSocket } from "./hooks/useGameSocket";

/* Helpers (still local to App) */
function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name}`;
}
function lastJoinKey() {
  return "mtgedh:lastJoin";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/* Small ChatPanel component */
function ChatPanel({
  messages,
  onSend,
  view,
}: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  view?: ClientGameView | null;
}) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        height: 340,
        background: "#fafafa",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Chat</div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 6,
          background: "#fff",
          borderRadius: 4,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "#666" }}>No messages</div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 6 }}>
            <div>
              <strong>{displaySender(m.from)}</strong>: {m.message}
            </div>
            <div style={{ fontSize: 11, color: "#777" }}>
              {new Date(m.ts).toLocaleTimeString()}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Type message..."
          style={{ flex: 1 }}
        />
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
  const [imagePref, setImagePref] = useState<ImagePref>(
    () =>
      (localStorage.getItem("mtgedh:imagePref") as ImagePref) || "normal"
  );
  const [layout, setLayout] = useState<"rows" | "table">(
    () =>
      (localStorage.getItem("mtgedh:layout") as "rows" | "table") || "table"
  );

  const [peek, setPeek] = useState<{
    mode: "scry" | "surveil";
    cards: any[];
  } | null>(null);

  // debug UI state
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);

  // import/commander hook will manage confirmOpen, etc.
  // (we keep lastInfo for banner text)
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
      const pid = p?.id ?? p?.playerId;
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

  // central import/commander hook
  const importAndCommander = useImportAndCommander(safeView, you);

  // wire sockets through useGameSocket
  useGameSocket({
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
  });

  // actions
  const handleJoin = () => {
    const lastJoinRef = {
      gameId,
      name,
      spectator: joinAsSpectator,
    };
    const token =
      sessionStorage.getItem(seatTokenKey(gameId, name)) || undefined;
    const payload = {
      gameId,
      playerName: name,
      spectator: joinAsSpectator,
      seatToken: token,
    };
    console.debug("[JOIN_EMIT] manual join", payload);
    socket.emit("joinGame", payload);
    try {
      sessionStorage.setItem(lastJoinKey(), JSON.stringify(lastJoinRef));
    } catch {
      /* ignore */
    }
  };

  const joinFromList = (selectedGameId: string) => {
    const lastJoinRef = {
      gameId: selectedGameId,
      name,
      spectator: joinAsSpectator,
    };
    const token =
      sessionStorage.getItem(seatTokenKey(selectedGameId, name)) || undefined;
    const payload = {
      gameId: selectedGameId,
      playerName: name,
      spectator: joinAsSpectator,
      seatToken: token,
    };
    console.debug("[JOIN_EMIT] joinFromList", payload);
    socket.emit("joinGame", payload);
    setGameId(selectedGameId);
    try {
      sessionStorage.setItem(lastJoinKey(), JSON.stringify(lastJoinRef));
    } catch {
      /* ignore */
    }
  };

  const {
    requestImportDeck,
    requestUseSavedDeck,
    handleLocalImportConfirmChange,
    handleCommanderConfirm,
    pendingLocalImport,
    confirmOpen,
    confirmPayload,
    confirmVotes,
    respondToConfirm,
    importedCandidates,
    cmdModalOpen,
    setCmdModalOpen,
    cmdSuggestedNames,
    cmdSuggestedGameId,
    showCommanderGallery,
  } = importAndCommander;

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

  const isTable = layout === "table";
  const canPass = !!safeView && !!you && safeView.priority === you;
  const isYouPlayer =
    !!safeView && !!you && safeView.players.some((p) => p.id === you);

  const canAdvanceStep = useMemo(() => {
    if (!safeView || !you) return false;
    if (safeView.turnPlayer === you) return true;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    if (phaseStr === "PRE_GAME" && safeView.players?.[0]?.id === you)
      return true;
    return false;
  }, [safeView, you]);

  const canAdvanceTurn = canAdvanceStep;

  const effectiveGameId = safeView?.id ?? gameId;

  return (
    <div
      style={{
        padding: 12,
        fontFamily: "system-ui",
        display: "grid",
        gridTemplateColumns: isTable ? "1fr" : "1.2fr 380px",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Header / controls */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>MTGEDH</h1>
            <div style={{ fontSize: 12, color: "#666" }}>
              Game: {effectiveGameId} • Format:{" "}
              {String(safeView?.format ?? "")}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: 6,
                border: "1px solid #eee",
                borderRadius: 6,
              }}
            >
              <button
                onClick={() =>
                  socket.emit("nextStep", { gameId: safeView?.id })
                }
                disabled={!canAdvanceStep}
              >
                Next Step
              </button>
              <button
                onClick={() =>
                  socket.emit("nextTurn", { gameId: safeView?.id })
                }
                disabled={!canAdvanceTurn}
              >
                Next Turn
              </button>
              <button
                onClick={() =>
                  socket.emit("passPriority", {
                    gameId: safeView?.id,
                    by: you,
                  })
                }
                disabled={!canPass}
              >
                Pass Priority
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#444" }}>
              Phase: <strong>{String(safeView?.phase ?? "-")}</strong>{" "}
              {safeView?.step ? (
                <span>
                  • Step: <strong>{String(safeView.step)}</strong>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Join / game controls */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            placeholder="Game ID"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <input
              type="checkbox"
              checked={joinAsSpectator}
              onChange={(e) => setJoinAsSpectator(e.target.checked)}
            />
            Spectator
          </label>
          <button onClick={handleJoin} disabled={!connected}>
            Join
          </button>
          <button
            onClick={() => socket.emit("requestState", { gameId })}
            disabled={!connected}
          >
            Refresh
          </button>
          <button
            onClick={() => fetchDebug()}
            disabled={!connected || !safeView}
          >
            Debug
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <GameList onJoin={joinFromList} />
        </div>

        {missingImport && missingImport.length > 0 && (
          <div
            style={{
              background: "#fff6d5",
              padding: 10,
              border: "1px solid #f1c40f",
              borderRadius: 6,
            }}
          >
            <strong>Import warning</strong>: Could not resolve these names:{" "}
            {missingImport.slice(0, 10).join(", ")}
            {missingImport.length > 10 ? ", …" : ""}.
            <button
              onClick={() => setMissingImport(null)}
              style={{ marginLeft: 12 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Table */}
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 6,
            padding: 8,
          }}
        >
          {safeView ? (
            <>
              <TableLayout
                players={safeView.players}
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
                zones={safeView.zones}
                commandZone={safeView.commandZone as any}
                format={String(safeView.format || "")}
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
                onRemove={(id) =>
                  safeView &&
                  socket.emit("removePermanent", {
                    gameId: safeView.id,
                    permanentId: id,
                  })
                }
                onCounter={(id, kind, delta) =>
                  safeView &&
                  socket.emit("updateCounters", {
                    gameId: safeView.id,
                    permanentId: id,
                    deltas: { [kind]: delta },
                  })
                }
                onBulkCounter={(ids, deltas) =>
                  safeView &&
                  socket.emit("updateCountersBulk", {
                    gameId: safeView.id,
                    updates: ids.map((id) => ({ permanentId: id, deltas })),
                  })
                }
                onPlayLandFromHand={(cardId) =>
                  socket.emit("playLand", { gameId: safeView!.id, cardId })
                }
                onCastFromHand={(cardId) =>
                  socket.emit("beginCast", { gameId: safeView!.id, cardId })
                }
                reasonCannotPlayLand={() => null}
                reasonCannotCast={() => null}
                threeD={undefined}
                enablePanZoom
                tableCloth={{ imageUrl: "" }}
                worldSize={12000}
                onUpdatePermPos={(id, x, y, z) =>
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
                gameId={safeView.id}
                stackItems={safeView.stack as any}
                importedCandidates={importedCandidates}
              />
            </>
          ) : (
            <div style={{ padding: 20, color: "#666" }}>
              No game state yet. Join a game to view table.
            </div>
          )}
        </div>
      </div>

      {/* Right column: chat + zones + quick controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ChatPanel
          messages={chat}
          onSend={(txt) => {
            if (!view) return;
            const payload = {
              id: `m_${Date.now()}`,
              gameId: view.id,
              from: you ?? "you",
              message: txt,
              ts: Date.now(),
            };
            socket.emit("chat", payload);
            setChat((prev) => [...prev, payload]);
          }}
          view={view}
        />

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: 8,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Zones</div>
          {safeView ? (
            <ZonesPanel view={safeView} you={you} isYouPlayer={isYouPlayer} />
          ) : (
            <div style={{ color: "#666" }}>Join a game to see zones.</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => requestImportDeck("")}>Import (text)</button>
          <button onClick={() => requestUseSavedDeck("")}>Use Saved</button>
          <button onClick={() => fetchDebug()} disabled={!safeView}>
            Debug
          </button>
        </div>
      </div>

      <CardPreviewLayer />

      {/* Commander selection UI (App-level) */}
      {effectiveGameId &&
        cmdModalOpen &&
        cmdSuggestedGameId === effectiveGameId && (
          showCommanderGallery ? (
            <CommanderSelectModal
              open={cmdModalOpen}
              onClose={() => setCmdModalOpen(false)}
              deckList={importedCandidates.map((c) => c.name).join("\n")}
              candidates={importedCandidates}
              max={2}
              onConfirm={(names, ids) => {
                handleCommanderConfirm(names, ids);
                setCmdModalOpen(false);
              }}
            />
          ) : (
            <CommanderConfirmModal
              open={cmdModalOpen}
              gameId={effectiveGameId}
              initialNames={cmdSuggestedNames}
              onClose={() => setCmdModalOpen(false)}
              onConfirm={(names) => {
                handleCommanderConfirm(names);
                setCmdModalOpen(false);
              }}
            />
          )
        )}

      {/* Debug modal */}
      {debugOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 6000,
          }}
        >
          <div
            style={{
              width: 900,
              maxHeight: "80vh",
              overflow: "auto",
              background: "#1e1e1e",
              color: "#fff",
              padding: 12,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>Debug Output</strong>
              <div>
                <button
                  onClick={() => {
                    setDebugOpen(false);
                    setDebugData(null);
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => fetchDebug()}
                  disabled={debugLoading}
                  style={{ marginLeft: 8 }}
                >
                  Refresh
                </button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {debugLoading ? (
                <div>Loading...</div>
              ) : (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 11,
                  }}
                >
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import-wipe confirmation modal */}
      {confirmOpen && confirmPayload && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 7000,
          }}
        >
          <div
            style={{
              width: 560,
              background: "#1e1e1e",
              color: "#fff",
              padding: 16,
              borderRadius: 8,
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              Confirm importing deck (wipes table)
            </h3>
            <div
              style={{
                fontSize: 13,
                opacity: 0.9,
                marginBottom: 8,
              }}
            >
              Player <strong>{confirmPayload.initiator}</strong> is importing a
              deck
              {confirmPayload.deckName ? `: ${confirmPayload.deckName}` : ""}.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <div>Resolved cards: {confirmPayload.resolvedCount}</div>
              <div>Declared deck size: {confirmPayload.expectedCount}</div>
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Votes</div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {confirmVotes ? (
                  Object.entries(confirmVotes).map(([pid, v]) => (
                    <div
                      key={pid}
                      style={{
                        padding: 8,
                        background: "#0f0f0f",
                        borderRadius: 6,
                        minWidth: 120,
                      }}
                    >
                      <div style={{ fontSize: 12 }}>
                        {safeView?.players?.find((p: any) => p.id === pid)
                          ?.name ?? pid}
                        {pid === you ? " (you)" : ""}
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          color:
                            v === "yes"
                              ? "#8ef58e"
                              : v === "no"
                              ? "#f58e8e"
                              : "#ddd",
                        }}
                      >
                        {v}
                      </div>
                    </div>
                  ))
                ) : (
                  <div>No votes yet</div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  // soft-dismiss only; underlying confirmation stays alive
                  // caller can re-open or respond later
                  // (we just hide the modal)
                  // If you want to cancel the confirm, emit here.
                }}
              >
                Dismiss
              </button>
              <button
                onClick={() => respondToConfirm(false)}
                style={{ background: "#a00", color: "#fff" }}
              >
                Decline
              </button>
              <button
                onClick={() => respondToConfirm(true)}
                style={{ background: "#0a8", color: "#fff" }}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scry/Surveil */}
      {peek && (
        <ScrySurveilModal
          mode={peek.mode}
          cards={peek.cards}
          imagePref={imagePref}
          onCancel={() => setPeek(null)}
          onConfirm={(res) => {
            if (!view) return;
            if (peek.mode === "scry")
              socket.emit("confirmScry", {
                gameId: view.id,
                keepTopOrder: res.keepTopOrder,
                bottomOrder: res.bottomOrder || [],
              });
            else
              socket.emit("confirmSurveil", {
                gameId: view.id,
                toGraveyard: res.toGraveyard || [],
                keepTopOrder: res.keepTopOrder,
              });
            setPeek(null);
          }}
        />
      )}

      {/* Name-in-use */}
      <NameInUseModal
        open={showNameInUseModal}
        payload={nameInUsePayload}
        onClose={() => {
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
        onReconnect={(fixedPlayerId: string, seatToken?: string) => {
          const gid = nameInUsePayload?.gameId || gameId;
          const pname = nameInUsePayload?.playerName || name;
          const token =
            seatToken ?? sessionStorage.getItem(seatTokenKey(gid, pname));
          console.debug("[JOIN_EMIT] reconnect click", {
            gameId: gid,
            playerName: pname,
            fixedPlayerId,
            seatToken: token,
          });
          socket.emit("joinGame", {
            gameId: gid,
            playerName: pname,
            spectator: joinAsSpectator,
            seatToken: token,
            fixedPlayerId,
          });
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
        onNewName={(newName: string) => {
          const gid = nameInUsePayload?.gameId || gameId;
          setName(newName);
          const lastJoinRef = {
            gameId: gid,
            name: newName,
            spectator: joinAsSpectator,
          };
          try {
            sessionStorage.setItem(
              lastJoinKey(),
              JSON.stringify(lastJoinRef)
            );
          } catch {
            /* ignore */
          }
          const token =
            sessionStorage.getItem(seatTokenKey(gid, newName)) || undefined;
          console.debug("[JOIN_EMIT] new-name join", {
            gameId: gid,
            playerName: newName,
            seatToken: token,
          });
          socket.emit("joinGame", {
            gameId: gid,
            playerName: newName,
            spectator: joinAsSpectator,
            seatToken: token,
          });
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
      />
    </div>
  );
}

/* default export retained for compatibility */
export default App;