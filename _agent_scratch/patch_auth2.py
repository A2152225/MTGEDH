from pathlib import Path
import re

p = Path(r"D:\Git\MTGEDH\server\src\index.ts")
t = p.read_text(encoding="utf-8")
t = re.sub(
    r"does not rewrite /admin/\* to Node.*?prefer",
    "does not rewrite /admin/* to Node - prefer",
    t,
    count=1,
)

start = t.find('app.post("/api/admin/games/:id/delete"')
if start < 0:
    raise SystemExit("POST delete route not found")
# expand start to include preceding comment lines
comment_start = t.rfind("// Proxy-friendly admin delete", 0, start)
if comment_start < 0:
    comment_start = start
end = t.find("});", start)
if end < 0:
    raise SystemExit("end of POST delete not found")
end = end + len("});")

new_post = '''// Proxy-friendly admin delete (goes through /api rewrite; POST avoids IIS DELETE blocks).
// Require authenticated admin session only. Do NOT use canUseAdminHttp/loopback here:
// IIS ARR peers appear as 127.0.0.1, which would authorize every proxied client.
app.post("/api/admin/games/:id/delete", (req, res) => {
  try {
    if (!userIsAdmin(getRequestAuthUser(req as any))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = String(req.params.id || "");
    if (!id) {
      res.status(400).json({ error: "Missing game id" });
      return;
    }
    adminHardDeleteGame(id, `POST /api/admin/games/:id/delete ${id}`);
    res.json({ ok: true });
  } catch (err) {
    debugError(1, "POST /api/admin/games/:id/delete failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});'''

t = t[:comment_start] + new_post + t[end:]

# bulk delete auth
old = """if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: \"Forbidden\" });
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
    }"""

# Only replace the POST delete-all canUseAdminHttp occurrence
marker = 'app.post("/api/admin/games/delete-all"'
i = t.find(marker)
if i < 0:
    raise SystemExit("delete-all route missing")
j = t.find("if (!canUseAdminHttp(req))", i)
if j < 0 or j > i + 400:
    raise SystemExit("canUseAdminHttp in delete-all not found near route")
t = t[:j] + "if (!userIsAdmin(getRequestAuthUser(req as any)))" + t[j + len("if (!canUseAdminHttp(req))"):]
# update comment above delete-all
t = t.replace(
    "// Proxy-friendly bulk admin delete (optional; same authz).",
    "// Proxy-friendly bulk admin delete. Authenticated admin only (not loopback via ARR).",
    1,
)

p.write_text(t, encoding="utf-8")
print("OK tightened POST admin auth")