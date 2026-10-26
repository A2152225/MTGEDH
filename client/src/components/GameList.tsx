import React, { useEffect, useState, useCallback, useRef } from "react";
import { socket } from "../socket";
import { authHeaders } from "../utils/authSessionStorage";
import { debug, debugWarn, debugError } from "../utils/debug";


/** Delay before fallback refresh after socket-based game deletion (ms) */
const GAME_DELETE_FALLBACK_DELAY_MS = 500;
/** Faster poll while any listed game is restoring after a server restart */
const RESUME_POLL_MS = 1000;

type ResumeProgress = {
  current: number;
  total: number;
  percent: number;
  reason?: "resume" | "undo";
};

type GameRow = {
  id: string;
  format: string;
  startingLife: number;
  createdAt: number;
  createdByPlayerId: string | null;
  playersCount: number;
  activeConnectionsCount: number;
  turn: number | null;
  phase: string | null;
  status: string | null;
  gameOver?: boolean;
  isRestoring?: boolean;
  resumeProgress?: ResumeProgress | null;
};

interface GameListProps {
  onJoin: (gameId: string, spectator?: boolean) => void;
  pollMs?: number;
  onRefresh?: () => void;
  currentPlayerId?: string | null;
  isAdmin?: boolean;
}

function ResumeProgressBar({ progress }: { progress: ResumeProgress }) {
  const pct = Math.max(0, Math.min(100, progress.percent ?? 0));
  const verb = progress.reason === "undo" ? "Undoing" : "Restoring";
  const label =
    progress.total > 0
      ? `${verb} ${progress.current}/${progress.total}`
      : `${verb}…`;
  return (
    <div
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 110,
        maxWidth: 160,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, #a78bfa, #60a5fa)",
            transition: "width 120ms linear",
          }}
        />
      </div>
      <span style={{ color: "#c4b5fd", fontSize: 10, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {pct}%
      </span>
    </div>
  );
}

export default function GameList(props: GameListProps) {
  const { onJoin, pollMs = 5000, onRefresh, currentPlayerId, isAdmin } = props;
  const [games, setGames] = useState<GameRow[]>([]);
  const [lobbyFilter, setLobbyFilter] = useState<"active" | "finished" | "all">("active");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resumeOverrides, setResumeOverrides] = useState<
    Record<string, ResumeProgress & { isRestoring: boolean }>
  >({});
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const fetchGames = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      // Add cache-busting headers to ensure fresh data from server (especially through reverse proxies)
      const res = await fetch("/api/games", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      });
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json();
      setGames(Array.isArray(json.games) ? json.games : []);
    } catch (err) {
      debugWarn(1, "GameList fetch failed:", err);
    } finally {
      if (!opts?.quiet) setLoading(false);
      if (onRefreshRef.current) onRefreshRef.current();
    }
  }, []);

  const anyRestoring =
    games.some((g) => g.isRestoring || resumeOverrides[g.id]?.isRestoring) ||
    Object.values(resumeOverrides).some((p) => p.isRestoring);

  useEffect(() => {
    fetchGames();
    const interval = anyRestoring ? RESUME_POLL_MS : pollMs;
    const t = setInterval(() => fetchGames({ quiet: true }), interval);
    return () => clearInterval(t);
  }, [pollMs, fetchGames, anyRestoring]);

  // Listen for real-time game deletion events to update immediately
  useEffect(() => {
    const handleGameDeleted = (payload: { gameId: string }) => {
      debug(2, "[GameList] Game deleted event received:", payload.gameId);
      // Remove the deleted game from the list immediately
      setGames(prev => prev.filter(g => g.id !== payload.gameId));
      setResumeOverrides((prev) => {
        if (!prev[payload.gameId]) return prev;
        const next = { ...prev };
        delete next[payload.gameId];
        return next;
      });
    };

    // Listen for both events: gameDeleted (broadcast to others) and gameDeletedAck (sent to requester)
    socket.on("gameDeleted" as any, handleGameDeleted);
    socket.on("gameDeletedAck" as any, handleGameDeleted);

    return () => {
      socket.off("gameDeleted" as any, handleGameDeleted);
      socket.off("gameDeletedAck" as any, handleGameDeleted);
    };
  }, []);

  // Live resume progress while a cold game replays events after server restart
  useEffect(() => {
    const handleResumeProgress = (payload: {
      gameId: string;
      current: number;
      total: number;
      percent: number;
      isRestoring: boolean;
      reason?: "resume" | "undo";
    }) => {
      if (!payload?.gameId) return;
      setResumeOverrides((prev) => {
        if (!payload.isRestoring) {
          if (!prev[payload.gameId]) return prev;
          const next = { ...prev };
          delete next[payload.gameId];
          return next;
        }
        return {
          ...prev,
          [payload.gameId]: {
            current: payload.current,
            total: payload.total,
            percent: payload.percent,
            reason: payload.reason,
            isRestoring: true,
          },
        };
      });
      setGames((prev) =>
        prev.map((g) =>
          g.id === payload.gameId
            ? {
                ...g,
                isRestoring: payload.isRestoring,
                resumeProgress: payload.isRestoring
                  ? {
                      current: payload.current,
                      total: payload.total,
                      percent: payload.percent,
                    }
                  : null,
              }
            : g
        )
      );
    };

    socket.on("gameResumeProgress", handleResumeProgress);
    return () => {
      socket.off("gameResumeProgress", handleResumeProgress);
    };
  }, []);

  // Clear stuck optimistic restore UI once we've joined (or on error)
  useEffect(() => {
    const clearResume = (gameId?: string) => {
      if (!gameId) {
        setResumeOverrides({});
        return;
      }
      setResumeOverrides((prev) => {
        if (!prev[gameId]) return prev;
        const next = { ...prev };
        delete next[gameId];
        return next;
      });
      setGames((prev) =>
        prev.map((g) =>
          g.id === gameId ? { ...g, isRestoring: false, resumeProgress: null } : g
        )
      );
    };
    const onJoined = (payload: { gameId?: string }) => clearResume(payload?.gameId);
    const onError = () => {
      // If join failed mid-restore, drop optimistic bars; server done event may still arrive
      setResumeOverrides((prev) => {
        const stuck = Object.entries(prev).filter(
          ([, p]) => p.isRestoring && p.total === 0
        );
        if (stuck.length === 0) return prev;
        const next = { ...prev };
        for (const [id] of stuck) delete next[id];
        return next;
      });
    };
    socket.on("joined", onJoined as any);
    socket.on("error", onError as any);
    return () => {
      socket.off("joined", onJoined as any);
      socket.off("error", onError as any);
    };
  }, []);

  const handleJoin = (id: string, spectator: boolean = false) => {
    console.debug("[GAME_LIST] join", id, "spectator:", spectator);
    const row = games.find((g) => g.id === id);
    // Cold games (not in memory after restart) show null turn/phase — only then
    // show an optimistic restoring bar until the server emits progress.
    const looksCold = !!row && row.turn == null && row.phase == null && !row.isRestoring;
    if (looksCold || row?.isRestoring) {
      setResumeOverrides((prev) => ({
        ...prev,
        [id]: prev[id]?.isRestoring
          ? prev[id]
          : { current: 0, total: 0, percent: 0, isRestoring: true },
      }));
    }
    onJoin(id, spectator);
  };

  // Check if game has started (is not in pre_game phase)
  const hasGameStarted = (game: GameRow): boolean => {
    const phase = (game.phase || "").toLowerCase();
    // Game has started if phase is not empty AND not "pre_game"
    // Empty string or "pre_game" both indicate the game hasn't started yet
    return phase !== "" && phase !== "pre_game";
  };

  // Check if the current player can delete a specific game
  const canDelete = (game: GameRow): boolean => {
    if (isAdmin) return true;
    if (currentPlayerId && game.createdByPlayerId === currentPlayerId) return true;
    return false;
  };

  const getResumeForGame = (game: GameRow): (ResumeProgress & { isRestoring: boolean }) | null => {
    const override = resumeOverrides[game.id];
    if (override?.isRestoring) return override;
    if (game.isRestoring && game.resumeProgress) {
      return { ...game.resumeProgress, isRestoring: true };
    }
    if (game.isRestoring) {
      return { current: 0, total: 0, percent: 0, isRestoring: true };
    }
    return null;
  };
  
  const formatDeleteError = (status: number, bodyText: string): string => {
    const lower = (bodyText || "").toLowerCase();
    // IIS / ARR often returns HTML when DELETE (or other verbs) are blocked by the reverse proxy.
    if (
      status === 405 ||
      lower.includes("http verb used to access this page is not allowed") ||
      lower.includes("verb used to access this page is not allowed")
    ) {
      return "Delete was blocked by the reverse proxy (HTTP verb not allowed). Try again after a refresh; if it persists, use POST /api/admin/games/:id/delete or socket deleteGame.";
    }
    // Avoid dumping raw HTML into an alert.
    const trimmed = (bodyText || "").trim();
    if (trimmed.startsWith("<") || trimmed.length > 280) {
      return `Delete failed (HTTP ${status}).`;
    }
    try {
      const parsed = JSON.parse(trimmed) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      // not JSON
    }
    return trimmed || `Delete failed (HTTP ${status}).`;
  };

  const deleteGameViaAdminHttp = async (gameId: string): Promise<void> => {
    // Prefer POST under /api so IIS URL Rewrite (api/* -> Node) accepts it.
    // Keep DELETE /admin/games/:id as a local/direct fallback.
    const attempts: Array<{ url: string; method: string }> = [
      { url: `/api/admin/games/${encodeURIComponent(gameId)}/delete`, method: "POST" },
      { url: `/admin/games/${encodeURIComponent(gameId)}`, method: "DELETE" },
    ];
    let lastErr = "Delete failed";
    for (const attempt of attempts) {
      const res = await fetch(attempt.url, {
        method: attempt.method,
        credentials: "include",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
      });
      if (res.ok) return;
      const txt = await res.text();
      lastErr = formatDeleteError(res.status, txt);
      // If proxy blocked the verb, try the next method/path.
      const lower = txt.toLowerCase();
      if (
        res.status === 405 ||
        lower.includes("http verb used to access this page is not allowed") ||
        lower.includes("verb used to access this page is not allowed")
      ) {
        continue;
      }
      throw new Error(lastErr);
    }
    throw new Error(lastErr);
  };

  const handleDelete = async (game: GameRow) => {
    const isCreator = !!(currentPlayerId && game.createdByPlayerId === currentPlayerId);
    
    if (!confirm(`Delete game ${game.id}? This removes persisted events.`)) return;
    
    try {
      setDeleting(game.id);

      // Prefer socket deleteGame for both admins and creators.
      // Avoids HTTP DELETE, which IIS/ARR in front of magic.a2games.win often blocks
      // ("The HTTP verb used to access this page is not allowed.").
      // Socket handler already gates on accountIsAdmin || isGameCreator.
      if (isAdmin || isCreator) {
        if (socket.connected) {
          socket.emit("deleteGame" as any, {
            gameId: game.id,
            claimedPlayerId: currentPlayerId || undefined,
          });
          // Removed via gameDeletedAck / gameDeleted; refresh as fallback.
          setTimeout(() => {
            fetchGames();
          }, GAME_DELETE_FALLBACK_DELAY_MS);
        } else if (isAdmin) {
          // Socket down: admin HTTP path that proxies through /api (POST).
          await deleteGameViaAdminHttp(game.id);
          await fetchGames();
        } else {
          throw new Error("Not connected to server. Reconnect and try delete again.");
        }
      }
    } catch (err) {
      debugError(1, "Delete failed:", err);
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const visibleGames = games.filter((game) => {
    if (lobbyFilter === "finished") return !!game.gameOver;
    if (lobbyFilter === "active") return !game.gameOver;
    return true;
  });
  const emptyLabel = lobbyFilter === "finished"
    ? "No finished games"
    : lobbyFilter === "active"
      ? "No games in progress"
      : "No games";

  return (
    <div style={{ 
      border: "1px solid rgba(255,255,255,0.1)", 
      borderRadius: 6, 
      padding: 8, 
      maxWidth: 760,
      background: "rgba(0,0,0,0.2)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600, color: "#e5e5e5", fontSize: 12 }}>Games</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {([
            ["active", `In progress (${games.filter((g) => !g.gameOver).length})`],
            ["finished", `Finished (${games.filter((g) => g.gameOver).length})`],
            ["all", "All"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLobbyFilter(id)}
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: lobbyFilter === id ? "1px solid rgba(167,139,250,0.7)" : "1px solid rgba(255,255,255,0.2)",
                background: lobbyFilter === id ? "rgba(167,139,250,0.25)" : "rgba(0,0,0,0.3)",
                color: lobbyFilter === id ? "#ddd6fe" : "#9ca3af",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
          <button 
            onClick={() => void fetchGames()} 
            disabled={loading}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.3)",
              color: "#9ca3af",
              fontSize: 11,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      <div style={{ maxHeight: 180, overflow: "auto" }}>
        {visibleGames.length === 0 && !loading && <div style={{ color: "#9ca3af", fontSize: 12 }}>{emptyLabel}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, color: "#e5e5e5" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Game</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Players</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Active</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Turn</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Phase</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600, minWidth: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleGames.map(g => {
              const resume = getResumeForGame(g);
              return (
              <tr key={g.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "#93c5fd" }}>{(g.id || "").slice(0, 8)}</td>
                <td style={{ padding: "4px 6px" }}>{g.playersCount}</td>
                <td style={{ padding: "4px 6px" }}>{g.activeConnectionsCount}</td>
                <td style={{ padding: "4px 6px" }}>{g.turn ?? "-"}</td>
                <td style={{ padding: "4px 6px" }}>{g.phase ?? "-"}</td>
                <td style={{ padding: "4px 6px" }}>
                  {resume ? (
                    <ResumeProgressBar progress={resume} />
                  ) : g.gameOver ? (
                    "Finished"
                  ) : (
                    g.status ?? "-"
                  )}
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button 
                      onClick={() => handleJoin(g.id, false)} 
                      style={{ 
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid rgba(16, 185, 129, 0.4)",
                        background: "rgba(16, 185, 129, 0.2)",
                        color: "#10b981",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                      title={
                        resume
                          ? "Game is restoring — join will wait until replay finishes"
                          : g.gameOver
                            ? "Game is over. You can still open the table."
                          : hasGameStarted(g)
                            ? "Join as inactive player (will join on next reset)"
                            : "Join game"
                      }
                    >
                      Play
                    </button>
                    <button 
                      onClick={() => handleJoin(g.id, true)} 
                      style={{ 
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid rgba(147, 197, 253, 0.4)",
                        background: "rgba(147, 197, 253, 0.2)",
                        color: "#93c5fd",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                      title={resume ? "Game is restoring — spectate will wait until replay finishes" : "Watch game as spectator"}
                    >
                      Spectate
                    </button>
                    {canDelete(g) && (
                      <button 
                        disabled={deleting === g.id || !!resume} 
                        onClick={() => handleDelete(g)}
                        title={
                          resume ? "Wait for restore to finish" :
                          isAdmin ? "Admin delete" :
                          currentPlayerId && g.createdByPlayerId === currentPlayerId ? "Delete your game" :
                          g.activeConnectionsCount === 0 ? "Delete (no active players)" :
                          "Delete"
                        }
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          background: "rgba(239, 68, 68, 0.2)",
                          color: "#ef4444",
                          fontSize: 10,
                          cursor: deleting === g.id || resume ? "not-allowed" : "pointer",
                        }}
                      >
                        {deleting === g.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
