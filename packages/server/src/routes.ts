/**
 * API routes setup
 */
import { Express } from 'express';

export function setupRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/v1/cards/search', (_req, res) => {
    // TODO: Implement card search via Scryfall
    res.json({ cards: [] });
  });

  app.post('/api/v1/games', (_req, res) => {
    // TODO: Implement game creation
    res.json({ gameId: 'placeholder' });
  });
}
