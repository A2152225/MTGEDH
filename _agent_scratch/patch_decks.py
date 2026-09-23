from pathlib import Path

p = Path(r"D:\Git\MTGEDH\server\src\decks\decksHttp.ts")
text = p.read_text(encoding="utf-8")

old = '''  app.delete('/api/decks/:id', (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const deckId = String(req.params.id || '');
      const existing = getDeck(deckId);
      if (!existing) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
      if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
        res.status(403).json({ error: 'You can only delete decks you created.' });
        return;
      }

      const ok = deleteDeck(deckId);
      if (!ok) {
        res.status(500).json({ error: 'Failed to delete deck' });
        return;
      }
      res.json({ success: true, deckId });
    } catch (err) {
      debugError(1, 'DELETE /api/decks/:id failed:', err);
      res.status(500).json({ error: 'Failed to delete deck' });
    }
  });
}'''

new = '''  const handleDeleteDeck = (req: Request, res: Response, logLabel: string) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const deckId = String(req.params.id || '');
      const existing = getDeck(deckId);
      if (!existing) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
      if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
        res.status(403).json({ error: 'You can only delete decks you created.' });
        return;
      }

      const ok = deleteDeck(deckId);
      if (!ok) {
        res.status(500).json({ error: 'Failed to delete deck' });
        return;
      }
      res.json({ success: true, deckId });
    } catch (err) {
      debugError(1, `${logLabel} failed:`, err);
      res.status(500).json({ error: 'Failed to delete deck' });
    }
  };

  // Kept for local/direct access. Some reverse proxies block DELETE.
  app.delete('/api/decks/:id', (req, res) => {
    handleDeleteDeck(req, res, 'DELETE /api/decks/:id');
  });

  // Proxy-friendly delete (GET/POST-only reverse proxies).
  app.post('/api/decks/:id/delete', (req, res) => {
    handleDeleteDeck(req, res, 'POST /api/decks/:id/delete');
  });
}'''

if old not in text:
    raise SystemExit('decksHttp delete block not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('OK decksHttp.ts')

# serverDeckApi.ts
p2 = Path(r"D:\Git\MTGEDH\client\src\utils\serverDeckApi.ts")
t2 = p2.read_text(encoding='utf-8')

old_read = '''async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Log in to see your server decks.');
    }
    const message = typeof (data as { error?: string }).error === 'string'
      ? (data as { error: string }).error
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}'''

new_read = '''async function readJson<T>(res: Response): Promise<T> {
  const rawText = await res.text();
  let data: unknown = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Log in to see your server decks.');
    }
    const lower = rawText.toLowerCase();
    if (
      res.status === 405 ||
      lower.includes('http verb used to access this page is not allowed') ||
      lower.includes('verb used to access this page is not allowed')
    ) {
      throw new Error('Delete was blocked by the reverse proxy (HTTP verb not allowed).');
    }
    const message = typeof (data as { error?: string }).error === 'string'
      ? (data as { error: string }).error
      : (rawText.trim().startsWith('<') || rawText.length > 280)
        ? `Request failed (${res.status})`
        : (rawText.trim() || `Request failed (${res.status})`);
    throw new Error(message);
  }
  return data as T;
}'''

old_del = '''export async function deleteServerDeckViaApi(deckId: string, playerId?: string): Promise<void> {
  await readJson(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  }));
}'''

new_del = '''export async function deleteServerDeckViaApi(deckId: string, playerId?: string): Promise<void> {
  // Prefer POST /delete so IIS/ARR proxies that block DELETE still work.
  // Fall back to DELETE for local/direct Node access.
  const body = JSON.stringify({ playerId });
  const headers = { 'Content-Type': 'application/json' };
  try {
    await readJson(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}/delete`, {
      method: 'POST',
      headers,
      body,
    }));
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('http verb') && !msg.toLowerCase().includes('not allowed')) {
      // Non-proxy failure from POST — do not mask it with DELETE.
      // Still try DELETE only when POST looks like a routing miss (404) via message.
    }
  }
  await readJson(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: 'DELETE',
    headers,
    body,
  }));
}'''

# Better delete: try POST first; on failure that indicates verb block OR 404 from old server, try DELETE.
# Simpler approach that matches game delete: POST first, then DELETE only if POST got verb-block / 404.
new_del = '''export async function deleteServerDeckViaApi(deckId: string, playerId?: string): Promise<void> {
  // Prefer POST /delete so IIS/ARR proxies that block DELETE still work.
  // Keep DELETE as fallback for older servers / local direct access.
  const body = JSON.stringify({ playerId });
  const headers = { 'Content-Type': 'application/json' };
  const postRes = await apiFetch(`/api/decks/${encodeURIComponent(deckId)}/delete`, {
    method: 'POST',
    headers,
    body,
  });
  if (postRes.ok) {
    await readJson(postRes);
    return;
  }
  const postText = await postRes.text();
  const postLower = postText.toLowerCase();
  const postLooksMissing =
    postRes.status === 404 ||
    postRes.status === 405 ||
    postLower.includes('http verb used to access this page is not allowed') ||
    postLower.includes('cannot post');
  if (!postLooksMissing) {
    // Re-wrap into a Response-like path via synthetic error using readJson semantics
    const fake = new Response(postText, { status: postRes.status, headers: postRes.headers });
    await readJson(fake);
    return;
  }
  await readJson(await apiFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: 'DELETE',
    headers,
    body,
  }));
}'''

if old_read not in t2:
    raise SystemExit('readJson not found')
if old_del not in t2:
    raise SystemExit('deleteServerDeckViaApi not found')
t2 = t2.replace(old_read, new_read, 1).replace(old_del, new_del, 1)
p2.write_text(t2, encoding='utf-8')
print('OK serverDeckApi.ts')
