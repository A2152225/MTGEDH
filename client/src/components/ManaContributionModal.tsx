/**
 * ManaContributionModal.tsx
 * 
 * A modal for multi-player mana contribution effects like:
 * - Join Forces cards (e.g., Collective Voyage)
 * - Tempting Offer cards (e.g., Tempt with Discovery)
 * 
 * Allows each player to specify how much mana they want to contribute
 * to a collective effect.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';

export interface ContributorInfo {
  playerId: string;
  playerName: string;
  contribution: number;
  isYou: boolean;
  hasResponded: boolean;
}

export interface ManaContributionModalProps {
  open: boolean;
  title: string;
  description?: string;
  source: { name: string; imageUrl?: string };
  // The effect scales based on total contribution
  effectDescription: string;
  // All players who can contribute
  contributors: ContributorInfo[];
  // Your player ID
  you: string;
  // Whether you've already submitted
  hasSubmitted: boolean;
  // Your current mana pool (for validation)
  availableMana?: number;
  // Callbacks
  onContribute: (amount: number) => void;
  onCancel?: () => void;
}

export function ManaContributionModal({
  open,
  title,
  description,
  source,
  effectDescription,
  contributors,
  you,
  hasSubmitted,
  availableMana = Infinity,
  onContribute,
  onCancel,
}: ManaContributionModalProps) {
  const [contributionAmount, setContributionAmount] = useState<number>(0);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setContributionAmount(0);
    }
  }, [open]);

  // Calculate total contributions so far
  const totalContributions = useMemo(() => {
    return contributors.reduce((sum, c) => sum + c.contribution, 0);
  }, [contributors]);

  // Count waiting players
  const waitingCount = useMemo(() => {
    return contributors.filter(c => !c.hasResponded).length;
  }, [contributors]);

  const handleContribute = useCallback(() => {
    onContribute(contributionAmount);
  }, [contributionAmount, onContribute]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 20,
          maxWidth: 550,
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
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#10b981' }}>
              🤝 {title}
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
          </div>
        </div>

        {/* Effect description */}
        <div
          style={{
            padding: 12,
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
            color: '#a7f3d0',
          }}
        >
          {effectDescription}
        </div>

        {/* Contributor list */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 6,
            backgroundColor: '#252540',
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#888' }}>
            Player Contributions ({waitingCount} waiting)
          </div>
          {contributors.map(contributor => (
            <div
              key={contributor.playerId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                backgroundColor: contributor.isYou ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.2)',
                borderRadius: 6,
                marginBottom: 6,
                border: contributor.isYou ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid transparent',
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>{contributor.playerName}</span>
                {contributor.isYou && <span style={{ color: '#3b82f6', marginLeft: 6 }}>(You)</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {contributor.hasResponded ? (
                  <span style={{ 
                    color: contributor.contribution > 0 ? '#10b981' : '#6b7280',
                    fontWeight: 600,
                  }}>
                    {contributor.contribution > 0 ? `+${contributor.contribution}` : '0'}
                  </span>
                ) : (
                  <span style={{ color: '#f59e0b', fontSize: 12 }}>⏳ Waiting...</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div
          style={{
            padding: 12,
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 6,
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Total Contributions</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>
            {totalContributions}
          </div>
        </div>

        {/* Your contribution input */}
        {!hasSubmitted && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Your Contribution
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                max={availableMana}
                value={contributionAmount}
                onChange={(e) => setContributionAmount(Math.max(0, Math.min(availableMana, parseInt(e.target.value) || 0)))}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 6,
                  border: '1px solid #4a4a6a',
                  backgroundColor: '#1a1a2e',
                  color: '#fff',
                  fontSize: 16,
                  textAlign: 'center',
                }}
              />
              <button
                onClick={() => setContributionAmount(0)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 6,
                  border: '1px solid #4a4a6a',
                  backgroundColor: '#2a2a4e',
                  color: '#888',
                  cursor: 'pointer',
                }}
              >
                0
              </button>
            </div>
            {availableMana !== Infinity && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                Available mana: {availableMana}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          {onCancel && (
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
          )}
          {!hasSubmitted ? (
            <button
              onClick={handleContribute}
              style={{
                padding: '10px 24px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: '#10b981',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Contribute {contributionAmount > 0 ? contributionAmount : '(0)'}
            </button>
          ) : (
            <div style={{ padding: '10px 24px', color: '#10b981', fontWeight: 500 }}>
              ✓ Submitted - Waiting for others...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ManaContributionModal;
