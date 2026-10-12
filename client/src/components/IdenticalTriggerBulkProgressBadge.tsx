import React, { useEffect, useState } from 'react';
import { socket } from '../socket';
import {
  type BulkResolveProgressState,
  bulkResolveProgressFraction,
  bulkResolveProgressLabel,
  expireBulkResolveProgress,
  reduceBulkResolveProgress,
} from '../utils/bulkResolveProgress';

/**
 * Small non-blocking badge for bulk identical-trigger resolution
 * ("Resolving Cathars' Crusade 37/100" + bar). Listens to the server's throttled
 * "identicalTriggerBulkProgress" events; clears on end or after a safety timeout.
 */
export function IdenticalTriggerBulkProgressBadge({ gameId }: { gameId?: string | null }) {
  const [progress, setProgress] = useState<BulkResolveProgressState>(null);

  useEffect(() => {
    const onProgress = (event: any) => setProgress((s) => reduceBulkResolveProgress(s, event, Date.now(), gameId));
    const onDisconnect = () => setProgress(null);
    (socket as any).on('identicalTriggerBulkProgress', onProgress);
    socket.on('disconnect', onDisconnect);
    return () => {
      (socket as any).off('identicalTriggerBulkProgress', onProgress);
      socket.off('disconnect', onDisconnect);
    };
  }, [gameId]);

  useEffect(() => {
    if (!progress) return;
    const timer = setInterval(() => setProgress((s) => expireBulkResolveProgress(s, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [progress !== null]);

  if (!progress) return null;
  const pct = Math.round(bulkResolveProgressFraction(progress) * 100);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="identical-trigger-bulk-progress"
      style={{
        pointerEvents: 'none',
        marginBottom: 10,
        padding: '6px 10px',
        borderRadius: 8,
        background: 'rgba(245,158,11,0.15)',
        border: '1px solid rgba(245,158,11,0.6)',
        color: '#fde68a',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {bulkResolveProgressLabel(progress)}
      </div>
      <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #d97706)', transition: 'width 200ms linear' }} />
      </div>
    </div>
  );
}

export default IdenticalTriggerBulkProgressBadge;
