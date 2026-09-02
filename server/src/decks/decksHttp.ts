import type { Express, Request, Response } from 'express';
import {
  deleteDeck,
  getDeck,
  renameDeck,
  saveDeck,
  updateDeckContent,
  listDecksByOwner,
  listPublicDecks,
} from '../db/decks.js';
import { resolveDeckList } from '../services/deckImport.js';
import { parseDecklist, shouldSkipDeckLine } from '../services/scryfall';
import { debug, debugError, debugWarn } from '../utils/debug.js';
import { getRequestAuthUser, userIsAdmin } from '../auth/requestUser.js';
import { canMutateDeck, canReadDeck, normalizeDeckVisibility } from './deckAccess.js';

function requireAuth(req: Request, res: Response) {
  const user = getRequestAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Log in to manage server decks.' });
    return null;
  }
  return user;
}

async function parseAndMaybeCache(text: string, cacheCards: boolean): Promise<{
  cardCount: number;
  parsed: Array<{ name: string; count: number }>;
  resolvedCardsJson: string | null | undefined;
}> {
  let cardCount = 0;
  let parsed: Array<{ name: string; count: number }> = [];
  try {
    parsed = parseDecklist(text);
    cardCount = parsed.reduce((sum, entry) => sum + (entry.count || 1), 0);
  } catch (e) {
    debugWarn(1, '[API] parseDecklist failed, using fallback count:', e);
    const lines = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0 && !shouldSkipDeckLine(l));
    cardCount = lines.length;
  }

  let resolvedCardsJson: string | null | undefined = undefined;
  if (cacheCards && parsed.length > 0) {
    try {
      const resolution = await resolveDeckList(parsed, { uniqueInstanceIds: false });
      resolvedCardsJson = resolution.resolvedCards.length > 0
        ? JSON.stringify(resolution.resolvedCards)
        : null;
    } catch (e) {
      debugWarn(1, '[API] cacheCards failed:', e);
      resolvedCardsJson = null;
    }
  }
  return { cardCount, parsed, resolvedCardsJson };
}

export function registerDeckHttpRoutes(app: Express): void {
  app.get('/api/decks', (req, res) => {
    try {
      const decks = listPublicDecks();
      res.json({ decks });
    } catch (err) {
      debugError(1, 'GET /api/decks failed:', err);
      res.status(500).json({ error: 'Failed to list decks' });
    }
  });

  app.get('/api/decks/mine', (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;
      const decks = listDecksByOwner(user.id);
      res.json({ decks });
    } catch (err) {
      debugError(1, 'GET /api/decks/mine failed:', err);
      res.status(500).json({ error: 'Failed to list your decks' });
    }
  });

  app.post('/api/decks', (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const { name, text, cacheCards, visibility } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Deck name is required' });
        return;
      }
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Deck text is required' });
        return;
      }

      const vis = normalizeDeckVisibility(visibility, 'private');
      const deckId = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      void (async () => {
        try {
          const { cardCount, resolvedCardsJson } = await parseAndMaybeCache(text, !!cacheCards);
          saveDeck({
            id: deckId,
            name: name.trim(),
            text: text.trim(),
            created_by_id: user.id,
            created_by_name: user.display_name,
            card_count: cardCount,
            resolved_cards: resolvedCardsJson ?? null,
            visibility: vis,
          });
          debug(1, '[API] Deck saved:', { deckId, name: name.trim(), cardCount, createdById: user.id, visibility: vis });
          res.json({ success: true, deckId, cardCount, visibility: vis });
        } catch (err) {
          debugError(1, 'POST /api/decks async failed:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to save deck' });
          }
        }
      })();
    } catch (err) {
      debugError(1, 'POST /api/decks failed:', err);
      res.status(500).json({ error: 'Failed to save deck' });
    }
  });

  app.get('/api/decks/:id', (req, res) => {
    try {
      const deck = getDeck(String(req.params.id || ''));
      const user = getRequestAuthUser(req);
      if (!deck || !canReadDeck(deck, user?.id, userIsAdmin(user))) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
      res.json({ deck });
    } catch (err) {
      debugError(1, 'GET /api/decks/:id failed:', err);
      res.status(500).json({ error: 'Failed to get deck' });
    }
  });

  app.put('/api/decks/:id', (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const deckId = String(req.params.id || '');
    const { name, text, cacheCards, visibility } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Deck name is required' });
      return;
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Deck text is required' });
      return;
    }

    const existing = getDeck(deckId);
    if (!existing) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }
    if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
      res.status(403).json({ error: 'You can only edit decks you created.' });
      return;
    }

    void (async () => {
      try {
        const { cardCount, resolvedCardsJson } = await parseAndMaybeCache(text, !!cacheCards);
        const vis = visibility === undefined
          ? undefined
          : normalizeDeckVisibility(visibility, (existing.visibility as 'public' | 'private') || 'private');
        const updated = updateDeckContent(deckId, {
          name: name.trim(),
          text,
          card_count: cardCount,
          ...(resolvedCardsJson !== undefined ? { resolved_cards: resolvedCardsJson } : {}),
          ...(vis ? { visibility: vis } : {}),
        });
        if (!updated) {
          res.status(500).json({ error: 'Failed to update deck' });
          return;
        }
        res.json({ success: true, deck: updated });
      } catch (err) {
        debugError(1, 'PUT /api/decks/:id failed:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to update deck' });
        }
      }
    })();
  });

  app.patch('/api/decks/:id', (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const deckId = String(req.params.id || '');
      const { name, visibility } = req.body || {};

      const existing = getDeck(deckId);
      if (!existing) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
      if (!canMutateDeck(existing, { accountUserId: user.id, isAdmin: userIsAdmin(user) })) {
        res.status(403).json({ error: 'You can only edit decks you created.' });
        return;
      }

      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          res.status(400).json({ error: 'Deck name is required' });
          return;
        }
        const deck = renameDeck(deckId, name.trim());
        if (!deck) {
          res.status(404).json({ error: 'Deck not found' });
          return;
        }
        if (visibility === 'public' || visibility === 'private') {
          const withVis = updateDeckContent(deckId, {
            name: deck.name,
            text: getDeck(deckId)!.text,
            card_count: deck.card_count,
            visibility,
          });
          res.json({ success: true, deck: withVis || deck });
          return;
        }
        res.json({ success: true, deck });
        return;
      }

      if (visibility === 'public' || visibility === 'private') {
        const full = getDeck(deckId);
        if (!full) {
          res.status(404).json({ error: 'Deck not found' });
          return;
        }
        const deck = updateDeckContent(deckId, {
          name: full.name,
          text: full.text,
          card_count: full.card_count,
          visibility,
        });
        res.json({ success: true, deck });
        return;
      }

      res.status(400).json({ error: 'Nothing to update' });
    } catch (err) {
      debugError(1, 'PATCH /api/decks/:id failed:', err);
      res.status(500).json({ error: 'Failed to update deck' });
    }
  });

  app.delete('/api/decks/:id', (req, res) => {
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
}
