/**
 * GET /api/precons/decklist?setCode=&deckName=
 * Returns the baked precon list as editable deck text. No auth: these are
 * published product lists, same data Import already loads.
 */
import type { Express } from 'express';
import { loadPreconDecklistText } from './services/preconDecklistText.js';
import { debugError } from './utils/debug.js';

export function registerPreconDecklistHttpRoutes(app: Express): void {
  app.get('/api/precons/decklist', (req, res) => {
    try {
      const setCode = String(req.query.setCode || '').trim();
      const deckName = String(req.query.deckName || '').trim();
      if (!setCode || !deckName || setCode.length > 16 || deckName.length > 200) {
        res.status(400).json({ error: 'setCode and deckName are required.' });
        return;
      }

      const loaded = loadPreconDecklistText(setCode, deckName);
      if (!loaded) {
        res.status(404).json({
          error: `No local decklist for "${deckName}" (${setCode.toUpperCase()}).`,
        });
        return;
      }

      res.set({ 'Cache-Control': 'public, max-age=86400' });
      res.json(loaded);
    } catch (err) {
      debugError(1, 'GET /api/precons/decklist failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to load that precon decklist.' });
      }
    }
  });
}
