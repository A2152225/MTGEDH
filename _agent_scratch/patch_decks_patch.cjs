const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');
const p = 'D:/Git/MTGEDH/server/src/decks/decksHttp.ts';
const { text, eol } = readText(p);
let next = text;
next = mustReplaceOnce(next,
`      if (existing.created_by_id !== user.id) {
        res.status(403).json({ error: 'You can only edit decks you created.' });
        return;
      }
`,
`      if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
        res.status(403).json({ error: 'You can only edit decks you created.' });
        return;
      }
`, 'decksHttp PATCH owner');
writeText(p, next, eol);
console.log('patched leftover PATCH check');
