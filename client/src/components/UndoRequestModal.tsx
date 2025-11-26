/**
 * UndoRequestModal.tsx
 * 
 * A modal for handling undo requests.
 * Shows when another player requests an undo and you need to approve/reject.
 * Also allows the current player to request an undo.
 */

import React, { useState, useEffect } from 'react';

// Undo timeout in milliseconds - should match server's UNDO_TIMEOUT_MS
const UNDO_TIMEOUT_MS = 60000;

export interface UndoRequestData {
  undoId: string;
  requesterId: string;
  requesterName: string;
  description: string;
  actionsToUndo: number;
  expiresAt: number;
  approvals: Record<string, boolean>;
  playerIds: string[];
}

export interface UndoRequestModalProps {
  open: boolean;
  you: string;
  request: UndoRequestData | null;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void; // For requester to cancel their own request
}

export function UndoRequestModal({
  open,
  you,
  request,
  onApprove,
  onReject,
  onCancel,
}: UndoRequestModalProps) {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  // Update time remaining every second
  useEffect(() => {
    if (!open || !request) {
      setTimeRemaining(0);
      return;
    }

    const updateTime = () => {
      const remaining = Math.max(0, request.expiresAt - Date.now());
      setTimeRemaining(remaining);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [open, request]);

  if (!open || !request) return null;

  const isRequester = request.requesterId === you;
  const hasResponded = request.approvals[you] !== undefined;
  const approvedCount = Object.values(request.approvals).filter(v => v === true).length;
  const rejectedCount = Object.values(request.approvals).filter(v => v === false).length;
  const pendingCount = request.playerIds.length - approvedCount - rejectedCount;
  const timeRemainingSeconds = Math.ceil(timeRemaining / 1000);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 9500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#1e1e1e',
          borderRadius: 12,
          width: 450,
          maxWidth: '95vw',
          padding: 20,
          color: '#fff',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', color: '#fbbf24' }}>
          ⏪ Undo Request
        </h3>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>
            <strong>{request.requesterName}</strong> is requesting to undo:
          </div>
          <div
            style={{
              background: '#2a2a3e',
              padding: 12,
              borderRadius: 6,
              fontSize: 13,
              color: '#a0aec0',
            }}
          >
            {request.description}
          </div>
        </div>

        {/* Approval status */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
            Approval Status:
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {request.playerIds.map(playerId => {
              const status = request.approvals[playerId];
              const isYou = playerId === you;
              let color = '#4a5568'; // pending
              let label = 'Pending';
              if (status === true) {
                color = '#48bb78';
                label = 'Approved';
              } else if (status === false) {
                color = '#f56565';
                label = 'Rejected';
              }

              return (
                <div
                  key={playerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    background: color,
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {isYou ? 'You' : playerId}
                  <span style={{ opacity: 0.8 }}>({label})</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Time remaining */}
        <div style={{ marginBottom: 16, fontSize: 12, color: '#888' }}>
          ⏱️ Time remaining: {timeRemainingSeconds} seconds
          <div
            style={{
              marginTop: 4,
              height: 4,
              background: '#2a2a3e',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(timeRemaining / UNDO_TIMEOUT_MS) * 100}%`,
                height: '100%',
                background: timeRemainingSeconds < 10 ? '#f56565' : '#fbbf24',
                transition: 'width 1s linear',
              }}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {isRequester ? (
            <button
              onClick={onCancel}
              style={{
                background: '#4a5568',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '10px 20px',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel Request
            </button>
          ) : hasResponded ? (
            <div style={{ fontSize: 13, color: '#888', padding: '10px 0' }}>
              You have already responded to this request.
            </div>
          ) : (
            <>
              <button
                onClick={onReject}
                style={{
                  background: '#f56565',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                style={{
                  background: '#48bb78',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default UndoRequestModal;
