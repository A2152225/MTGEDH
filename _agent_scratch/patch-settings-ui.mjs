const fs = require('fs');

function readUtf8(p) {
  const buf = fs.readFileSync(p);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const text = buf.slice(bom ? 3 : 0).toString('utf8');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  return { text, bom, nl };
}

function writeUtf8(p, text, nl) {
  const body = text.replace(/\r\n/g, '\n').replace(/\n/g, nl);
  fs.writeFileSync(p, Buffer.from(body, 'utf8'));
}

function mustReplace(text, from, to, label) {
  if (!text.includes(from)) {
    throw new Error('missing snippet: ' + label);
  }
  const next = text.split(from).join(to);
  if (next === text) throw new Error('no change: ' + label);
  return next;
}

function onceReplace(text, from, to, label) {
  const idx = text.indexOf(from);
  if (idx < 0) throw new Error('missing snippet: ' + label);
  const idx2 = text.indexOf(from, idx + from.length);
  if (idx2 >= 0) throw new Error('snippet not unique: ' + label);
  return text.slice(0, idx) + to + text.slice(idx + from.length);
}

const results = [];

function patch(p, fn) {
  const { text, nl } = readUtf8(p);
  const next = fn(text);
  if (next === text) throw new Error('no change in ' + p);
  writeUtf8(p, next.endsWith('\n') ? next : next + '\n', nl);
  results.push(p + ' (' + nl.replace('\r', '\\r').replace('\n', '\\n') + ')');
}

// --- SettingsMenu trailing newline ---
{
  const p = 'D:/Git/MTGEDH/client/src/components/SettingsMenu.tsx';
  const { text, nl } = readUtf8(p);
  if (!text.endsWith('\n')) writeUtf8(p, text + '\n', nl);
}

// --- AuthSessionPanel: re-read then only change logged-in branch ---
{
  const p = 'D:/Git/MTGEDH/client/src/components/AuthSessionPanel.tsx';
  patch(p, (text) => {
    let next = text;
    next = onceReplace(
      next,
      "import React, { useState } from 'react';",
      "import React, { useEffect, useState } from 'react';",
      'AuthSessionPanel react import'
    );
    next = onceReplace(
      next,
      "  const { user, busy, error, nameInput, onNameInput, onLogin, onRegister, onLogout } = props;",
      "  const { user, busy, error, nameInput, onNameInput, onLogin, onRegister } = props;",
      'AuthSessionPanel destructure'
    );
    const lock = [
      "  const shownError = localError || error || null;",
      "",
      "  useEffect(() => {",
      "    if (!user?.displayName) return;",
      "    if (nameInput !== user.displayName) onNameInput(user.displayName);",
      "  }, [user, nameInput, onNameInput]);",
    ].join('\n');
    next = onceReplace(
      next,
      "  const shownError = localError || error || null;",
      lock,
      'AuthSessionPanel name lock'
    );
    const oldLoggedIn = [
      "  if (user) {",
      "    return (",
      "      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>",
      "        <span style={{ fontSize: 12, color: '#c4b5fd', whiteSpace: 'nowrap' }}>",
      "          {user.displayName}",
      "          <span style={{ color: '#9ca3af', marginLeft: 6 }}>@{user.username}</span>",
      "        </span>",
      "        <input",
      "          value={nameInput}",
      "          onChange={(e) => onNameInput(e.target.value)}",
      "          placeholder=\"Seat name\"",
      "          title=\"In-game seat name (defaults to your display name)\"",
      "          style={inputStyle}",
      "        />",
      "        <button type=\"button\" onClick={() => { void onLogout(); }} disabled={busy} style={btnStyle}>",
      "          Logout",
      "        </button>",
      "        {shownError && <span role=\"alert\" style={{ fontSize: 11, color: '#f87171' }}>{shownError}</span>}",
      "      </div>",
      "    );",
      "  }",
    ].join('\n');
    const newLoggedIn = [
      "  if (user) {",
      "    return (",
      "      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>",
      "        <span style={{ fontSize: 12, color: '#c4b5fd', whiteSpace: 'nowrap' }}>",
      "          Playing as {user.displayName}",
      "        </span>",
      "        {shownError && <span role=\"alert\" style={{ fontSize: 11, color: '#f87171' }}>{shownError}</span>}",
      "      </div>",
      "    );",
      "  }",
    ].join('\n');
    next = onceReplace(next, oldLoggedIn, newLoggedIn, 'AuthSessionPanel logged-in branch');
    return next;
  });
}

// --- useAuthSession: prefill seat name on session restore ---
{
  const p = 'D:/Git/MTGEDH/client/src/hooks/useAuthSession.ts';
  patch(p, (text) => {
    const from = [
      "        const me = await fetchAuthMe();",
      "        if (!cancelled) {",
      "          setUser(me);",
      "          if (me) applySocketAuthToken(getStoredSessionToken());",
      "        }",
    ].join('\n');
    const to = [
      "        const me = await fetchAuthMe();",
      "        if (!cancelled) {",
      "          setUser(me);",
      "          if (me) {",
      "            applySocketAuthToken(getStoredSessionToken());",
      "            options?.onLoginPrefillName?.(me.displayName);",
      "          }",
      "        }",
    ].join('\n');
    return onceReplace(text, from, to, 'useAuthSession fetchAuthMe prefill');
  });
}

// --- appPlayLayoutMain: Settings instead of top-level Appearance ---
{
  const p = 'D:/Git/MTGEDH/client/src/App-handlers/appPlayLayoutMain.tsx';
  patch(p, (text) => {
    let next = onceReplace(
      text,
      'import { AuthSessionPanel } from "../components/AuthSessionPanel";',
      'import { AuthSessionPanel } from "../components/AuthSessionPanel";\nimport { SettingsMenu } from "../components/SettingsMenu";',
      'layout SettingsMenu import'
    );
    const oldBtnStart = '                <button\n                  onClick={() => setAppearanceModalOpen(true)}';
    const idx = next.indexOf(oldBtnStart);
    if (idx < 0) throw new Error('missing Appearance button start');
    const endMarker = '\n                </button>';
    const endIdx = next.indexOf(endMarker, idx);
    if (endIdx < 0) throw new Error('missing Appearance button end');
    const oldBtn = next.slice(idx, endIdx + endMarker.length);
    if (!oldBtn.includes('Appearance')) throw new Error('Appearance label missing in button block');
    const newBtn = [
      '                <SettingsMenu',
      '                  user={authSession?.user ?? null}',
      '                  busy={authSession?.busy}',
      '                  onLogout={() => authSession.logout()}',
      '                  onOpenAppearance={() => setAppearanceModalOpen(true)}',
      '                />',
    ].join('\n');
    next = onceReplace(next, oldBtn, newBtn, 'layout Appearance -> SettingsMenu');
    return next;
  });
}

// --- Deck server panel: Cache is owner-only ---
{
  const p = 'D:/Git/MTGEDH/client/src/components/DeckManagerModal-handlers/deckManagerModalServerPanel.tsx';
  patch(p, (text) => {
    return onceReplace(
      text,
      '{!d.has_cached_cards && !useRestServer && (',
      '{canEditServerDeck(d) && !d.has_cached_cards && !useRestServer && (',
      'cache button owner gate'
    );
  });
}

// --- socket canModifySavedDeck: drop localhost admin ---
{
  const p = 'D:/Git/MTGEDH/server/src/socket/deck-handlers/deckImportConfirmState.ts';
  patch(p, (text) => {
    let next = text;
    next = onceReplace(
      next,
      ' * confirm-id / room / localhost saved-deck guards, and wipe-confirm RQ cancel.',
      ' * confirm-id / room / owner-only saved-deck guards, and wipe-confirm RQ cancel.',
      'deckImportConfirmState header'
    );
    next = onceReplace(
      next,
      [
        "function getSocketRemoteAddress(socket: Socket): string {",
        "  return String(socket.handshake?.address || (socket as any).conn?.remoteAddress || '')",
        "    .replace(/^::ffff:/, '');",
        "}",
        "",
        "function isLocalhostSocket(socket: Socket): boolean {",
        "  const remote = getSocketRemoteAddress(socket);",
        "  return remote === '127.0.0.1' || remote === '::1' || remote === 'localhost';",
        "}",
        "",
        "export function canModifySavedDeck(",
        "  socket: Socket,",
        "  deck: { created_by_id: string },",
        "  playerId: PlayerID,",
        "): boolean {",
        "  const accountUserId = typeof (socket.data as any)?.accountUserId === 'string'",
        "    ? String((socket.data as any).accountUserId)",
        "    : '';",
        "  return deck.created_by_id === playerId",
        "    || (!!accountUserId && deck.created_by_id === accountUserId)",
        "    || isLocalhostSocket(socket);",
        "}",
      ].join('\n'),
      [
        "export function canModifySavedDeck(",
        "  socket: Socket,",
        "  deck: { created_by_id: string },",
        "  playerId: PlayerID,",
        "): boolean {",
        "  const accountUserId = typeof (socket.data as any)?.accountUserId === 'string'",
        "    ? String((socket.data as any).accountUserId)",
        "    : '';",
        "  return deck.created_by_id === playerId",
        "    || (!!accountUserId && deck.created_by_id === accountUserId);",
        "}",
      ].join('\n'),
      'canModifySavedDeck owner-only'
    );
    return next;
  });
}

// --- cacheSavedDeck owner check + comment ---
{
  const p = 'D:/Git/MTGEDH/server/src/socket/deck.ts';
  patch(p, (text) => {
    let next = onceReplace(
      text,
      '// updateSavedDeck - update an existing deck\'s name and list (owner or localhost admin)',
      '// updateSavedDeck - update an existing deck\'s name and list (owner-only)',
      'updateSavedDeck comment'
    );
    next = onceReplace(
      next,
      [
        "        const saved = getDeckDB(deckId);",
        "        if (!saved) {",
        "          socket.emit(\"deckError\", { gameId, message: \"Deck not found.\" });",
        "          return;",
        "        }",
        "",
        "        // Check if already cached",
      ].join('\n'),
      [
        "        const saved = getDeckDB(deckId);",
        "        if (!saved) {",
        "          socket.emit(\"deckError\", { gameId, message: \"Deck not found.\" });",
        "          return;",
        "        }",
        "",
        "        if (!canModifySavedDeck(socket, saved, pid)) {",
        "          socket.emit(\"deckError\", { gameId, message: \"You can only cache decks you created.\" });",
        "          return;",
        "        }",
        "",
        "        // Check if already cached",
      ].join('\n'),
      'cacheSavedDeck owner check'
    );
    return next;
  });
}

console.log('patched:');
for (const line of results) console.log(' -', line);