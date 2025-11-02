/**
 * Main server entry point
 */
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { setupRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';

const app = express();

// Middleware
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Setup routes
setupRoutes(app);

// Start server
const server = app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

// Setup WebSocket
setupWebSocket(server);

export default app;
