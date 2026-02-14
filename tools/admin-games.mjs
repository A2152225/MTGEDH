#!/usr/bin/env node
/**
 * tools/admin-games.mjs
 *
 * Small CLI to manage games on a running local server without interacting with stdin.
 *
 * Usage:
 *   node tools/admin-games.mjs list
 *   node tools/admin-games.mjs delete <gameId>
 *   node tools/admin-games.mjs delete-all
 *
 * Env:
 *   PORT=3001 (default)
 *   HOST=127.0.0.1 (default)
 */

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const baseUrl = `http://${host}:${port}`;

function usage(exitCode = 1) {
  // Intentionally plain output (PowerShell-friendly)
  console.log('Usage:');
  console.log('  node tools/admin-games.mjs list');
  console.log('  node tools/admin-games.mjs delete <gameId>');
  console.log('  node tools/admin-games.mjs delete-all');
  console.log('');
  console.log(`Default target: ${baseUrl}`);
  process.exit(exitCode);
}

async function request(method, path) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `${res.status} ${res.statusText}`;
    throw new Error(`${method} ${path} failed: ${msg}`);
  }
  return json;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage(1);

  if (cmd === 'list') {
    const json = await request('GET', '/api/games');
    const games = Array.isArray(json?.games) ? json.games : [];
    if (games.length === 0) {
      console.log('No games.');
      return;
    }
    for (const g of games) {
      console.log(`${g.id}  players=${g.playersCount ?? '?'}  active=${g.activeConnectionsCount ?? '?'}  phase=${g.phase ?? ''}`);
    }
    return;
  }

  if (cmd === 'delete') {
    const gameId = rest.join(' ').trim();
    if (!gameId) usage(1);
    const json = await request('DELETE', `/admin/games/${encodeURIComponent(gameId)}`);
    console.log(`Deleted ${gameId}: ok=${json?.ok === true}`);
    return;
  }

  if (cmd === 'delete-all') {
    const json = await request('DELETE', '/admin/games');
    console.log(`Delete-all: requested=${json?.requested ?? '?'} deleted=${json?.deleted ?? '?'} ok=${json?.ok === true}`);
    return;
  }

  usage(1);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
