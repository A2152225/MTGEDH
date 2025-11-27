/**
 * PlayerTargetSelectionModal.tsx
 * 
 * A modal for selecting a player as a target for abilities like mill.
 * Used for effects that target "target player" or "target opponent".
 * 
 * Supports:
 * - Selecting from available players
 * - Filtering by opponent-only
 * - Visual feedback for valid targets
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { PlayerRef } from '../../../shared/src';

export interface PlayerTarget {
  id: string;
  name: string;
  life: number;
  libraryCount?: number;
  isOpponent?: boolean;
  isSelf?: boolean;
}

export interface PlayerTargetSelectionModalProps {
  open: boolean;
  title: string;
  description?: string;
  source: { name: string; imageUrl?: string };
  // Available players to target
  players: PlayerTarget[];
  // Filter options
  opponentOnly?: boolean;
  selfOnly?: boolean;
  // Selection settings
  minTargets?: number;
  maxTargets?: number;
  // Callbacks
  onConfirm: (selectedPlayerIds: string[]) => void;
  onCancel: () => void;
}

export function PlayerTargetSelectionModal({
  open,
  title,
  description,
  source,
  players,
  opponentOnly = false,
  selfOnly = false,
  minTargets = 1,
  maxTargets = 1,
  onConfirm,
  onCancel,
}: PlayerTargetSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open]);

  // Filter players based on restrictions
  const validPlayers = useMemo(() => {
    return players.filter(player => {
      if (opponentOnly && !player.isOpponent) return false;
      if (selfOnly && !player.isSelf) return false;
      return true;
    });
  }, [players, opponentOnly, selfOnly]);

  const toggleSelect = useCallback((playerId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else if (next.size < maxTargets) {
        next.add(playerId);
      }
      return next;
    });
  }, [maxTargets]);

  const canConfirm = selectedIds.size >= minTargets && selectedIds.size <= maxTargets;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(Array.from(selectedIds));
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && minTargets === 0) {
          onCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 20,
          maxWidth: 500,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {source.imageUrl && (
            <div
              style={{
                width: 60,
                height: 84,
                borderRadius: 6,
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid #4a4a6a',
              }}
            >
              <img
                src={source.imageUrl}
                alt={source.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#f59e0b' }}>
              👤 {title}
            </h2>
            {source.name && (
              <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
                {source.name}
              </div>
            )}
            {description && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#a0aec0' }}>
                {description}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              {minTargets === maxTargets
                ? `Select ${minTargets} player${minTargets !== 1 ? 's' : ''}`
                : `Select ${minTargets} to ${maxTargets} players`}
              {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
            </div>
          </div>
        </div>

        {/* Player Selection Grid */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 6,
            backgroundColor: '#252540',
            padding: 12,
          }}
        >
          {validPlayers.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              {validPlayers.map(player => {
                const isSelected = selectedIds.has(player.id);
                const canSelect = isSelected || selectedIds.size < maxTargets;

                return (
                  <div
                    key={player.id}
                    onClick={() => canSelect && toggleSelect(player.id)}
                    style={{
                      position: 'relative',
                      borderRadius: 8,
                      padding: 16,
                      border: isSelected ? '3px solid #f59e0b' : '1px solid rgba(255,255,255,0.15)',
                      backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0,0,0,0.2)',
                      cursor: canSelect ? 'pointer' : 'not-allowed',
                      opacity: canSelect ? 1 : 0.5,
                      transition: 'all 0.15s',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 8 }}>
                      {player.isSelf ? '🙋' : '👤'}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {player.name}
                      {player.isSelf && <span style={{ color: '#888', fontWeight: 400 }}> (You)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', display: 'flex', justifyContent: 'center', gap: 12 }}>
                      <span>❤️ {player.life}</span>
                      {player.libraryCount !== undefined && (
                        <span>📚 {player.libraryCount}</span>
                      )}
                    </div>
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          backgroundColor: '#f59e0b',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#000',
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              No valid players to target.
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: canConfirm ? '#f59e0b' : '#4a4a6a',
              color: canConfirm ? '#000' : '#888',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Confirm Target
          </button>
        </div>
      </div>
    </div>
  );
}

export default PlayerTargetSelectionModal;
