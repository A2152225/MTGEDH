import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { registerAuthHttpRoutes, validateRegisterBody } from '../src/auth/authHttp.js';
import { isLoopbackRemoteAddress } from '../src/auth/loopback.js';
import { registerDeckHttpRoutes } from '../src/decks/decksHttp.js';
import { deleteDeck, getDeck, listPublicDecks } from '../src/db/decks.js';
import { deleteUserCascade } from '../src/db/users.js';

async function startTestApp(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json());
  registerAuthHttpRoutes(app);
  registerDeckHttpRoutes(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

function unique(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('auth + server decks HTTP v1', () => {
  let server: Server;
  let base = '';
  const createdUserIds: string[] = [];
  const createdDeckIds: string[] = [];

  beforeAll(async () => {
    const started = await startTestApp();
    server = started.server;
    base = started.base;
  });

  afterAll(async () => {
    for (const id of createdDeckIds) {
      try { deleteDeck(id); } catch { /* ignore */ }
    }
    for (const id of createdUserIds) {
      try { deleteUserCascade(id); } catch { /* ignore */ }
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function json(path: string, init: RequestInit = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function register(username: string, password: string, displayName: string, email?: string, extra?: { isAdmin?: boolean }) {
    const { res, data } = await json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, email, ...extra }),
    });
    if (res.ok && data?.user?.id) createdUserIds.push(data.user.id);
    return { res, data };
  }

  async function login(username: string, password: string) {
    return json('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  function authHeader(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  it('registers, logs in, and returns me()', async () => {
    const username = unique('v1auth');
    const password = 'correct-horse-battery';
    const { res, data } = await register(username, password, 'Display One', `${username}@example.test`);
    expect(res.status).toBe(201);
    expect(data.user.username).toBe(username.toLowerCase());
    expect(data.user.displayName).toBe('Display One');
    expect(data.token).toBeTruthy();
    expect(String(res.headers.get('set-cookie') || '')).toMatch(/mtgedh_session=/);

    const me = await json('/api/auth/me', { headers: authHeader(data.token) });
    expect(me.res.status).toBe(200);
    expect(me.data.user.username).toBe(username.toLowerCase());

    const loggedIn = await login(username, password);
    expect(loggedIn.res.status).toBe(200);
    expect(loggedIn.data.user.id).toBe(data.user.id);
  });

  it('rejects duplicate username case-insensitively and duplicate email', async () => {
    const username = unique('v1dup');
    const email = `${username}@example.test`;
    const first = await register(username, 'password123', 'A', email);
    expect(first.res.status).toBe(201);

    const dupName = await register(username.toUpperCase(), 'password123', 'B', `${username}-2@example.test`);
    expect(dupName.res.status).toBe(409);

    const dupEmail = await register(unique('v1dupb'), 'password123', 'C', email.toUpperCase());
    expect(dupEmail.res.status).toBe(409);
  });

  it('rejects bad login credentials', async () => {
    const username = unique('v1bad');
    await register(username, 'password123', 'Bad');
    const { res, data } = await login(username, 'wrong-password');
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/invalid/i);
  });

  it('keeps private decks off the public list and unreadable by others', async () => {
    const ownerName = unique('v1own');
    const otherName = unique('v1oth');
    const owner = await register(ownerName, 'password123', 'Owner');
    const other = await register(otherName, 'password123', 'Other');
    expect(owner.res.status).toBe(201);
    expect(other.res.status).toBe(201);

    const created = await json('/api/decks', {
      method: 'POST',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({
        name: 'Secret Storm',
        text: '1 Sol Ring\n1 Command Tower',
        visibility: 'private',
      }),
    });
    expect(created.res.status).toBe(200);
    const deckId = created.data.deckId as string;
    createdDeckIds.push(deckId);

    const pub = await json('/api/decks');
    expect(pub.res.status).toBe(200);
    expect((pub.data.decks as any[]).some((d) => d.id === deckId)).toBe(false);

    const mine = await json('/api/decks/mine', { headers: authHeader(owner.data.token) });
    expect(mine.res.status).toBe(200);
    expect((mine.data.decks as any[]).some((d) => d.id === deckId && d.visibility === 'private')).toBe(true);

    const ownerGet = await json(`/api/decks/${deckId}`, { headers: authHeader(owner.data.token) });
    expect(ownerGet.res.status).toBe(200);
    expect(ownerGet.data.deck.name).toBe('Secret Storm');

    const otherGet = await json(`/api/decks/${deckId}`, { headers: authHeader(other.data.token) });
    expect(otherGet.res.status).toBe(404);

    const anonGet = await json(`/api/decks/${deckId}`);
    expect(anonGet.res.status).toBe(404);
  });

  it('lets the owner edit public and private decks; others cannot', async () => {
    const ownerName = unique('v1ed');
    const otherName = unique('v1ed2');
    const owner = await register(ownerName, 'password123', 'Owner');
    const other = await register(otherName, 'password123', 'Other');

    const priv = await json('/api/decks', {
      method: 'POST',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({ name: 'Priv', text: '1 Sol Ring', visibility: 'private' }),
    });
    const pub = await json('/api/decks', {
      method: 'POST',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({ name: 'Pub', text: '1 Command Tower', visibility: 'public' }),
    });
    createdDeckIds.push(priv.data.deckId, pub.data.deckId);

    const updPriv = await json(`/api/decks/${priv.data.deckId}`, {
      method: 'PUT',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({ name: 'Priv Updated', text: '1 Sol Ring\n1 Arcane Signet', visibility: 'private' }),
    });
    expect(updPriv.res.status).toBe(200);
    expect(updPriv.data.deck.name).toBe('Priv Updated');

    const updPub = await json(`/api/decks/${pub.data.deckId}`, {
      method: 'PUT',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({ name: 'Pub Updated', text: '1 Command Tower\n1 Sol Ring', visibility: 'public' }),
    });
    expect(updPub.res.status).toBe(200);
    expect(updPub.data.deck.name).toBe('Pub Updated');

    const otherEdit = await json(`/api/decks/${pub.data.deckId}`, {
      method: 'PUT',
      headers: authHeader(other.data.token),
      body: JSON.stringify({ name: 'Hacked', text: '1 Sol Ring' }),
    });
    expect(otherEdit.res.status).toBe(403);

    const listed = listPublicDecks();
    expect(listed.some((d) => d.id === pub.data.deckId && d.name === 'Pub Updated')).toBe(true);
    expect(listed.some((d) => d.id === priv.data.deckId)).toBe(false);
    expect(getDeck(priv.data.deckId)?.name).toBe('Priv Updated');
  });

  it('rejects unauthenticated mutations', async () => {
    const owner = await register(unique('v1un'), 'password123', 'Owner');
    const created = await json('/api/decks', {
      method: 'POST',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({ name: 'Lockme', text: '1 Sol Ring', visibility: 'public' }),
    });
    createdDeckIds.push(created.data.deckId);

    const post = await json('/api/decks', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nope', text: '1 Sol Ring' }),
    });
    expect(post.res.status).toBe(401);

    const put = await json(`/api/decks/${created.data.deckId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Nope', text: '1 Sol Ring' }),
    });
    expect(put.res.status).toBe(401);

    const del = await json(`/api/decks/${created.data.deckId}`, { method: 'DELETE' });
    expect(del.res.status).toBe(401);

    const mine = await json('/api/decks/mine');
    expect(mine.res.status).toBe(401);
  });

  it('allows 2-char usernames from loopback and rejects shorter or empty', async () => {
    const two = 'z' + Math.floor(Math.random() * 10);
    const ok = await register(two, 'password123', 'Short');
    expect(ok.res.status).toBe(201);
    expect(ok.data.user.username).toBe(two);
    expect(ok.data.user.isAdmin).toBe(false);

    const one = await register('q', 'password123', 'TooShort');
    expect(one.res.status).toBe(400);
    expect(String(one.data.error || '')).toMatch(/2-24/);

    const empty = await json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: '   ', password: 'password123', displayName: 'Empty' }),
    });
    expect(empty.res.status).toBe(400);
  });

  it('creates an admin from loopback when isAdmin is true; default is user', async () => {
    const adminName = unique('v1adm');
    const admin = await register(adminName, 'password123', 'Admin One', undefined, { isAdmin: true });
    expect(admin.res.status).toBe(201);
    expect(admin.data.user.isAdmin).toBe(true);

    const me = await json('/api/auth/me', { headers: authHeader(admin.data.token) });
    expect(me.res.status).toBe(200);
    expect(me.data.user.isAdmin).toBe(true);

    const userName = unique('v1usr');
    const user = await register(userName, 'password123', 'User One');
    expect(user.res.status).toBe(201);
    expect(user.data.user.isAdmin).toBe(false);
  });

  it('ignores isAdmin and 2-char names when the client is not privileged (remote)', () => {
    expect(isLoopbackRemoteAddress('8.8.8.8')).toBe(false);
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);

    const promoted = validateRegisterBody(
      { username: 'RemoteAdm', password: 'password123', displayName: 'Nope', isAdmin: true },
      { allowPrivileged: false },
    );
    expect(promoted.ok).toBe(true);
    if (promoted.ok) expect(promoted.isAdmin).toBe(false);

    const short = validateRegisterBody(
      { username: 'A2', password: 'password123', displayName: 'A2' },
      { allowPrivileged: false },
    );
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/3-24/);

    const localShort = validateRegisterBody(
      { username: 'A2', password: 'password123', displayName: 'A2', isAdmin: true },
      { allowPrivileged: true },
    );
    expect(localShort.ok).toBe(true);
    if (localShort.ok) expect(localShort.isAdmin).toBe(true);
  });

  it('lets an admin mutate another user deck; a non-admin cannot', async () => {
    const owner = await register(unique('v1owna'), 'password123', 'Owner');
    const other = await register(unique('v1otha'), 'password123', 'Other');
    const admin = await register(unique('v1admx'), 'password123', 'Admin', undefined, { isAdmin: true });
    expect(admin.data.user.isAdmin).toBe(true);

    const created = await json('/api/decks', {
      method: 'POST',
      headers: authHeader(owner.data.token),
      body: JSON.stringify({ name: 'Owner Deck', text: '1 Sol Ring', visibility: 'public' }),
    });
    expect(created.res.status).toBe(200);
    const deckId = created.data.deckId as string;
    createdDeckIds.push(deckId);

    const otherEdit = await json(`/api/decks/${deckId}`, {
      method: 'PUT',
      headers: authHeader(other.data.token),
      body: JSON.stringify({ name: 'Hacked', text: '1 Sol Ring' }),
    });
    expect(otherEdit.res.status).toBe(403);

    const adminEdit = await json(`/api/decks/${deckId}`, {
      method: 'PUT',
      headers: authHeader(admin.data.token),
      body: JSON.stringify({ name: 'Admin Edit', text: '1 Sol Ring\n1 Command Tower', cacheCards: false }),
    });
    expect(adminEdit.res.status).toBe(200);
    expect(adminEdit.data.deck.name).toBe('Admin Edit');

    const otherDel = await json(`/api/decks/${deckId}`, {
      method: 'DELETE',
      headers: authHeader(other.data.token),
    });
    expect(otherDel.res.status).toBe(403);

    const adminDel = await json(`/api/decks/${deckId}`, {
      method: 'DELETE',
      headers: authHeader(admin.data.token),
    });
    expect(adminDel.res.status).toBe(200);
  });
});
