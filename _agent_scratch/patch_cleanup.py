from pathlib import Path

# Simplify deleteServerDeckViaApi
p = Path(r"D:\Git\MTGEDH\client\src\utils\serverDeckApi.ts")
t = p.read_text(encoding="utf-8")
start = t.find("export async function deleteServerDeckViaApi")
end = t.find("export type DeckCardLookupResult")
if start < 0 or end < 0:
    raise SystemExit(f"markers not found start={start} end={end}")
new_fn = '''export async function deleteServerDeckViaApi(deckId: string, playerId?: string): Promise<void> {
  // Prefer POST /delete so IIS/ARR proxies that block DELETE still work.
  // Keep DELETE as fallback for older servers / local direct access.
  const body = JSON.stringify({ playerId });
  const headers = { 'Content-Type': 'application/json' };
  const postRes = await apiFetch(`/api/decks/${encodeURIComponent(deckId)}/delete`, {
    method: 'POST',
    headers,
    body,
  });
  if (postRes.ok || (postRes.status !== 404 && postRes.status !== 405)) {
    await readJson(postRes);
    return;
  }
  await readJson(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: 'DELETE',
    headers,
    body,
  }));
}

'''
t = t[:start] + new_fn + t[end:]
p.write_text(t, encoding="utf-8")
print("simplified deleteServerDeckViaApi")

# Add admin proxy rule to web.config files (before SPA-Fallback)
for wc in [
    Path(r"D:\Git\MTGEDH\web.config"),
    Path(r"D:\Git\MTGEDH\client\public\web.config"),
]:
    if not wc.exists():
        print("skip missing", wc)
        continue
    w = wc.read_text(encoding="utf-8")
    if 'rule name="Admin"' in w or "rule name='Admin'" in w:
        print("admin rule already present", wc)
        continue
    needle = '''        <!-- SPA fallback - serve index.html for client-side routing -->
        <rule name="SPA-Fallback" stopProcessing="true">'''
    insert = '''        <!-- Admin HTTP (delete games, etc.) - must reach Node; otherwise SPA fallback + DELETE verb fails in IIS -->
        <rule name="Admin" stopProcessing="true">
          <match url="^admin/(.*)" />
          <action type="Rewrite" url="http://localhost:3001/admin/{R:1}" />
        </rule>
        
        <!-- SPA fallback - serve index.html for client-side routing -->
        <rule name="SPA-Fallback" stopProcessing="true">'''
    if needle not in w:
        print("SPA needle not found in", wc)
        continue
    # Also update SPA negate pattern to include admin
    w2 = w.replace(needle, insert, 1)
    w2 = w2.replace(
        '<add input="{REQUEST_URI}" pattern="^/(api|socket\\.io)" negate="true" />',
        '<add input="{REQUEST_URI}" pattern="^/(api|admin|socket\\.io)" negate="true" />',
        1,
    )
    wc.write_text(w2, encoding="utf-8")
    print("patched", wc)
