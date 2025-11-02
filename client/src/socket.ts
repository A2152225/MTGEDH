import { io } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../../shared/src';

export const socket = io({
  path: '/socket.io',
  autoConnect: true
}) as unknown as ReturnType<typeof io> & {
  emit: <E extends keyof ClientToServerEvents>(event: E, payload: Parameters<ClientToServerEvents[E]>[0]) => boolean;
  on: <E extends keyof ServerToClientEvents>(event: E, cb: ServerToClientEvents[E]) => void;
  off: <E extends keyof ServerToClientEvents>(event: E, cb?: ServerToClientEvents[E]) => void;
};