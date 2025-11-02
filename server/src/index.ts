import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socket';
import { initDb } from './db';

const port = Number(process.env.PORT || 4000);
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // tighten later in production
});

// DB init
await initDb();

// Socket handlers
registerSocketHandlers(io);

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on ${port}`);
});