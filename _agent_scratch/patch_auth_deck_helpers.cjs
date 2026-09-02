const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');

// requestUser.ts
{
  const p = 'D:/Git/MTGEDH/server/src/auth/requestUser.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`export function publicAuthUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email || null,
  };
}
`,
`export function userIsAdmin(user: { is_admin?: number | boolean | null } | null | undefined): boolean {
  if (!user) return false;
  return user.is_admin === true || Number(user.is_admin) === 1;
}

export function publicAuthUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email || null,
    isAdmin: userIsAdmin(user),
  };
}
`, 'requestUser publicAuthUser');
  writeText(p, next, eol);
  console.log('patched requestUser.ts');
}

// attachSocketAuth.ts
{
  const p = 'D:/Git/MTGEDH/server/src/auth/attachSocketAuth.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`import { validateSession } from '../db/users.js';
`,
`import { validateSession } from '../db/users.js';
import { userIsAdmin } from './requestUser.js';
`, 'attachSocketAuth import');
  next = mustReplaceOnce(next,
`  (socket.data as any).accountUserId = user.id;
  (socket.data as any).accountUsername = user.username;
  (socket.data as any).accountDisplayName = user.display_name;
`,
`  (socket.data as any).accountUserId = user.id;
  (socket.data as any).accountUsername = user.username;
  (socket.data as any).accountDisplayName = user.display_name;
  (socket.data as any).accountIsAdmin = userIsAdmin(user);
`, 'attachSocketAuth fields');
  next = mustReplaceOnce(next,
`export function getSocketAccountUserId(socket: { data?: any }): string | null {
  const id = socket.data?.accountUserId;
  return typeof id === 'string' && id.trim() ? id : null;
}
`,
`export function getSocketAccountUserId(socket: { data?: any }): string | null {
  const id = socket.data?.accountUserId;
  return typeof id === 'string' && id.trim() ? id : null;
}

export function getSocketAccountIsAdmin(socket: { data?: any }): boolean {
  return socket.data?.accountIsAdmin === true;
}
`, 'attachSocketAuth helper');
  writeText(p, next, eol);
  console.log('patched attachSocketAuth.ts');
}

// deckAccess.ts
{
  const p = 'D:/Git/MTGEDH/server/src/decks/deckAccess.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`export function canReadDeck(
  deck: { visibility?: string | null; created_by_id: string },
  accountUserId?: string | null,
): boolean {
  if (isPublicDeck(deck)) return true;
  return !!accountUserId && accountUserId === deck.created_by_id;
}

export function canMutateDeck(
  deck: { created_by_id: string },
  actor: { accountUserId?: string | null; playerId?: string | null },
): boolean {
  if (actor.accountUserId && actor.accountUserId === deck.created_by_id) return true;
  if (!actor.accountUserId && actor.playerId && actor.playerId === deck.created_by_id) return true;
  return false;
}

export function listDecksVisibleTo(accountUserId?: string | null): SavedDeckSummary[] {
  const byId = new Map<string, SavedDeckSummary>();
  for (const deck of listPublicDecks()) {
    byId.set(deck.id, deck);
  }
  if (accountUserId) {
    for (const deck of listDecksByOwner(accountUserId)) {
      byId.set(deck.id, deck);
    }
  }
  return [...byId.values()];
}
`,
`export function canReadDeck(
  deck: { visibility?: string | null; created_by_id: string },
  accountUserId?: string | null,
  isAdmin?: boolean,
): boolean {
  if (isAdmin) return true;
  if (isPublicDeck(deck)) return true;
  return !!accountUserId && accountUserId === deck.created_by_id;
}

export function canMutateDeck(
  deck: { created_by_id: string },
  actor: { accountUserId?: string | null; playerId?: string | null; isAdmin?: boolean },
): boolean {
  if (actor.isAdmin) return true;
  if (actor.accountUserId && actor.accountUserId === deck.created_by_id) return true;
  if (!actor.accountUserId && actor.playerId && actor.playerId === deck.created_by_id) return true;
  return false;
}

export function listDecksVisibleTo(accountUserId?: string | null, isAdmin?: boolean): SavedDeckSummary[] {
  if (isAdmin) return listDecks();
  const byId = new Map<string, SavedDeckSummary>();
  for (const deck of listPublicDecks()) {
    byId.set(deck.id, deck);
  }
  if (accountUserId) {
    for (const deck of listDecksByOwner(accountUserId)) {
      byId.set(deck.id, deck);
    }
  }
  return [...byId.values()];
}
`, 'deckAccess auth');
  writeText(p, next, eol);
  console.log('patched deckAccess.ts');
}
