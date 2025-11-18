import React, { useEffect, useState } from "react";

type GameRow = {
  id: string;
  format: string;
  startingLife: number;
  createdAt: number;
  playersCount: number;
  turn: number | null;
  phase: string | null;
  status: string | null;
};

export default function GameList(props: { onJoin: (gameId: string) => void; pollMs?: number; onRefresh?: () => void }) {
  const { onJoin, pollMs = 5000, onRefresh } = props;
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchGames = async () => {
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
  };

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  const handleJoin = (id: string) => {
    console.debug("[GAME_LIST] join", id);
    onJoin(id);
  };

  const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "");
  const handleDelete = async (id: string) => {
    if (!isLocalhost) return;
    if (!confirm(`Delete game ${id}? This removes persisted events.`)) return;
    try {
      setDeleting(id);
      const res = await fetch(`/admin/games/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const txt = await res.text();
        alert("Delete failed: " + txt);
      } else {
        await fetchGames();
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Active Games</div>
        <div>
          <button onClick={fetchGames} disabled={loading}>Refresh</button>
        </div>
      </div>
      <div style={{ maxHeight: 260, overflow: "auto" }}>
        {games.length === 0 && !loading && <div style={{ color: "#666" }}>No games</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th style={{ padding: "6px 8px" }}>Game</th>
              <th style={{ padding: "6px 8px" }}>Players</th>
              <th style={{ padding: "6px 8px" }}>Turn</th>
              <th style={{ padding: "6px 8px" }}>Phase</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {games.map(g => (
              <tr key={g.id} style={{ borderBottom: "1px solid #fafafa" }}>
                <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{(g.id || "").slice(0, 8)}</td>
                <td style={{ padding: "6px 8px" }}>{g.playersCount}</td>
                <td style={{ padding: "6px 8px" }}>{g.turn ?? "-"}</td>
                <td style={{ padding: "6px 8px" }}>{g.phase ?? "-"}</td>
                <td style={{ padding: "6px 8px" }}>{g.status ?? "-"}</td>
                <td style={{ padding: "6px 8px" }}>
                  <button onClick={() => handleJoin(g.id)} style={{ marginRight: 8 }}>Join</button>
                  {isLocalhost && (
                    <button disabled={deleting === g.id} onClick={() => handleDelete(g.id)}>
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