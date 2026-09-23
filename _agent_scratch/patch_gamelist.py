from pathlib import Path

# ========== 1) GameList.tsx ==========
p = Path(r"D:\Git\MTGEDH\client\src\components\GameList.tsx")
text = p.read_text(encoding="utf-8")

old_handle = '''  const handleDelete = async (game: GameRow) => {
    const isCreator = currentPlayerId && game.createdByPlayerId === currentPlayerId;
    
    if (!confirm(`Delete game ${game.id}? This removes persisted events.`)) return;
    
    try {
      setDeleting(game.id);
      
      if (isAdmin) {
        const res = await fetch(`/admin/games/${encodeURIComponent(game.id)}`, {
          method: "DELETE",
          credentials: "include",
          headers: authHeaders(),
        });
        if (!res.ok) {
          const txt = await res.text();
          alert("Delete failed: " + txt);
        } else {
          await fetchGames();
        }
      } else if (isCreator) {
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
      debugError(1, "Delete failed:", err);
      alert("Delete failed");
    } finally {
      setDeleting(null);
    }
  };'''

new_handle = '''  const formatDeleteError = (status: number, bodyText: string): string => {
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
  };'''

if old_handle not in text:
    raise SystemExit("GameList handleDelete block not found")
text = text.replace(old_handle, new_handle, 1)
p.write_text(text, encoding="utf-8")
print("OK GameList.tsx")
