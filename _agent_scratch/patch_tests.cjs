const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');
const p = 'D:/Git/MTGEDH/server/tests/auth-and-decks.http.integration.test.ts';
const { text, eol } = readText(p);
let next = text;

next = mustReplaceOnce(next,
`import { registerAuthHttpRoutes } from '../src/auth/authHttp.js';
`,
`import { registerAuthHttpRoutes, validateRegisterBody } from '../src/auth/authHttp.js';
import { isLoopbackRemoteAddress } from '../src/auth/loopback.js';
`, 'test imports');

next = mustReplaceOnce(next,
`  async function register(username: string, password: string, displayName: string, email?: string) {
    const { res, data } = await json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, email }),
    });
`,
`  async function register(username: string, password: string, displayName: string, email?: string, extra?: { isAdmin?: boolean }) {
    const { res, data } = await json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, email, ...extra }),
    });
`, 'test register helper');

next = mustReplaceOnce(next,
`    const mine = await json('/api/decks/mine');
    expect(mine.res.status).toBe(401);
  });
});
`,
`    const mine = await json('/api/decks/mine');
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

    const otherEdit = await json(\`/api/decks/\${deckId}\`, {
      method: 'PUT',
      headers: authHeader(other.data.token),
      body: JSON.stringify({ name: 'Hacked', text: '1 Sol Ring' }),
    });
    expect(otherEdit.res.status).toBe(403);

    const adminEdit = await json(\`/api/decks/\${deckId}\`, {
      method: 'PUT',
      headers: authHeader(admin.data.token),
      body: JSON.stringify({ name: 'Admin Edit', text: '1 Sol Ring\\n1 Command Tower', cacheCards: false }),
    });
    expect(adminEdit.res.status).toBe(200);
    expect(adminEdit.data.deck.name).toBe('Admin Edit');

    const otherDel = await json(\`/api/decks/\${deckId}\`, {
      method: 'DELETE',
      headers: authHeader(other.data.token),
    });
    expect(otherDel.res.status).toBe(403);

    const adminDel = await json(\`/api/decks/\${deckId}\`, {
      method: 'DELETE',
      headers: authHeader(admin.data.token),
    });
    expect(adminDel.res.status).toBe(200);
  });
});
`, 'test new cases');

writeText(p, next, eol);
console.log('patched auth-and-decks tests');
