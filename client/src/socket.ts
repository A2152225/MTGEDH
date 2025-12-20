import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../../shared/src';
import { debug, debugWarn, debugError } from "./utils/debug";


// Point to your server explicitly when client and server run on different ports.
// In dev, set VITE_SOCKET_URL=http://localhost:4000
const URL = import.meta.env?.VITE_SOCKET_URL || undefined; // undefined => same origin

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  path: '/socket.io',
  autoConnect: true,
  // Prefer pure WebSocket to avoid long-polling interference with Vite dev server
  transports: ['websocket'],
  // Robust reconnection defaults
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 10000,
});

// Optional diagnostics (remove once stable)
socket.on('connect', () => {
  // eslint-disable-next-line no-console
  debug(1, '[client] connected:', socket.id);
});
socket.on('disconnect', (reason) => {
  // eslint-disable-next-line no-console
  debug(1, '[client] disconnected:', reason);
});
socket.on('connect_error', (err) => {
  // eslint-disable-next-line no-console
  debugError(1, '[client] connect_error', err);
});
// Manager-level error (rare, optional)
socket.io.on('error', (err: unknown) => {
  // eslint-disable-next-line no-console
  debugError(1, '[client] manager error', err);
});

export default socket;
