/**
 * MutateTargetModal.tsx
 * 
 * A modal for selecting a mutate target and choosing whether to put the
 * mutating creature on top or bottom of the target creature.
 * 
 * Rule 702.140: Mutate
 * - Target must be a non-Human creature you own
 * - Choose to put the mutating card on top or bottom
 * - Top card determines characteristics (name, power/toughness, type)
 * - All abilities from all cards are gained
 */

import React, { useState, useMemo, useCallback } from 'react';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface MutateTarget {
  id: string;
  name: string;
  typeLine: string;
  power?: string;
  toughness?: string;
  imageUrl?: string;
  controller: string;
  controllerName?: string;
  /** If the creature is already mutated, how many cards are in the stack */
  mutationCount?: number;
  /** Whether this creature is already mutated */
  isAlreadyMutated?: boolean;
}

export interface MutateTargetModalProps {
  open: boolean;
  /** The card being cast with mutate */
  mutatingCard: {
    id: string;
    name: string;
    imageUrl?: string;
    power?: string;
    toughness?: string;
    mutateCost: string;
  };
  /** Valid target creatures */
  targets: MutateTarget[];
  onConfirm: (targetId: string, onTop: boolean) => void;
  onCancel: () => void;
  /** If true, the spell resolves as a normal creature (target became illegal) */
  onCastNormally?: () => void;
}

export function MutateTargetModal({
  open,
  mutatingCard,
  targets,
  onConfirm,
  onCancel,
  onCastNormally,
}: MutateTargetModalProps) {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [onTop, setOnTop] = useState(true);

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedTargetId(null);
      setOnTop(true);
    }
  }, [open]);

  const selectedTarget = useMemo(() => {
    return targets.find(t => t.id === selectedTargetId);
  }, [targets, selectedTargetId]);

  const handleConfirm = useCallback(() => {
    if (selectedTargetId) {
      onConfirm(selectedTargetId, onTop);
    }
  }, [selectedTargetId, onTop, onConfirm]);

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
          padding: 24,
          maxWidth: 1000,
          width: '95%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 20, alignItems: 'flex-start' }}>
          {/* Mutating card preview */}
          {mutatingCard.imageUrl && (
            <div
              style={{
                width: 130,
                height: 182,
                borderRadius: 8,
                overflow: 'hidden',
                flexShrink: 0,
                border: '2px solid #8b5cf6',
                boxShadow: '0 0 16px rgba(139, 92, 246, 0.5)',
              }}
            >
              <img
                src={mutatingCard.imageUrl}
                alt={mutatingCard.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#8b5cf6' }}>
              🧬 Cast with Mutate
            </h2>
            <div style={{ marginTop: 8, fontSize: 14, color: '#a0aec0' }}>
              <strong>{mutatingCard.name}</strong> — Mutate {mutatingCard.mutateCost}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: '#888' }}>
              Choose a non-Human creature you own to mutate onto.
              The mutated creature gains all abilities of both cards.
            </div>
            {mutatingCard.power && mutatingCard.toughness && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                P/T if on top: {mutatingCard.power}/{mutatingCard.toughness}
              </div>
            )}
          </div>
        </div>

        {/* Target selection */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 8,
            backgroundColor: '#252540',
            padding: 12,
          }}
        >
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#a0aec0' }}>
            Select Target Creature ({targets.length} valid targets)
          </div>
          
          {targets.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              <div style={{ fontSize: 16, marginBottom: 8 }}>No valid targets available.</div>
              <div style={{ fontSize: 13 }}>
                Mutate requires a non-Human creature you own on the battlefield.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {targets.map(target => {
                const isSelected = target.id === selectedTargetId;
                
                return (
                  <div
                    key={target.id}
                    onClick={() => setSelectedTargetId(target.id)}
                    style={{
                      position: 'relative',
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: isSelected ? '3px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden' }}>
                      {target.imageUrl ? (
                        <img
                          src={target.imageUrl}
                          alt={target.name}
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            background: '#333',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            textAlign: 'center',
                            padding: 8,
                          }}
                        >
                          {target.name}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '6px 8px' }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {target.name}
                      </div>
                      {target.power && target.toughness && (
                        <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                          {target.power}/{target.toughness}
                        </div>
                      )}
                      {target.isAlreadyMutated && (
                        <div style={{ fontSize: 10, color: '#8b5cf6', marginTop: 2 }}>
                          🧬 Already mutated ({target.mutationCount})
                        </div>
                      )}
                    </div>
                    
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
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
          )}
        </div>

        {/* Position selection (top/bottom) */}
        {selectedTarget && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              backgroundColor: 'rgba(139, 92, 246, 0.1)',
              borderRadius: 8,
              border: '1px solid rgba(139, 92, 246, 0.3)',
            }}
          >
            <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: '#8b5cf6' }}>
              Position in Mutation Stack
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 6,
                  border: onTop ? '2px solid #8b5cf6' : '1px solid #4a4a6a',
                  backgroundColor: onTop ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                  cursor: 'pointer',
                  flex: 1,
                  minWidth: 200,
                }}
              >
                <input
                  type="radio"
                  name="mutatePosition"
                  checked={onTop}
                  onChange={() => setOnTop(true)}
                  style={{ accentColor: '#8b5cf6' }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>On Top</div>
                  <div style={{ fontSize: 11, color: '#a0aec0' }}>
                    Uses {mutatingCard.name}'s name, P/T
                    {mutatingCard.power && mutatingCard.toughness && 
                      ` (${mutatingCard.power}/${mutatingCard.toughness})`}
                  </div>
                </div>
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 6,
                  border: !onTop ? '2px solid #8b5cf6' : '1px solid #4a4a6a',
                  backgroundColor: !onTop ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                  cursor: 'pointer',
                  flex: 1,
                  minWidth: 200,
                }}
              >
                <input
                  type="radio"
                  name="mutatePosition"
                  checked={!onTop}
                  onChange={() => setOnTop(false)}
                  style={{ accentColor: '#8b5cf6' }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>On Bottom</div>
                  <div style={{ fontSize: 11, color: '#a0aec0' }}>
                    Uses {selectedTarget.name}'s name, P/T
                    {selectedTarget.power && selectedTarget.toughness && 
                      ` (${selectedTarget.power}/${selectedTarget.toughness})`}
                  </div>
                </div>
              </label>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#888' }}>
              The mutated creature will have all abilities from both cards.
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            {onCastNormally && (
              <button
                onClick={onCastNormally}
                style={{
                  padding: '10px 16px',
                  borderRadius: 6,
                  border: '1px solid #4a4a6a',
                  backgroundColor: 'transparent',
                  color: '#a0aec0',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
                title="Cast as a normal creature instead of mutating"
              >
                Cast Normally
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
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
              disabled={!selectedTargetId}
              style={{
                padding: '10px 24px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: selectedTargetId ? '#8b5cf6' : '#4a4a6a',
                color: selectedTargetId ? '#fff' : '#888',
                cursor: selectedTargetId ? 'pointer' : 'not-allowed',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              🧬 Mutate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MutateTargetModal;
