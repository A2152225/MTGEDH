from pathlib import Path

p = Path(r"D:\Git\MTGEDH\server\src\index.ts")
text = p.read_text(encoding="utf-8")

old = '''// Admin: delete a game (only from localhost)
app.delete("/admin/games/:id", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = String(req.params.id || "");
    if (!id) {
      res.status(400).json({ error: "Missing game id" });
      return;
    }

    // Remove in-memory game from GameManager (authoritative)
    try {
      const removed = GameManager.deleteGame(id);
      if (!removed) {
        debug(1, 
          `DELETE /admin/games/${id}: GameManager.deleteGame returned false (no in-memory game)`
        );
      } else {
        debug(1, 
          `DELETE /admin/games/${id}: GameManager.deleteGame removed in-memory game`
        );
      }
    } catch (e) {
      debugWarn(1, 
        `DELETE /admin/games/${id}: GameManager.deleteGame threw`,
        e
      );
    }

    // Remove persisted rows (events + games metadata)
    const ok = dbDeleteGame(id);
    if (!ok) {
      debugWarn(2, `DELETE /admin/games/${id}: deleteGame returned false`);
    }

    res.json({ ok: true });
  } catch (err) {
    debugError(1, "DELETE /admin/games/:id failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Admin: delete ALL games (only from localhost)
app.delete("/admin/games", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const persisted = dbListGames();
    const ids = persisted.map((r) => String(r.game_id)).filter(Boolean);

    let deleted = 0;
    for (const id of ids) {
      try {
        GameManager.deleteGame(id);
      } catch {
        // best-effort
      }
      try {
        const ok = dbDeleteGame(id);
        if (ok) deleted++;
      } catch (e) {
        debugWarn(1, `DELETE /admin/games: dbDeleteGame threw for ${id}`, e);
      }
    }

    res.json({ ok: true, requested: ids.length, deleted, ids });
  } catch (err) {
    debugError(1, "DELETE /admin/games failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});'''

new = '''/** Shared admin hard-delete for one game (in-memory + DB). Caller must authorize. */
function adminHardDeleteGame(id: string, logPrefix: string): void {
  try {
    const removed = GameManager.deleteGame(id);
    if (!removed) {
      debug(1, `${logPrefix}: GameManager.deleteGame returned false (no in-memory game)`);
    } else {
      debug(1, `${logPrefix}: GameManager.deleteGame removed in-memory game`);
    }
  } catch (e) {
    debugWarn(1, `${logPrefix}: GameManager.deleteGame threw`, e);
  }

  const ok = dbDeleteGame(id);
  if (!ok) {
    debugWarn(2, `${logPrefix}: deleteGame returned false`);
  }
}

function handleAdminDeleteGameById(req: any, res: any, logPrefix: string): void {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = String(req.params.id || "");
    if (!id) {
      res.status(400).json({ error: "Missing game id" });
      return;
    }

    adminHardDeleteGame(id, `${logPrefix} ${id}`);
    res.json({ ok: true });
  } catch (err) {
    debugError(1, `${logPrefix} failed:`, err);
    res.status(500).json({ error: "Delete failed" });
  }
}

// Admin: delete a game (localhost / authenticated admin).
// Kept for local/direct access. IIS in front of magic.a2games.win often blocks DELETE
// and does not rewrite /admin/* to Node — prefer POST /api/admin/games/:id/delete or socket deleteGame.
app.delete("/admin/games/:id", (req, res) => {
  handleAdminDeleteGameById(req, res, "DELETE /admin/games/:id");
});

// Proxy-friendly admin delete (GET/POST-only reverse proxies; goes through /api rewrite).
// Same authz as DELETE /admin/games/:id (canUseAdminHttp: admin session or loopback).
app.post("/api/admin/games/:id/delete", (req, res) => {
  handleAdminDeleteGameById(req, res, "POST /api/admin/games/:id/delete");
});

// Admin: delete ALL games (only from localhost)
app.delete("/admin/games", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const persisted = dbListGames();
    const ids = persisted.map((r) => String(r.game_id)).filter(Boolean);

    let deleted = 0;
    for (const id of ids) {
      try {
        GameManager.deleteGame(id);
      } catch {
        // best-effort
      }
      try {
        const ok = dbDeleteGame(id);
        if (ok) deleted++;
      } catch (e) {
        debugWarn(1, `DELETE /admin/games: dbDeleteGame threw for ${id}`, e);
      }
    }

    res.json({ ok: true, requested: ids.length, deleted, ids });
  } catch (err) {
    debugError(1, "DELETE /admin/games failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Proxy-friendly bulk admin delete (optional; same authz).
app.post("/api/admin/games/delete-all", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const persisted = dbListGames();
    const ids = persisted.map((r) => String(r.game_id)).filter(Boolean);

    let deleted = 0;
    for (const id of ids) {
      try {
        GameManager.deleteGame(id);
      } catch {
        // best-effort
      }
      try {
        const ok = dbDeleteGame(id);
        if (ok) deleted++;
      } catch (e) {
        debugWarn(1, `POST /api/admin/games/delete-all: dbDeleteGame threw for ${id}`, e);
      }
    }

    res.json({ ok: true, requested: ids.length, deleted, ids });
  } catch (err) {
    debugError(1, "POST /api/admin/games/delete-all failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});'''

if old not in text:
    raise SystemExit("admin delete block not found in server index.ts")
text = text.replace(old, new, 1)
p.write_text(text, encoding="utf-8")
print("OK server/src/index.ts")
