/**
 * API routes setup
 */
import { Express } from 'express';

export function setupRoutes(app: Express): void {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/v1/cards/search', (req, res) => {
    // TODO: Implement card search via Scryfall
    res.json({ cards: [] });
  });

  app.post('/api/v1/games', (req, res) => {
    // TODO: Implement game creation
    res.json({ gameId: 'placeholder' });
  });
}
