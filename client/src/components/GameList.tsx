import React, { useEffect, useState, useCallback } from "react";
import { socket } from "../socket";

/** Delay before fallback refresh after socket-based game deletion (ms) */
const GAME_DELETE_FALLBACK_DELAY_MS = 500;

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
};

interface GameListProps {
  onJoin: (gameId: string) => void;
  pollMs?: number;
  onRefresh?: () => void;
  currentPlayerId?: string | null;
}

export default function GameList(props: GameListProps) {
  const { onJoin, pollMs = 5000, onRefresh, currentPlayerId } = props;
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/games");
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json();
      setGames(Array.isArray(json.games) ? json.games : []);
    } catch (err) {
      console.warn("GameList fetch failed:", err);
    } finally {
      setLoading(false);
      if (onRefresh) onRefresh();
    }
  }, [onRefresh]);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, pollMs);
    return () => clearInterval(t);
  }, [pollMs, fetchGames]);

  // Listen for real-time game deletion events to update immediately
  useEffect(() => {
    const handleGameDeleted = (payload: { gameId: string }) => {
      console.log("[GameList] Game deleted event received:", payload.gameId);
      // Remove the deleted game from the list immediately
      setGames(prev => prev.filter(g => g.id !== payload.gameId));
    };

    // Listen for both events: gameDeleted (broadcast to others) and gameDeletedAck (sent to requester)
    socket.on("gameDeleted" as any, handleGameDeleted);
    socket.on("gameDeletedAck" as any, handleGameDeleted);

    return () => {
      socket.off("gameDeleted" as any, handleGameDeleted);
      socket.off("gameDeletedAck" as any, handleGameDeleted);
    };
  }, []);

  const handleJoin = (id: string) => {
    console.debug("[GAME_LIST] join", id);
    onJoin(id);
  };

  const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "");
  
  // Check if the current player can delete a specific game
  const canDelete = (game: GameRow): boolean => {
    // Localhost can always delete
    if (isLocalhost) return true;
    // Game creators can delete their games
    if (currentPlayerId && game.createdByPlayerId === currentPlayerId) return true;
    // Anyone can delete a game with no active player connections
    if (game.activeConnectionsCount === 0) return true;
    return false;
  };
  
  const handleDelete = async (game: GameRow) => {
    const isCreator = currentPlayerId && game.createdByPlayerId === currentPlayerId;
    const noActiveConnections = game.activeConnectionsCount === 0;
    
    if (!confirm(`Delete game ${game.id}? This removes persisted events.`)) return;
    
    try {
      setDeleting(game.id);
      
      if (isLocalhost) {
        // Admin endpoint for localhost
        const res = await fetch(`/admin/games/${encodeURIComponent(game.id)}`, { method: "DELETE" });
        if (!res.ok) {
          const txt = await res.text();
          alert("Delete failed: " + txt);
        } else {
          await fetchGames();
        }
      } else if (isCreator || noActiveConnections) {
        // Use socket to delete as the creator or when no players are connected
        // Pass claimedPlayerId for cases where the socket hasn't joined a game yet
        // (e.g., user is on game list but hasn't joined any game)
        socket.emit("deleteGame" as any, { 
          gameId: game.id,
          claimedPlayerId: currentPlayerId || undefined
        });
        // The game will be removed from the list via the gameDeletedAck event listener
        // Also refresh the list after a short delay as a fallback in case the event isn't received
        setTimeout(() => {
          fetchGames();
        }, GAME_DELETE_FALLBACK_DELAY_MS);
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div style={{ 
      border: "1px solid rgba(255,255,255,0.1)", 
      borderRadius: 6, 
      padding: 8, 
      maxWidth: 760,
      background: "rgba(0,0,0,0.2)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, color: "#e5e5e5", fontSize: 12 }}>Active Games</div>
        <div>
          <button 
            onClick={fetchGames} 
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
        {games.length === 0 && !loading && <div style={{ color: "#9ca3af", fontSize: 12 }}>No games</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, color: "#e5e5e5" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Game</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Players</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Active</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Turn</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Phase</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "4px 6px", color: "#a78bfa", fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {games.map(g => (
              <tr key={g.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "#93c5fd" }}>{(g.id || "").slice(0, 8)}</td>
                <td style={{ padding: "4px 6px" }}>{g.playersCount}</td>
                <td style={{ padding: "4px 6px" }}>{g.activeConnectionsCount}</td>
                <td style={{ padding: "4px 6px" }}>{g.turn ?? "-"}</td>
                <td style={{ padding: "4px 6px" }}>{g.phase ?? "-"}</td>
                <td style={{ padding: "4px 6px" }}>{g.status ?? "-"}</td>
                <td style={{ padding: "4px 6px" }}>
                  <button 
                    onClick={() => handleJoin(g.id)} 
                    style={{ 
                      marginRight: 6,
                      padding: "2px 8px",
                      borderRadius: 4,
                      border: "1px solid rgba(16, 185, 129, 0.4)",
                      background: "rgba(16, 185, 129, 0.2)",
                      color: "#10b981",
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    Join
                  </button>
                  {canDelete(g) && (
                    <button 
                      disabled={deleting === g.id} 
                      onClick={() => handleDelete(g)}
                      title={
                        isLocalhost ? "Admin delete" :
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
                        cursor: deleting === g.id ? "not-allowed" : "pointer",
                      }}
                    >
                      {deleting === g.id ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}