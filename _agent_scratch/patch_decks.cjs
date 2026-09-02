const { readText, writeText, mustReplaceOnce, mustReplace } = require('./patch_util.cjs');

// decksHttp.ts
{
  const p = 'D:/Git/MTGEDH/server/src/decks/decksHttp.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`import { getRequestAuthUser } from '../auth/requestUser.js';
import { canReadDeck, normalizeDeckVisibility } from './deckAccess.js';
`,
`import { getRequestAuthUser, userIsAdmin } from '../auth/requestUser.js';
import { canMutateDeck, canReadDeck, normalizeDeckVisibility } from './deckAccess.js';
`, 'decksHttp imports');

  next = mustReplaceOnce(next,
`      const user = getRequestAuthUser(req);
      if (!deck || !canReadDeck(deck, user?.id)) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
`,
`      const user = getRequestAuthUser(req);
      if (!deck || !canReadDeck(deck, user?.id, userIsAdmin(user))) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
`, 'decksHttp canReadDeck');

  next = mustReplace(next,
`    if (existing.created_by_id !== user.id) {
      res.status(403).json({ error: 'You can only edit decks you created.' });
      return;
    }
`,
`    if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
      res.status(403).json({ error: 'You can only edit decks you created.' });
      return;
    }
`, 'decksHttp edit owner checks');

  next = mustReplaceOnce(next,
`      if (existing.created_by_id !== user.id) {
        res.status(403).json({ error: 'You can only delete decks you created.' });
        return;
      }
`,
`      if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
        res.status(403).json({ error: 'You can only delete decks you created.' });
        return;
      }
`, 'decksHttp delete owner check');

  writeText(p, next, eol);
  console.log('patched decksHttp.ts');
}

// canModifySavedDeck
{
  const p = 'D:/Git/MTGEDH/server/src/socket/deck-handlers/deckImportConfirmState.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`  const accountUserId = typeof (socket.data as any)?.accountUserId === 'string'
    ? String((socket.data as any).accountUserId)
    : '';
  return deck.created_by_id === playerId
    || (!!accountUserId && deck.created_by_id === accountUserId);
`,
`  if ((socket.data as any)?.accountIsAdmin === true) return true;
  const accountUserId = typeof (socket.data as any)?.accountUserId === 'string'
    ? String((socket.data as any).accountUserId)
    : '';
  return deck.created_by_id === playerId
    || (!!accountUserId && deck.created_by_id === accountUserId);
`, 'canModifySavedDeck');
  writeText(p, next, eol);
  console.log('patched deckImportConfirmState.ts');
}

// visibleDecksForSocket + canReadDeck in deck.ts
{
  const p = 'D:/Git/MTGEDH/server/src/socket/deck.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`import { getSocketAccountUserId } from "../auth/attachSocketAuth.js";
`,
`import { getSocketAccountIsAdmin, getSocketAccountUserId } from "../auth/attachSocketAuth.js";
`, 'deck.ts import');
  next = mustReplaceOnce(next,
`function visibleDecksForSocket(socket: Socket) {
  return listDecksVisibleTo(getSocketAccountUserId(socket));
}
`,
`function visibleDecksForSocket(socket: Socket) {
  return listDecksVisibleTo(getSocketAccountUserId(socket), getSocketAccountIsAdmin(socket));
}
`, 'deck.ts visibleDecks');
  next = mustReplace(next, 'canReadDeck(deck, getSocketAccountUserId(socket))', 'canReadDeck(deck, getSocketAccountUserId(socket), getSocketAccountIsAdmin(socket))', 'deck.ts canReadDeck');
  writeText(p, next, eol);
  console.log('patched deck.ts');
}
