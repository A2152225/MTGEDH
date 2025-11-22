import React, { useMemo, useState } from "react";
import { socket } from "./socket";
import type {
  ClientGameView,
  PlayerID,
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
import { type ImagePref } from "./components/BattlefieldGrid";
import GameList from "./components/GameList";
import { useGameSocket } from "./hooks/useGameSocket";

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
  const endRef = React.useRef<HTMLDivElement | null>(null);
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
        height: 260,
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

/** Map engine/internal phase enum to human-friendly name */
function prettyPhase(phase?: string | null): string {
  if (!phase) return "-";
  const p = String(phase);
  switch (p) {
    case "PRE_GAME":
    case "preGame":
      return "Pre-game";
    case "beginning":
      return "Beginning phase";
    case "precombatMain":
    case "main1":
      return "Main phase";
    case "combat":
      return "Combat phase";
    case "postcombatMain":
    case "main2":
      return "Main phase 2";
    case "ending":
      return "Ending phase";
    default:
      return p
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** Map engine/internal step enum to human-friendly name */
function prettyStep(step?: string | null): string {
  if (!step) return "";
  const s = String(step);
  switch (s) {
    case "untap":
      return "Untap step";
    case "upkeep":
      return "Upkeep step";
    case "draw":
      return "Draw step";
    case "main":
      return "Main phase";
    case "beginCombat":
      return "Beginning of combat step";
    case "declareAttackers":
      return "Declare attackers step";
    case "declareBlockers":
      return "Declare blockers step";
    case "combatDamage":
      return "Combat damage step";
    case "endCombat":
      return "End of combat step";
    case "endStep":
    case "end":
      return "End step";
    case "cleanup":
      return "Cleanup step";
    default:
      return s
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/* App component */
export function App() {
  const {
    connected,
    gameIdInput,
    setGameIdInput,
    nameInput,
    setNameInput,
    joinAsSpectator,
    setJoinAsSpectator,

    you,
    view,
    safeView,
    priority,

    chat,
    setChat,
    lastError,
    lastInfo, // currently unused but preserved
    missingImport,
    setMissingImport,

    importedCandidates,
    pendingLocalImport,
    localImportConfirmOpen,

    cmdModalOpen,
    setCmdModalOpen,
    cmdSuggestedNames,
    cmdSuggestedGameId,

    confirmOpen,
    confirmPayload,
    confirmVotes,
    confirmId,

    debugOpen,
    debugLoading,
    debugData,
    setDebugOpen,

    handleJoin,
    joinFromList,
    requestImportDeck,
    requestUseSavedDeck,
    handleLocalImportConfirmChange,
    handleCommanderConfirm,
    fetchDebug,
    respondToConfirm,
  } = useGameSocket();

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

  const [showNameInUseModal, setShowNameInUseModal] = useState(false);
  const [nameInUsePayload, setNameInUsePayload] = useState<any | null>(null);

  // Accordion state for Join / Active Games
  const [joinCollapsed, setJoinCollapsed] = useState(false);

  React.useEffect(() => {
    const handler = (payload: any) => {
      setNameInUsePayload(payload);
      setShowNameInUseModal(true);
    };
    socket.on("nameInUse", handler);
    return () => {
      socket.off("nameInUse", handler);
    };
  }, []);

  const isTable = layout === "table";
  const canPass = !!safeView && !!you && safeView.priority === you;
  const isYouPlayer =
    !!safeView && !!you && safeView.players.some((p) => p.id === you);

  // Auto-collapse join panel once you're an active player
  React.useEffect(() => {
    if (isYouPlayer) {
      setJoinCollapsed(true);
    }
  }, [isYouPlayer]);

  const canAdvanceStep = useMemo(() => {
    if (!safeView || !you) return false;
    if (safeView.turnPlayer === you) return true;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    if (phaseStr === "PRE_GAME" && safeView.players?.[0]?.id === you)
      return true;
    return false;
  }, [safeView, you]);

  const canAdvanceTurn = canAdvanceStep;

  const effectiveGameId = safeView?.id ?? gameIdInput;

  const showCommanderGallery =
    cmdModalOpen && cmdSuggestedGameId && importedCandidates.length > 0;

  const phaseLabel = prettyPhase(safeView?.phase);
  const stepLabelRaw = safeView?.step ? String(safeView.step) : "";
  const stepLabel = prettyStep(stepLabelRaw);

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
        {/* HEADER (game id, format) */}
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
        </div>

        {/* JOIN / ACTIVE GAMES (collapsible/accordion) */}
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: 8,
            background: "#fafafa",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => setJoinCollapsed((c) => !c)}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Join / Active Games
            </div>
            <div style={{ fontSize: 16 }}>
              {joinCollapsed ? "▸" : "▾"}
            </div>
          </div>

          {!joinCollapsed && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <input
                  value={gameIdInput}
                  onChange={(e) => setGameIdInput(e.target.value as any)}
                  placeholder="Game ID"
                />
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
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
                  onClick={() =>
                    socket.emit("requestState", { gameId: gameIdInput })
                  }
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

              <div style={{ marginTop: 8 }}>
                <GameList onJoin={joinFromList} />
              </div>
            </>
          )}
        </div>

        {/* CONTROL BAR JUST ABOVE THE TABLE */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: 4,
          }}
        >
          {/* Phase / Step summary on the left (fixed/truncated) */}
          <div
            style={{
              maxWidth: 360,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: 12,
              color: "#444",
            }}
          >
            Phase: <strong>{phaseLabel}</strong>
            {stepLabel && (
              <span style={{ marginLeft: 8 }}>
                • Step: <strong>{stepLabel}</strong>
              </span>
            )}
          </div>

          {/* Buttons on the right, in a stable group */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: 6,
              border: "1px solid #eee",
              borderRadius: 6,
              background: "#fafafa",
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
        </div>

        {/* IMPORT WARNINGS */}
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

        {/* TABLE / PLAYING FIELD */}
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 6,
            padding: 8,
          }}
        >
          {safeView ? (
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
          ) : (
            <div style={{ padding: 20, color: "#666" }}>
              No game state yet. Join a game to view table.
            </div>
          )}
        </div>

        {/* INLINE CHAT BELOW PLAY AREA */}
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
      </div>

      {/* RIGHT COLUMN: Quick actions only (Zones removed) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: 8,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Quick Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={() => requestImportDeck("")}>Import (text)</button>
            <button onClick={() => requestUseSavedDeck("")}>Use Saved</button>
            <button onClick={() => fetchDebug()} disabled={!safeView}>
              Debug
            </button>
          </div>
        </div>
      </div>

      <CardPreviewLayer />

      {/* Commander selection UI */}
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

      {/* Debug modal (unchanged) */}
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

      {/* Import confirmation modal (unchanged from your file) */}
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
                  // only dismiss locally; actual cancel must come from server
                  // to keep everyone in sync
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
          const gid = nameInUsePayload?.gameId || gameIdInput;
          const pname = nameInUsePayload?.playerName || nameInput;
          const token =
            seatToken ??
            sessionStorage.getItem(`mtgedh:seatToken:${gid}:${pname}`);
          // eslint-disable-next-line no-console
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
          const gid = nameInUsePayload?.gameId || gameIdInput;
          setNameInput(newName);
          const token =
            sessionStorage.getItem(
              `mtgedh:seatToken:${gid}:${newName}`
            ) || undefined;
          // eslint-disable-next-line no-console
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

export default App;