/**
 * Server configuration
 */
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath: process.env.DATABASE_PATH || './data/mtgedh.sqlite',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  sessionSecret: process.env.SESSION_SECRET || 'default-secret-change-me',
  scryfallApiUrl: process.env.SCRYFALL_API_URL || 'https://api.scryfall.com',
  wsPort: parseInt(process.env.WS_PORT || '3002', 10),
  logLevel: process.env.LOG_LEVEL || 'info'
};
