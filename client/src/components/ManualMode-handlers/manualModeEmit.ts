// Origin parent: client/src/components/ManualModeControl.tsx
// Cluster: socket emit helpers for kitchen-table manual verbs.
// Public entry symbols: emitManualAction, peekManualZone, ManualAck.

import { socket } from '../../socket';
import type { ManualActionPayload, ManualZone } from '../../../../shared/src/manualAction';

export type ManualAck = {
  ok: boolean;
  error?: string;
  summary?: string;
  peekedCards?: Array<{ id: string; name: string; type_line?: string; image_uris?: { small?: string; normal?: string } }>;
};

export function emitManualAction(
  gameId: string,
  payload: Omit<ManualActionPayload, 'actorId'> & { actorId?: string },
): Promise<ManualAck> {
  return new Promise((resolve) => {
    socket.emit('manualAction', { gameId, ...payload }, (result: ManualAck) => {
      resolve(result || { ok: false, error: 'No response from server.' });
    });
  });
}

export function peekManualZone(
  gameId: string,
  zone: ManualZone | 'library_top',
  options?: { playerId?: string; count?: number },
): Promise<ManualAck> {
  return new Promise((resolve) => {
    socket.emit('manualPeek', {
      gameId,
      zone,
      playerId: options?.playerId,
      count: options?.count,
    }, (result: ManualAck) => {
      resolve(result || { ok: false, error: 'No response from server.' });
    });
  });
}
