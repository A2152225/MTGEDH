/**
 * Main server entry point
 */
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { setupRoutes } from './routes';
import { setupWebSocket } from './websocket';

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
