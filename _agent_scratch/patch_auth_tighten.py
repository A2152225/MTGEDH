from pathlib import Path

# --- server index.ts: require admin session for proxied POST routes ---
p = Path(r"D:\Git\MTGEDH\server\src\index.ts")
t = p.read_text(encoding="utf-8")

# Fix corrupted comment if present
t = t.replace("does not rewrite /admin/* to Node \uFFFD? prefer", "does not rewrite /admin/* to Node - prefer")
t = t.replace("does not rewrite /admin/* to Node �?\" prefer", "does not rewrite /admin/* to Node - prefer")
t = t.replace("does not rewrite /admin/* to Node �?" prefer", "does not rewrite /admin/* to Node - prefer")

old_post = '''// Proxy-friendly admin delete (GET/POST-only reverse proxies; goes through /api rewrite).
// Same authz as DELETE /admin/games/:id (canUseAdminHttp: admin session or loopback).
app.post("/api/admin/games/:id/delete", (req, res) => {
  handleAdminDeleteGameById(req, res, "POST /api/admin/games/:id/delete");
});'''

new_post = '''// Proxy-friendly admin delete (goes through /api rewrite; POST avoids IIS DELETE blocks).
// IMPORTANT: require authenticated admin session only — do NOT treat ARR/IIS peers as
// loopback (req.socket.remoteAddress is 127.0.0.1 for all proxied clients).
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

if old_post not in t:
    raise SystemExit("POST single-delete block not found")
t = t.replace(old_post, new_post, 1)

old_bulk = '''// Proxy-friendly bulk admin delete (optional; same authz).
app.post("/api/admin/games/delete-all", (req, res) => {
  try {
    if (!canUseAdminHttp(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }'''

new_bulk = '''// Proxy-friendly bulk admin delete. Authenticated admin only (not loopback via ARR).
app.post("/api/admin/games/delete-all", (req, res) => {
  try {
    if (!userIsAdmin(getRequestAuthUser(req as any))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }'''

if old_bulk not in t:
    raise SystemExit("POST delete-all block not found")
t = t.replace(old_bulk, new_bulk, 1)
p.write_text(t, encoding="utf-8")
print("updated server index.ts auth for POST admin")

# --- Revert /admin reverse-proxy from web.configs (ARR loopback would bypass canUseAdminHttp) ---
# Root web.config
wc = Path(r"D:\Git\MTGEDH\web.config")
w = wc.read_text(encoding="utf-8")
admin_block_markers = [
'''        <!-- Admin HTTP (delete games, etc.) - must reach Node; otherwise SPA fallback + DELETE verb fails in IIS -->
        <rule name="Admin" stopProcessing="true">
          <match url="^admin/(.*)" />
          <action type="Rewrite" url="http://localhost:3001/admin/{R:1}" />
        </rule>
        
''',
]
for m in admin_block_markers:
    if m in w:
        w = w.replace(m, "", 1)
        print("removed Admin rule from root web.config")
w = w.replace(
    '<add input="{REQUEST_URI}" pattern="^/(api|admin|socket\\.io)" negate="true" />',
    '<add input="{REQUEST_URI}" pattern="^/(api|socket\\.io)" negate="true" />',
    1,
)
wc.write_text(w, encoding="utf-8")

# public web.config
pc = Path(r"D:\Git\MTGEDH\client\public\web.config")
pw = pc.read_text(encoding="utf-8")
pub_block = '''
        <!-- 2b) Proxy /admin/* to Node (game delete etc.). Without this, DELETE /admin hits SPA and IIS returns verb-not-allowed. -->
        <rule name="ReverseProxyAdmin" stopProcessing="true">
          <match url="^admin/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/admin/{R:1}" appendQueryString="true" />
        </rule>
'''
if pub_block in pw:
    pw = pw.replace(pub_block, "\n", 1)
    print("removed ReverseProxyAdmin from public web.config")
else:
    print("public admin block not exact match; checking...")
    if "ReverseProxyAdmin" in pw:
        raise SystemExit("ReverseProxyAdmin present but block text mismatch")
pw = pw.replace(
'''            <add input="{REQUEST_URI}" pattern="^/api" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/admin" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/socket\\.io" negate="true" />''',
'''            <add input="{REQUEST_URI}" pattern="^/api" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/socket\\.io" negate="true" />''',
1,
)
pc.write_text(pw, encoding="utf-8")
print("web.config auth-safe")
